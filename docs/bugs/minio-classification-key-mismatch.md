# Bug: classification/resolve returns 404 despite successful pipeline run

**Fixed in:** `f532e48d`  
**File:** `ai-system-registry/backend/app/minio_client.py`

## Symptom

`POST /systems/{id}/classification/resolve` returns:

```
404 No classification run found for this system
```

…even though `POST /systems/{id}/classification-llm-run` completed successfully.

## Root cause

The classification pipeline writes its MinIO result using the **basename** of the config ID:

```python
# classification_pipeline.py
config_id_short = Path(classification_config_id).name  # "risk_role_classification_config"
run_key = f"classification-results/{system_id}/{config_id_short}/{iso}.json"
```

But `list_latest_classification` was querying with the **full** config ID:

```python
# minio_client.py (before fix)
prefix = f"classification-results/{system_id}/{config_id}/"
# → "classification-results/SYS-xxx/risk_classification/risk_role_classification_config/"
```

`DEFAULT_CLASSIFICATION_CONFIG_ID = "risk_classification/risk_role_classification_config"` — the slash-separated path caused the prefix to never match the actual stored key `classification-results/SYS-xxx/risk_role_classification_config/`.

## Fix

Apply the same `Path(...).name` transform in `list_latest_classification`:

```python
config_id_short = Path(config_id).name
prefix = f"classification-results/{system_id}/{config_id_short}/"
```

## Impact

Every call to the resolve endpoint returned 404, making the hierarchy solver completely unusable from the UI even after a successful pipeline run.
