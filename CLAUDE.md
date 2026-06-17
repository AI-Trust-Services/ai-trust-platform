# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Run the full platform (shell + all components)
```bash
docker compose up --build -d
docker compose down --remove-orphans
```

### Run AI System Registry in isolation (no shell)
```bash
cd ai-system-registry
docker compose up --build -d
docker compose down --remove-orphans
```

### Backend development (local, no Docker)
```bash
cd ai-system-registry/backend
make setup  # first time only
# Set DATABASE_URL to a local postgres instance
# Run migrations first (only needed once, or after pulling new migrations)
cd ../../libs/persistence && alembic upgrade head && cd -
ALLOWED_ORIGINS=http://localhost:3001 uvicorn app.main:app --reload --port 8001
```

### Run tests (local)
```bash
cd ai-system-registry/backend
make test-unit   # no Docker needed
make test-e2e    # requires Postgres: docker compose up -d postgres
make test        # all tests
```

- `tests/unit/` — pure unit tests, no DB required
- `tests/e2e/` — full stack via ASGITransport, requires Postgres only (no running server needed), auto-creates `ai_trust_test` DB and runs migrations on first run


```bash
cd libs/persistence
alembic upgrade head         # apply all
alembic revision --autogenerate -m "description"  # generate new migration
alembic downgrade -1         # roll back one
```

### VS Code debugging (local backend)
```bash
# Stop Docker backend first
docker compose stop ai-system-registry-backend
# Install dependencies into venv
cd ai-system-registry/backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
# Then press F5 in VS Code — launch.json is pre-configured
```

## Service URLs

| Service | URL |
|---|---|
| Luigi shell | http://localhost:8080 |
| AI System Registry frontend | http://localhost:3001 |
| AI System Registry backend API | http://localhost:8001 |
| API docs (Swagger) | http://localhost:8001/docs |
| OpenAPI spec (JSON) | http://localhost:8001/openapi.json |
| Health check (includes DB) | http://localhost:8001/health |
| Monitoring frontend | http://localhost:3002 |
| Monitoring backend API | http://localhost:8003 |
| Monitoring health check | http://localhost:8003/health |
| PostgreSQL | localhost:5432 / db: `ai_trust` |
| OTel Collector (gRPC) | localhost:4317 |
| OTel Collector (HTTP) | localhost:4318 |
| OTel RMQ Bridge | http://localhost:8002 |
| OTel RMQ Bridge health | http://localhost:8002/health |
| RabbitMQ management UI | http://localhost:15672 (credentials from `.env`) |
| ClickHouse HTTP API | http://localhost:8123 / db: `otel` |

## Architecture

See [docs/architecture.md](docs/architecture.md) for repo layout, GenAI observability data flow, and Docker startup order diagrams.

## libs/persistence

The shared DB package. All backends depend on it.

- **`database.py`** — creates async SQLAlchemy engine, reads `DATABASE_URL` from environment. Includes connection pool config (`pool_size=5`, `max_overflow=10`, `pool_pre_ping=True`)
- **`models/`** — SQLAlchemy ORM models, one file per domain entity. Adding a new model: create a file here + add a migration
- **`migrations/versions/`** — Alembic migration scripts for all tables across all components

### Adding a new model
1. Create `libs/persistence/ai_trust_persistence/models/your_model.py`
2. Import it in `libs/persistence/ai_trust_persistence/models/__init__.py`
3. Run `alembic revision --autogenerate -m "description"` from `libs/persistence/`
4. Rebuild `db-migrate` container: `docker compose up --build -d db-migrate`

## libs/clickhouse

The shared ClickHouse package. All consumers and any future services that read/write ClickHouse depend on it.

- **`database.py`** — ClickHouse connection factory, reads `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` from environment (fail-fast)
- **`tables.py`** — single source of truth for table name (`GEN_AI_SPANS`) and column list (`COLUMNS`)
- **`migrations/`** — versioned SQL migration files, applied in filename order

## libs/logging

The shared structured logging package. All backends depend on it.

