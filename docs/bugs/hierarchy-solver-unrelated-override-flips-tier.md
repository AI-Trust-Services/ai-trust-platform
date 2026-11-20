# Investigation: baseline MINIMAL, but any answer override flips to HIGH_RISK

> **SUPERSEDED** by `classification-pipeline-skips-label-with-satisfiable-rule.md`.
> Live MinIO data (`SYS-D84E84C1`) confirmed the cause is the pipeline's per-label skip
> granularity (Candidate B below), **not** the ANNEX_III exception logic (Candidate A).
> The real fix is in `classification_pipeline.py`, not the solver. Kept for the reasoning trail.

**Status:** diagnosed, root cause is a design mismatch between pipeline classification and deterministic re-eval
**Files:** `ai-system-registry/backend/app/hierarchy_solver.py`, `app/classification_pipeline.py`, `app/questionnaire_tree.py`

## Symptom

- Baseline resolve (no overrides) → **MINIMAL**
- Set *any* answer override (e.g. `Prohibited_8 = NO`, a question unrelated to HIGH_RISK) → **HIGH_RISK**

`Prohibited_8` is referenced *only* by the PROHIBITED/SOCIAL_SCORING rule — it is not in the
HIGH_RISK tree at all. So the override itself cannot logically trigger HIGH_RISK. Something
else changes when *any* override is present.

## The mechanism

`hierarchy_solver.solve()` Step 1 (lines ~109–120) re-evaluates **every** label's rule tree
deterministically whenever `overrides.answers` is non-empty — not just the label owning the
overridden question:

```python
if overrides and overrides.answers:
    base_answers = _build_answers_map(questionnaire_result)
    effective_answers = {**base_answers, **overrides.answers}
    for label_id, classification in classification_map.items():
        new_result = eval_label(label, effective_answers)   # ← re-evals HIGH_RISK too
        if new_result != classification["result"]:
            classification_map[label_id] = {..., "result": new_result, "_answers_overridden": True}
```

So with **no** override, the risk winner comes from the **pipeline's stored LLM classification**
for each label. With **any** override present, HIGH_RISK is recomputed from `eval_label` over
the questionnaire answers.

**The two disagree.** The deterministic re-eval returns `True` for HIGH_RISK on this system's
answers; the pipeline's stored classification returned `False` (→ baseline MINIMAL). The
override is merely the switch that flips the solver from "trust the LLM's label result" to
"recompute deterministically".

## Why the pipeline and the re-eval disagree — two candidate root causes

### Candidate A: ANNEX_III exception logic + NOT_ENOUGH_INFORMATION filtering

The HIGH_RISK / ANNEX_III_USE_CASE rule is:

```
all:
  any:  High_Risk_3..30  IN [YES, PARTIALLY]          # an Annex III use case applies
  any:  High_Risk_31/32  IN [YES, PARTIALLY]          # OR
        all: 31 EQUALS NO, 32 EQUALS NO,              # not exempt under Art. 6(3)
             33..36 IN [NO, PARTIALLY]
```

`questionnaire_tree` filters NOT_ENOUGH_INFORMATION / CONFLICT / NOT_APPLICABLE before atom
evaluation. An atom like `High_Risk_31 EQUALS NO` evaluates **False** when the answer is
NEI (filtered → no eligible value → False). So the *second* `any` is False and the whole
rule is False → the label is MINIMAL-eligible.

But the Classification-LLM (pipeline) may have reasoned about the Art. 6(3) exception
differently — e.g. treating "no evidence of an exception" as "exception does not apply"
(= deterministic NO), yielding HIGH_RISK=True. Or vice-versa. The LLM's holistic judgement
and the strict tree eval diverge exactly on the unanswered/NEI questions.

### Candidate B: labels skipped by the pipeline are re-evaluated from an empty base

If the pipeline **skipped** HIGH_RISK (any referenced question missing → `skipped_labels`),
the seeded entry is `result=False`. Then Step 1's re-eval runs `eval_label` over
`base_answers` (the full questionnaire map, which may well contain enough YES/NO answers to
satisfy the rule) and flips it to True. So the baseline (False, seeded) and the override-run
(True, re-evaluated) differ — and the trigger is again "any override present", because Step 1
only runs when `overrides.answers` is non-empty.

**Candidate B is the more likely one here**, because it also explains why the *baseline* is
MINIMAL: a skipped HIGH_RISK contributes no `result=True`, so the winner falls through to
MINIMAL. The moment an override forces Step 1 to run, the deterministic eval over the real
answer map produces HIGH_RISK=True.

## Core issue (the real problem)

Two sources of truth for a label's boolean result:
1. the **pipeline's LLM classification** (used at baseline, and when no answer override is set), and
2. the **deterministic `eval_label`** (used for every label once any answer override is present).

They are not guaranteed to agree, so merely *adding an unrelated answer override* silently
switches which source wins and can change the risk tier with no logical connection to the
override itself. A user overriding `Prohibited_8` has no reason to expect HIGH_RISK to appear.

## Reproduction

1. A system whose questionnaire answers satisfy the ANNEX_III rule deterministically
   (some `High_Risk_3..30 = YES`, exceptions `31/32 = NO`, `33..36 = NO`), but where the
   pipeline either skipped HIGH_RISK or its LLM returned HIGH_RISK=False.
2. Baseline resolve → MINIMAL.
3. Add any answer override → Step 1 re-evals → HIGH_RISK=True → winner HIGH_RISK.

## Open design decision (do not fix blindly)

Decide the intended contract:
- **Option 1 — re-eval only the affected labels.** In Step 1, recompute only labels whose rule
  tree references a question present in `overrides.answers`. Unrelated labels keep their pipeline
  result. Removes the "unrelated override changes the tier" surprise, but leaves pipeline vs.
  deterministic disagreement for the affected label.
- **Option 2 — always re-eval deterministically.** Make the deterministic `eval_label` the single
  source of truth for *all* labels at baseline too (not only under overrides). Consistent, but
  discards the LLM's holistic judgement and may change many baselines.
- **Option 3 — surface the disagreement.** Show both the pipeline result and the deterministic
  re-eval in the tester so the divergence is visible rather than silent.

Needs a product/compliance call on whether the LLM classification or the deterministic rule
tree is authoritative for the risk tier.
