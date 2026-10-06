# cognee-eval

Standalone evaluation component for [Cognee](https://cognee.ai) as a knowledge graph foundation.
Ingests the EU AI Act PDF, builds a knowledge graph, and supports grounded Q&A with a human
feedback cycle.

**Port:** 8011 · **Profile:** `ollama` · **API docs:** `/api/cognee/docs`

## Storage

All Cognee data (LanceDB vectors, Kuzu graph, SQLite relational) lives under `COGNEE_DATA_PATH`
(`/app/.cognee_system` in Docker), mounted as the `cognee_eval_data` volume. Our feedback data
lives in `cognee_eval.db` inside the same directory.

## Running

```bash
# Place EU-AI-ACT.pdf in ./data/ first
cp /path/to/EU-AI-ACT.pdf data/

docker compose --profile ollama up --build -d cognee-eval-backend kuzu-explorer

# Trigger ingestion (takes several minutes on first run)
curl -X POST http://localhost:8080/api/cognee/v1/ingest

# Check status
curl http://localhost:8080/api/cognee/v1/ingest/status

# Inspect graph visually
open http://localhost:8888
```

## Milestones

| # | Scope | Status |
|---|---|---|
| 1 | Skeleton + Ingestion | In progress |
| 2 | Graph Inspection API | Pending |
| 3 | Grounded Q&A | Pending |
| 4 | Feedback Capture + Graph Update | Pending |
| 5 | Verification Scenarios | Pending |

## Routes (Milestone 1)

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/ingest` | Ingest EU AI Act PDF — runs full Cognee pipeline |
| `GET` | `/v1/ingest/status` | Check ingestion status |
| `GET` | `/v1/graph/stats` | Knowledge graph summary |
| `GET` | `/v1/graph/entities` | List entities, filterable by `?type=Article` |
| `GET` | `/health` | Health check — also reports PDF mount status |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `EU_AI_ACT_PDF_PATH` | `/data/EU-AI-ACT.pdf` | Path to PDF inside container |
| `EU_AI_ACT_PDF_HOST_PATH` | `./data` | Host directory mounted at `/data` |
| `COGNEE_LLM_MODEL` | `llama3.1:8b` | Ollama model for entity extraction |
| `COGNEE_EMBEDDING_MODEL` | `nomic-embed-text` | Ollama model for embeddings |
| `COGNEE_DATA_PATH` | `/app/.cognee_system` | Where Cognee stores its databases |
| `ALLOWED_ORIGINS` | — | Required — comma-separated CORS origins |

## Key files

- `app/cognee_client.py` — thin wrapper around `cognee.remember()` / `cognee.recall()`
- `app/database.py` — own SQLite engine for feedback data (`cognee_eval.db`)
- `app/ids.py` — `new_id("EVL")` evaluations, `new_id("EFB")` feedback

## Notes

- `kuzu-explorer` at `localhost:8888` — stop `cognee-eval-backend` first to avoid Kuzu file lock
- Ingestion is synchronous; the nginx `proxy_read_timeout` is set to 600s for this route
- No OpenFGA wiring — reviewer identity comes from `X-Forwarded-Preferred-Username` header only
