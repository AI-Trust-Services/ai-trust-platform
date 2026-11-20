# Bug: pipeline skips a label if ANY referenced question is unanswered — even when one rule is fully satisfiable

**Status:** ROOT CAUSE CONFIRMED with live MinIO data (system `SYS-D84E84C1`)
**Severity:** high — mis-classifies real high-risk systems as MINIMAL in the production pipeline, not just the tester
**Files:** `ai-system-registry/backend/app/classification_pipeline.py` (root cause),
`app/hierarchy_solver.py` (where the symptom surfaces)

## Symptom (as first observed)

In the hierarchy tester:
- Baseline resolve (no overrides) → **MINIMAL**
- Set *any* answer override (even an unrelated question like `Prohibited_8`) → **HIGH_RISK**

## Verified root cause

Live data for `SYS-D84E84C1` (newest classification run):

**Questionnaire answers — the only High_Risk answer present:**
```
High_Risk_1: ["LIFTS_AND_SAFETY_COMPONENTS", "RADIO_EQUIPMENT"]
```

**Pipeline stored classification:**
```
HIGH_RISK: SKIPPED — reason=insufficient_data
           missing = [High_Risk_3 .. High_Risk_36]   (34 questions)
```

**Deterministic eval over the same answers:**
```
eval_label(HIGH_RISK) = True
  rule ANNEX_I_PRODUCT_OR_SAFETY_COMPONENT = True   ← fires on High_Risk_1 alone
  rule ANNEX_III_USE_CASE                  = False
```

So HIGH_RISK is **genuinely true** (an Annex I safety-component use is declared via
`High_Risk_1`), but the pipeline skipped the label entirely.

### Why the skip is wrong

`classification_pipeline.py` step 4:

```python
question_ids = get_question_ids_from_label(label)   # ALL qids across ALL rules of the label
scoped = _scope_questionnaire_data(questionnaire_results, question_ids)
missing = sorted(question_ids - {r.get("questionId") for r in scoped})
if missing:                                          # ← skips if ANY single qid is unanswered
    skipped.append(...)
```

`get_question_ids_from_label` unions the questionIds of **every rule** in the label. HIGH_RISK
has two rules:
- `ANNEX_I_PRODUCT_OR_SAFETY_COMPONENT` → needs only `High_Risk_1`
- `ANNEX_III_USE_CASE` → needs `High_Risk_3..36`

Because `ANNEX_III` has unanswered questions, `missing` is non-empty and the **whole label**
is skipped — even though `ANNEX_I` is fully answered and evaluates True. The skip granularity
is per-label; it should be per-rule (a label is high-risk if *any one* rule fires).

### Why the override "fixes" it in the tester

Skipped HIGH_RISK is absent from the pipeline result → seeded `result=False` → baseline winner
falls through to MINIMAL. The moment any answer override is set, `hierarchy_solver` Step 1
re-evaluates every label deterministically via `eval_label`, which correctly returns True for
HIGH_RISK (ANNEX_I fires). The override is unrelated to HIGH_RISK — it is merely the switch
that makes the solver trust the deterministic eval instead of the (wrongly-skipped) pipeline
result.

## Impact

This is **not** a tester-only issue. In the real assessment-prefill pipeline, any high-risk
system whose high-risk basis is a *single* rule (e.g. Annex I product safety via `High_Risk_1`)
will be skipped and classified MINIMAL whenever the *other* high-risk rule's questions are
unanswered — which is the normal case for a system with little registration data. The tester
only made it visible.

## Fix options

- **Primary (correct granularity): skip per-rule, not per-label.** A label is runnable if at
  least one of its rules has all its referenced questions answered. Evaluate the runnable rules;
  a label fires if any runnable rule is True. Restructure step 4 to compute `missing` per rule.
- **Alternative: never skip, always eval deterministically.** If a label's result is fully
  determined by the rule tree + answers (no LLM judgement needed), the pipeline could compute
  it directly with `eval_label` and drop the skip concept for rule-based labels. (Bigger change;
  check whether the LLM call adds confidence/explanation value beyond the boolean.)

## Test cases

1. **Annex I alone triggers HIGH_RISK (the SYS-D84E84C1 case).**
   `High_Risk_1 = [LIFTS_AND_SAFETY_COMPONENTS]`, all `High_Risk_3..36` unanswered →
   pipeline must classify HIGH_RISK=True (currently skips → MINIMAL).
2. **Partial Annex III does not spuriously fire.** `High_Risk_1` empty, only some Annex III
   use-case questions YES but exception questions unanswered → HIGH_RISK stays False.
3. **Unrelated answer override must not change the tier** (regression for the tester symptom):
   once the skip bug is fixed, baseline and override-run agree on HIGH_RISK.

## Note on earlier diagnosis

The companion doc `hierarchy-solver-unrelated-override-flips-tier.md` guessed the cause was the
ANNEX_III Art. 6(3) exception logic + NOT_ENOUGH_INFORMATION filtering (Candidate A). Live data
disproves that — the actual cause is the per-label skip granularity hiding a satisfied ANNEX_I
rule (Candidate B, confirmed). That doc should be superseded by this one.
