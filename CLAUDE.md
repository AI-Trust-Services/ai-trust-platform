# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Run the full platform
```bash
docker compose up --build -d
docker compose down --remove-orphans
```

### Run the full platform on local Kubernetes (kind)

Alternative deployment path to docker-compose — both are supported, share the same `.env`, and use
identical host ports, so don't run them at the same time. See [k8s/README.md](k8s/README.md) for
full details.

```bash
cd k8s
make up      # kind create cluster + bootstrap (namespace/Secret/ConfigMaps) + build&load images + helm install
make down    # helm uninstall + kind delete cluster
```

Manifests live in `k8s/helm/ai-trust-platform/` (a Helm chart). Every k8s Service name is fixed to
the literal docker-compose service name (`postgres`, `ai-system-registry-backend`, etc.) so
`shell/nginx.conf` and every backend's env vars work unmodified — no image or app code changes were
needed for this deployment path.

### Run tests (any backend)
```bash
cd <component>/backend   # e.g. cd compliance/backend
make setup               # first time only — creates .venv and installs deps
make test-unit           # no Docker needed (where available)
make test-e2e            # requires Postgres: docker compose up -d postgres
make test                # all tests
```

- `tests/unit/` — pure unit tests, no DB required
- `tests/e2e/` — full stack via ASGITransport, requires Postgres only (no running server needed), auto-creates `ai_trust_test` DB and runs migrations on first run

### Migrations
```bash
cd libs/persistence
alembic upgrade head                              # apply all
alembic revision --autogenerate -m "description" # generate new migration
alembic downgrade -1                              # roll back one
```

### Consumer tests
```bash
cd consumers/clickhouse-consumer
make setup      # first time only — creates .venv and installs deps
make test-unit  # no Docker needed
```

### VS Code debugging (any backend)
```bash
# Stop the Docker backend you want to debug
docker compose stop <service-name>
cd <component>/backend
make setup  # first time only — creates .venv
# Press F5 in VS Code — launch.json is pre-configured in each backend
```

---

## Project conventions

These are the decisions that are specific to this codebase. Follow them consistently — don't apply external patterns that contradict these even if they are more common elsewhere.

### DB sessions
This project uses `async with SessionLocal() as session` directly in each router function — not FastAPI's `Depends()` pattern. Follow this convention for consistency. Helper functions (e.g. `cascade.py`) never call `session.commit()` — only `session.flush()` if they need the row's ID before returning. The router function is always the one that calls `session.commit()`, keeping each request atomic.

### Logging
Event names follow the `resource.action` convention — e.g. `assessment.created`, `evidence.status_changed`, `policy_checker_worker.unknown_condition`. Contextual fields go in `extra={}`, never interpolated into the message string.
```python
logger.info("assessment.created", extra={"assessment_id": row.id, "framework_id": row.framework_id})
```

### ID generation
All domain IDs use `new_id("PREFIX")` from `compliance/backend/app/ids.py` — e.g. `new_id("ASS")` → `ASS-XXXXXXXX`. Never use `uuid4()` directly. Existing prefixes: `ASS`, `OBL`, `CTL`, `EVD`. Add new prefixes to `ids.py` when creating new models.

### E2E test helpers
`conftest.py` in each component exposes module-level async functions (`create_system`, `create_assessment`, `create_obligation`, etc.) as building blocks for test setup. Import and call them directly — don't inline repeated HTTP calls or wrap them in fixtures. `create_system()` in the compliance tests writes directly to the DB (no HTTP intake endpoint exists in compliance — systems come from the registry).

### M2M linking
Many-to-many joins (`control_obligations`, `evidence_controls`, `evidence_obligations`) use raw `pg_insert(...).on_conflict_do_nothing()` — not SQLAlchemy `relationship()` with `secondary=`. Don't add ORM relationships to M2M tables.
```python
from sqlalchemy.dialects.postgresql import insert as pg_insert
await session.execute(
    pg_insert(control_obligations).values(control_id=ctl_id, obligation_id=obl_id).on_conflict_do_nothing()
)
```

### Frontend API client
Every React frontend has `src/api/client.ts` with a typed `request<T>()` wrapper, a `json()` helper for POST/PUT bodies, a `qs()` helper for query params, and an `api` object with one method per endpoint. All API calls go through `request<T>()` — never raw `fetch()` inline in components. Error handling (`formatDetail`) normalises FastAPI validation errors into a readable string. Follow `compliance/frontend/src/api/client.ts` as the reference.

### Pydantic schemas
All response schemas set `model_config = {"from_attributes": True}`. Convert ORM rows with `Schema.model_validate(row)` — never `.from_orm()` (Pydantic v1, removed in v2).

---

## Service URLs

All traffic enters through port 8080 (oauth2-proxy). Frontend and backend ports are not exposed — only accessible via the shell nginx reverse proxy.

