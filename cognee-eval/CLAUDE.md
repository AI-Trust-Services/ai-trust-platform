# cognee-eval

Standalone evaluation component for [Cognee](https://cognee.ai) as a knowledge graph foundation.
Ingests the EU AI Act PDF, builds a knowledge graph, and supports grounded Q&A with a human
feedback cycle.

**Port:** 8014 · **Helm flag:** `cogneeEval.enabled` · **API docs:** `/api/cognee/docs`

## Storage

All Cognee data (LanceDB vectors, per-dataset Kuzu graphs, SQLite relational) lives under `COGNEE_DATA_PATH`
(`/app/.cognee_system` in the container), mounted on the `data` PVC of the `cognee-eval-backend`
StatefulSet. Our feedback data lives in `cognee_eval.db` inside the same directory.

**Graph storage layout** — cognee 1.6 persists each dataset's graph as a per-dataset
`system/databases/<dataset-uuid>/<graph-uuid>.pkl` **Kuzu** database (the shipped `kuzu` package is
the ladybug fork, so despite the `.pkl` extension these are Kuzu DBs, *not* Python pickles — never
`pickle.load()` them). There is no single shared `cognee_graph_kuzu` database. `graph.py` globs for the
most recently written per-dataset `.pkl` and opens it with `kuzu.Database(path, read_only=True)`; the
`Node`/`EDGE` tables carry the extracted knowledge graph.

## Running

The component ships disabled by default — set `cogneeEval.enabled: true` in `values.yaml` (or the
cluster's override) before deploying. On kind:

```bash
# Build + deploy via Helm (see root CLAUDE.md for the full make workflow)
make build && make upgrade && make rollout

# Trigger ingestion — upload the EU AI Act PDF as a multipart file
curl -X POST http://localhost:8080/api/cognee/v1/ingest \
  -F "file=@/path/to/EU-AI-ACT.pdf"

# Check status
curl http://localhost:8080/api/cognee/v1/ingest/status

# Inspect graph visually
open http://localhost:8080/api/cognee/v1/graph/viz
```

## Milestones

| # | Scope | Status |
|---|---|---|
| 1 | Skeleton + Ingestion | Done |
| 2 | Graph Inspection API | Done |
| 3 | Grounded Q&A | Done |
| 4 | Feedback Capture + Graph Update | Done |
| 5 | Verification Scenarios | Pending |

## Routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/ingest` | Ingest a PDF — upload as multipart/form-data (`file` field) |
| `GET` | `/v1/ingest/status` | Check ingestion status |
| `GET` | `/v1/graph/stats` | Knowledge graph summary |
| `GET` | `/v1/graph/entities` | List entities, filterable by `?type=Article` |
| `GET` | `/v1/graph/raw` | Raw nodes + edges from Kuzu |
| `GET` | `/v1/graph/viz` | Interactive vis-network graph visualization |
| `POST` | `/v1/evaluate` | Ask a question — recall + LLM answer + save |
| `GET` | `/v1/evaluate` | List past evaluations |
| `GET` | `/v1/evaluate/{id}` | Get single evaluation |
| `POST` | `/v1/feedback` | Submit feedback on an evaluation |
| `GET` | `/v1/feedback` | List feedback (`?status=pending\|approving\|approved\|failed\|rejected`) |
| `GET` | `/v1/feedback/{id}` | Get single feedback |
| `PATCH` | `/v1/feedback/{id}/approve` | Approve + re-ingest into graph (async, returns 202) |
| `PATCH` | `/v1/feedback/{id}/reject` | Reject feedback |
| `GET` | `/ui` | Single-page evaluation UI |
| `GET` | `/health` | Health check — also reports PDF mount status |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `LLM_ENDPOINT` / `LLM_EXTRACTION_ENDPOINT` | `http://ai-gateway:8000/v1` | AI gateway — all cognee generation |
| `COGNEE_EMBEDDING_MODEL` | `BAAI/bge-small-en-v1.5` | fastembed in-process embedding model (384-dim) |
| `COGNEE_LLM_RATE_LIMIT_REQUESTS` | `12` | cognee LLM calls/min cap (keeps the gateway under its token quota) |
| `COGNEE_DATA_PATH` | `/app/.cognee_system` | Where Cognee stores its databases |
| `ALLOWED_ORIGINS` | — | Required — comma-separated CORS origins |

## Key files

- `app/cognee_client.py` — wrapper around `cognee.remember()` / `cognee.recall()`; `answer_question()` calls the AI gateway
- `app/database.py` — own SQLite engine for feedback data (`cognee_eval.db`)
- `app/ids.py` — `new_id("EVL")` evaluations, `new_id("EFB")` feedback

## AI Gateway

All cognee generation (main LLM + graph extraction) runs through the standalone
`ai-gateway` service (repo-root `ai-gateway/`), an OpenAI-compatible façade over an
Anthropic deployment that owns the OAuth2 token refresh. cognee reaches it at
`http://ai-gateway:8000/v1`; the gateway holds the `AI_CLIENT_ID/SECRET/AUTH_URL/API_URL/DEPLOYMENT_ID`
creds. Embeddings run in-process via fastembed (`BAAI/bge-small-en-v1.5`, 384-dim).

## Notes

- Ingestion is synchronous; the nginx `proxy_read_timeout` is set to 600s for this route
- No OpenFGA wiring — reviewer identity comes from `X-Forwarded-Preferred-Username` header only
- **Embeddings**: use fastembed (in-process ONNX), NOT Ollama. Ollama's HTTP embed path is CPU-bound
  and could not drain a full-document edge-indexing batch within cognee's hardcoded 60s-per-embed
  timeout — the whole ingest rolled back. fastembed embeds in-process, far faster on CPU.
- **Rate limiting**: `COGNEE_LLM_RATE_LIMIT_REQUESTS` paces cognee's generation calls under the upstream
  model's sustained token quota; the gateway adds 429/5xx retry-backoff. Upstream throttling is a
  sustained quota, not a per-request wall (short bursts pass; sustained volume throttles).
