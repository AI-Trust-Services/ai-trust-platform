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
pip install -r requirements.txt
# Set DATABASE_URL to a local postgres instance
# Run migrations first (only needed once, or after pulling new migrations)
cd ../../libs/persistence && alembic upgrade head && cd -
uvicorn app.main:app --reload --port 8001
```

### Run tests (local)
```bash
cd ai-system-registry/backend
ALLOWED_ORIGINS=http://localhost:3001 .venv/bin/pytest tests/ -v
```

Tests cover classifier logic (`tests/test_classifier.py`) and schema validation (`tests/test_schemas.py`). No DB required — these are pure unit tests.


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
| PostgreSQL | localhost:5432 / db: `ai_trust` |

## Architecture

```
ai-trust-platform/
├── libs/
│   └── persistence/              ← shared Python package (models, migrations, DB session)
│       ├── Dockerfile            ← one-shot migration container
│       ├── pyproject.toml        ← pip installable as ai-trust-persistence
│       ├── alembic.ini           ← migration config, reads DATABASE_URL from env
│       └── ai_trust_persistence/
│           ├── database.py       ← engine (pool_size=5), SessionLocal, Base
│           ├── models/           ← all SQLAlchemy ORM models (shared across all backends)
│           └── migrations/       ← single Alembic setup for all tables
├── shell/                        ← Luigi host (nginx + luigi-config.js)
├── ai-system-registry/           ← first component
│   ├── frontend/                 ← static HTML + UI5 Web Components (nginx, port 3001)
│   └── backend/                  ← FastAPI + SQLAlchemy async (port 8001)
└── docker-compose.yml            ← orchestrates all services
```

## Docker Startup Order

```
postgres (healthy)
      ↓
db-migrate  →  runs alembic upgrade head, then exits (service_completed_successfully)
      ↓
ai-system-registry-backend (healthy)  →  starts uvicorn, healthcheck via healthcheck.py
ai-system-registry-frontend           →  starts independently (static, no DB dependency)
      ↓
shell  →  waits for backend (service_healthy) + frontend (service_started)
```

`db-migrate` is a one-shot container built from `libs/persistence/Dockerfile`. It owns all migrations. Backends never run migrations — they just start the API server.

**If db-migrate fails:** check logs with `docker compose logs db-migrate`. Common causes: postgres not ready (retry `docker compose up db-migrate`), or a bad migration file. Fix the migration, then re-run with `docker compose up --build db-migrate`. The backend will not start until db-migrate exits successfully.

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
- `frontend/` — static HTML + UI5 Web Components (no build step), served by nginx on port 3001+
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
Each MFE is a single `public/index.html` with:
- UI5 Web Components v2 loaded from `unpkg.com`
- Luigi Client loaded from `unpkg.com`
- Vanilla JS with hash-based client-side routing (`#/systems`, `#/models`)
- Backend health polling on load — shows a red banner with auto-retry if backend is unavailable
- All API calls to `http://localhost:800x/api/v1/`
- nginx headers: `X-Frame-Options: ALLOWALL` and `Content-Security-Policy: frame-ancestors *` (required for Luigi iframe embedding)

## Environment variables

| Variable | Service | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | all backends, db-migrate | `postgresql+asyncpg://postgres:postgres@postgres:5432/ai_trust` | Postgres connection string |
| `ALLOWED_ORIGINS` | ai-system-registry-backend | *(required — no default)* | Comma-separated list of allowed CORS origins. App refuses to start if not set. Set to real domain(s) in production |

## docker-compose.yml conventions
- `DATABASE_URL` is defined once as a YAML anchor (`x-db-env`) and merged into each service that needs it — never copy-paste it
- Backend build context is always the repo root (`.`) so the Dockerfile can `COPY libs/persistence`
- New backends follow the same pattern: `depends_on: db-migrate: condition: service_completed_successfully`
- Each backend must have a `healthcheck.py` and declare a `healthcheck` in `docker-compose.yml` using `CMD python healthcheck.py` — no extra packages needed, uses Python stdlib `urllib`
- Shell depends on backend via `condition: service_healthy` — it won't start until the backend passes its healthcheck