| Service | URL |
|---|---|
| Luigi shell / entry point | http://localhost:8080 |
| Keycloak (browser login) | http://localhost:8180 |
| AI System Registry frontend | http://localhost:8080/registry/ |
| AI System Registry backend API | http://localhost:8080/api/registry/v1 |
| AI System Registry API docs | http://localhost:8080/api/registry/docs |
| AI System Registry health | http://localhost:8080/api/registry/health |
| Overview frontend | http://localhost:8080/overview/ |
| Overview backend API | http://localhost:8080/api/overview/v1 |
| Overview health | http://localhost:8080/api/overview/health |
| Monitoring frontend | http://localhost:8080/monitoring/ |
| Monitoring backend API | http://localhost:8080/api/monitoring/v1 |
| Monitoring health | http://localhost:8080/api/monitoring/health |
| Alerts frontend | http://localhost:8080/alerts/ |
| Alerts backend API | http://localhost:8080/api/alerts/v1 |
| Alerts health | http://localhost:8080/api/alerts/health |
| Decision Trace Analyzer frontend | http://localhost:8080/dta/ |
| Decision Trace Analyzer backend API | http://localhost:8080/api/dta/v1 |
| Decision Trace Analyzer health | http://localhost:8080/api/dta/health |
| Compliance frontend | http://localhost:8080/compliance/ |
| Compliance backend API | http://localhost:8080/api/compliance/v1 |
| Compliance health | http://localhost:8080/api/compliance/health |
| Role Management (IAM) frontend | http://localhost:8080/iam/ |
| IAM / roles API | http://localhost:8080/api/users/v1/iam |
| Current user permissions | http://localhost:8080/api/users/v1/me/permissions |
| PostgreSQL | localhost:5432 / db: `ai_trust` |
| OTel Collector (gRPC) | localhost:4317 |
| OTel Collector (HTTP) | localhost:4318 |
| OTel RMQ Bridge | http://localhost:8002 |
| OTel RMQ Bridge health | http://localhost:8002/health |
| RabbitMQ management UI | http://localhost:15672 (credentials from `.env`) |
| ClickHouse HTTP API | http://localhost:8123 / db: `otel` |
| MinIO API | http://localhost:9000 |
| MinIO console | http://localhost:9001 (credentials from `.env`) |

## Authentication and Authorization

**Hard separation of concerns:**
- **Keycloak** — authentication only: who you are (identity, login, logout, JWT issuance)
- **OpenFGA** — authorization only: what you can do (roles, permissions, access decisions)

Keycloak has no knowledge of application roles or permissions. OpenFGA has no knowledge of passwords or sessions. The two systems are independent — never use Keycloak realm roles to gate application features.

See [docs/auth-flow.md](docs/auth-flow.md) for sequence diagrams of the login, API request, and sign-out flows.

### Authentication (Keycloak + oauth2-proxy)

All traffic enters through **oauth2-proxy** at port 8080. No backend or frontend is reachable directly from the browser — all ports are internal to Docker.

#### Flow
1. Browser hits `http://localhost:8080` → oauth2-proxy checks session cookie
2. No session → redirects browser to Keycloak login at `KEYCLOAK_PUBLIC_URL` (port 8180)
3. User logs in → Keycloak redirects back to `/oauth2/callback` with auth code
4. oauth2-proxy exchanges code for JWT, stores it in an encrypted session cookie
5. All subsequent requests: oauth2-proxy validates cookie, forwards to shell with `Authorization: Bearer <JWT>` added server-side
6. Browser only ever sees the encrypted session cookie — JWT never exposed

#### Components
- **Keycloak 25** (`infra/keycloak/`) — identity provider, realm `ai-trust`, port 8180. Owns user accounts, credentials, and sessions only.
- **keycloak-provision** — one-shot container that creates the realm, OIDC client, and bootstrap admin user via Admin API on startup. Idempotent. Config driven by `APP_PUBLIC_URL` — no hardcoded URLs.
- **oauth2-proxy v7.6.0** — gateway at port 8080, enforces authentication on all paths. Forwards `X-Forwarded-Preferred-Username` (the human-readable username, used by backends) and `X-Forwarded-User` (the OIDC `sub` UUID, fallback only) to backends.
- **Sign out** — shell bar button links to `/oauth2/sign_out`, which clears the session and calls Keycloak's logout endpoint server-side (`--backend-logout-url`).

A single bootstrap admin user is always created on startup with credentials from `APP_ADMIN_USERNAME` / `APP_ADMIN_PASSWORD` in `.env`.

### Authorization — RBAC via OpenFGA

**OpenFGA is the sole source of truth for roles and permissions.** Backends never check Keycloak realm roles to make access decisions. See [docs/rbac-design.md](docs/rbac-design.md) for the full design.

