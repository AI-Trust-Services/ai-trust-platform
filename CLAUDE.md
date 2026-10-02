# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

> **Nested docs** — component- and service-specific detail lives in a `CLAUDE.md` next to that code (e.g. [compliance/CLAUDE.md](compliance/CLAUDE.md), [ai-system-registry/CLAUDE.md](ai-system-registry/CLAUDE.md)). Claude Code loads those automatically when you work on files in that directory. This root file keeps only cross-cutting guidance. When you add/change a component feature, update **that component's** `CLAUDE.md`; update this root file only for cross-cutting concerns (commands, conventions, auth, deployment, env vars).

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

**Stateful workloads** (`postgres`, `clickhouse`, `minio`, `ollama`) are `kind: StatefulSet` with `volumeClaimTemplates` (not standalone PVCs). This gives each pod a stable PVC identity (`data-postgres-0` etc.) and lets the CSI driver safely detach/reattach the volume when a pod reschedules to a different node — preventing the RWO deadlock that occurs with plain Deployments on multi-node clusters. `updateStrategy: RollingUpdate` with `maxUnavailable: 1` ensures the old pod fully terminates (releasing the volume) before the new pod starts.

**OpenFGA store ID** is distributed as a Kubernetes `Secret` (`openfga-store-id`) rather than a PVC. The `openfga-provision` Job writes the store ID to the Secret; all backends mount it read-only at `/config/store_id` via a `secret` volume. This avoids the RWO multi-node attach conflict that a shared PVC would cause when backends land on different nodes.

