# Batch import — AI systems data format

Reference for the batch-import payload: a **JSON array** of records, one object per AI system.
Each object maps to the `AISystemImport` schema. Only `name` is required; every other key is
optional. Unknown keys are ignored.

```json
[
  { "name": "Fraud scoring model", "tier": "high", "annex_iii_area": 5, "org_role": "deployer" },
  { "name": "Internal chatbot", "is_chatbot": true, "tier": "limited" }
]
```

## Record keys

### Descriptive

| Key | Type | Default | Description |
|---|---|---|---|
| `name` | string (1–200) | — (**required**) | System name. Must not be whitespace-only. |
| `version` | string | `"1.0.0"` | System version. |
| `provider` | string | `""` | Provider organisation. |
| `org_name` | string | `""` | Owning organisation. |
| `org_role` | enum | `"provider"` | One of `provider`, `deployer`, `both`, `importer`, `distributor`, `authorised_representative`. |
| `description` | string | `""` | Free-text description. |
| `intended_purpose` | string | `""` | Intended purpose of the system. |
| `department` | string | `null` | Owning department. |
| `use_case` | string | `null` | Use case. |
| `people_affected` | string | `null` | Who is affected by the system's decisions. |
| `decision_context` | string | `null` | Context in which the system makes/supports decisions. |
| `system_type` | string | `"application"` | Free string (not enum-validated). |
| `autonomy_level` | string | `"decision_support"` | Free string (not enum-validated). |
| `application_url` | string (≤500) | `""` | URL of the application. **Only `http`/`https` schemes accepted** (rejected otherwise). |
| `provider_country` | string (≤5) | `"DE"` | Provider country. |
| `deployment_country` | string (2) | `null` | ISO 3166-1 alpha-2 deployment country. |
| `eu_output_usage` | bool | `null` | System output used in the EU. |
| `eu_market_placement` | bool | `null` | System placed on the EU market. |
| `lifecycle` | enum | `"development"` | One of `development`, `testing`, `prod_ready`, `market`, `service`, `updated`, `decommissioned`. |

### Classification result

| Key | Type | Default | Description |
|---|---|---|---|
| `tier` | enum | `"pending"` if absent | EU AI Act risk tier. One of `prohibited`, `gpai-systemic`, `gpai-standard`, `high`, `limited`, `minimal`, `pending`. **Taken verbatim from the source — the classifier does not run on import.** A record with no `tier` is created as a `pending` stub. |
| `basis` | string | `""` | Human-readable basis for the tier. |
| `annex_iii_area` | integer (1–8) | `null` | Annex III high-risk area number. |

### Classification evidence (flags)

All optional, evidential only. Booleans default `false`; not required even when `tier` is set.

| Group | Keys |
|---|---|
| Art. 5 (prohibited) | `subliminal_manipulation`, `exploits_vulnerability`, `social_scoring_public`, `real_time_biometric_public`, `emotion_recognition_workplace`, `untargeted_facial_scraping`, `predictive_policing`, `biometric_categorisation_sensitive` |
| Annex III (high-risk) | `is_biometric_identification`, `is_critical_infrastructure`, `is_education_related`, `is_employment_related`, `is_credit_scoring`, `is_public_service`, `is_law_enforcement`, `is_migration`, `is_judicial_admin` |
| GPAI / Art. 50 | `is_gpai` (bool), `training_compute_flops` (float, default `0.0`), `is_chatbot` (bool), `generates_synthetic_content` (bool) |

## Keys that are NOT imported (always stored `NULL`)

These are rejected from the payload and hard-set to `null` on insert — they are LLM/workflow/UI
artifacts with no meaning for an external import:

| Key | Why excluded |
|---|---|
| `classification_rationale` | LLM flag-inference audit trail; a foreign shape would not render in the UI and the tier is not recomputed. |
| `field_confirmations` | Internal UI confirmation state. |
| `questionnaire_answers` | 3-role governance workflow artifact. |
| `registration_documents` | MinIO file references, created only on upload. |

## System-managed (never in the file)

`id` (assigned as `SYS-XXXXXXXX`), `created_at`, `updated_at`, `compliance` (starts at `0.0`).

## Import behavior

- **Insert-only, no de-duplication.** Each record creates a new system with a fresh `SYS-` id.
  Re-importing the same system produces duplicates — accepted by design (no stable external key).
- **Partial success.** Records are validated independently; valid ones are inserted, invalid ones
  reported. Response: `{ "imported": <n>, "failed": [ { "index": <i>, "errors": [...] } ] }`.
- **Unknown keys** in a record are ignored.