- **Model** — flat RBAC: users are members of roles, roles grant permissions on a single `platform:global` object.
- **`libs/authorization`** — shared lib. `require_permission("evidence:approve")` is a FastAPI `Depends()` that reads `X-Forwarded-Preferred-Username` (set by oauth2-proxy), calls OpenFGA, and returns 403 on denial. **Fails closed** — any OpenFGA error denies. Permission strings + role definitions live in `ai_trust_authorization.constants` (single source of truth).
- **`openfga` + `openfga-provision`** — OpenFGA uses its own Postgres DB (`openfga`, created by `infra/postgres/init.sh`). `openfga-provision` (one-shot, like `keycloak-provision`) creates the store, uploads the model generated from `constants.py`, seeds role→permission tuples, seeds `APP_ADMIN_USERNAME` as Platform Admin, and writes the store ID to the `openfga-config` volume. Backends read the store ID from `/config/store_id` on startup.
- **IAM API** — `users` backend exposes four role/permission routers (all mounted at `/v1`):
  - `routers/roles.py` — `GET /roles` → `[{id, name, description}]` (built-in roles list, used by the role assignment dropdown in the UI)
  - `routers/iam.py` — `GET /iam/roles` → `[{name, permissions[]}]` (built-in roles with their full permission list, used by the IAM roles page)
  - `routers/permissions.py` — `GET /me/permissions` → current user's effective permissions (used by the shell to gate the IAM nav node, and by MFEs to grey out unauthorized actions)
  - `routers/custom_roles.py` — `GET/POST/PUT/DELETE /iam/custom-roles` (see Custom roles below)
  - User management endpoints (`GET/POST /users`, `PUT/DELETE /users/{id}/roles/{role}`) live in `routers/users.py`
- **IAM UI** — separate `iam/` frontend MFE (Role Management), proxied at `/iam/`, shown in the Luigi nav only to users with `iam:manage`.
- **Built-in roles** — `platform_administrator`, `ai_engineer`, `ai_compliance_officer`, `business_owner`, `auditor`, `executive`. Each user holds exactly one role at a time (single-role invariant enforced in `assign_role`). Role assignment writes directly to OpenFGA.
- **Custom roles** — `routers/custom_roles.py` (all endpoints require `iam:manage`): `GET /iam/custom-roles`, `POST /iam/custom-roles`, `PUT /iam/custom-roles/{role_id}`, `DELETE /iam/custom-roles/{role_id}`. Custom roles are stored in Postgres (`custom_roles` table, IDs prefixed `ROLE-`) and their permission tuples live in OpenFGA. Deletion removes OpenFGA member tuples → OpenFGA permission tuples → Postgres row in that order.
- **Permission naming convention** — permission strings use `resource:action` format (e.g. `systems:read`, `evidence:approve`). The OpenFGA relation name is derived by prefixing `can_` and replacing `:` with `_` — e.g. `systems:read` → `can_read_systems`. The full mapping lives in `RELATION_BY_PERMISSION` in `ai_trust_authorization.constants`. **To add a new permission: add it to `constants.py` only** — `openfga-provision` auto-generates the authorization model from that file at startup. Never hand-edit an FGA schema file.
- **Authorization model** — generated programmatically by `infra/openfga-provision/provision.py` from `constants.py` each time `openfga-provision` runs. There is no hand-authored DSL file. The model is re-uploaded only if no model exists in the store (idempotent).
- **Store ID** — `openfga-provision` writes the store ID to `/config/store_id` on the shared `openfga-config` volume. Backends read it at startup via `libs/authorization`. For tests or production deployments that don't use the volume, set `OPENFGA_STORE_ID` env var directly — it takes precedence over the file.

## Architecture

See [docs/architecture.md](docs/architecture.md) for repo layout, GenAI observability data flow, and Docker startup order diagrams.

## Frontend stacks

