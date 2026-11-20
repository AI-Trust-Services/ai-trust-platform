# Bug: answer override on Prohibited questions raises 500 — unknown operator IN

**Fixed in:** `a3828e36`  
**File:** `ai-system-registry/backend/app/questionnaire_tree.py`

## Symptom

Setting an answer override for any `Prohibited_*` question (or others using the `IN` operator)
in the hierarchy solver tester raises:

```
Error: Unknown operator 'IN' in when-tree for questionId 'Transparency_1'
```

## Root cause

The classification config uses three operators: `EQUALS`, `CONTAINS`, and `IN`. The tree
evaluator in `questionnaire_tree.py` only handled the first two. `IN` differs from `EQUALS`/`CONTAINS`
in that it carries a `values` list instead of a single `value`:

```json
{ "questionId": "Prohibited_4", "operator": "IN", "values": ["YES", "PARTIALLY"] }
```

Semantics: true when at least one eligible answer value is present in the configured `values` list.
All eight `Prohibited_*` questions and several others use `IN` exclusively — so any answer
override touching those labels would crash.

## Fix

```python
if operator == "IN":
    return any(v in when.get("values", []) for v in eligible)
```

## Impact

Answer overrides for any label whose rule tree contains an `IN` atom were completely broken —
the entire resolve call failed with a 500.