- **`logger.py`** — JSON formatter with UTC timestamps, log level, logger name, correlation ID, and any extra fields passed via `extra={}`
- **`correlation_id_var`** — `contextvars.ContextVar` set once per request in the `logging_middleware` in `main.py`. Because it uses `contextvars`, it automatically propagates through all `await` calls within that request — every `logger.info(...)` anywhere in the call chain includes the same `correlation_id` without passing it explicitly
- **Log levels** — middleware logs `INFO` for 2xx, `WARNING` for 4xx, `ERROR` for 5xx
- Usage: `from ai_trust_logging import get_logger, correlation_id_var`

## Shell (`shell/`)

Static HTML + `luigi-config.js` served by nginx. Luigi core is loaded from CDN. Navigation nodes in `luigi-config.js` define which MFEs are mounted and at what paths. To add a new component, add a `children` node with its `viewUrl`.

## Components (e.g. `ai-system-registry/`)

Each component has:
- `frontend/` — React 18 + Vite SPA, multi-stage Docker build, served by nginx on port 3001+
- `backend/` — FastAPI + SQLAlchemy async, served on port 8001+
- `docker-compose.yml` — standalone compose for isolated development

### Adding a new component
1. Create `new-component/frontend/` and `new-component/backend/`
2. Add model to `libs/persistence/ai_trust_persistence/models/`
3. Add migration to `libs/persistence/migrations/versions/`
4. Copy `ai-system-registry/backend/Dockerfile` pattern (build context must be repo root)
5. Add `-e /app/libs/persistence` and `-e /app/libs/logging` to `requirements.txt`
6. Add `healthcheck.py` to the backend (copy from `ai-system-registry/backend/healthcheck.py`, update port)
7. Add service to root `docker-compose.yml` with `depends_on: db-migrate: condition: service_completed_successfully` and a `healthcheck`
8. Add nav node to `shell/luigi-config.js`

### Backend structure (`ai-system-registry/backend/app/`)
- `main.py` — FastAPI app, mounts routers, `/health` endpoint tests DB connectivity
- `schemas/` — Pydantic v2 request/response schemas, split by domain:
  - `schemas/ai_system.py` — `AISystemCreate`, `AISystemUpdate`, `AISystemResponse`, `ClassificationResult`, `IntakeResponse`, `VALID_LIFECYCLES`, `VALID_ROLES`
  - `schemas/model_card.py` — `ModelCardCreate`, `ModelCardUpdate`, `ModelCardResponse`
  - `schemas/__init__.py` — re-exports everything; all routers import from `app.schemas`
- `classifier.py` — EU AI Act 4-tier waterfall classifier (Art. 5 → GPAI → Annex III → Art. 50 → minimal), pure Python, no I/O, no DB
- `healthcheck.py` — used by Docker healthcheck (`python healthcheck.py`), hits `/health` via stdlib urllib
- `routers/intake.py` — `POST /api/v1/intake` (classify + persist)
- `routers/systems.py` — `GET/PUT/DELETE /api/v1/systems`, `POST /api/v1/systems/{id}/reclassify`, `PUT /api/v1/systems/{id}/model` (link), `DELETE /api/v1/systems/{id}/model` (unlink)
- `routers/model_cards.py` — `GET/POST/PUT/DELETE /api/v1/model-cards`

### Registration flow
`POST /api/v1/intake` is the entry point for all new registrations. It runs the classifier synchronously (< 10ms), assigns a `SYS-XXXXXXXX` ID, persists to PostgreSQL, and returns the system + classification result. The frontend never sends a `tier` field — classification is backend-only.

### Listing systems
`GET /api/v1/systems` supports pagination via `?limit=50&offset=0` (max limit: 200). Defaults to 50 most recently created systems.

### Reclassification
`POST /api/v1/systems/{id}/reclassify` re-runs the classifier on a system's existing flags and updates `tier`, `basis`, and `annex_iii_area` in the DB. Use this if the classifier logic changes and existing records need updating.

### EU AI Act Classification (classifier.py)
Waterfall — returns at first match, highest priority first:

| Priority | Tier | Trigger |
|---|---|---|
| 1 | `prohibited` | Any Art. 5 flag (subliminal manipulation, social scoring, etc.) |
| 2 | `gpai-systemic` | `is_gpai=true` AND `training_compute_flops ≥ 10²⁵` |
| 3 | `gpai-standard` | `is_gpai=true` AND `training_compute_flops < 10²⁵` |
| 4 | `high` | Any Annex III flag (biometric, credit scoring, law enforcement, etc.) |
| 5 | `limited` | `is_chatbot=true` OR `generates_synthetic_content=true` |
| 6 | `minimal` | None of the above |

