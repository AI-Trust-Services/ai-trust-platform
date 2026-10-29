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
`system/databases/<dataset-uuid>/<graph-uuid>.(lbug|pkl)` **Kuzu** database (the shipped `kuzu`
package is the ladybug fork; it writes `.lbug` or `.pkl` depending on the code path — same library
version `0.19.0`). There is no single shared `cognee_graph_kuzu` database. `graph.py` globs for
both `*.lbug` and `*.pkl`, picks the most recently written, and opens it with
`kuzu.Database(path, read_only=True)`; the `Node`/`EDGE` tables carry the extracted knowledge graph.

**Single dataset for source + feedback** — `ingest_feedback()` calls `cognee.remember()` with
`dataset_name=_DATASET` (the same dataset as the source PDF), so every approved feedback correction
merges into the one Kuzu database / one LanceDB collection. There is no N+1 `.pkl` explosion — the
snapshot exported for production contains a single coherent graph.

## Running

The component ships enabled by default in read-only mode with the promoted graph snapshot — set `cogneeEval.enabled: false` in `values.yaml` (or the
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
| `THALAMUS_BASE_URL` | _(unset → stub)_ | Thalamus OpenAI-compatible gateway (incl. `/v1`); unset or `stub` → offline/CI. All cognee generation + extraction. |
| `THALAMUS_MODEL` | `mistralai/Mistral-Small-4-119B-2603` | Model ID the gateway serves — used for generation and extraction |
| `THALAMUS_BEARER_TOKEN` | _(empty)_ | Static bearer token sent as `Authorization: Bearer <token>`; required when `THALAMUS_BASE_URL` is a real gateway |
| `COGNEE_SKIP_CONNECTION_TEST` | `true` (set in code) | Suppresses cognee's first-use LLM/embedding probe — it can fail against OpenAI-compat endpoints even when real calls work. Set in `cognee_client.py` via `os.environ.setdefault`; override with `false` to re-enable. |
| `COGNEE_DATA_PATH` | `/app/.cognee_system` | Where Cognee stores its databases |
| `COGNEE_READONLY` | _(unset)_ | When `true`/`1`/`yes`: read-only prod mode — ingest + feedback routers are not mounted (404), and `/health` returns 503 until the first-boot graph consistency check passes |
| `ALLOWED_ORIGINS` | — | Required — comma-separated CORS origins |

## Key files

- `app/cognee_client.py` — wrapper around `cognee.remember()` / `cognee.recall()`; `answer_question()` calls Thalamus directly
- `app/database.py` — own SQLite engine for feedback data (`cognee_eval.db`)
- `app/ids.py` — `new_id("EVL")` evaluations, `new_id("EFB")` feedback

## Thalamus inference

All cognee generation (main LLM + graph extraction) and embeddings run against
[Thalamus](https://github.com/cobaltcore-dev/thalamus), an OpenAI-compatible inference
gateway, configured via `THALAMUS_BASE_URL` / `THALAMUS_MODEL` / `THALAMUS_BEARER_TOKEN`
(see `setup_cognee()`). cognee's litellm keeps its `openai/<model>` routing prefix; the
endpoint points straight at Thalamus and the bearer token is passed as the litellm
`api_key` (sent as `Authorization: Bearer <token>`). Embeddings also go through Thalamus
in live mode — the model is selected in code (`Snowflake/snowflake-arctic-embed-m`,
768-dim), not via env. In stub/CI mode (`THALAMUS_BASE_URL` unset or `stub`) embeddings
fall back to in-process fastembed (local ONNX, `BAAI/bge-small-en-v1.5`, 384-dim, never
hits the network); the e2e suite mocks the whole cognee pipeline regardless.

## Notes

- Ingestion is synchronous; the nginx `proxy_read_timeout` is set to 600s for this route
- No OpenFGA wiring — reviewer identity comes from `X-Forwarded-Preferred-Username` header only
- **Embeddings**: live mode routes through the same Thalamus gateway as LLM calls
  (OpenAI-compat `/v1/embeddings`, `Snowflake/snowflake-arctic-embed-m`, 768-dim); the model
  is hardcoded per mode in `setup_cognee()`, not env-configurable. Stub/CI mode uses
  in-process fastembed (`BAAI/bge-small-en-v1.5`, 384-dim, no network required).
- **Rate limiting**: `COGNEE_LLM_RATE_LIMIT_REQUESTS` (default 60) is passed to `litellm.rpm_limit`, capping cognee's per-minute LLM call rate under the gateway's sustained token quota.

## Testing

```bash
cd cognee-eval/backend
make setup      # creates .venv, installs requirements-test.txt + libs/logging
make test-e2e   # no Docker needed — uses in-memory SQLite
make test-unit
```

The e2e suite (`tests/e2e/`) uses `httpx.AsyncClient` + `ASGITransport` against an in-memory SQLite DB — no Postgres, Docker, or running Thalamus gateway required.

**Key conftest design** (`tests/e2e/conftest.py`):
- `cognee` and `kuzu` are imported at module level in `app/cognee_client.py` and `app/routers/graph.py` but are not installed in CI. The conftest stubs them in `sys.modules` at module level (before any `app` import) so collection works without the real packages.
- `sqlalchemy[asyncio]` and `python-multipart` are listed in `requirements-test.txt` (not pulled from `requirements.txt` which uses Docker-path `-e /app/libs/…`).
- All `app.cognee_client` functions (`recall`, `answer_question`, `ingest_pdf`, etc.) are replaced with `AsyncMock` in `_patch_cognee()` so tests never touch a real Cognee pipeline.
- Tables are created via `Base.metadata.create_all` on the in-memory engine; rows are deleted between tests by the `truncate_tables` autouse fixture.

## Freeze & promote to read-only production

The build/test instance mutates the graph (ingest + the expert feedback loop). **Production serves a
frozen snapshot of that graph read-only** — it never ingests or mutates. Same `cognee-eval-backend`
image on both sides; the only differences are config.

**Two modes (Helm `cogneeEval.readOnly`):**
- `readOnly: true` (default) — prod. `Deployment` with an `emptyDir` hydrated at startup by an init container
  from the pinned `cogneeEval.graphImage`; `COGNEE_READONLY=true` so ingest/feedback are unmounted
  (404). The pod is stateless and reconstructs the exact pinned graph on every start. Eval history
  (POST /evaluate) still works but is ephemeral (resets on restart) — it writes a Q&A log row, never
  the graph.
- `readOnly: false` — build/test. `StatefulSet` + PVC, all routers, full feedback loop.

**Why a snapshot (not cognee `push`/CogX):** both sides run the same Cognee, so a verbatim copy of
`/app/.cognee_system` is byte-identical to what experts approved. `push`/CogX re-materialize via a
semantic interchange format into a *live writable* remote — the opposite of read-only serving.

**Promotion flow:**
1. **Export** (operator, with their own kubeconfig — the CI SA lacks `pods/exec` and the PVC is RWO):
   ```bash
   kubectl exec -n <test-namespace> cognee-eval-backend-0 -c cognee-eval-backend -- \
     tar czf - -C /app/.cognee_system --exclude=./cognee_eval.db . > graph.tar.gz
   tar tzf graph.tar.gz | grep -c cognee_eval.db   # must print 0 (feedback PII excluded)
   ```
   Export only when ingestion is idle (synchronous ingest holds the event loop; a mid-ingest snapshot
   risks a torn Kuzu DB — the first-boot consistency check is the backstop).
2. **Promote**: attach `graph.tar.gz` to a GitHub Release published as a **pre-release** (not a draft —
   drafts require `contents:write`; pre-releases are readable with `contents:read`), then run the
   `Promote Cognee Graph` workflow (`.github/workflows/promote-graph.yml`) with that release tag. It
   writes a provenance `manifest.json` (source doc hash, approved feedback IDs, approver, timestamp,
   archive sha256), builds the `cognee-eval/graph-image/Dockerfile` (`FROM busybox` — provides the
   `tar` the init container runs), pushes `ghcr.io/<owner>/ai-trust-platform/cognee-graph`, and prints
   the `@sha256` digest to the job summary.
3. **Pin + deploy**: set `cogneeEval.readOnly: true` and `cogneeEval.graphImage:
   ghcr.io/<owner>/ai-trust-platform/cognee-graph@sha256:<digest>` (always a digest, never a mutable
   tag) in the prod override, then deploy.

**First-boot safety:** in read-only mode the lifespan runs `consistency_check()` — opens the Kuzu DB directly (read-only) and counts `Node` rows; no LLM or embedding call, so it works in kind/local without network access. If the snapshot is torn/empty, `/health` returns 503 and the pod never becomes Ready, so a bad artifact never serves traffic.

> The graph image is a deliberate exception to the "adding a service" checklist: it is **not** in
> `docker-bake.hcl`, `build-and-load-images.sh`, or `cleanup-images.yml` — it is built only by the
> promotion workflow and must never be pruned. OCM `ociImage` registration is deferred.