All React frontends (AI System Registry, Alerts, Decision Trace Analyzer, Compliance) share the same pattern:
- **Build tool:** Vite 6 (`npm run build → dist/`), multi-stage Dockerfile (`node:20-alpine` build → `nginx:alpine` serve)
- **Base path:** `base` set in `vite.config.ts` (e.g. `/registry/`) so assets resolve correctly when served under a sub-path via the shell proxy
- **Routing:** `HashRouter` (compatible with Luigi's `useHashRouting: true`)
- **Luigi integration:** `@luigi-project/client` npm package; `addInitListener` handshake in `useLuigi.js`
- **API base URL:** read from `import.meta.env.VITE_*_API_BASE` at build time — all relative paths (e.g. `/api/registry/v1`)
- **Backend health polling:** shows a red banner with auto-retry if backend is unavailable
- **nginx headers:** `X-Frame-Options: ALLOWALL` and `Content-Security-Policy: frame-ancestors *` (required for Luigi iframe embedding)
- **UI5 Web Components** — `<ui5-button>` etc. for SAP Fiori look. Import once per file: `import "@ui5/webcomponents/dist/Button.js"` then use as `<ui5-button>` JSX tags

**Exceptions:**
- **Overview** — static HTML served directly by nginx, no build step
- **Decision Trace Analyzer** — dev proxy: `vite.config.ts` proxies `/api/*` → `http://localhost:8006`, so no CORS issues locally

## Backend stacks

All backends are **FastAPI 0.115 + Python 3.12**, served on port 8001+:
- `main.py` — FastAPI app, mounts routers, `/health` endpoint tests DB connectivity
- `schemas/` — Pydantic v2 request/response schemas, one file per domain
- `healthcheck.py` — used by Docker healthcheck (`python healthcheck.py`), hits `/health` via stdlib urllib
- `routers/` — one file per resource group

## libs/persistence

The shared DB package. All backends depend on it.

- **`database.py`** — async SQLAlchemy engine, reads `DATABASE_URL` from environment. Pool: `pool_size=5`, `max_overflow=10`, `pool_pre_ping=True`
- **`models/`** — SQLAlchemy ORM models, one file per domain entity
- **`migrations/versions/`** — Alembic migration scripts for all tables across all components

## libs/clickhouse

The shared ClickHouse package. All consumers and any future services that read/write ClickHouse depend on it.

- **`database.py`** — ClickHouse connection factory, reads `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` from environment (fail-fast)
- **`tables.py`** — single source of truth for table names and column lists
- **`migrations/`** — versioned SQL files, applied in filename order, tracked in `otel.schema_migrations`

### Cold storage (tiered MergeTree → MinIO)

Both `gen_ai_spans` and `alert_events` use a two-tier storage policy:

| Tier | Storage | Trigger |
|---|---|---|
| Hot | Local disk (`clickhouse_data` volume) | Default for new data |
| Cold | MinIO S3 (`minio_data` volume) | Age > 7 days **or** hot disk > 90% full |

Key decisions:
- **MinIO** — open-source S3-compatible object store, runs as a Docker container, no hyperscaler dependency. Swap to AWS S3 by changing three env vars — no code or schema changes needed
- **Queryable cold data** — tiered MergeTree keeps cold data queryable via SQL (slower, network round-trip to MinIO); data is never detached or exported
- **No delete TTL** — data kept forever in MinIO (compliance audit trail)
- **Full fidelity** — `input_messages` and `output_messages` are retained in cold storage (not stripped)
- **Query routing** — all existing dashboard queries stay on hot storage naturally (24h max window); alert worker queries are explicitly bounded to recent data (e.g. last 1h) to avoid cold scans
- **Credentials** — `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` in `.env`, with `x-minio-env` anchor in `docker-compose.yml`
- **ClickHouse config** — storage policy defined in `otel-pipeline/clickhouse-config/config.d/storage.xml`, mounted into the ClickHouse container as read-only
- **Bucket init** — `minio-init` one-shot container creates the `clickhouse` bucket on first startup; ClickHouse `depends_on: minio-init`

## libs/logging

The shared structured logging package. All backends depend on it.

- **`logger.py`** — JSON formatter with UTC timestamps, log level, logger name, correlation ID, and any extra fields passed via `extra={}`
- **`correlation_id_var`** — `contextvars.ContextVar` set once per request in the `logging_middleware` in `main.py`. Because it uses `contextvars`, it automatically propagates through all `await` calls within that request — every `logger.info(...)` anywhere in the call chain includes the same `correlation_id` without passing it explicitly
- **Log levels** — middleware logs `INFO` for 2xx, `WARNING` for 4xx, `ERROR` for 5xx
- Usage: `from ai_trust_logging import get_logger, correlation_id_var`

## Shell (`shell/`)

Static HTML + `luigi-config.js` served by nginx. Luigi core is loaded from CDN. Navigation nodes in `luigi-config.js` define which MFEs are mounted and at what paths. To add a component to the nav, add a `children` node with its `viewUrl`.

The shell nginx also acts as a **reverse proxy** — all MFE and backend API traffic routes through it:
- `/registry/`, `/monitoring/`, `/overview/`, `/alerts/`, `/compliance/`, `/dta/` → frontend containers
- `/api/registry/`, `/api/monitoring/`, `/api/overview/`, `/api/alerts/`, `/api/compliance/`, `/api/dta/` → backend containers

If a container restarts and nginx returns 502, run `docker compose restart shell` to clear the stale DNS cache.

**Sidebar customization** — the sidebar uses `responsiveNavigation: "Fiori3"` with a custom animated hamburger injected via `luigiAfterInit`. Key settings:
- `sideNavigation: { collapsed: true }` — starts collapsed (icons only)
- The custom hamburger is injected into the sidebar DOM after Luigi renders
- Alerts is registered as `hideFromNav: true` — accessible via bell badge but not shown in nav
- `defaultChildNode: "overview"` — Overview loads by default when navigating to `/home`
- "Sign out" button injected into the shell bar via `luigiAfterInit`, links to `/oauth2/sign_out`

## Components

Each component has `frontend/` (nginx, internal only) and `backend/` (FastAPI, internal only). All traffic is routed through port 8080 via the shell nginx reverse proxy.

### Dual deployment paths — docker-compose and k8s (kind)

This platform has **two independent, fully-supported local deployment paths**: `docker-compose.yml`
and the Helm chart under `k8s/helm/ai-trust-platform/` (see [k8s/README.md](k8s/README.md)). Only
one is usually running in a given session, but **develop and change both together** — don't treat
the k8s path as a one-off snapshot. Whenever you touch anything that affects how a service runs:

- New service in `docker-compose.yml`? Add the matching Deployment+Service (or Job, for a one-shot
  task) to the Helm chart, and add its image to `k8s/scripts/build-and-load-images.sh`.
- New/changed env var or secret? Add it to `.env.example` for docker-compose — it flows through to
  k8s automatically via `k8s/scripts/bootstrap.sh`'s Secret (sourced from that same `.env`; there is
  no separate k8s-specific env file by design).
