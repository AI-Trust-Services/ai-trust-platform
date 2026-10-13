# ai-test-bed/ (port 8013, `/api/ai-test-bed/`) — k8s-only

Interactive EU AI Act classification test harness. Lets compliance officers and AI engineers pick a pre-built scenario (or configure their own), enable retrieval sources, and run the registry's `classify/evaluate` endpoint to see how context from indexed documents affects the classification outcome.

> **Deployment: k8s/kind + Gardener only — no docker-compose entry** (same exception as document-indexing). Verify via `cd k8s && make up`.

Two workloads:
- **`ai-test-bed/backend`** (FastAPI, port 8013) — orchestrator: loads sample fixtures, calls the document-indexing retrieve endpoint and the registry evaluate endpoint over HTTP, persists `TestBedRun` rows in Postgres.
- **`ai-test-bed/frontend`** — React MFE at `/ai-test-bed/` (nav label **"AI Test Bed"**, gated on `systems:read`). Contains **both** the document-management UI (DocPanels — list/upload/version documents, watch indexing status, test retrieval) and the test-bed UI (pick scenario, run classification, view passages + rationale). Document calls go to the `document-indexing` backend; test-bed calls go to this backend.

## HTTP service boundaries

This backend does **not** import `document-indexing` code. All retrieval is over HTTP:
- **Retrieval** — `POST {INDEXING_BACKEND_URL}/v1/retrieve` with `{ai_system_id, query, k, mode, rrf_k}`. Called twice per run: once for the sample's own `ai_system_id` (system_docs source) and once for the `__eu_ai_act__` sentinel. The `x-forwarded-preferred-username` header is forwarded on each call.
- **Classification** — `POST {REGISTRY_BACKEND_URL}/v1/classify/evaluate` with answers + injected context. Fatal if unavailable (502). The username header is forwarded here too.

Env vars: `INDEXING_BACKEND_URL` (default `http://document-indexing-backend:8011`), `REGISTRY_BACKEND_URL` (default `http://ai-system-registry-backend:8001`).

## Backend (`app/routers/testbed.py`, all `/v1/testbed/`, gated `systems:read`)

- `GET /testbed/samples` — list all YAML fixture summaries (`id`, `title`, `expected_tier`, `description`).
- `GET /testbed/samples/{sample_id}` — full fixture: adds `business_answers`, `technical_answers`, `expected_rationale`, `ai_system_id`. Used by the ScenarioPanel to show context before a run.
- `POST /testbed/run` — main orchestrator:
  1. Load sample YAML.
  2. For each enabled source (`system_docs`, `eu_ai_act`) POST to `/v1/retrieve` on the DI backend. Graceful: `httpx.RequestError` is caught and logged as a warning; retrieval failure does not abort the run.
  3. Format passages as a numbered citation block via `_format_passages_as_context`.
  4. POST to `/v1/classify/evaluate` on the registry backend with `injected_context`. Fatal if unavailable.
  5. Persist `TestBedRun` row (kind `"run"`), store passages in `payload["source_passages"]`.
  6. Return run result.
  - Body: `{sample_id, role?, enabled_sources: {system_docs, eu_ai_act, cognee}, prompt_override?, model?, retrieval_k?, retrieval_mode?, retrieval_rrf_k?}`. Retrieval knobs default to `k=5, mode=hybrid, rrf_k=60`. `cognee` source is a no-op stub.
- `GET /testbed/runs` — latest 50 run summaries, descending. `?sample_id=` filter.
- `GET /testbed/runs/{run_id}` — full run with `payload` including `source_passages`.

## Data model (migration `0036`, in `libs/persistence`)

`test_bed_runs` — one row per test run. Top-level columns for cheap filtering: `id` (prefix `TBR-`), `sample_id`, `role`, `enabled_sources` (JSONB), `model`, `knowledge_revision`, `prompt_revision`, `created_by`, `created_at`, `kind` (`"run"` for test runs; `"knowledge_item"` for the knowledge brain stub). Full input/output in `payload` JSONB. Source passages are stored at `payload["source_passages"]` (not nested under `input`).

## Sample fixtures (`app/testbed/samples/*.yaml`)

Git-versioned YAML test scenarios. Fields: `id`, `title`, `description`, `expected_tier`, `expected_rationale`, `ai_system_id`, `role`, `answers: {business: {…}, technical: {…}}`. Loaded at import time by `samples_loader.py` into `SAMPLES` dict. IDs prefix `tbs-`.

Included: `tbs-hiring-screener` (`SYS-TBHIRING`, CV ranking → high), `tbs-internal-chatbot` (`SYS-TBCHATBOT`, employee Q&A → limited), `tbs-credit-scoring` (`SYS-TBCREDIT`, retail credit risk → high).

## Sample system documents (`app/testbed/sample_docs/<sample-dir>/*.md`)

Synthetic Markdown system cards shipped in the repo image. The `testbed-seed` Helm Job uploads them to document-indexing at deploy time (via HTTP `POST /v1/systems/{id}/documents`); the `document-indexing-worker` indexes them asynchronously.

## Seed module (`app/seed.py`, `python -m app.seed`)

Idempotent. Creates `AISystem` stub rows for the 3 sample scenarios and the EU AI Act sentinel (`__eu_ai_act__`) if not already present (direct DB write), then uploads each sample's Markdown card via HTTP to the document-indexing backend. Re-running skips anything already present. Auth: forwarded as `x-forwarded-preferred-username: $APP_ADMIN_USERNAME`. Requires `DATABASE_URL` + `INDEXING_BACKEND_URL`.

The `testbed-seed` Helm Job uses the `ai-test-bed-backend` image with `command: ["python", "-m", "app.seed"]` and waits for `db-migrate`, `ai-system-registry-backend`, and `document-indexing-backend` to be healthy first.

## EU AI Act sentinel (`__eu_ai_act__`)

Reserved `ai_system_id` for the EU AI Act document corpus. The seed creates the `AISystem` stub (no documents seeded). Users upload EU AI Act PDFs via the Test Bed UI **EU AI Act corpus** panel; the worker indexes them. The sentinel is filtered out of all system dropdowns (frontend filter on `id.startsWith("__")`). Never show it in the registry or compliance system lists — it exists only for retrieval.

## KnowledgeBrain (`app/testbed/knowledge_brain.py`)

Abstract ABC (`add_reviewed_knowledge`, `query`, `export`, `import_items`) defining a swappable knowledge source interface. Phase 1 ships `JsonbKnowledgeBrainStub` (backed by `test_bed_runs` rows with `kind="knowledge_item"` and `sample_id="__knowledge_brain__"`; substring scoring). Module-level singleton in `knowledge_brain_stub.py`. Phase 2 will swap for a Cognee implementation without touching call sites.

## Frontend (`src/api/client.ts`) — split API bases

The MFE hosts two logical UIs with different backends:
- **Test-bed calls** (run, samples, runs) → `VITE_TESTBED_API_BASE` = `/api/ai-test-bed/v1`.
- **Document calls** (upload, list, versions, retrieve, download) → `VITE_INDEXING_API_BASE` = `/api/indexing/v1`.
- **User/permissions** → `VITE_USERS_API_BASE` = `/api/users/v1`.
- **Registry AI system list** (system dropdown in DocPanels) → `VITE_REGISTRY_API_BASE` = `/api/registry/v1`.

`HEALTH_URL` is derived from `VITE_TESTBED_API_BASE` (strips `/v1`, appends `/health`). The red banner + auto-retry polls the ai-test-bed backend health.
