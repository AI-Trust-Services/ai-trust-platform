# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Commands

### Run the full platform
```bash
docker compose up --build -d
docker compose down --remove-orphans
```

### Run on local Kubernetes (kind)
Alternative to docker-compose — both share the same `.env` and host ports (don't run simultaneously). See [k8s/README.md](k8s/README.md).
```bash
cd k8s
make up      # kind create cluster + bootstrap + build&load images + helm install
make down    # helm uninstall + kind delete cluster
make demo-seed # opt-in Risk Management demo data Job
```
Manifests live in `k8s/helm/ai-trust-platform/`. Every k8s Service name matches the docker-compose service name. Stateful workloads (`postgres`, `clickhouse`, `minio`, `ollama`) use `StatefulSet` with `volumeClaimTemplates` for stable PVC identity. The OpenFGA store ID is distributed as a Kubernetes `Secret` (`openfga-store-id`) written by the `openfga-provision` Job. The kind installer prompts for `TENANCY_MODE` and writes it into `.env`; set non-interactively with `TENANCY_MODE=<single|jwt> make up`.

### Deploy to Gardener (OCM + Flux + GitHub Actions)
The platform is packaged as an OCM component and deployed to Gardener shoot clusters via Flux HelmRelease. Deployments are namespace-scoped — `ai-trust` (default on `ai-trust-main`) plus per-developer/PR namespaces. See [k8s/README.md](k8s/README.md).
```bash
# Trigger build + deploy from any branch:
gh workflow run build-push-deploy.yml \
  --ref <branch> \
  --field gardener_cluster=ai-trust-test \
  --field namespace=<namespace>

# Check deploy status:
kubectl get componentversion,resource,fluxdeployer -n ocm-system
kubectl get helmrelease ai-trust-<namespace> -n ocm-system -o wide
kubectl get pods -n <namespace>
```
- OCM component descriptor: `.ocm/component-constructor.yaml`
- OCM CRs (ComponentVersion, Resource, FluxDeployer): `k8s/ocm/manifests.yaml`
- Per-cluster env: `k8s/env/<cluster>/.env`
- One-time cluster/namespace setup: `k8s/gardener_init/shoot-cluster-init.sh <cluster> [--namespace=<namespace>]`
- **PR deployment test** — adding `garden-deploy` label to a PR deploys to a namespace derived from the PR author on `ai-trust-test`. That namespace must be initialized once via `shoot-cluster-init.sh ai-trust-test --namespace=<github-username>`.

### Run tests (any backend)
```bash
cd <component>/backend   # e.g. cd compliance/backend
make setup               # first time only — creates .venv, installs deps
make test-unit           # no Docker needed
make test-e2e            # requires Postgres: docker compose up -d postgres
make test                # all tests
```
- `tests/unit/` — pure unit tests, no DB
- `tests/e2e/` — full stack via ASGITransport, requires Postgres only; auto-creates `ai_trust_test` DB and runs migrations on first run

Workers (`audit-flush-worker`, `policy-checker-worker`, `consumers/clickhouse-consumer`) follow the same pattern but live without a `backend/` subdirectory.

### Pre-push checks
```bash
python3 -m ruff check .
python3 -m ruff format --check .
cd <component>/frontend && npm ci && npm run typecheck
```
All three run as PR gates (`.github/workflows/pr-lint.yml`, `pr-typecheck.yml`, `pr-unit-tests.yml`).

### Migrations
```bash
cd libs/persistence
alembic upgrade head
alembic revision --autogenerate -m "description"
alembic downgrade -1
```
**After merging main into a feature branch:** if revision IDs collide, renumber all feature migrations to follow the new main head. Check whether any feature migration touches the same table/column as new main migrations — warn if so.

### VS Code debugging (any backend)
Stop the Docker backend (`docker compose stop <service>`), `cd <component>/backend`, `make setup`, then press F5.

---

## Project conventions

- **DB sessions** — use `async with SessionLocal() as session` directly in each router (not `Depends()`). Helper functions never `commit()` — only `flush()` if they need a row ID. The router owns the transaction.
- **Logging** — event names follow `resource.action`. Contextual fields go in `extra={}`, never interpolated: `logger.info("assessment.created", extra={"assessment_id": row.id})`.
- **ID generation** — all domain IDs use `new_id("PREFIX")` from `compliance/backend/app/ids.py`. Never `uuid4()` directly. Prefixes: `ASS`, `OBL`, `REQ`, `EVD`.
- **E2E helpers** — `conftest.py` exposes module-level async functions (`create_system`, `create_assessment`, etc.). Import and call them directly; don't inline HTTP calls. `create_system()` in compliance tests writes directly to the DB.
- **M2M linking** — `evidence_requirements` uses raw `pg_insert(...).on_conflict_do_nothing()`, not ORM `relationship(secondary=)`. Requirements link to obligations via direct `obligation_id` FK (1:N).
- **Frontend API client** — every React frontend has `src/api/client.ts` with a typed `request<T>()` wrapper. All calls go through `request<T>()` — never raw `fetch()` in components. Reference: `compliance/frontend/src/api/client.ts`.
- **Pydantic schemas** — `model_config = {"from_attributes": True}`. Convert rows with `Schema.model_validate(row)` — never `.from_orm()`.
- **Test deps** — `requirements-test.txt` lists PyPI deps only; never `-r requirements.txt`. Editable libs installed by `make setup`.
- **Lint** — `ruff` not on PATH — invoke as `python3 -m ruff check .` / `python3 -m ruff format --check .`. Rules F401/F811/E402/E701/E712 are suppressed for pre-existing violations — don't add new suppressions.
- **TypeScript typecheck** — all 8 frontends run `npm run typecheck` as a PR gate. Do not leave unused imports or type errors.
- **CLAUDE.md** — update it as part of any PR that adds or changes a feature, service, endpoint, env var, migration, or architectural pattern.

---

## Service URLs

All traffic enters through port 8080 (oauth2-proxy). Frontend and backend ports are not exposed.

| Service | URL |
|---|---|
| Luigi shell / entry point | http://localhost:8080 |
| Keycloak (browser login) | http://localhost:8180 |
| Frontends | `/registry/`, `/overview/`, `/monitoring/`, `/alerts/`, `/dta/`, `/compliance/`, `/iam/`, `/audit/`, `/admin/` under `:8080` |
| Backend APIs | `/api/{registry,overview,monitoring,alerts,dta,compliance,audit,admin}/v1` under `:8080` |
| IAM / roles API | `/api/users/v1/iam` · current-user permissions `/api/users/v1/me/permissions` |
| PostgreSQL | localhost:5432 / db `ai_trust` |
| OTel Collector | gRPC localhost:4317 · HTTP localhost:4318 |
| OTel RMQ Bridge | http://localhost:8002 |
| RabbitMQ management | http://localhost:15672 |
| ClickHouse HTTP | http://localhost:8123 / db `otel` |
| MinIO | API http://localhost:9000 · console http://localhost:9001 |

## Authentication and Authorization

**Hard separation:** **Keycloak** = authentication only. **OpenFGA** = authorization only. Never use Keycloak realm roles to gate application features. See [docs/auth-flow.md](docs/auth-flow.md) and [docs/rbac-design.md](docs/rbac-design.md).

### Tenancy mode (single vs multi-tenant)

The platform runs in one of two tenancy modes via `TENANCY_MODE` env var (default `single`). The tenancy layer (`libs/tenancy`) is a no-op in `single` mode.

- **`single`** (default) — one organization, plain `public` Postgres schema, one fixed Keycloak realm. Used for docker-compose, kind, and standalone single-org deploys.
- **`jwt`** — multi-tenant. Tenant resolved from a `tenant_id` OIDC claim, data isolated per tenant: schema-per-tenant Postgres, per-tenant Keycloak realm, per-tenant ClickHouse DB / MinIO bucket. Normally provisioned by the MSP operator bundle.

### Authentication (Keycloak + oauth2-proxy)
All traffic enters through **oauth2-proxy** at port 8080. No session → redirect to Keycloak (port 8180) → JWT stored in an encrypted session cookie → requests forwarded with `Authorization: Bearer <JWT>`. The browser only ever sees the cookie.

- **Keycloak 25** — realm `ai-trust`, port 8180. Owns accounts, credentials, sessions only.
- **keycloak-provision** — idempotent one-shot; creates realm, OIDC client, bootstrap admin via Admin API.
- **oauth2-proxy v7.6.0** — forwards `X-Forwarded-Preferred-Username` (used by backends) and `X-Forwarded-User` (OIDC `sub` UUID, fallback).
- **Sign out** — shell bar → `/oauth2/sign_out`, clears session and calls Keycloak logout server-side.
- Bootstrap admin created from `APP_ADMIN_USERNAME` / `APP_ADMIN_PASSWORD`.

### Authorization — RBAC via OpenFGA
**OpenFGA is the sole source of truth for roles and permissions.** Flat RBAC: users are members of roles, roles grant permissions on a single `platform:global` object.

- **`libs/authorization`** — `require_permission("evidence:approve")` is a `Depends()` that reads `X-Forwarded-Preferred-Username`, calls OpenFGA, returns 403 on denial. **Fails closed.** Permission strings + role definitions live in `ai_trust_authorization.constants`.
- **`openfga` + `openfga-provision`** — provision creates the store, uploads the model generated from `constants.py`, seeds role→permission tuples, seeds `APP_ADMIN_USERNAME` as Platform Admin, writes store ID to `/config/store_id`. Backends also accept `OPENFGA_STORE_ID` env var (takes precedence — used for tests/prod).
- **IAM API** (`users` backend, all at `/v1`): roles, iam, permissions, custom roles, user management endpoints.
- **IAM UI** — separate `iam/` MFE at `/iam/`, shown only to users with `iam:manage`.
- **Built-in roles** — `platform_administrator`, `ai_engineer`, `ai_compliance_officer`, `business_owner`, `auditor`, `executive`. Single-role invariant enforced in `assign_role`.
- **Custom roles** — stored in Postgres (`custom_roles`, IDs prefixed `ROLE-`), permission tuples in OpenFGA.
- **Permission naming** — `resource:action` (e.g. `systems:read`). OpenFGA relation = `can_` + name with `:` → `_`. **To add a permission, edit `constants.py` only** — `openfga-provision` regenerates the model at startup.

## Architecture

See [docs/architecture.md](docs/architecture.md) for repo layout, GenAI observability data flow, and Docker startup order.

## Frontend stacks

All React frontends (registry, alerts, DTA, compliance, monitoring, users, iam) share:
- **Stack** — React 19, React Router 8, TypeScript 5.8. Use React 19 APIs (no `forwardRef`/`React.FC`).
- **Build** — Vite 6 (`npm run build → dist/`), multi-stage Dockerfile.
- **Base path** — `base` in `vite.config.ts` (e.g. `/registry/`).
- **Routing** — `HashRouter` (`useHashRouting: true`). Luigi via `@luigi-project/client`.
- **API base URL** — from `import.meta.env.VITE_*_API_BASE` at build time.
- **Health polling** — red banner with auto-retry if backend is down.
- **nginx headers** — `X-Frame-Options: ALLOWALL` and `Content-Security-Policy: frame-ancestors *` (required for Luigi iframe embedding).
- **UI components** — Radix UI primitives + Tailwind CSS 4 (shadcn pattern). Named imports from `@/components/ui/`.

**Exceptions:** Overview is static HTML. DTA dev proxy (`vite.config.ts`) proxies `/api/*` → `http://localhost:8006`.

## Backend stacks

All backends are **FastAPI 0.115 + Python 3.12**:
- `main.py` — app, router mounts, `/health`
- `schemas/` — Pydantic v2, one file per domain
- `routers/` — one file per resource group
- `healthcheck.py` — Docker healthcheck, hits `/health` via stdlib urllib

## Shared libs

- **`libs/persistence`** — async SQLAlchemy engine, ORM `models/`, Alembic migrations (all tables).
- **`libs/clickhouse`** — connection factory, `tables.py` (single source for table/column names), versioned SQL migrations.
- **`libs/logging`** — JSON formatter (UTC timestamp, level, logger, correlation ID). `correlation_id_var` is a `ContextVar` set per request; propagates through all `await`s. Usage: `from ai_trust_logging import get_logger, correlation_id_var`.

### ClickHouse cold storage (tiered MergeTree → MinIO)
`gen_ai_spans` and `alert_events` use hot (local disk, default) and cold (MinIO S3, triggered by age > 7 days or disk > 90%) tiers. Cold data stays queryable via SQL; no delete TTL. MinIO is S3-compatible — swap to AWS S3 via three env vars. Storage policy in `otel-pipeline/clickhouse-config/config.d/storage.xml`.

## Shell (`shell/`)

Static HTML + `luigi-config.js` served by nginx. Nav nodes in `luigi-config.js` define mounted MFEs. The shell nginx reverse-proxies all MFE and backend traffic.

- If a container restarts and nginx returns 502, run `docker compose restart shell`.
- `responsiveNavigation: "Fiori3"`, `sideNavigation.collapsed: true`. Alerts is `hideFromNav: true`. "Sign out" links to `/oauth2/sign_out`.

## Components

Each component has `frontend/` (nginx, internal) and `backend/` (FastAPI, internal).

### Dual deployment paths — keep in sync
Three deployment paths are fully supported (docker-compose, kind, Gardener/OCM). When you touch how a service runs:
- New service → add to `docker-compose.yml`, Helm chart (`k8s/`), `build-and-load-images.sh`, and `.ocm/component-constructor.yaml`.
- **New image built in CI** → add to **all three**: the `build-push` matrix in `.github/workflows/build-push-deploy.yml`, a `target` + `group "default"` in `docker-bake.hcl`, and as an `ociImage` resource in `.ocm/component-constructor.yaml`. Frontends must carry `VITE_*` build args in both.
- New/changed env var → add to `.env.example`; flows to k8s via `k8s/scripts/bootstrap.sh`.
- New `depends_on: condition:` → add matching `waitForTcp`/`waitForHttp`/`waitForJob` initContainer.
- New one-shot Job → use `ai-trust.jobName` helper (appends `-r<.Release.Revision>`) — no `helm.sh/hook` annotations.
- Renamed mounted file → update both `docker-compose.yml` volumes and `bootstrap.sh --from-file`.

### Adding a new component
1. Create `new-component/frontend/` and `new-component/backend/`.
2. Add ORM model to `libs/persistence/ai_trust_persistence/models/` and import in `models/__init__.py`.
3. Add Alembic migration and run `alembic upgrade head`.
4. Copy `ai-system-registry/backend/Dockerfile` (build context = repo root).
5. Add needed libs to `requirements.txt` (`-e /app/libs/persistence`, etc.).
6. Add `healthcheck.py` (copy from ai-system-registry, update port).
7. Add service to `docker-compose.yml` with `depends_on: db-migrate` and a `healthcheck`. No `ports:`.
8. Add proxy routes to `shell/nginx.conf`.
9. Set `base: "/new-component/"` in the frontend `vite.config.ts`.
10. Add a nav node to `shell/luigi-config.js`.
11. Add Deployment+Service to Helm chart; add image(s) to `build-and-load-images.sh`, `build-push` matrix, `docker-bake.hcl`, and `.ocm/component-constructor.yaml` (see "keep in sync" above).

### ai-system-registry/ (port 8001, `/api/registry/`)
AI system registration and EU AI Act classification.
- `POST /api/v1/intake` — entry point; runs classifier, assigns `SYS-XXXXXXXX`, persists to Postgres. Frontend never sends `tier`.
- `GET /api/v1/systems` — paginated list (`?limit=50&offset=0`, max 200).
- `POST /api/v1/systems/{id}/reclassify` — re-runs classifier, updates tier/basis/annex_iii_area.
- `classifier.py` — pure Python, no I/O. EU AI Act 4-tier waterfall (prohibited → gpai-systemic → gpai-standard → high → limited → minimal). Logic is hardcoded (EU AI Act is law).

**AI-assisted registration** — LLM extracts fields; the same deterministic `classifier.py` produces the tier. Stateless: frontend holds transcript + field state. See [docs/ai-assisted-registration.md](docs/ai-assisted-registration.md).
- `POST /api/v1/intake/assist/turn` — one owner-flow turn; returns `{message, extracted_fields, next_field, complete, degraded, inferred_flags?, classification?}`.
- `POST /api/v1/intake/assist/extract` — multipart upload (TXT/MD/PDF/DOCX/PPTX/images), returns `{extracted_fields, notes}`.
- `POST /api/v1/intake/assist/engineer/{system_id}/turn` and `/extract` — engineer flow, same shapes.
- **LLM layer** (`app/llm/`) — dispatch via `LLM_PROVIDER`: `stub` (default, offline), `ollama`, `external` (OAuth2 + Anthropic-format). Malformed JSON → one auto-repair retry → `LLMParseError` → 502, UI falls back to manual form.

**Registration modes** — `ai_systems.registration_mode`: `ai` (conversational), `manual_questionnaire` (structured), `full_manual` (CO enters tier directly).

**Questionnaire workflow** (`routers/workflow.py`) — 3-role governance: owner (business) → AI engineer (technical) → compliance officer (approves). `workflow_status` ∈ `draft, business_pending, technical_pending, pending_review, info_requested, approved, rejected`. Answers in `questionnaire_answers` (JSONB). Key endpoints: `/assign`, `/submit-business`, `/submit-technical`, `/submit`, `/approve`, `/reject`, `/request-info`, `/submit-info`, `/reset`, `GET /workflow`, `/rce-summary`. Sub-delegation: `/sub-assign`, `/sub-complete`, `/sub-reclaim`. Per-question assignment (`question_assignments` table): `GET /question-assignments`, `POST`/`DELETE /question-assign`, `POST /question-answer`.

**Other registry routes**:
- `PATCH /systems/{id}/questionnaire` — merge-patch questionnaire answers.
- `POST /systems/{id}/documents` — multipart upload for `full_manual` docs to MinIO (20 MB limit, extension allowlist). `GET /systems/{id}/documents/{index}/download-url` returns presigned URL.
- `obligation_lookup.py` — pure, hardcoded EU AI Act obligation titles per (tier, org_role) for the RCE summary panel.

### overview/ (port 8004, `/api/overview/`)
Compliance-posture MFE, reads Postgres only, static HTML frontend.
- `GET /api/overview/v1/stats?lifecycle=` — KPI counts, tier distribution, compliance data, recent registrations. Dashboard layout persists to `localStorage`.

### monitoring/ (port 8003, `/api/monitoring/`)
Live signals from ClickHouse + registry analytics from Postgres.
- `GET /v1/services` — distinct services + models.
- `GET /v1/signals?service=&window=1h` — time-series count/latency/tokens (`window` ∈ `15m`,`1h`,`6h`,`24h`).
- `GET /v1/stats?lifecycle=` — Postgres analytics.
All ClickHouse queries use `clickhouse-connect` parameterized queries — never f-string interpolation. Live Signals polls every 30s.

### alerts/ (port 8005, `/api/alerts/`)
Rule-based alerting. Rules in Postgres, events in ClickHouse.
- `GET /v1/active`, `GET /v1/history`, `GET /v1/rules`, `GET /v1/count` (bell badge).
- `POST /v1/events/{id}/handle`, `/approve-model`, `/reject-model` · `POST /v1/rules/{id}/toggle`.

**policy-checker-worker/** — standalone background job. Evaluates enabled rules every `ALERT_POLL_INTERVAL`s against Postgres + ClickHouse; creates events in `otel.alert_events`, auto-resolves threshold events when conditions clear.

Seeded rules: `prohibited_exists`, `avg_compliance_below`, `high_risk_on_market_low_compliance`, `no_signals`, `high_latency`, `market_system_no_model_card`, `gpai_no_compliance`, `model_diverged`.

**Model divergence (`model_diverged`)** — detects a service switching models via a persistent baseline in `service_model_baselines` (Postgres). First span → stores baseline. Later spans → compares `argMax(request_model, received_at)` against baseline; fires alert on mismatch. Baseline updates only on explicit human approve.

### decision-trace-analyzer/ (port 8006, `/api/dta/`)
Trace viewer for GenAI spans, reads ClickHouse only.
- `GET /api/v1/traces` — groups spans by `trace_id`, paginated.

### compliance/ (port 8007, `/api/compliance/`)
Governance chain — assessments, obligations, requirements, evidence for EU AI Act / NIST / ISO. Evidence files in MinIO.

Backend (`compliance/backend/app/`):
- `cascade.py` — status cascade + score recalc: approved evidence → fulfilled requirement → fulfilled obligation → assessment score → `ai_systems.compliance`. Caller owns the transaction; cascade never commits.
- `obligation_templates.py` — hardcoded obligation sets per (framework, tier, org_role). EU AI Act obligations are clusters keyed by stable `cluster_id`. `obligations_for(framework, tier, org_role="provider")`.
- `requirement_templates.py` — hardcoded per-requirement templates keyed by obligation `cluster_id`, filtered by tier and org_role. `requirement_ref` is the Requirement ID (e.g. `P-RM-01`).
- `minio_client.py` — async wrapper over sync `minio` SDK.
- Routers: `frameworks.py`, `assessments.py` (CRUD + `/generate-obligations`, `/generate-requirements`, `/submit`, `/approve`), `obligations.py`, `requirements.py` (CRUD + `/link/{obligation_id}`), `evidence.py` (multipart CRUD + `/approve`, `/reject`, `/download-url`, `/versions`, `/upload-version`).

**Governance chain** — `POST /api/v1/assessments` auto-generates obligations and requirements in one transaction. Owner/not-applicable pre-filled from most recent approved prior assessment. Requirements use stable `requirement_ref` (1:N FK to obligation). Approving evidence cascades automatically.

**Delete** — `DELETE /api/v1/assessments/{id}` cascades obligations and removes auto-generated requirements linked only to that assessment. Manual requirements kept.

**Evidence** — `POST /api/v1/evidence` accepts `requirement_ids` (multi-value). Versioned: `/upload-version` snapshots current metadata before replacing; `/versions` returns history oldest-first. Stored in MinIO `evidence-files` bucket.

#### Evidence expiry (policy-checker-worker)
Three seeded rules: `evidence_expired` (marks expired, cascades status, fires alert), `evidence_expiring_30d` (warning 8–30 days out), `evidence_expiring_7d` (warning 1–7 days, auto-resolves the 30-day alert).

### audit/ (port 8008, `/api/audit/`)
Immutable audit trail. Write-ahead buffer in Postgres, queryable archive in ClickHouse.

**Data flow** — `log_audit_event()` adds an `AuditEvent` row to the caller's session (committed atomically). `audit-flush-worker/` polls Postgres every `AUDIT_FLUSH_INTERVAL`s, batch-inserts into ClickHouse `otel.audit_events`, then deletes from Postgres. ClickHouse uses hot/cold tiered storage (< 7 days local, then MinIO).

**Instrumented actions** — `system.registered/deleted/reclassified`, `assessment.created/submitted/approved`, `evidence.uploaded/approved/rejected/deleted`.

**Backend** (`audit/backend/app/routers/events.py`):
- `GET /v1/events` — paginated list with filters: `ai_system_id`, `action`, `actor`, `resource_type`, `from`, `to`, `search`, `limit`/`offset`/`sort`.
- `GET /v1/events/{id}` — full detail including `changes` dict.
- `GET /v1/systems` — distinct AI systems present in audit log.
- `GET /v1/stats` — KPI counts with trend vs. previous equal-length window.

All endpoints require `audit:read` (assigned to `platform_administrator`, `ai_compliance_officer`, `auditor`, `ai_engineer`).

### admin/ (port 8010, `/api/admin/`)
Platform administration — SMTP, general settings, summary dashboard. All screens require `iam:manage`.

**Backend** (`admin/backend/app/`):
- `GET/PUT /v1/smtp` — SMTP configuration. PUT preserves existing password when absent from body.
- `POST /v1/smtp/test` — sends real test email using saved settings; returns `{success, message}`.
- `GET/PUT /v1/settings` — platform_name, support_email, `risk_library_editable`.
- `GET /v1/stats` — dashboard KPIs (user/role counts, mail configured flag).
- `startup.py` — `seed_settings_from_env()` inserts the row only if none exists; DB wins after that.
- **`risk_library_editable`** (bool, default `true`) — gates whether risk-management users may upload to the shared Risk Library. Exposed unauthenticated at `GET /internal/settings/risk-library-editable`; risk-management backend proxies it at `GET /v1/settings/risk-library-editable` and **fails open** (`true`) if admin-backend is unreachable.

## Environment variables

All credentials load from `.env` (gitignored; copy from `.env.example`). All services use `os.environ["KEY"]` (fail-fast). See `.env.example` for the full list.

Notable groups:
- **Infra creds** — `POSTGRES_*`, `RABBITMQ_*`, `CLICKHOUSE_*`, `MINIO_ROOT_*`, `DATABASE_URL`.
- **Tenancy** — `TENANCY_MODE` (`single`/`jwt`), `TENANCY_JWKS_ISSUER_BASE`, `TENANT_CLAIM`.
- **`ALLOWED_ORIGINS`** — comma-separated CORS origins; app refuses to start if unset.
- **`VITE_*`** — frontend build-time API base URLs baked into bundles.
- **Auth** — `KEYCLOAK_*`, `USERS_BACKEND_CLIENT_SECRET`, `APP_PUBLIC_URL`, `APP_ADMIN_*`, `OAUTH2_PROXY_COOKIE_SECRET` (exactly 16/24/32 chars).
- **compliance MinIO** — `MINIO_ENDPOINT` (in-cluster), `MINIO_PUBLIC_ENDPOINT` (presigned URLs), `MINIO_SECURE`, `MINIO_REGION`.
- **alerts** — `ALERT_POLL_INTERVAL` (10 dev, 60+ prod).
- **admin SMTP** — `SMTP_HOST/PORT/USER/PASSWORD/FROM/FROM_NAME/SSL/STARTTLS` seed `platform_settings` on first startup. After that, DB value wins. The registry backend reads these vars directly from the environment for fire-and-forget notifications.
- **admin general settings** — `RISK_LIBRARY_EDITABLE` seeds `platform_settings`. `risk-management-backend` needs `ADMIN_BACKEND_URL` (default `http://admin-backend:8010`).
- **registry LLM** — `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_VISION_MODEL`; external provider: `AI_CLIENT_ID/SECRET`, `AI_AUTH_URL`, `AI_API_URL`, `AI_RESOURCE_GROUP`, `AI_DEPLOYMENT_ID`, `AI_API_VERSION`; `ASSIST_TURN_CAP` (12), `ASSIST_MAX_TEXT_LENGTH` (15000).

## otel-pipeline/

Receives OTLP, routes through RabbitMQ, stores in ClickHouse.
- **`collector/otel-collector-config.yaml`** — receives OTLP gRPC/HTTP, exports to rmq-bridge as OTLP/HTTP JSON. `encoding: json` and `compression: none` required.
- **`rmq-bridge/`** — FastAPI; `POST /v1/traces` publishes raw OTLP JSON to RabbitMQ fanout exchange `otel.traces`.
- **ClickHouse schema** — managed by `clickhouse-migrate` (migrations in `libs/clickhouse/migrations/`).

**Connecting an external app** — `OTEL_EXPORTER_OTLP_ENDPOINT=http://<host-ip>:4317` (gRPC) or `:4318` (HTTP). To capture prompt/response content: `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` on the instrumented app.

## consumers/

One sub-directory per RabbitMQ consumer — standalone Python worker (`asyncio.run(main())`, no HTTP port). Each binds a durable queue to the `otel.traces` fanout exchange. To add one, use the `/add-consumer` skill.

**`clickhouse-consumer/`** — parses OTLP JSON, skips spans without `gen_ai.operation.name`, batch-inserts into `otel.gen_ai_spans`. Hybrid batching: flush at `BATCH_SIZE` rows (default 100) or `BATCH_TIMEOUT` seconds (default 5). On ClickHouse failure retries 3× then acks and drops. Reads `RABBITMQ_URL`, `CLICKHOUSE_*`.