- New `depends_on: condition:` in compose? Add the matching `waitForTcp`/`waitForHttp`/`waitForJob`
  initContainer in the Helm chart (helpers defined once in `_helpers.tpl`).
- Renamed or moved a file that's mounted as a volume/ConfigMap in either path (e.g. `infra/*/init.sh`,
  `otel-pipeline/**/config`)? Update both `docker-compose.yml`'s `volumes:` **and**
  `k8s/scripts/bootstrap.sh`'s `--from-file` references — nothing enforces this in CI, a rename on
  one side silently breaks the other.

### Adding a new component
1. Create `new-component/frontend/` and `new-component/backend/`
2. Create `libs/persistence/ai_trust_persistence/models/your_model.py` and import it in `models/__init__.py`
3. Add migration to `libs/persistence/migrations/versions/` and run `alembic upgrade head`
4. Copy `ai-system-registry/backend/Dockerfile` pattern (build context must be repo root)
5. Add the libs your component needs to `requirements.txt`: `-e /app/libs/persistence` (Postgres), `-e /app/libs/clickhouse` (ClickHouse), `-e /app/libs/logging` (all backends)
6. Add `healthcheck.py` to the backend (copy from `ai-system-registry/backend/healthcheck.py`, update port)
7. Add service to root `docker-compose.yml` with `depends_on: db-migrate: condition: service_completed_successfully` and a `healthcheck`. Do **not** add `ports:` — traffic goes through the shell proxy
8. Add proxy routes to `shell/nginx.conf` for the frontend (`/new-component/`) and backend API (`/api/new-component/`)
9. Add `base: "/new-component/"` to the frontend's `vite.config.ts`
10. Add nav node to `shell/luigi-config.js` with `viewUrl: "http://localhost:8080/new-component/"`
11. Add the matching Deployment+Service pair to the k8s Helm chart — if it fits the generic
    backend+frontend pattern, add an entry to the `components` list in
    `k8s/helm/ai-trust-platform/values.yaml` (templated once in `templates/components.yaml`); if not,
    add a new template file. Add the component's image(s) to `k8s/scripts/build-and-load-images.sh`.

### ai-system-registry/ (internal port 8001, accessed via /api/registry/)

AI system registration and EU AI Act classification.

- `POST /api/v1/intake` — entry point for all new registrations. Runs the classifier (< 10ms), assigns a `SYS-XXXXXXXX` ID, persists to PostgreSQL. The frontend never sends a `tier` field — classification is backend-only.
- `GET /api/v1/systems` — pagination via `?limit=50&offset=0` (max 200)
- `POST /api/v1/systems/{id}/reclassify` — re-runs classifier on existing flags, updates `tier`, `basis`, `annex_iii_area`
- `classifier.py` — EU AI Act 4-tier waterfall (Art. 5 → GPAI → Annex III → Art. 50 → minimal), pure Python, no I/O

#### EU AI Act classifier waterfall

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

### overview/ (internal port 8004, accessed via /api/overview/)

Compliance posture MFE. Reads Postgres only. Static HTML frontend (no build step).

- `GET /api/overview/v1/stats?lifecycle=` — KPI counts, tier distribution, compliance data, recent registrations
- Frontend: fixed top section (KPI cards + tier donut + compliance bar chart) + customizable analytics dashboard. Layout persists to `localStorage` (`ai_trust_overview_dashboard_v1`)

### monitoring/ (internal port 8003, accessed via /api/monitoring/)

Live observability signals from ClickHouse + registry analytics from Postgres.

- `GET /api/monitoring/v1/services` — distinct services + models seen in ClickHouse
- `GET /api/monitoring/v1/signals?service=&window=1h` — time-series inference count, latency, token usage from ClickHouse. `window` accepts `15m`, `1h`, `6h`, `24h`
- `GET /api/monitoring/v1/stats?lifecycle=` — registry analytics aggregated from Postgres
- All ClickHouse queries use `clickhouse-connect` with **parameterized queries** (`{param:Type}` syntax) — never f-string interpolation of user input. `window` and `interval` values come from a server-side allowlist
- Frontend: Live Signals section polls every 30s; selectors persist to `localStorage` (`ai_trust_monitoring_filters_v1`). Registry Analytics section layout persists to `localStorage` (`ai_trust_dashboard_v4`)