Classification logic is hardcoded (EU AI Act is law, not config). Obligation texts and thresholds are constants in `classifier.py`.

### Database
Shared PostgreSQL instance (one container, all components use the same DB). All migrations live in `libs/persistence/migrations/versions/`:
- `0001` — creates `ai_systems` table
- `0002` — creates `model_cards` table, adds `model_id` FK to `ai_systems`
- `0003` — seeds 12 known LLM model cards (GPT-4o, Claude 3.5, Llama 3, etc.)

### Frontend MFE pattern
Each MFE is a React 18 + Vite SPA built to static files and served by nginx:
- **Build tool:** Vite 5 (`npm run build → dist/`), multi-stage Dockerfile (`node:20-alpine` build → `nginx:alpine` serve)
- **Routing:** `HashRouter` (compatible with Luigi's `useHashRouting: true`)
- **Luigi integration:** `@luigi-project/client` npm package; `addInitListener` handshake in `useLuigi.js`
- **API base URL:** read from `import.meta.env.VITE_API_BASE` at build time; defaults to `http://localhost:800x/api/v1` for local dev
- **Backend health polling:** shows a red banner with auto-retry if backend is unavailable
- **nginx headers:** `X-Frame-Options: ALLOWALL` and `Content-Security-Policy: frame-ancestors *` (required for Luigi iframe embedding)

## Environment variables

All credentials are loaded from `.env` (gitignored). Copy `.env.example` and fill in values before running `docker compose up`. Never commit `.env`.

| Variable | Service | Default in `.env` | Description |
|---|---|---|---|
| `POSTGRES_USER` | postgres, db-migrate, backends | `postgres` | PostgreSQL username |
| `POSTGRES_PASSWORD` | postgres, db-migrate, backends | `postgres` | PostgreSQL password |
| `RABBITMQ_USER` | rabbitmq, otel-rmq-bridge, consumers | `guest` | RabbitMQ username |
| `RABBITMQ_PASSWORD` | rabbitmq, otel-rmq-bridge, consumers | `guest` | RabbitMQ password |
| `CLICKHOUSE_USER` | clickhouse, otel-clickhouse-consumer | `default` | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | clickhouse, otel-clickhouse-consumer | *(empty)* | ClickHouse password |
| `DATABASE_URL` | all backends, db-migrate | derived from `POSTGRES_*` above | Postgres connection string |
| `ALLOWED_ORIGINS` | ai-system-registry-backend | *(required — no default)* | Comma-separated CORS origins. App refuses to start if not set. |
| `VITE_API_BASE` | ai-system-registry-frontend (build time) | `http://localhost:8001/api/v1` | Backend API base URL baked into the frontend bundle by Vite. |
| `VITE_MONITORING_API_BASE` | monitoring-frontend (build time) | `http://localhost:8003/api/v1` | Monitoring backend API base URL baked into the monitoring bundle by Vite. |

All services use `os.environ["KEY"]` (fail-fast) — no hardcoded credential defaults in code.

## docker-compose.yml conventions
- Credentials are defined via YAML anchors (`x-db-env`, `x-rmq-env`, `x-ch-env`) and merged into each service — never copy-paste connection strings
- Backend build context is always the repo root (`.`) so the Dockerfile can `COPY libs/persistence`
- New backends follow the same pattern: `depends_on: db-migrate: condition: service_completed_successfully`
- Each backend must have a `healthcheck.py` and declare a `healthcheck` in `docker-compose.yml` using `CMD python healthcheck.py` — no extra packages needed, uses Python stdlib `urllib`
- Shell depends on backend via `condition: service_healthy` — it won't start until the backend passes its healthcheck
- YAML does not allow two `<<:` merge keys in the same mapping block — expand env vars inline when a service needs multiple anchors (see `otel-clickhouse-consumer`)

## Dependency pinning

Each service has its own `requirements.txt` with pinned versions directly in it (e.g. `fastapi==0.115.6`). When adding or upgrading a dependency:

1. Edit the version directly in the relevant service's `requirements.txt`
2. Rebuild the service: `docker compose up --build -d <service-name>`

## otel-pipeline/

GenAI observability pipeline. Receives OTLP from any application, routes through RabbitMQ, stores in ClickHouse.

- **`collector/otel-collector-config.yaml`** — OTel Collector receives OTLP gRPC/HTTP and exports to rmq-bridge as OTLP/HTTP JSON. `encoding: json` and `compression: none` are required — the collector defaults to protobuf binary which the bridge cannot parse.
- **`rmq-bridge/`** — FastAPI service. `POST /v1/traces` receives raw OTLP JSON and publishes it to RabbitMQ fanout exchange `otel.traces`. No parsing or filtering here — that is the consumer's job. Reads `RABBITMQ_URL` from env (fail-fast).
- **ClickHouse schema** — managed by the `clickhouse-migrate` service (see `libs/clickhouse/`). Schema migrations live in `libs/clickhouse/migrations/` and are tracked in `otel.schema_migrations`.

### Connecting an external application

Any app outside Docker can send spans to the collector running on the host:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://<host-ip>:4317   # gRPC
# or
OTEL_EXPORTER_OTLP_ENDPOINT=http://<host-ip>:4318   # HTTP
```

To capture prompt/response message content (off by default for privacy):

```bash
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

This env var is set on the **instrumented application**, not on this platform. When `false` (default), `input_messages` and `output_messages` columns in ClickHouse will be empty strings.

## consumers/

One sub-directory per RabbitMQ consumer. Each is a standalone Python worker: no FastAPI, `asyncio.run(main())` entrypoint, no HTTP port. All consumers bind a named durable queue to the `otel.traces` fanout exchange — messages are queued while a consumer is down and processed on reconnect.

To add a new consumer, use the `/add-consumer` skill.

**`consumers/clickhouse-consumer/`** — Parses OTLP JSON, skips spans without `gen_ai.operation.name`, batch-inserts into `otel.gen_ai_spans`. Reads `RABBITMQ_URL`, `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` from env (all fail-fast). Imports connection and schema constants from `ai_trust_clickhouse`.

### Run consumer tests (local)
```bash
cd consumers/clickhouse-consumer
make setup      # first time only — creates .venv and installs deps
make test-unit  # no Docker needed
```

## monitoring/

The monitoring MFE — live observability signals from ClickHouse + registry analytics from Postgres. Runs as a separate Luigi microfrontend, independent from the AI System Registry.

- `frontend/` — React 18 + Vite SPA (Recharts for charts), multi-stage Docker build, served by nginx on port 3002
- `backend/` — FastAPI on port 8003, reads from both Postgres and ClickHouse

### Backend structure (`monitoring/backend/app/`)
- `main.py` — FastAPI app, mounts monitoring router, `/health` endpoint
- `routers/monitoring.py` — all monitoring endpoints:
  - `GET /api/v1/monitoring/services` — distinct services + models seen in ClickHouse
  - `GET /api/v1/monitoring/signals?service=&window=1h` — time-series inference count, latency, token usage from ClickHouse. `window` accepts `15m`, `1h`, `6h`, `24h`
  - `GET /api/v1/monitoring/stats?lifecycle=` — registry analytics aggregated from Postgres (tier counts, compliance distribution, model breakdown etc.)

### ClickHouse queries
All ClickHouse queries use `clickhouse-connect` with **parameterized queries** (`{param:Type}` syntax) — never f-string interpolation of user input. `window` and `interval` values come from a server-side allowlist, not raw user input.

### Frontend
React 18 + Vite SPA with two views:
1. **Live Signals** — polls `/monitoring/signals` every 5s. Service and time-window selectors persist to `localStorage` (`ai_trust_monitoring_filters_v1`). Recharts line charts for inference count and latency over time.
2. **Registry Analytics** — reads `/monitoring/stats`. Tier breakdown, compliance histogram, recent systems table.

### Environment variables
The monitoring backend reads the same `DATABASE_URL` as the registry backend (shared Postgres), plus the ClickHouse vars:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string (from `x-db-env` anchor) |
| `CLICKHOUSE_HOST` | ClickHouse hostname |
| `CLICKHOUSE_PORT` | ClickHouse HTTP port (default `8123`) |
| `CLICKHOUSE_USER` | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | ClickHouse password |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins (required) |
