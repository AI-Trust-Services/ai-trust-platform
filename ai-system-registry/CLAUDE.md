# ai-system-registry/ (port 8001, `/api/registry/`)
AI system registration and EU AI Act classification.
- `POST /api/v1/intake` — entry point for all registrations. Runs the classifier (< 10ms), assigns `SYS-XXXXXXXX`, persists to Postgres. The frontend never sends `tier` — classification is backend-only.
- `GET /api/v1/systems` — pagination `?limit=50&offset=0` (max 200).
- `POST /api/v1/systems/{id}/reclassify` — re-runs classifier, updates `tier`/`basis`/`annex_iii_area`.
- `classifier.py` — pure Python, no I/O. EU AI Act 4-tier waterfall, returns at first match (highest priority first):

  | Priority | Tier | Trigger |
  |---|---|---|
  | 1 | `prohibited` | Any Art. 5 flag |
  | 2 | `gpai-systemic` | `is_gpai` AND `training_compute_flops ≥ 10²⁵` |
  | 3 | `gpai-standard` | `is_gpai` AND `training_compute_flops < 10²⁵` |
  | 4 | `high` | Any Annex III flag |
  | 5 | `limited` | `is_chatbot` OR `generates_synthetic_content` |
  | 6 | `minimal` | none of the above |

  Logic is hardcoded (EU AI Act is law). Obligation texts/thresholds are constants in `classifier.py`.

**AI-assisted registration** — conversational alternative to the manual form. An LLM extracts descriptive fields and infers classifier flags; the **same deterministic `classifier.py`** produces the tier (the LLM never decides the tier). Stateless: the frontend holds the transcript + field state and resends each turn; nothing persists until `POST /v1/intake`.
- `POST /api/v1/intake/assist/turn` — one owner-flow turn. Body `{transcript[], fields{}}`; returns `{message, extracted_fields, next_field, complete, degraded, inferred_flags?, classification?}`. On `complete`, runs flag inference + `classify()`. Turn cap (`ASSIST_TURN_CAP`) → `degraded=true`.
- `POST /api/v1/intake/assist/extract` — multipart upload (TXT/MD/PDF/DOCX/PPTX/images), parsed via `documents.py` (max `ASSIST_MAX_TEXT_LENGTH`); images use `LLM_VISION_MODEL`. Returns `{extracted_fields, notes}`.
- `POST /api/v1/intake/assist/engineer/{system_id}/turn` and `/extract` — engineer flow, same shapes, prompts focused on technical fields.
- `POST /api/v1/intake` accepts AI-collected fields, flags, and `classification_rationale` (JSONB `{flag, value, rationale, confidence}`); runs `classify()` when flags present. Manual owner mode sends no flags → stays a `pending` stub for the engineer.
- **LLM layer** (`app/llm/`) — dispatch via `LLM_PROVIDER`: `stub` (default; deterministic, offline, dev/CI), `ollama` (OpenAI-compatible), `external` (OAuth2 + Anthropic-format `/invoke`, fails fast on missing creds). Malformed JSON → one auto-repair retry → `LLMParseError` → route returns 502, UI falls back to the manual form.
- **Externalized prompts** — prompt *wording* lives outside the code in repo-root `context/prompts/*.md` (one `.md` per model-call system prompt, named by a stable template id; see `context/prompts/README.md`). `app/llm/templates.py` resolves that dir (walks up to find `context/prompts`, or `PROMPTS_DIR` env override; baked into the image at `/app/context/prompts` via the Dockerfile) and exposes `render_template(id, **vars)`. Each `build_*` in `app/llm/prompts.py` renders its template and fills runtime vars (`target_schema`/`flag_schema`/`flag_names`); the JSON auto-repair call in `app/llm/parsing.py` renders `json_repair_system`/`json_repair_user` (var `malformed_response`). The field/flag data and message assembly stay in Python. A missing template or missing required variable raises `PromptTemplateError` with an actionable message; every render logs `prompt.rendered` with `template_id`+`template_path` for revision traceability (git provides the diff). **To change prompt wording, edit the `.md` — no code change.**
- All four assist routes gated `require_permission(SYSTEMS_WRITE)`.