### Deploy to Gardener (OCM + Flux + GitHub Actions)
The platform is packaged as an OCM component and deployed to Gardener shoot clusters via Flux HelmRelease. Deployments are **namespace-scoped** — a cluster can host several concurrent namespaces: `ai-trust` (the platform's existing, long-running namespace, default on `ai-trust-main`) plus per-developer/PR namespaces derived from the GitHub username (used on `ai-trust-test`). See [k8s/README.md](k8s/README.md) for the full guide.
```bash
# Trigger a build + deploy to a specific cluster/namespace from any branch:
gh workflow run build-push-deploy.yml \
  --ref <branch> \
  --field gardener_cluster=ai-trust-test \
  --field namespace=<namespace>

# Check deploy status on the cluster (namespace defaults to "ai-trust" on ai-trust-main):
kubectl get componentversion,resource,fluxdeployer -n ocm-system
kubectl get helmrelease ai-trust-<namespace> -n ocm-system -o wide
kubectl get pods -n <namespace>
```
- OCM component descriptor: `.ocm/component-constructor.yaml`
- OCM CRs (ComponentVersion, Resource, FluxDeployer), all named per `${NAMESPACE}`: `k8s/ocm/manifests.yaml`
- Per-cluster env: `k8s/env/<cluster>/.env` (`K8S_NAMESPACE` sets that cluster's default namespace)
- One-time cluster/namespace setup: `k8s/gardener_init/shoot-cluster-init.sh <cluster> [--namespace=<namespace>]` (installs OCM controller, Flux, Traefik, per-namespace DNS + TLS cert, RBAC — default namespace `ai-trust`; pass `--namespace=<name>` to additionally provision a developer/PR namespace on a shared cluster)
- **PR deployment test** — adding the `garden-deploy` label to a PR (`.github/workflows/pr-deployment-test.yml`) deploys the PR branch to a namespace derived from the PR author on `ai-trust-test`. It runs the whole build→package→publish→deploy pipeline as one job (`namespace-deployment-test`) via composite actions + `docker-bake.hcl` (not a `workflow_call` to `build-push-deploy.yml`); the job's pass/fail is the PR check. That namespace must be initialized once via `shoot-cluster-init.sh ai-trust-test --namespace=<github-username>`.

### Run tests (any backend)
```bash
cd <component>/backend   # e.g. cd compliance/backend
make setup               # first time only — creates .venv, installs deps
make test-unit           # no Docker needed
make test-e2e            # requires Postgres: docker compose up -d postgres
make test                # all tests
```
- `tests/unit/` — pure unit tests, no DB
- `tests/e2e/` — full stack via ASGITransport, requires Postgres only (no running server); auto-creates `ai_trust_test` DB and runs migrations on first run

Workers (`audit-flush-worker`, `policy-checker-worker`, `consumers/clickhouse-consumer`) follow the same pattern but live without a `backend/` subdirectory — `cd <worker-dir>` instead of `cd <component>/backend`.

### Pre-push checks
Run these from the repo root before pushing to avoid CI failures:
```bash
# Python lint + format (ruff is not on PATH — invoke via python3 -m)
python3 -m ruff check .
python3 -m ruff format --check .

# TypeScript typecheck (run for each frontend you touched)
cd <component>/frontend && npm ci && npm run typecheck
```
All three checks run as PR gates (`.github/workflows/pr-lint.yml`, `pr-typecheck.yml`, `pr-unit-tests.yml`). A clean local run guarantees no surprises in CI.

### Migrations
```bash
cd libs/persistence
alembic upgrade head
alembic revision --autogenerate -m "description"
alembic downgrade -1
```

**After merging main into a feature branch:** if revision IDs collide, renumber all feature migrations to follow the new main head (rename file + update `revision`/`down_revision`). Then check whether any feature migration touches the same table/column as the new main migrations — warn if so, don't auto-fix.

### VS Code debugging (any backend)
Stop the Docker backend (`docker compose stop <service>`), `cd <component>/backend`, `make setup`, then press F5 — `launch.json` is pre-configured in each backend.

---

## Project conventions

Codebase-specific decisions. Follow them even where an external pattern is more common.

- **DB sessions** — use `async with SessionLocal() as session` directly in each router (not `Depends()`). Helper functions (e.g. `cascade.py`) never `commit()` — only `flush()` if they need a row ID. The router owns the transaction and is always the one to `commit()`, keeping each request atomic.
- **Logging** — event names follow `resource.action` (e.g. `assessment.created`, `evidence.status_changed`). Contextual fields go in `extra={}`, never interpolated into the message: `logger.info("assessment.created", extra={"assessment_id": row.id})`.
- **ID generation** — all domain IDs use `new_id("PREFIX")` from `compliance/backend/app/ids.py` (e.g. `new_id("ASS")` → `ASS-XXXXXXXX`). Never `uuid4()` directly. Prefixes: `ASS`, `OBL`, `REQ`, `EVD`. Add new prefixes to `ids.py`.
- **E2E helpers** — `conftest.py` exposes module-level async functions (`create_system`, `create_assessment`, etc.). Import and call them directly; don't inline HTTP calls or wrap them in fixtures. `create_system()` in compliance tests writes directly to the DB (no HTTP intake endpoint in compliance).
- **M2M linking** — `evidence_requirements` is the only M2M join table; it uses raw `pg_insert(...).on_conflict_do_nothing()`, not ORM `relationship(secondary=)`. Don't add ORM relationships to M2M tables. Requirements link to obligations via a direct `obligation_id` FK (1:N), not a join table.
- **Frontend API client** — every React frontend has `src/api/client.ts` with a typed `request<T>()` wrapper, `json()`/`qs()` helpers, and an `api` object with one method per endpoint. All calls go through `request<T>()` — never raw `fetch()` in components. `formatDetail` normalises FastAPI validation errors. Reference: `compliance/frontend/src/api/client.ts`.
- **Pydantic schemas** — response schemas set `model_config = {"from_attributes": True}`. Convert rows with `Schema.model_validate(row)` — never `.from_orm()` (Pydantic v1, removed in v2).
- **Test deps** — `requirements-test.txt` lists PyPI deps only; never `-r requirements.txt`. Editable libs (`-e ../libs/…`) are installed by `make setup`, not from this file. The service `requirements.txt` uses Docker-path `-e /app/libs/…` which is invalid outside containers and would break CI.
- **Lint** — `pyproject.toml` at repo root configures ruff. `ruff` is not on PATH — invoke as `python3 -m ruff check .` and `python3 -m ruff format --check .`; both run as PR gates. Rules F401/F811/E402/E701/E712 are suppressed for pre-existing violations — don't add new suppressions for new code.
- **TypeScript typecheck** — all 8 frontends run `npm run typecheck` (`tsc --noEmit`) as a PR gate (`.github/workflows/pr-typecheck.yml`). Run `cd <component>/frontend && npm ci && npm run typecheck` locally before pushing frontend changes. Do not leave unused imports or type errors — the check fails the PR.
- **CLAUDE.md** — update it as part of any PR that adds or changes a feature, service, endpoint, env var, migration, or architectural pattern. It is the primary reference for AI assistants working in this repo — stale docs cause wrong suggestions and wasted effort. Component-specific detail goes in that component's own `CLAUDE.md` (see "Nested docs" at the top); keep this root file for cross-cutting concerns.

---

## Service URLs

All traffic enters through port 8080 (oauth2-proxy). Frontend and backend ports are not exposed — only reachable via the shell nginx reverse proxy.

| Service | URL |
|---|---|
| Luigi shell / entry point | http://localhost:8080 |
| Keycloak (browser login) | http://localhost:8180 |
| Frontends | `/registry/`, `/overview/`, `/monitoring/`, `/alerts/`, `/dta/`, `/compliance/`, `/iam/`, `/audit/`, `/admin/` under `:8080` |
| Backend APIs | `/api/{registry,overview,monitoring,alerts,dta,compliance,audit,admin}/v1` under `:8080` (health at `/api/*/health`, docs at `/api/registry/docs`) |
| IAM / roles API | `/api/users/v1/iam` · current-user permissions `/api/users/v1/me/permissions` |
| PostgreSQL | localhost:5432 / db `ai_trust` |
| OTel Collector | gRPC localhost:4317 · HTTP localhost:4318 |
| OTel RMQ Bridge | http://localhost:8002 (health `/health`) |
| RabbitMQ management | http://localhost:15672 (creds from `.env`) |
| ClickHouse HTTP | http://localhost:8123 / db `otel` |
| MinIO | API http://localhost:9000 · console http://localhost:9001 (creds from `.env`) |

## Authentication and Authorization

**Hard separation:** **Keycloak** = authentication only (who you are). **OpenFGA** = authorization only (what you can do). The two are independent — never use Keycloak realm roles to gate application features. See [docs/auth-flow.md](docs/auth-flow.md).

### Tenancy mode (single vs multi-tenant)

The platform is a **single codebase** that runs in one of two tenancy modes, selected by the
`TENANCY_MODE` env var (default `single`). The whole tenancy layer (`libs/tenancy`) is a no-op in
`single` mode, so there is nothing to strip out for a single-org deployment.

- **`single`** (default) — one organization. The tenant middleware is not registered, Postgres uses
  the plain `public` schema, one fixed Keycloak realm, no per-tenant scoping of ClickHouse/MinIO. This
  is the mode for docker-compose, the local kind install (`k8s/`), and any standalone single-org deploy.
- **`jwt`** — multi-tenant. Each request's tenant is resolved from a `tenant_id` OIDC claim
  (`TENANT_CLAIM`), verified against `TENANCY_JWKS_ISSUER_BASE`. Data is isolated per tenant:
  schema-per-tenant Postgres (`tenant_<org>`) + a per-tenant role, a per-tenant Keycloak realm, and
  per-tenant ClickHouse DB / MinIO bucket. This mode is normally provisioned by the MSP operator
  bundle, which stamps the per-tenant realm and wiring — selecting `jwt` alone is not enough.

The kind installer (`cd k8s && make up`) **prompts** for the mode and writes `TENANCY_MODE` into
`.env`. Set it non-interactively with `TENANCY_MODE=<single|jwt> make up`.


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
- **UI components** — Radix UI primitives + Tailwind CSS 4 (shadcn pattern). Named imports from `@/components/ui/`. Never raw HTML elements where a component exists.

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
- **`libs/react-hooks`** — shared React hooks for all MFEs. Provides `useBranding()` (applies branding colors from localStorage) and `useTheme()` (applies dark/light mode). All MFE frontends import via `@ai-trust/react-hooks` path alias (configured in each MFE's `tsconfig.json` + `vite.config.ts`). Frontend Dockerfiles use repo-root context (`context: .`) to access the shared lib.

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

Each component has `frontend/` (nginx, internal) and `backend/` (FastAPI, internal). All traffic routes through `:8080` via the shell proxy. **Per-component detail lives in each component's own `CLAUDE.md`** (linked below) and loads on demand when you work in that directory.

### Dual deployment paths (docker-compose, k8s kind, and Gardener/OCM) — keep in sync
Three paths are fully supported; **develop and change them together**. When you touch how a service runs:
- New service in `docker-compose.yml` → add matching Deployment+Service (or Job) to the Helm chart + its image to `k8s/scripts/build-and-load-images.sh` + add it as a resource in `.ocm/component-constructor.yaml`.
- **New image built in CI** → add it in **all three** CI build definitions or the Gardener deploy will be missing it: the **Deployment Workflow** `build-push` matrix (`.github/workflows/build-push-deploy.yml`, used by push-to-main and `workflow_dispatch`), a matching `target` + the `group "default"` list in `docker-bake.hcl` (used by the **PR Deployment Test** `/garden-deploy` path via `.github/actions/build-images`), and as an `ociImage` resource in `.ocm/component-constructor.yaml`. Nothing enforces parity — an image added to only one silently ships broken on the other trigger. Frontends must also carry their `VITE_*` build args in both the matrix `build_args` and the bake `target`'s `args`.
- New/changed env var or secret → add to `.env.example`; it flows to k8s via `k8s/scripts/bootstrap.sh`'s Secret (sourced from the same `.env`, no separate k8s env file).
- New `depends_on: condition:` → add the matching `waitForTcp`/`waitForHttp`/`waitForJob` initContainer (helpers in `_helpers.tpl`).
- New one-shot Job → use the `ai-trust.jobName` helper for `metadata.name` (appends `-r<.Release.Revision>`) so each `helm upgrade` creates a new Job name instead of patching an immutable one. Do **not** add `helm.sh/hook` annotations — plain resources with per-revision names are the established pattern here (see `jobs.yaml`).
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
11. Add the Deployment+Service to the Helm chart — if it fits the generic backend+frontend pattern, add an entry to `components` in `k8s/helm/ai-trust-platform/values.yaml`; else a new template file. Add the image(s) to `build-and-load-images.sh` (kind), the `build-push` matrix in `.github/workflows/build-push-deploy.yml` **and** a `target` + `group "default"` entry in `docker-bake.hcl` (both CI build paths — see "keep in sync" above), **and** as `ociImage` resources in `.ocm/component-constructor.yaml`.
12. Add a `new-component/CLAUDE.md` documenting its routes, data model, and any conventions (see the existing component `CLAUDE.md` files for the pattern).

### ai-system-registry/ (port 8001, `/api/registry/`)
AI system registration and EU AI Act classification. LLM prompt wording is externalized to repo-root `context/prompts/*.md` (loaded by `ai-system-registry/backend/app/llm/templates.py`, baked into the image via that backend's Dockerfile). Details → [ai-system-registry/CLAUDE.md](ai-system-registry/CLAUDE.md).

### overview/ (port 8004, `/api/overview/`)
Compliance-posture MFE, reads Postgres only, static HTML frontend. Details → [overview/CLAUDE.md](overview/CLAUDE.md).

### monitoring/ (port 8003, `/api/monitoring/`)
Live signals from ClickHouse + registry analytics from Postgres. Details → [monitoring/CLAUDE.md](monitoring/CLAUDE.md).

### alerts/ (port 8005, `/api/alerts/`)
Rule-based alerting. Rules in Postgres, events in ClickHouse. Includes the `policy-checker-worker`. Details → [alerts/CLAUDE.md](alerts/CLAUDE.md).

### decision-trace-analyzer/ (port 8006, `/api/dta/`)
Trace viewer for GenAI spans, reads ClickHouse only. Details → [decision-trace-analyzer/CLAUDE.md](decision-trace-analyzer/CLAUDE.md).

### compliance/ (port 8007, `/api/compliance/`)
Governance chain — assessments, obligations, requirements, evidence for EU AI Act / NIST / ISO. Details → [compliance/CLAUDE.md](compliance/CLAUDE.md).

### audit/ (port 8008, `/api/audit/`)
Immutable audit trail across all platform actions (Postgres buffer → ClickHouse archive). Includes the `audit-flush-worker`. Details → [audit/CLAUDE.md](audit/CLAUDE.md).

### admin/ (port 8010, `/api/admin/`)
Platform administration — SMTP mail config, general platform settings, branding/white-labeling, summary dashboard. Details → [admin/CLAUDE.md](admin/CLAUDE.md).

## Environment variables

All credentials load from `.env` (gitignored; copy from `.env.example`, never commit). All services use `os.environ["KEY"]` (fail-fast) — no hardcoded credential defaults in code. **Exception:** SMTP settings are optional — when `SMTP_HOST` is unset, the registry backend skips email and starts normally.

See `.env.example` for the full list, defaults, and per-service mapping. Notable groups:
- **Infra creds** — `POSTGRES_*`, `RABBITMQ_*`, `CLICKHOUSE_*`, `MINIO_ROOT_*`, `DATABASE_URL`.
- **Tenancy** — `TENANCY_MODE` (`single` default / `jwt`), `TENANCY_JWKS_ISSUER_BASE` (required if `jwt`), `TENANT_CLAIM` (`tenant_id`).
- **`ALLOWED_ORIGINS`** (all backends) — comma-separated CORS origins; the app refuses to start if unset.
- **`VITE_*`** (frontend build-time) — API base URLs and cross-MFE deep-link URLs baked into bundles.
- **Auth** — `KEYCLOAK_*`, `USERS_BACKEND_CLIENT_SECRET`, `APP_PUBLIC_URL`, `APP_ADMIN_*`, `OAUTH2_PROXY_COOKIE_SECRET` (exactly 16/24/32 chars).
- **compliance MinIO** — `MINIO_ENDPOINT` (in-cluster, uploads), `MINIO_PUBLIC_ENDPOINT` (presigned URLs), `MINIO_SECURE`, `MINIO_REGION`.
- **alerts** — `ALERT_POLL_INTERVAL` (10 dev, 60+ prod).
- **admin SMTP** — `SMTP_HOST/PORT/USER/PASSWORD/FROM/FROM_NAME/SSL/STARTTLS` seed the `platform_settings` row on first startup of the admin backend. After that, the DB value wins — changes via the Admin UI persist across redeploys. The registry backend also reads these same vars directly from the environment for its fire-and-forget notifications (it does not read from `platform_settings`).
- **registry LLM** — `LLM_PROVIDER` (`stub`/`ollama`/`external`), `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_VISION_MODEL`; external provider `AI_CLIENT_ID/SECRET`, `AI_AUTH_URL`, `AI_API_URL`, `AI_RESOURCE_GROUP`, `AI_DEPLOYMENT_ID`, `AI_API_VERSION`; `ASSIST_TURN_CAP` (12), `ASSIST_MAX_TEXT_LENGTH` (15000).

## otel-pipeline/

Receives OTLP from any app, routes through RabbitMQ, stores in ClickHouse. Details → [otel-pipeline/CLAUDE.md](otel-pipeline/CLAUDE.md).

## consumers/

One sub-directory per RabbitMQ consumer — standalone Python worker (no FastAPI, no HTTP port). To add one, use the `/add-consumer` skill. Details → [consumers/CLAUDE.md](consumers/CLAUDE.md).