### alerts/ (internal port 8005, accessed via /api/alerts/)

Rule-based alerting. Rules in Postgres, events in ClickHouse.

- `GET /api/alerts/v1/active` — unresolved, unhandled events from ClickHouse
- `GET /api/alerts/v1/history` — resolved/handled events
- `GET /api/alerts/v1/rules` — all rules from Postgres (includes `parameters`, `is_custom`)
- `GET /api/alerts/v1/count` — fast count for bell badge polling
- `POST /api/alerts/v1/events/{id}/handle` — mark event as handled (sets both `handled_at` and `resolved_at`)
- `POST /api/alerts/v1/events/{id}/approve-model` — approve a model change: marks handled + updates `service_model_baselines` to new model. Body: `{ service_name, new_model }`
- `POST /api/alerts/v1/events/{id}/reject-model` — reject a model change: marks handled, baseline unchanged
- `POST /api/alerts/v1/rules/{id}/toggle` — enable/disable a rule

#### policy-checker-worker/

Standalone background job (no HTTP port). Evaluates all enabled rules every `ALERT_POLL_INTERVAL` seconds (default 10s dev / raise to 60s+ for production).

- Reads enabled rules from Postgres `alert_rules` table
- Evaluates each condition against live data (Postgres + ClickHouse)
- Creates new events in ClickHouse `otel.alert_events` when conditions trigger
- Auto-resolves threshold events when conditions clear
- Event-type alerts suppressed for 24h after being handled (except `model_diverged` — baseline is the deduplication mechanism)
- Supports two evaluator return types: `tuple[bool, float]` for aggregate rules, `list[EvalResult]` for entity-scoped rules (one event per entity)

#### Alert rules (seeded defaults)

| Rule | Category | Condition type |
|---|---|---|
| Prohibited system registered | risk | `prohibited_exists` |
| Average compliance below 70% | compliance | `avg_compliance_below` |
| High-risk on market with compliance < 50% | compliance | `high_risk_on_market_low_compliance` |
| No inference signals in last 30 min | observability | `no_signals` |
| Avg latency > 500ms | observability | `high_latency` |
| System on market without model card | compliance | `market_system_no_model_card` |
| GPAI system with no compliance score | risk | `gpai_no_compliance` |
| Model version changed | observability | `model_diverged` |

#### Model divergence rule (`model_diverged`)

Detects when a service switches to a different model. Uses a persistent baseline in `service_model_baselines` (Postgres) rather than a sliding window comparison.

- On first span from a service → stores baseline, no alert
- On subsequent spans → compares `argMax(request_model, received_at)` from ClickHouse against stored baseline
- If different → fires alert with description "Model changed for {service}: {old} → {new}"
- Baseline only updates when a human explicitly approves via **Approve new model** button
- Rejecting an alert leaves the baseline unchanged; the alert re-fires every 24h until approved or the service reverts

### decision-trace-analyzer/ (internal port 8006, accessed via /api/dta/)

Trace viewer for GenAI spans. Reads ClickHouse only (no Postgres).

- `GET /api/v1/traces` — groups spans by `trace_id`, returns paginated list
- Dev proxy — `vite.config.ts` proxies `/api/*` → `http://localhost:8006`, so no CORS issues locally
- Prod — nginx proxies `/api/` → `decision-trace-analyzer-backend:8006`

### compliance/ (internal port 8007, accessed via /api/compliance/)

Governance chain MFE — assessments, obligations, controls, and evidence for EU AI Act / NIST / ISO compliance. Reads/writes Postgres; stores evidence files in MinIO.

#### Backend structure (`compliance/backend/app/`)
- `main.py` — FastAPI app, mounts all routers, `/health` endpoint, ensures MinIO bucket exists on startup
- `cascade.py` — status cascade + score recalculation: approved evidence → effective control → fulfilled obligation → assessment score → `ai_systems.compliance`. Caller owns transaction boundary; cascade functions never commit
- `obligation_templates.py` — hardcoded obligation sets per (framework, tier); EU AI Act tiers + NIST AI RMF + ISO/IEC 42001
- `control_templates.py` — hardcoded control templates per obligation `article_ref` (adapted from the EU AI Act blueprint AISEC-* control set), tier-filtered via `controls_for(article_ref, tier)`; EU AI Act + NIST + ISO
- `ids.py` — `new_id(prefix)` for `ASS-XXXXXXXX`, `OBL-XXXXXXXX`, `CTL-XXXXXXXX`, `EVD-XXXXXXXX` IDs
- `minio_client.py` — async wrapper around the synchronous `minio` SDK; all blocking calls wrapped in `asyncio.to_thread`. Two clients: `_client` (in-cluster endpoint for uploads), `_presign_client` (public endpoint for presigned download URLs)
- `routers/frameworks.py` — `GET/PATCH /api/v1/frameworks`
- `routers/assessments.py` — full CRUD + `/generate-obligations`, `/generate-controls`, `/submit`, `/approve`
- `routers/obligations.py` — full CRUD
- `routers/controls.py` — full CRUD + `/link/{obligation_id}`, `/link/{obligation_id}` DELETE
- `routers/evidence.py` — multipart upload, full CRUD + `/approve`, `/reject`, `/download-url`, `/versions`, `/upload-version`

