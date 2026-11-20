# Bug: answer-override revives a skipped label but the risk-winner guard drops it → MINIMAL

**Status:** fixed (`616309de`) — winner guard no longer uses _skipped flag, reads combined dict directly  
**File:** `ai-system-registry/backend/app/hierarchy_solver.py`  
**Pinned by:** `ai-system-registry/backend/tests/unit/test_hierarchy_solver.py::test_answer_override_revives_skipped_high_risk_supported_operator`

## Symptom

An answer override that *should* trigger a skipped label's rule re-evaluates it to `True`,
yet the resolver still returns `MINIMAL` as the risk winner. No crash — the label simply
never wins.

Distinct from the `IN`-operator crash (see
[questionnaire-tree-missing-in-operator.md](questionnaire-tree-missing-in-operator.md)):
this reproduces with a rule on a *supported* operator, so the re-eval actually runs and
flips the result. The result is then discarded anyway.

## Root cause

Self-inflicted by the skipped-label seeding fix. `solve()` seeds skipped labels with a
`_skipped: True` baseline so Step 1 can re-evaluate them:

```python
classification_map[lid] = {"labelId": lid, "result": False, "_skipped": True, ...}
```

Step 1 flips the result when `eval_label` fires, but builds the revived entry by spreading
the old dict — so `_skipped: True` survives onto a now-`result: True` entry:

```python
if new_result != classification["result"]:
    classification_map[label_id] = {**classification, "result": new_result, "_answers_overridden": True}
    #                                 ^^^^^^^^^^^^^^^^ carries _skipped=True forward
```

The risk-winner loop then excludes it, because its guard rejects anything still marked
`_skipped`:

```python
if classification and classification.get("result") and not classification.get("_skipped"):
    winner_id = label_id
    break
```

`result` is `True` but `_skipped` is still `True`, so the branch is skipped and the loop
falls through to `MINIMAL`.

The `_skipped` guard and the revive logic contradict each other: the guard is meant to keep
*untouched* skipped labels out of the winner race, but it also eats labels that an override
legitimately revived.

## Minimal reproduction

1. Pipeline result with `HIGH_RISK` in `skipped_labels` (absent from `classifications`).
2. Answer override `{"High_Risk_1": ["MACHINERY"]}` (rule `ANNEX_I`, `CONTAINS` — a supported operator).
3. `solve()` → `eval_label(HIGH_RISK)` returns `True`, entry flipped to `result: True`.
4. Risk winner resolves as `MINIMAL` instead of `HIGH_RISK`.

## Expected fix

Either drop `_skipped` when an override revives the label, or make the winner guard ignore
`_skipped` once an override flag is present. Options:

```python
# Option A — clear _skipped on flip (Step 1):
classification_map[label_id] = {**classification, "result": new_result, "_answers_overridden": True}
classification_map[label_id].pop("_skipped", None)
```

```python
# Option B — relax the winner guard to only exclude untouched skips:
overridden = classification.get("_user_overridden") or classification.get("_answers_overridden")
if classification and classification.get("result") and not (classification.get("_skipped") and not overridden):
    ...
```

Whichever is chosen, the Step 4 role-output filter (`_is_dropped_skip`) already uses the
"skipped **and not** overridden" shape — align the winner guard with it so both drop only
genuinely-ignored skips.
