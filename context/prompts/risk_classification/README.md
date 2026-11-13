# Risk & Role Classification — LLM 2

This folder contains the Step 2 classification artifacts: the LLM 2 system prompt and the classification configuration.

## Files

| File | Purpose |
|---|---|
| `risk_role_classification.md` | LLM 2 system prompt — instructs the model to evaluate one active label against questionnaire answers and return `{classifications: [{labelId, result, confidence, explanation}]}` |
| `risk_role_classification_config.json` | Classification configuration — defines risk labels (`PROHIBITED`, `HIGH_RISK`, `TRANSPARENCY`) and role labels (`PROVIDER`, `DEPLOYER`, `IMPORTER`, `DISTRIBUTOR`, `AUTHORISED_REPRESENTATIVE`) with their deterministic rule trees |

## Architecture

```
Pipeline 3: assessment_prefill_pipeline.py  (started by POST /assessment/open; runs 1 then 2)

Pipeline 1: questionnaire_pipeline.py          (also POST /questionnaire-llm-run)
  → LLM answers each questionnaire question
  → Persists to MinIO: questionnaire-results/{system_id}/ai-questionnaire/{timestamp}.json

Pipeline 2: classification_pipeline.py  ← this folder   (also POST /classification-llm-run)
  → Reads pipeline 1's output from MinIO (by run_key)
  → One LLM call per active label (parallel)
  → Each call receives: scoped QUESTIONNAIRE_DATA + single label CLASSIFICATION_CONFIG
  → A label whose referenced questions have no answer is skipped (listed under skipped_labels)
  → Persists to MinIO: classification-results/{system_id}/risk_role_classification_config/{timestamp}.json

Step 3 (issue #371): hierarchy resolver
  → Reads pipeline 2 output from MinIO
  → Deterministic: selects final label from true results by configured priority
```

The same two pipeline functions serve the Swagger endpoints and the assessment start; see the
"LLM prefill pipelines" section of `ai-system-registry/CLAUDE.md` for the diagrams, the failure
policy and the validation rules.

## Versioning

The config version is embedded in `classification-config.json` as `"version": "1.0.0"`. The persisted Step 2 result JSON records both `config_id` and `config_version` so the exact config used for any historical run is traceable. To update the classification rules, bump the version in the config file.

## Boundaries

The LLM 2 prompt and config deliberately do NOT contain:
- Label hierarchy or aggregation logic (→ hierarchy resolver, issue #371)
- Confidence thresholds or review rules (→ application layer)
- Questionnaire question definitions (→ `ai-questionnaire.json`)
- Answer pre-fill logic (→ Step 1 `questionnaire_answer.md`)
