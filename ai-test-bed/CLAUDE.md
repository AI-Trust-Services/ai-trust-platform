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

## Knowledge-Grounded Task Agent (`app/agent/`)

A PydanticAI agent that takes a task + a registered AI system, receives that system's questionnaire as direct context, retrieves evidence via 3 configurable RAG tools, and returns a structured `TaskResult`.

### Agent endpoints (all under `/v1/testbed/agent`, gated `systems:read`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/testbed/agent/run` | Run the agent against a registered AI system |
| `GET` | `/testbed/agent/runs` | List 50 most recent agent runs (summaries) |
| `GET` | `/testbed/agent/runs/{run_id}` | Full agent run (result + passages) |
| `POST` | `/testbed/agent/feedback` | Submit cognee feedback loop for a run |
| `POST` | `/testbed/agent/cognee/ingest` | Proxy file upload to cognee |

### POST /testbed/agent/run body

```json
{
  "system_id": "SYS-XXXX",
  "task": null,
  "source_backends": {
    "legal": "classic",
    "reviewed_judgments": "classic",
    "system_evidence": "classic"
  },
  "model": null,
  "retrieval_k": 5,
  "retrieval_mode": "hybrid",
  "retrieval_rrf_k": 60
}
```

- `task`: omit to use the EU AI Act risk-classification default (loaded from `app/agent/prompts/risk_classification.md`).
- `source_backends` values: `classic` | `graph` | `hierarchical`. All default to `classic`.

### POST /testbed/agent/run response

```json
{
  "run_id": "TBR-XXXXXXXX",
  "system_id": "SYS-XXXX",
  "task": "...",
  "source_backends": {"legal": "classic", ...},
  "result": {
    "proposed_answer": "...",
    "rationale": "...",
    "source_references": [{"ref_id": "L-abc", "quote": null, "resolved": true}],
    "applicable_judgments": [{"ref_id": "J-abc", "statement": "..."}],
    "missing_facts": [],
    "review_required": false,
    "review_questions": []
  },
  "retrieved_passages": [...],
  "created_at": "...",
  "created_by": "..."
}
```

`source_references[].resolved` is `true` if the ref_id was found in `retrieved_passages`.

### Three RAG tools and per-source backend config

The agent has three `@agent.tool` functions. Each tool resolves its backend via `source_backends`:

| Tool | Source label | classic system_id | Ref prefix |
|---|---|---|---|
| `retrieve_legal_sources` | `legal` | `__eu_ai_act__` | `L-` |
| `retrieve_reviewed_judgments` | `reviewed_judgments` | `__reviewed_judgments__` | `J-` |
| `retrieve_system_evidence` | `system_evidence` | run's `system_id` | `S-` |

Backend implementations (`app/agent/retrieval_backends.py`):
- `classic` → `POST {INDEXING_BACKEND_URL}/v1/retrieve`
- `graph` → `POST {COGNEE_EVAL_URL}/v1/recall`
- `hierarchical` → stub (returns `[]`, logs info)

All backends are **graceful**: non-200 and `httpx.RequestError` return `[]` and log `agent.retrieve.failed`.

### Questionnaire as direct context

The router fetches `GET {REGISTRY_BACKEND_URL}/v1/systems/{system_id}` and formats `questionnaire_answers` (business + `technical` nested key) into a `QUESTIONNAIRE` section prepended to the user prompt. 404 from registry → 404 to caller.

### Output validator

`app/agent/task_agent.validate_task_result(retrieved, result)` (also used as `@agent.output_validator`):
1. `retrieved` empty → `ModelRetry` (agent must call at least one tool first)
2. Unresolved `ref_id` in `source_references` → `review_required=True` + review question naming them
3. Non-empty `review_questions` → forces `review_required=True`

### Prompts

- `app/agent/prompts/system.md` — system prompt (loaded at agent construction time)
- `app/agent/prompts/risk_classification.md` — default task text (EU AI Act risk-tier classification); used when `task` is omitted in the run request

### Feedback → cognee loop

`POST /testbed/agent/feedback {run_id, conclusion, reasoning, question?}`:
1. `POST {COGNEE_EVAL_URL}/v1/evaluate {question}` (question defaults to run's task if omitted)
2. `POST {COGNEE_EVAL_URL}/v1/feedback {evaluation_id, conclusion, reasoning, supporting_node_ids}`
3. `PATCH {COGNEE_EVAL_URL}/v1/feedback/{id}/approve`

Returns `{feedback_id, status: "approved"}`. Returns 503 if cognee unreachable.

### `__reviewed_judgments__` sentinel

Reserved `ai_system_id` for the reviewed-judgments knowledge base. Created by `app/seed.py` (idempotent). Users upload expert compliance decisions via the cognee ingest endpoint. The sentinel is filtered out of all system dropdowns (frontend filter on `id.startsWith("__")`).

### Persistence

Agent runs are stored as `TestBedRun` rows with:
- `kind="agent_run"`
- `sample_id=system_id` (the registered system)
- `role="agent"`
- `enabled_sources=source_backends`
- `payload={system_id, task, source_backends, result(dict), retrieved_passages, usage}`

### New env vars

| Var | Default | Description |
|---|---|---|
| `AI_GATEWAY_URL` | `http://ai-gateway:8000` | AI gateway base URL; serves `POST /v1/messages` (Claude-compatible) |
| `AGENT_MODEL` | `claude` | Anthropic model name passed to the gateway |
| `COGNEE_EVAL_URL` | `http://cognee-eval-backend:8014` | Cognee evaluation service base URL |

## Frontend (`src/api/client.ts`) — split API bases

The MFE hosts two logical UIs with different backends:
- **Test-bed calls** (run, samples, runs) → `VITE_TESTBED_API_BASE` = `/api/ai-test-bed/v1`.
- **Document calls** (upload, list, versions, retrieve, download) → `VITE_INDEXING_API_BASE` = `/api/indexing/v1`.
- **User/permissions** → `VITE_USERS_API_BASE` = `/api/users/v1`.
- **Registry AI system list** (system dropdown in DocPanels) → `VITE_REGISTRY_API_BASE` = `/api/registry/v1`.

`HEALTH_URL` is derived from `VITE_TESTBED_API_BASE` (strips `/v1`, appends `/health`). The red banner + auto-retry polls the ai-test-bed backend health.