**Side-effect-free evaluation** (`routers/classify.py`):
- `POST /v1/classify/evaluate` (`systems:read`) — runs the full LLM inference + deterministic classifier without writing to the database. Used by the document-indexing AI Test Bed to score sample fixtures. Body: `{answers: {business: {…}, technical: {…}}, enabled_sources?, injected_context?, prompt_override?, model?, role?}`. Returns `{tier, basis, obligations, confidence, rationale}`. Malformed LLM JSON → 502.
- `classifier.py` exposes `classify_from_questionnaire_answers(business_answers, technical_answers, injected_context="", prompt_override=None, model=None, role=None) → (ClassificationResult, rationale_dict)` — the reusable async core; `classify_ai_questionnaire(row)` is now a thin wrapper around it.
- **`role`** (`"engineer"` | `"compliance_officer"`) adds role-specific framing to the classification system prompt via the `{role_framing}` placeholder in `classify_questionnaire.md`. Engineers get flag-evidence/confidence emphasis; compliance officers get obligations/org_role/legal-exposure emphasis. When `prompt_override` is set it replaces the entire system message, so role framing does not apply. The framing text lives in `_ROLE_FRAMING` in `app/llm/prompts.py`.
- The `classify_questionnaire.md` prompt template accepts `{retrieved_context}` (context passages, or `""`) and `{role_framing}` (role-specific framing paragraph, or `""`). Both variables are always required; empty strings are valid.

**Registration modes** — `ai_systems.registration_mode` (`String(30)`, default `ai`) selects one of three intake paths:
- `ai` — conversational AI-assisted flow (above); LLM infers flags, `classifier.py` decides the tier.
- `manual_questionnaire` — structured owner + engineer questionnaire (below); flags come from boolean/number answer columns.
- `full_manual` — the compliance officer enters the tier directly (validated against `VALID_TIERS` in the router) and attaches supporting documents. No questionnaire sections.

An owner who registers with only name + description creates a **`pending`-tier** stub (`ck_ai_systems_tier` includes `pending` since migration `0017`); risk classification is completed later in Assessments. Registration also captures `deployment_country` (ISO 3166-1 alpha-2) + two EU-presence booleans (`eu_output_usage`, `eu_market_placement`, migration `0018`) — all nullable; the frontend uses them to recommend the EU AI Act framework. Terminology-aligned lifecycle values (migration `0014_terminology_alignment`): `conformity`→`prod_ready`, `post-market`→`service`, plus new `updated`.

**Questionnaire workflow** (`routers/workflow.py`, all under `/v1/systems/{id}/workflow/…`) — a 3-role governance chain: **owner** (business section) → **AI engineer** (technical section) → **compliance officer** (approves). `ai_systems.workflow_status` ∈ `draft, business_pending, technical_pending, pending_review, info_requested, approved, rejected` (CHECK `ck_ai_systems_workflow_status`, migration `0015`). Answers live in `questionnaire_answers` (JSONB; business at top level, technical under `"technical"`); `business_assignee_username` / `technical_assignee_username` name the section owners.
- Assignment / submission: `POST /assign`, `/submit-business`, `/submit-technical`, `/submit`, `/approve`, `/reject`, `/request-info` (CO sends **one section** back for detail → `info_requested`; body `{section: "business"|"technical", note}`, recipient derived from that section's owner, target stored in `ai_systems.info_requested_section` per migration `0021`), `/submit-info` (clears `info_requested_section`, reclassifies, returns to CO), `/reset`; `GET /workflow` (step history), `/rce-summary`.
- **Bounce-back editing** — while `info_requested`, only the reopened section (`info_requested_section`) is editable: `PATCH /systems/{id}/questionnaire` and (for the technical section, manual_questionnaire flags) `PUT /systems/{id}` both permit edits in that state gated on the section matching. Reject uses `business_pending`/`technical_pending` instead, which the ordinary section edit-locks already allow.
- **Section delegation** (`sub_assigned_*` steps): `POST /sub-assign`, `/sub-complete`, `/sub-reclaim` — a section owner hands their whole section to a delegate and can reclaim it.
- **Per-question assignment** (`question_assignments` table, migration `0016`): `GET /question-assignments`, `POST`/`DELETE /question-assign`, `POST /question-answer` — assign individual questions to contributors. Assignment emails use `QUESTION_LABEL` (in `questionnaire_required.py`) for human-readable labels, falling back to the raw key.
- **Approval gate** — `questionnaire_required.py::missing_for_approval(row)` lists still-unanswered required business + technical questions; the CO cannot approve until empty. `full_manual` systems have no sections → always empty. Assignees may submit partial sections; only approval is gated.
- `obligation_lookup.py` — pure, hardcoded EU AI Act obligation titles/refs per (tier, `org_role`) for the RCE summary panel (`roles`: `provider` | `deployer` | `both`; pass `org_role="both"` for the full union). Framework-aware full templates still live in `compliance/backend`.

**Other registry routes** (`routers/systems.py`):
- `PATCH /systems/{id}/questionnaire` — merge-patch questionnaire answers (`section` = `business` | `technical`).
- `POST /systems/{id}/documents` — multipart upload of a `full_manual` supporting doc to MinIO (extension allowlist + `MAX_DOC_SIZE` 20 MB; filename sanitized/capped in `minio_client.object_key`). Metadata appended to `registration_documents` (JSONB). `GET /systems/{id}/documents/{index}/download-url` returns a presigned URL.
