# Bug: label override on skipped label has no effect — system resolves as MINIMAL

**Status:** fixed (`616309de`) — hierarchy solver rewritten with combined dict, skipped labels revived via eval_label  
**File:** `ai-system-registry/backend/app/hierarchy_solver.py`

## Symptom

Setting e.g. `Prohibited_8 = YES` (or any label override like `PROHIBITED: true`) in the
hierarchy tester still returns `MINIMAL` as the risk winner — the override appears to have
no effect.

## Root cause

The pipeline skips labels for which the LLM produced no result (insufficient data, missing
questionnaire answers). Skipped labels are absent from `classification_map`.

Step 2 (label override) silently drops overrides for absent labels:

```python
if label_id in classification_map:   # ← skipped labels never enter this branch
    classification_map[label_id] = {**classification_map[label_id], "result": forced_result, ...}
```

Step 1 (answer override) has the same gap — it only iterates `classification_map.items()`,
so a label not in the map is never re-evaluated even if the answer override would trigger it.

Step 3 (risk winner) then finds no `result=True` for any risk label and falls back to MINIMAL.

## Affected paths

Both override modes are broken for skipped labels:
- **Answer override** (`Prohibited_8 = YES`) — re-evaluation skipped, label stays absent
- **Label override** (`PROHIBITED: true`) — forced result dropped silently

Single-question rules (e.g. `Prohibited_7`, `Prohibited_8`, `Prohibited_16`–`Prohibited_19`)
are most likely to be skipped because the pipeline has no questionnaire data to work with
in a fresh/stub run.

## Minimal reproduction

1. Run pipeline on a system with minimal description and no indexed documents.
2. In the tester, set answer override `Prohibited_8 = YES`.
3. Click "Resolve with overrides" → result is MINIMAL instead of PROHIBITED.

## Expected fix

Seed `classification_map` with a default `{result: False}` entry for every active label
from the config before applying overrides, so Step 1 and Step 2 have something to mutate:

```python
for lbl in all_labels:
    if lbl.get("activate", False) and lbl["id"] not in classification_map:
        classification_map[lbl["id"]] = {"labelId": lbl["id"], "result": False, "confidence": None, "explanation": None}
```

## Open question

**Why does the pipeline skip labels in the first place?**

`classification_pipeline.py` skips a label if any question referenced by its rule tree
has no answer in the questionnaire result (`NOT_ENOUGH_INFORMATION` or absent). The
Classification-LLM is never called for that label — it goes straight to `skipped_labels`.

This is intentional for normal pipeline runs (don't ask the LLM to classify without evidence),
but it creates a usability problem in the tester: the user wants to manually override answers
for exactly those missing questions, but the pipeline never ran the LLM for those labels,
so there is no classification result to override — only a skip.

**Follow-up to investigate:** should the hierarchy solver re-evaluate skipped labels from
scratch using the answer overrides (via `eval_label` / rule tree), rather than seeding them
with `result=False` and letting the label override force the result? That would make answer
overrides on skipped labels actually work deterministically without needing the LLM.


Each of the following single-question PROHIBITED paths should resolve as PROHIBITED
when the corresponding answer override is set to YES:

| Answer override | Rule triggered |
|---|---|
| `Prohibited_7 = YES` | `EXPLOITATION_OF_VULNERABILITY` |
| `Prohibited_8 = YES` | `SOCIAL_SCORING` |
| `Prohibited_16 = YES` | `UNTARGETED_FACIAL_SCRAPING` |
| `Prohibited_17 = YES` | `EMOTION_RECOGNITION_WORK_OR_EDUCATION` |
| `Prohibited_18 = YES` | `NON_CONSENSUAL_INTIMATE_CONTENT` |
| `Prohibited_19 = YES` | `CHILD_ABUSE_MATERIAL` |

Multi-question path (all three required):

| Answer overrides | Rule triggered |
|---|---|
| `Prohibited_4 = YES` + `Prohibited_5 = YES` + `Prohibited_6 = YES` | `MANIPULATIVE_OR_DECEPTIVE_TECHNIQUES` |