#### Evidence multi-link
`POST /api/v1/evidence` accepts `control_ids` and `obligation_ids` as **repeated form fields** (multiple values allowed). Each creates a row in the relevant M2M table. At least one of `control_ids`, `obligation_ids`, `ai_system_id`, or `assessment_id` must be provided.

#### Evidence versioning
Evidence items are versioned. `POST /api/v1/evidence/{id}/upload-version` snapshots the current file metadata to `evidence_versions` before replacing. `GET /api/v1/evidence/{id}/versions` returns the version history ordered oldest-first. The `version_label` field on the evidence row tracks the current version label. Old files are deleted from MinIO after a successful version upload (metadata snapshot retained in `evidence_versions`).

#### Governance chain
`POST /api/v1/assessments` is the entry point: creating an assessment automatically generates obligations **and controls** in the same transaction — no separate call needed. Obligations are selected from `obligation_templates.py` based on the AI system's risk tier, with owner/not-applicable pre-filled from the most recent approved prior assessment for the same (system, framework). The `/generate-obligations` endpoint remains available for API consumers but is no longer used by the frontend.

Controls are auto-generated from `control_templates.py`: for each obligation, `controls_for(article_ref, tier)` yields the tier-scoped control templates, each persisted as a `Control` (with a stable `control_ref = "{article_ref}:{slug}"`) and linked to its obligation via `control_obligations`. Because a freshly-linked control is `not_started` (not `effective`), the cascade immediately moves each obligation `applicable → in_progress`. Owner is carried forward from the most recent prior control with the same `control_ref` for that system (owner only — never status/effectiveness/due_date). Standalone `POST /api/v1/assessments/{id}/generate-controls` re-runs generation for API consumers and is idempotent: it skips any obligation that already has ≥1 linked control. Controls can also be linked to obligations manually via `POST /api/v1/controls/{id}/link/{obligation_id}`. Evidence is uploaded as multipart form data; approving evidence cascades automatically through the chain.

Deleting an assessment cascades its obligations (FK `ondelete=CASCADE`) and cleans up the controls that were auto-generated for it: `DELETE /api/v1/assessments/{id}` removes controls that are auto-generated (`control_ref` not null) **and** linked only to that assessment's obligations. Manually-created controls (`control_ref` null) and controls shared with another assessment are always kept. The response includes `controls_deleted`.

Evidence stored in MinIO bucket `evidence-files`, key pattern: `evidence/{evidence_id}/{filename}`.

#### Evidence expiry (policy-checker-worker)
Three alert rules seeded in migration `0004` drive evidence expiry:
- `evidence_expired` — marks approved evidence past `validity_until` as `expired`, cascades control effectiveness + obligation status, fires alert
- `evidence_expiring_30d` — fires warning for approved evidence expiring in 8–30 days
- `evidence_expiring_7d` — fires warning for approved evidence expiring in 1–7 days; replaces the 30-day alert when evidence enters the 7-day window (auto-resolves the 30-day alert)

## Environment variables

All credentials are loaded from `.env` (gitignored). Copy `.env.example` and fill in values before running `docker compose up`. Never commit `.env`.

