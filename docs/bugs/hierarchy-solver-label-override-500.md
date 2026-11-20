# Bug: classification/resolve returns 500 when overriding a skipped label

**Fixed in:** `a5116987`  
**Files:** `ai-system-registry/backend/app/hierarchy_solver.py`, `app/routers/hierarchy_solver.py`

## Symptom

`POST /systems/{id}/classification/resolve` with a label override (e.g. `HIGH_RISK: true`) returns HTTP 500,
even after a successful pipeline run.

## Root cause

Two compounding bugs:

**1. Validation checked the wrong set.**  
`_validate_overrides` built `known_label_ids` from the pipeline result's `classifications` list:

```python
known_label_ids = {c["labelId"] for c in classifications}
```

If the pipeline skipped a label (insufficient data, LLM error), that label is absent from
`classifications` — so overriding it raised `ValueError: Unknown labelId: 'HIGH_RISK'`.
The correct source is the classification config, which lists all labels regardless of whether
the pipeline produced a result for them.

**2. `ValueError` was not caught in the router.**  
FastAPI does not map bare `ValueError` to 422 — it propagates as an unhandled exception → 500.
The router docstring claimed 422 for this case but never actually caught it.

## Fix

Validate against config-derived label IDs instead of pipeline output:

```python
all_label_ids = {lbl["id"] for lbl in all_labels}
_validate_overrides(overrides, all_label_ids, all_question_ids)
```

And catch `ValueError` in the router:

```python
try:
    return solve(pipeline_result, body, questionnaire_result)
except ValueError as e:
    raise HTTPException(422, str(e))
```

## Impact

Any label the pipeline skipped (e.g. due to missing questionnaire data) could not be manually
overridden in the hierarchy tester — the only workaround was to run a full pipeline first and
hope every label produced a result.
