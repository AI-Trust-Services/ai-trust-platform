# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Commands

### Run the full platform
```bash
docker compose up --build -d
docker compose down --remove-orphans
```

### Run on local Kubernetes (kind)
Alternative to docker-compose — both are supported, share the same `.env`, and use identical host ports (don't run them at the same time). See [k8s/README.md](k8s/README.md).
```bash
cd k8s
make up      # kind create cluster + bootstrap + build&load images + helm install
make down    # helm uninstall + kind delete cluster
```
Manifests live in `k8s/helm/ai-trust-platform/`. Every k8s Service name matches the docker-compose service name (`postgres`, `ai-system-registry-backend`, etc.) so `shell/nginx.conf` and backend env vars work unmodified.

### Run tests (any backend)
```bash
cd <component>/backend   # e.g. cd compliance/backend
make setup               # first time only — creates .venv, installs deps
make test-unit           # no Docker needed (where available)
make test-e2e            # requires Postgres: docker compose up -d postgres
make test                # all tests
```
- `tests/unit/` — pure unit tests, no DB
- `tests/e2e/` — full stack via ASGITransport, requires Postgres only (no running server); auto-creates `ai_trust_test` DB and runs migrations on first run

### Consumer tests
```bash
cd consumers/clickhouse-consumer
make setup
make test-unit
```

### Migrations
```bash
cd libs/persistence
alembic upgrade head
alembic revision --autogenerate -m "description"
alembic downgrade -1
```

### VS Code debugging (any backend)
Stop the Docker backend (`docker compose stop <service>`), `cd <component>/backend`, `make setup`, then press F5 — `launch.json` is pre-configured in each backend.

---

## Project conventions

Codebase-specific decisions. Follow them even where an external pattern is more common.

- **DB sessions** — use `async with SessionLocal() as session` directly in each router (not `Depends()`). Helper functions (e.g. `cascade.py`) never `commit()` — only `flush()` if they need a row ID. The router owns the transaction and is always the one to `commit()`, keeping each request atomic.
- **Logging** — event names follow `resource.action` (e.g. `assessment.created`, `evidence.status_changed`). Contextual fields go in `extra={}`, never interpolated into the message: `logger.info("assessment.created", extra={"assessment_id": row.id})`.
- **ID generation** — all domain IDs use `new_id("PREFIX")` from `compliance/backend/app/ids.py` (e.g. `new_id("ASS")` → `ASS-XXXXXXXX`). Never `uuid4()` directly. Prefixes: `ASS`, `OBL`, `CTL`, `EVD`. Add new prefixes to `ids.py`.
- **E2E helpers** — `conftest.py` exposes module-level async functions (`create_system`, `create_assessment`, etc.). Import and call them directly; don't inline HTTP calls or wrap them in fixtures. `create_system()` in compliance tests writes directly to the DB (no HTTP intake endpoint in compliance).
- **M2M linking** — many-to-many joins (`control_obligations`, `evidence_controls`, `evidence_obligations`) use raw `pg_insert(...).on_conflict_do_nothing()`, not ORM `relationship(secondary=)`. Don't add ORM relationships to M2M tables.
- **Frontend API client** — every React frontend has `src/api/client.ts` with a typed `request<T>()` wrapper, `json()`/`qs()` helpers, and an `api` object with one method per endpoint. All calls go through `request<T>()` — never raw `fetch()` in components. `formatDetail` normalises FastAPI validation errors. Reference: `compliance/frontend/src/api/client.ts`.
- **Pydantic schemas** — response schemas set `model_config = {"from_attributes": True}`. Convert rows with `Schema.model_validate(row)` — never `.from_orm()` (Pydantic v1, removed in v2).

---

## Service URLs

All traffic enters through port 8080 (oauth2-proxy). Frontend and backend ports are not exposed — only reachable via the shell nginx reverse proxy.

| Service | URL |
|---|---|
| Luigi shell / entry point | http://localhost:8080 |
| Keycloak (browser login) | http://localhost:8180 |
| Frontends | `/registry/`, `/overview/`, `/monitoring/`, `/alerts/`, `/dta/`, `/compliance/`, `/iam/` under `:8080` |
| Backend APIs | `/api/{registry,overview,monitoring,alerts,dta,compliance}/v1` under `:8080` (health at `/api/*/health`, docs at `/api/registry/docs`) |
| IAM / roles API | `/api/users/v1/iam` · current-user permissions `/api/users/v1/me/permissions` |
| PostgreSQL | localhost:5432 / db `ai_trust` |
| OTel Collector | gRPC localhost:4317 · HTTP localhost:4318 |
| OTel RMQ Bridge | http://localhost:8002 (health `/health`) |
| RabbitMQ management | http://localhost:15672 (creds from `.env`) |
| ClickHouse HTTP | http://localhost:8123 / db `otel` |
| MinIO | API http://localhost:9000 · console http://localhost:9001 (creds from `.env`) |

## Authentication and Authorization

**Hard separation:** **Keycloak** = authentication only (who you are). **OpenFGA** = authorization only (what you can do). The two are independent — never use Keycloak realm roles to gate application features. See [docs/auth-flow.md](docs/auth-flow.md) and [docs/rbac-design.md](docs/rbac-design.md).

### Authentication (Keycloak + oauth2-proxy)
All traffic enters through **oauth2-proxy** at port 8080; nothing else is browser-reachable. No session → redirect to Keycloak login (`KEYCLOAK_PUBLIC_URL`, port 8180) → code exchanged for JWT stored in an encrypted session cookie → subsequent requests forwarded to the shell with `Authorization: Bearer <JWT>` added server-side. The browser only ever sees the cookie.

- **Keycloak 25** (`infra/keycloak/`) — realm `ai-trust`, port 8180. Owns accounts, credentials, sessions only.
- **keycloak-provision** — one-shot, idempotent; creates realm, OIDC client, bootstrap admin via Admin API. Driven by `APP_PUBLIC_URL`, no hardcoded URLs.
- **oauth2-proxy v7.6.0** — forwards `X-Forwarded-Preferred-Username` (human-readable, used by backends) and `X-Forwarded-User` (OIDC `sub` UUID, fallback).
- **Sign out** — shell bar button → `/oauth2/sign_out`, which clears the session and calls Keycloak logout server-side.
- Bootstrap admin created on startup from `APP_ADMIN_USERNAME` / `APP_ADMIN_PASSWORD`.

### Authorization — RBAC via OpenFGA
**OpenFGA is the sole source of truth for roles and permissions.** Flat RBAC: users are members of roles, roles grant permissions on a single `platform:global` object.

- **`libs/authorization`** — `require_permission("evidence:approve")` is a `Depends()` that reads `X-Forwarded-Preferred-Username`, calls OpenFGA, returns 403 on denial. **Fails closed.** Permission strings + role definitions live in `ai_trust_authorization.constants` (single source of truth).
- **`openfga` + `openfga-provision`** — OpenFGA has its own Postgres DB (`openfga`, created by `infra/postgres/init.sh`). Provision (one-shot) creates the store, uploads the model generated from `constants.py`, seeds role→permission tuples, seeds `APP_ADMIN_USERNAME` as Platform Admin, writes the store ID to the `openfga-config` volume. Backends read it from `/config/store_id` at startup (or `OPENFGA_STORE_ID` env var, which takes precedence — used for tests/prod without the volume).
- **IAM API** (`users` backend, all at `/v1`): `roles.py` (`GET /roles`, dropdown list) · `iam.py` (`GET /iam/roles` with full permission lists) · `permissions.py` (`GET /me/permissions`) · `custom_roles.py` (`GET/POST/PUT/DELETE /iam/custom-roles`) · user management in `users.py` (`GET/POST /users`, `PUT/DELETE /users/{id}/roles/{role}`).
- **IAM UI** — separate `iam/` MFE at `/iam/`, shown in nav only to users with `iam:manage`.
- **Built-in roles** — `platform_administrator`, `ai_engineer`, `ai_compliance_officer`, `business_owner`, `auditor`, `executive`. Single-role invariant enforced in `assign_role`.
- **Custom roles** — stored in Postgres (`custom_roles`, IDs prefixed `ROLE-`), permission tuples in OpenFGA. Deletion order: OpenFGA member tuples → permission tuples → Postgres row.
- **Permission naming** — `resource:action` (e.g. `systems:read`). OpenFGA relation = `can_` + name with `:` → `_` (e.g. `can_read_systems`); mapping in `RELATION_BY_PERMISSION`. **To add a permission, edit `constants.py` only** — `openfga-provision` regenerates the model from it at startup (re-uploaded only if the store has no model). Never hand-edit an FGA schema file.

## Architecture

See [docs/architecture.md](docs/architecture.md) for repo layout, GenAI observability data flow, and Docker startup order.

## Frontend stacks

All React frontends (registry, alerts, DTA, compliance, monitoring, users, iam) share:
- **Stack** — React 19, React Router 8, TypeScript 5.8. Use React 19 APIs (no `forwardRef`/`React.FC`, `use()` where applicable).
- **Build** — Vite 6 (`npm run build → dist/`), multi-stage Dockerfile (`node:24-alpine` build → `nginx:alpine` serve).
- **Base path** — `base` in `vite.config.ts` (e.g. `/registry/`) for correct asset resolution under the shell sub-path.
- **Routing** — `HashRouter` (Luigi `useHashRouting: true`). Luigi via `@luigi-project/client`, `addInitListener` handshake in `useLuigi.js`.
- **API base URL** — from `import.meta.env.VITE_*_API_BASE` at build time (relative paths, e.g. `/api/registry/v1`).
- **Health polling** — red banner with auto-retry if backend is down.
- **nginx headers** — `X-Frame-Options: ALLOWALL` and `Content-Security-Policy: frame-ancestors *` (required for Luigi iframe embedding).
- **UI5 Web Components** — `@ui5/webcomponents-react` 2.25 (SAP Fiori look). Import named components (`import { Button } from "@ui5/webcomponents-react"`) and use as JSX; never raw `<ui5-button>` custom elements.

**Exceptions:** Overview is static HTML served by nginx (no build). DTA uses a dev proxy (`vite.config.ts` proxies `/api/*` → `http://localhost:8006`, no local CORS).

## Backend stacks

All backends are **FastAPI 0.115 + Python 3.12** on port 8001+:
- `main.py` — app, router mounts, `/health` (tests DB connectivity)
- `schemas/` — Pydantic v2, one file per domain
- `routers/` — one file per resource group
- `healthcheck.py` — Docker healthcheck (`python healthcheck.py`), hits `/health` via stdlib urllib

## Shared libs

- **`libs/persistence`** — async SQLAlchemy engine (`database.py`, reads `DATABASE_URL`; pool 5/+10, `pool_pre_ping`), ORM `models/` (one file per entity), Alembic `migrations/versions/` (all tables, all components).
- **`libs/clickhouse`** — connection factory (`database.py`, reads `CLICKHOUSE_*`, fail-fast), `tables.py` (single source for table/column names), versioned SQL `migrations/` (applied in filename order, tracked in `otel.schema_migrations`).
- **`libs/logging`** — `logger.py` JSON formatter (UTC timestamp, level, logger, correlation ID, `extra={}` fields). `correlation_id_var` is a `contextvars.ContextVar` set once per request in `logging_middleware`; it propagates through all `await`s automatically. Middleware logs INFO for 2xx, WARNING for 4xx, ERROR for 5xx. Usage: `from ai_trust_logging import get_logger, correlation_id_var`.

### ClickHouse cold storage (tiered MergeTree → MinIO)
`gen_ai_spans` and `alert_events` use two tiers: **hot** (local `clickhouse_data` disk, default) and **cold** (MinIO S3, triggered by age > 7 days or hot disk > 90% full).
- MinIO is an S3-compatible container (no hyperscaler dep); swap to AWS S3 via three env vars, no code/schema change.
- Cold data stays queryable via SQL (slower); never detached/exported. No delete TTL — kept forever (audit trail), full fidelity (`input_messages`/`output_messages` retained).
- Dashboard queries stay hot naturally (24h max window); alert worker queries are explicitly bounded to recent data to avoid cold scans.
- Storage policy in `otel-pipeline/clickhouse-config/config.d/storage.xml` (mounted read-only). `minio-init` creates the `clickhouse` bucket on first startup; ClickHouse `depends_on: minio-init`.

## Shell (`shell/`)

Static HTML + `luigi-config.js` served by nginx (Luigi core from CDN). Nav nodes in `luigi-config.js` define mounted MFEs. The shell nginx also **reverse-proxies** all MFE (`/registry/`, …) and backend (`/api/registry/`, …) traffic.

- If a container restarts and nginx returns 502, run `docker compose restart shell` to clear the stale DNS cache.
- **Sidebar** — `responsiveNavigation: "Fiori3"`, custom animated hamburger injected via `luigiAfterInit`, `sideNavigation.collapsed: true`. Alerts is `hideFromNav: true` (reached via bell badge). `defaultChildNode: "overview"`. "Sign out" button injected into the shell bar, links to `/oauth2/sign_out`.

## Components

Each component has `frontend/` (nginx, internal) and `backend/` (FastAPI, internal). All traffic routes through `:8080` via the shell proxy.

### Dual deployment paths (docker-compose and k8s) — keep in sync
Both paths are fully supported; **develop and change them together**. When you touch how a service runs:
- New service in `docker-compose.yml` → add matching Deployment+Service (or Job) to the Helm chart + its image to `k8s/scripts/build-and-load-images.sh`.
- New/changed env var or secret → add to `.env.example`; it flows to k8s via `k8s/scripts/bootstrap.sh`'s Secret (sourced from the same `.env`, no separate k8s env file).
- New `depends_on: condition:` → add the matching `waitForTcp`/`waitForHttp`/`waitForJob` initContainer (helpers in `_helpers.tpl`).
- Renamed/moved a mounted file (e.g. `infra/*/init.sh`, `otel-pipeline/**/config`) → update both `docker-compose.yml` `volumes:` **and** `bootstrap.sh` `--from-file`. Nothing enforces this in CI — a rename on one side silently breaks the other.

### Adding a new component
1. Create `new-component/frontend/` and `new-component/backend/`.
2. Add `libs/persistence/ai_trust_persistence/models/your_model.py` and import it in `models/__init__.py`.
3. Add a migration to `libs/persistence/migrations/versions/` and `alembic upgrade head`.
4. Copy `ai-system-registry/backend/Dockerfile` (build context = repo root).
5. Add needed libs to `requirements.txt`: `-e /app/libs/persistence`, `-e /app/libs/clickhouse`, `-e /app/libs/logging`.
6. Add `healthcheck.py` (copy from ai-system-registry, update port).
7. Add the service to `docker-compose.yml` with `depends_on: db-migrate: condition: service_completed_successfully` and a `healthcheck`. Do **not** add `ports:`.
8. Add proxy routes to `shell/nginx.conf` (`/new-component/`, `/api/new-component/`).
9. Add `base: "/new-component/"` to the frontend `vite.config.ts`.
10. Add a nav node to `shell/luigi-config.js`.
11. Add the Deployment+Service to the Helm chart — if it fits the generic backend+frontend pattern, add an entry to `components` in `k8s/helm/ai-trust-platform/values.yaml`; else a new template file. Add the image(s) to `build-and-load-images.sh`.

### ai-system-registry/ (port 8001, `/api/registry/`)
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

**AI-assisted registration** — conversational alternative to the manual form. An LLM extracts descriptive fields and infers classifier flags; the **same deterministic `classifier.py`** produces the tier (the LLM never decides the tier). Stateless: the frontend holds the transcript + field state and resends each turn; nothing persists until `POST /v1/intake`. See [docs/ai-assisted-registration.md](docs/ai-assisted-registration.md).
- `POST /api/v1/intake/assist/turn` — one owner-flow turn. Body `{transcript[], fields{}}`; returns `{message, extracted_fields, next_field, complete, degraded, inferred_flags?, classification?}`. On `complete`, runs flag inference + `classify()`. Turn cap (`ASSIST_TURN_CAP`) → `degraded=true`.
- `POST /api/v1/intake/assist/extract` — multipart upload (TXT/MD/PDF/DOCX/PPTX/images), parsed via `documents.py` (max `ASSIST_MAX_TEXT_LENGTH`); images use `LLM_VISION_MODEL`. Returns `{extracted_fields, notes}`.
- `POST /api/v1/intake/assist/engineer/{system_id}/turn` and `/extract` — engineer flow, same shapes, prompts focused on technical fields.
- `POST /api/v1/intake` accepts AI-collected fields, flags, and `classification_rationale` (JSONB `{flag, value, rationale, confidence}`); runs `classify()` when flags present. Manual owner mode sends no flags → stays a `pending` stub for the engineer.
- **LLM layer** (`app/llm/`) — dispatch via `LLM_PROVIDER`: `stub` (default; deterministic, offline, dev/CI), `ollama` (OpenAI-compatible), `external` (OAuth2 + Anthropic-format `/invoke`, fails fast on missing creds). Malformed JSON → one auto-repair retry → `LLMParseError` → route returns 502, UI falls back to the manual form.
- All four assist routes gated `require_permission(SYSTEMS_WRITE)`.

### overview/ (port 8004, `/api/overview/`)
Compliance-posture MFE, reads Postgres only, static HTML frontend.
- `GET /api/overview/v1/stats?lifecycle=` — KPI counts, tier distribution, compliance data, recent registrations. Dashboard layout persists to `localStorage` (`ai_trust_overview_dashboard_v1`).

### monitoring/ (port 8003, `/api/monitoring/`)
Live signals from ClickHouse + registry analytics from Postgres.
- `GET /v1/services` — distinct services + models. `GET /v1/signals?service=&window=1h` — time-series count/latency/tokens (`window` ∈ `15m`,`1h`,`6h`,`24h`). `GET /v1/stats?lifecycle=` — Postgres analytics.
- All ClickHouse queries use `clickhouse-connect` **parameterized queries** (`{param:Type}`) — never f-string interpolation. `window`/`interval` come from a server-side allowlist.
- Live Signals polls every 30s; filters persist to `localStorage` (`ai_trust_monitoring_filters_v1`), analytics layout to `ai_trust_dashboard_v4`.

### alerts/ (port 8005, `/api/alerts/`)
Rule-based alerting. Rules in Postgres, events in ClickHouse.
- `GET /v1/active` (unresolved/unhandled) · `GET /v1/history` · `GET /v1/rules` (incl. `parameters`, `is_custom`) · `GET /v1/count` (bell badge).
- `POST /v1/events/{id}/handle` (sets `handled_at` + `resolved_at`) · `/approve-model` (marks handled + updates `service_model_baselines`; body `{service_name, new_model}`) · `/reject-model` (marks handled, baseline unchanged) · `POST /v1/rules/{id}/toggle`.

**policy-checker-worker/** — standalone background job (no HTTP port). Evaluates enabled rules every `ALERT_POLL_INTERVAL`s (10s dev, 60s+ prod) against Postgres + ClickHouse; creates events in `otel.alert_events`, auto-resolves threshold events when conditions clear. Event-type alerts suppressed 24h after handling (except `model_diverged`). Evaluators return `tuple[bool, float]` (aggregate) or `list[EvalResult]` (entity-scoped, one event per entity).

Seeded rules: `prohibited_exists`, `avg_compliance_below`, `high_risk_on_market_low_compliance`, `no_signals`, `high_latency`, `market_system_no_model_card`, `gpai_no_compliance`, `model_diverged`.

**Model divergence (`model_diverged`)** — detects a service switching models via a persistent baseline in `service_model_baselines` (Postgres), not a sliding window. First span → stores baseline, no alert. Later spans → compares `argMax(request_model, received_at)` against the baseline; if different, fires "Model changed for {service}: {old} → {new}". Baseline updates only on explicit human approve; rejecting leaves it unchanged and the alert re-fires every 24h until approved or the service reverts.

### decision-trace-analyzer/ (port 8006, `/api/dta/`)
Trace viewer for GenAI spans, reads ClickHouse only.
- `GET /api/v1/traces` — groups spans by `trace_id`, paginated. Dev: `vite.config.ts` proxies `/api/*` → `http://localhost:8006`. Prod: nginx proxies `/api/` → `decision-trace-analyzer-backend:8006`.

### compliance/ (port 8007, `/api/compliance/`)
Governance chain — assessments, obligations, controls, evidence for EU AI Act / NIST / ISO. Reads/writes Postgres; evidence files in MinIO.

Backend (`compliance/backend/app/`):
- `cascade.py` — status cascade + score recalc: approved evidence → effective control → fulfilled obligation → assessment score → `ai_systems.compliance`. Caller owns the transaction; cascade never commits.
- `obligation_templates.py` — hardcoded obligation sets per (framework, tier): EU AI Act + NIST AI RMF + ISO/IEC 42001.
- `control_templates.py` — hardcoded control templates per obligation `article_ref` (AISEC-* set), tier-filtered via `controls_for(article_ref, tier)`.
- `minio_client.py` — async wrapper over the sync `minio` SDK (blocking calls in `asyncio.to_thread`). Two clients: `_client` (in-cluster, uploads) and `_presign_client` (public, presigned download URLs).
- Routers: `frameworks.py`, `assessments.py` (CRUD + `/generate-obligations`, `/generate-controls`, `/submit`, `/approve`), `obligations.py`, `controls.py` (CRUD + `/link/{obligation_id}` POST/DELETE), `evidence.py` (multipart + CRUD + `/approve`, `/reject`, `/download-url`, `/versions`, `/upload-version`).

**Governance chain** — `POST /api/v1/assessments` is the entry point: it auto-generates obligations **and** controls in one transaction. Obligations come from `obligation_templates.py` by tier, with owner/not-applicable pre-filled from the most recent approved prior assessment for the same (system, framework). For each obligation, `controls_for(article_ref, tier)` yields controls (stable `control_ref = "{article_ref}:{slug}"`) linked via `control_obligations`; a fresh control is `not_started`, so the cascade immediately moves each obligation `applicable → in_progress`. Owner (only) is carried forward from the most recent prior control with the same `control_ref` for that system. `POST /assessments/{id}/generate-controls` re-runs for API consumers and is idempotent (skips obligations that already have a control). Controls can also be linked manually via `POST /controls/{id}/link/{obligation_id}`. Approving evidence cascades automatically.

**Delete** — `DELETE /api/v1/assessments/{id}` cascades obligations (FK `ondelete=CASCADE`) and removes auto-generated controls (`control_ref` not null) linked **only** to that assessment's obligations. Manual controls (`control_ref` null) and shared controls are kept. Response includes `controls_deleted`.

**Evidence** — `POST /api/v1/evidence` accepts `control_ids` and `obligation_ids` as repeated form fields (multi-value, one M2M row each); at least one of `control_ids`/`obligation_ids`/`ai_system_id`/`assessment_id` required. Versioned: `/upload-version` snapshots current file metadata to `evidence_versions` before replacing (old MinIO file deleted, snapshot retained); `/versions` returns history oldest-first; `version_label` tracks the current label. Stored in MinIO bucket `evidence-files`, key `evidence/{evidence_id}/{filename}`.

**Evidence expiry** (policy-checker-worker, seeded in migration `0004`): `evidence_expired` (marks approved evidence past `validity_until` as `expired`, cascades, fires), `evidence_expiring_30d` (8–30 days), `evidence_expiring_7d` (1–7 days; replaces and auto-resolves the 30-day alert when evidence enters the 7-day window).

## otel-pipeline/

Receives OTLP from any app, routes through RabbitMQ, stores in ClickHouse.
- **`collector/otel-collector-config.yaml`** — receives OTLP gRPC/HTTP, exports to rmq-bridge as OTLP/HTTP JSON. `encoding: json` and `compression: none` are required (the collector defaults to protobuf binary, which the bridge can't parse).
- **`rmq-bridge/`** — FastAPI; `POST /v1/traces` publishes raw OTLP JSON to the RabbitMQ fanout exchange `otel.traces` (no parsing/filtering — that's the consumer's job). Reads `RABBITMQ_URL` (fail-fast).
- **ClickHouse schema** — managed by `clickhouse-migrate` (migrations in `libs/clickhouse/migrations/`, tracked in `otel.schema_migrations`).

**Connecting an external app** — point it at the host collector: `OTEL_EXPORTER_OTLP_ENDPOINT=http://<host-ip>:4317` (gRPC) or `:4318` (HTTP). To capture prompt/response content (off by default for privacy), set `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` **on the instrumented app**. When false, `input_messages`/`output_messages` are empty strings.

## consumers/

One sub-directory per RabbitMQ consumer — standalone Python worker (no FastAPI, `asyncio.run(main())`, no HTTP port). Each binds a named durable queue to the `otel.traces` fanout exchange, so messages queue while a consumer is down. To add one, use the `/add-consumer` skill.

**`clickhouse-consumer/`** — parses OTLP JSON, skips spans without `gen_ai.operation.name`, batch-inserts into `otel.gen_ai_spans`. Hybrid batching: flush at `BATCH_SIZE` rows (default 100) or `BATCH_TIMEOUT` seconds (default 5). On ClickHouse failure retries 3× (1s/2s/4s backoff) then acks and drops the batch. Flushes on shutdown. Reads `RABBITMQ_URL`, `CLICKHOUSE_*` (fail-fast).

## Conventions & config

### docker-compose.yml
- Credentials via YAML anchors (`x-db-env`, `x-rmq-env`, `x-ch-env`, `x-minio-env`) merged into each service — never copy-paste connection strings.
- Backend build context is always the repo root (so the Dockerfile can `COPY libs/...`).
- New backends: `depends_on: db-migrate: condition: service_completed_successfully`, a `healthcheck.py` + `healthcheck: CMD python healthcheck.py`, no `ports:`. Shell depends on backends via `condition: service_healthy`.
- YAML forbids two `<<:` merge keys in one mapping — expand env vars inline when a service needs multiple anchors (see `otel-clickhouse-consumer`).

### Dependency pinning
Each service pins versions directly in its own `requirements.txt` (e.g. `fastapi==0.115.6`). To change: edit the version, then `docker compose up --build -d <service>`.

### Environment variables
All credentials load from `.env` (gitignored; copy from `.env.example`, never commit). All services use `os.environ["KEY"]` (fail-fast) — no hardcoded credential defaults in code. See `.env.example` for the full list and defaults; notable groups:
- **Infra creds** — `POSTGRES_*`, `RABBITMQ_*`, `CLICKHOUSE_*`, `MINIO_ROOT_*`, `DATABASE_URL`.
- **`ALLOWED_ORIGINS`** (all backends) — comma-separated CORS origins; the app refuses to start if unset.
- **`VITE_*`** (frontend build-time) — API base URLs and cross-MFE deep-link URLs baked into bundles.
- **Auth** — `KEYCLOAK_*`, `USERS_BACKEND_CLIENT_SECRET`, `APP_PUBLIC_URL`, `APP_ADMIN_*`, `OAUTH2_PROXY_COOKIE_SECRET` (exactly 16/24/32 chars).
- **compliance MinIO** — `MINIO_ENDPOINT` (in-cluster, uploads), `MINIO_PUBLIC_ENDPOINT` (presigned URLs), `MINIO_SECURE`, `MINIO_REGION`.
- **alerts** — `ALERT_POLL_INTERVAL` (10 dev, 60+ prod).
- **registry SMTP** — `SMTP_HOST/PORT/USER/PASSWORD/FROM/FROM_NAME/SSL/STARTTLS`, `USERS_BACKEND_URL`.
- **registry LLM** — `LLM_PROVIDER` (`stub`/`ollama`/`external`), `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_VISION_MODEL`; external provider `AI_CLIENT_ID/SECRET`, `AI_AUTH_URL`, `AI_API_URL`, `AI_RESOURCE_GROUP`, `AI_DEPLOYMENT_ID`, `AI_API_VERSION`; `ASSIST_TURN_CAP` (12), `ASSIST_MAX_TEXT_LENGTH` (15000).