| Variable | Service | Default | Description |
|---|---|---|---|
| `POSTGRES_USER` | postgres, db-migrate, all backends | `postgres` | PostgreSQL username |
| `POSTGRES_PASSWORD` | postgres, db-migrate, all backends | `postgres` | PostgreSQL password |
| `RABBITMQ_USER` | rabbitmq, otel-rmq-bridge, consumers | `guest` | RabbitMQ username |
| `RABBITMQ_PASSWORD` | rabbitmq, otel-rmq-bridge, consumers | `guest` | RabbitMQ password |
| `CLICKHOUSE_USER` | clickhouse, consumers, backends | `default` | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | clickhouse, consumers, backends | *(empty)* | ClickHouse password |
| `MINIO_ROOT_USER` | minio, minio-init, clickhouse, compliance | `minioadmin` | MinIO access key (used by ClickHouse S3 disk) |
| `MINIO_ROOT_PASSWORD` | minio, minio-init, clickhouse, compliance | `minioadmin` | MinIO secret key |
| `DATABASE_URL` | all backends, db-migrate | derived from `POSTGRES_*` | Postgres connection string |
| `ALLOWED_ORIGINS` | all backends | *(required — no default)* | Comma-separated CORS origins. App refuses to start if not set |
| `VITE_ALERTS_API_BASE` | alerts frontend (build time) | `/api/alerts/v1` | Alerts API URL baked into bundle |
| `VITE_ALERTS_URL` | alerts frontend (build time) | `http://localhost:8080/alerts` | Alerts frontend URL (used for bell badge deep-link) |
| `VITE_COMPLIANCE_API_BASE` | compliance frontend (build time) | `/api/compliance/v1` | Compliance API URL baked into bundle |
| `VITE_COMPLIANCE_URL` | alerts + overview frontends (build time) | `http://localhost:8080/compliance` | Compliance frontend URL |
| `VITE_DTA_API_BASE` | DTA frontend (build time) | `/api/dta/v1` | DTA API base — relative path via shell nginx proxy |
| `VITE_MONITORING_API_BASE` | monitoring frontend (build time) | `/api/monitoring/v1` | Monitoring API URL baked into bundle |
| `VITE_OVERVIEW_API_BASE` | overview frontend (build time) | `/api/overview/v1` | Overview API URL baked into bundle |
| `VITE_REGISTRY_API_BASE` | registry + compliance frontends (build time) | `/api/registry/v1` | Registry API URL baked into bundle |
| `VITE_REGISTRY_URL` | overview + compliance frontends (build time) | `http://localhost:8080/registry` | Registry frontend URL |
| `KEYCLOAK_ADMIN` | keycloak, keycloak-provision | `admin` | Keycloak admin username |
| `KEYCLOAK_ADMIN_PASSWORD` | keycloak, keycloak-provision | `admin` | Keycloak admin password |
| `KEYCLOAK_CLIENT_SECRET` | keycloak-provision, oauth2-proxy | *(required)* | Shared secret for the oauth2-proxy OIDC client |
| `USERS_BACKEND_CLIENT_SECRET` | keycloak-provision, users-backend | *(required)* | Secret for the users-backend service account client in Keycloak |
| `KEYCLOAK_PUBLIC_URL` | oauth2-proxy | `http://localhost:8180` | Public Keycloak URL reachable by the browser (for login redirect) |
| `APP_PUBLIC_URL` | keycloak-provision | `http://localhost:8080` | Public app URL — used to set oauth2-proxy redirect URIs in Keycloak |
| `APP_ADMIN_USERNAME` | keycloak-provision | `admin` | Bootstrap platform admin username |
| `APP_ADMIN_PASSWORD` | keycloak-provision | `password` | Bootstrap platform admin password — change before any non-local deployment |
| `VITE_USERS_API_BASE` | users frontend (build time) | `/api/users/v1` | Users API URL baked into bundle |
| `OAUTH2_PROXY_COOKIE_SECRET` | oauth2-proxy | *(required)* | Cookie encryption key — must be exactly 16, 24, or 32 characters |
| `MINIO_ENDPOINT` | compliance-backend | `minio:9000` | In-cluster MinIO host:port for uploads (used inside the container) |
| `MINIO_PUBLIC_ENDPOINT` | compliance-backend | `localhost:9000` | Public-facing MinIO host:port for presigning download URLs the browser can reach |
| `MINIO_SECURE` | compliance-backend | `false` | Set to `true` if MinIO is behind TLS |
| `MINIO_REGION` | compliance-backend | `us-east-1` | Region used when presigning — avoids a GetBucketLocation network call from inside the container |
| `ALERT_POLL_INTERVAL` | policy-checker-worker | `10` | Rule evaluation interval in seconds (use `60`+ in production) |

All services use `os.environ["KEY"]` (fail-fast) — no hardcoded credential defaults in code.

## docker-compose.yml conventions

- Credentials are defined via YAML anchors (`x-db-env`, `x-rmq-env`, `x-ch-env`, `x-minio-env`) and merged into each service — never copy-paste connection strings
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

- **`collector/otel-collector-config.yaml`** — OTel Collector receives OTLP gRPC/HTTP and exports to rmq-bridge as OTLP/HTTP JSON. `encoding: json` and `compression: none` are required — the collector defaults to protobuf binary which the bridge cannot parse
- **`rmq-bridge/`** — FastAPI service. `POST /v1/traces` receives raw OTLP JSON and publishes it to RabbitMQ fanout exchange `otel.traces`. No parsing or filtering here — that is the consumer's job. Reads `RABBITMQ_URL` from env (fail-fast)
- **ClickHouse schema** — managed by the `clickhouse-migrate` service (see `libs/clickhouse/`). Schema migrations live in `libs/clickhouse/migrations/` and are tracked in `otel.schema_migrations`

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

Batching is hybrid — flushes when the buffer reaches `BATCH_SIZE` rows **or** after `BATCH_TIMEOUT` seconds, whichever comes first. On ClickHouse failure, retries up to 3 times with exponential backoff (1s, 2s, 4s) then acks and drops the batch. On shutdown, flushes the remaining buffer before exiting.

| Env var | Default | Description |
|---|---|---|
| `BATCH_SIZE` | `100` | Flush when buffer reaches this many rows |
| `BATCH_TIMEOUT` | `5` | Flush after this many seconds if buffer is not full |
