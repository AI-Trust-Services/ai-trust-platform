# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

> **Nested docs** — component- and service-specific detail lives in a `CLAUDE.md` next to that code (e.g. [compliance/CLAUDE.md](compliance/CLAUDE.md), [ai-system-registry/CLAUDE.md](ai-system-registry/CLAUDE.md)). Claude Code loads those automatically when you work on files in that directory. This root file keeps only cross-cutting guidance. When you add/change a component feature, update **that component's** `CLAUDE.md`; update this root file only for cross-cutting concerns (commands, conventions, auth, deployment, env vars).

## Commands

### Run the full platform (local Kubernetes via kind)
```bash
make prereqs     # first time only — installs kind, kubectl, helm, python@3.12, node, ruff via Homebrew
make up          # kind create cluster + bootstrap + build&load images + helm install
make down        # helm uninstall + kind delete cluster
```
Manifests live in `k8s/helm/ai-trust-platform/`.

**Day-to-day development** (cluster already running):
```bash
make build && make upgrade && make rollout   # after a code change — rebuild images, redeploy, restart all Deployments
make upgrade                                 # after a Helm/config-only change — no image rebuild or rollout needed
make lint                                    # format Python in-place + ruff lint check (mirrors CI)
```

> **Why `make rollout`?** All local images share `:local` tag + `imagePullPolicy: IfNotPresent`. `helm upgrade` only restarts pods whose template changed; `make rollout` force-restarts every Deployment so the new image is picked up.

**Stateful workloads** (`postgres`, `clickhouse`, `minio`) use `StatefulSet` + `volumeClaimTemplates` for stable PVC identity and safe RWO volume reattach on node reschedule. **OpenFGA store ID** is a Kubernetes `Secret` (`openfga-store-id`) written by the `openfga-provision` Job; backends mount it read-only at `/config/store_id`.

### Deploy to Gardener (OCM + Flux + GitHub Actions)
The platform is packaged as an OCM component and deployed to Gardener shoot clusters via Flux HelmRelease. Deployments are **namespace-scoped** — a cluster can host several concurrent namespaces: `ai-trust` (long-running, default on `ai-trust-main`) plus per-developer/PR namespaces derived from the GitHub username (used on `ai-trust-test`). See [k8s/README.md](k8s/README.md) for the full guide.
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
- Files: `.ocm/component-constructor.yaml` (descriptor), `k8s/ocm/manifests.yaml` (CRs, named per `${NAMESPACE}`), `k8s/env/<cluster>/.env` (`K8S_NAMESPACE` = cluster default namespace).
- One-time setup: `k8s/gardener_init/shoot-cluster-init.sh <cluster> [--namespace=<namespace>]` — `--namespace` additionally provisions a developer/PR namespace on a shared cluster.
- **PR deployment test** — the `garden-deploy` label deploys the PR to a namespace derived from the PR author on `ai-trust-test` (namespace must be initialized once via `shoot-cluster-init.sh ai-trust-test --namespace=<github-username>`). Details → [docs/ci-cd.md](docs/ci-cd.md).

### Run tests (any backend)
```bash
cd <component>/backend   # e.g. cd compliance/backend
make setup               # first time only — creates .venv, installs deps
make test-unit           # no Docker needed
make test-e2e            # requires Postgres: make up or docker run postgres
make test                # all tests
```
- `tests/unit/` — pure unit tests, no DB.
- `tests/e2e/` — full stack via ASGITransport; auto-creates `ai_trust_test` DB and runs Postgres migrations. Alerts, audit, and monitoring also require ClickHouse (plain `MergeTree()`, no storage policy). All other external services (MinIO, OpenFGA, etc.) are mocked.

**Every backend must have a `tests/e2e/` suite** — runs automatically as a PR gate via `.github/workflows/microservice-e2e-tests.yml`. Exceptions: `cognee-eval` uses in-memory SQLite; `decision-trace-analyzer` mocks ClickHouse. When adding a backend, copy the `conftest.py` from a service of similar type (Postgres-only → `overview`; Postgres + MinIO mocked → `compliance`; ClickHouse-only → `audit`; SQLite + stubs → `cognee-eval`).

Workers (`audit-flush-worker`, `policy-checker-worker`, `consumers/clickhouse-consumer`) follow the same pattern — `cd <worker-dir>` instead of `cd <component>/backend`.

### Integration tests (cross-service, live platform)
`tests/integration/` drives real HTTP against a **running** platform to verify cross-service contracts.

```bash
make test-e2e   # per-service e2e tests (kind cluster, forwards Postgres + ClickHouse only)
make test       # test-e2e then test-int (full local suite)
make test-int   # kind cluster, namespace ai-trust
```
- The `k8s/` make targets are **kind-only** — `NAMESPACE := ai-trust` wins over env. Remote Gardener namespaces are targeted only by CI via `k8s/scripts/forward-ports.sh`.
- Auth bypasses oauth2-proxy via `X-Forwarded-Preferred-Username`; `APP_ADMIN_USERNAME` (default `admin`) selects the admin. URLs overridable via env (`REGISTRY_URL`, …).
- **Not a PR gate** — runs after a successful deployment. Details → [tests/integration/README.md](tests/integration/README.md).

### On-demand label workflows (deployed-namespace, OIDC)
Three workflows test a **deployed** namespace through oauth2-proxy with a real Keycloak OIDC session (no kubeconfig/port-forward). None is a PR gate; each reports a commit status:
- **`e2e-system-tests`** (`e2e-system-tests.yml`) → `tests/e2e_system/` black-box OIDC E2E. Runs after a successful deployment.
- **`playwright-tests`** (`playwright-frontend-tests.yml`) → `tests/playwright/` browser smoke + registration flow. Runs after deployment; re-run on a PR via the `playwright-test` label. Details → [tests/playwright/README.md](tests/playwright/README.md).
- **`langfuse-test`** (`langfuse-benchmark.yml`) → `tests/langfuse_benchmark/` scores the 339 ground-truth scenarios and pushes a Langfuse experiment run. Label-triggered on the PR author's namespace on `ai-trust-test`. Details → [tests/langfuse_benchmark/README.md](tests/langfuse_benchmark/README.md).

Full workflow semantics (status seeding, `workflow_run` triggers, enabled backends) → [docs/tests.md](docs/tests.md#ci-test-workflows).

### Pre-push checks
Run these from the repo root before pushing to avoid CI failures:
```bash
# Python lint + format (ruff is not on PATH — invoke via python3 -m)
python3 -m ruff check .
python3 -m ruff format --check .

# TypeScript typecheck (run for each frontend you touched)
cd <component>/frontend && npm ci && npm run typecheck
```
All three checks run as PR gates (`.github/workflows/pr-lint.yml`, `pr-typecheck.yml`, `pr-unit-tests.yml`).

### Migrations
```bash
cd libs/persistence
alembic upgrade head
alembic revision --autogenerate -m "description"
alembic downgrade -1
```

**After merging main into a feature branch:** if revision IDs collide, renumber all feature migrations to follow the new main head (rename file + update `revision`/`down_revision`). Check whether any feature migration touches the same table/column as the new main migrations — warn if so, don't auto-fix.

### VS Code debugging (any backend)
Stop the kind-deployed backend (`kubectl scale deployment <name> -n ai-trust --replicas=0`), `cd <component>/backend`, `make setup`, then press F5 — `launch.json` is pre-configured in each backend.

---

## Project conventions

Codebase-specific decisions. Follow them even where an external pattern is more common.

- **DB sessions** — use `async with SessionLocal() as session` directly in each router (not `Depends()`). Helper functions (e.g. `cascade.py`) never `commit()` — only `flush()` if they need a row ID. The router owns the transaction and is always the one to `commit()`, keeping each request atomic.
- **Logging** — event names follow `resource.action` (e.g. `assessment.created`, `evidence.status_changed`). Contextual fields go in `extra={}`, never interpolated into the message: `logger.info("assessment.created", extra={"assessment_id": row.id})`.
- **ID generation** — all domain IDs use `new_id("PREFIX")` from `compliance/backend/app/ids.py` (e.g. `new_id("ASS")` → `ASS-XXXXXXXX`). Never `uuid4()` directly. Prefixes: `ASS`, `OBL`, `REQ`, `EVD`. Add new prefixes to `ids.py`.
- **E2E helpers** — `conftest.py` exposes module-level async functions (`create_system`, `create_assessment`, etc.). Import and call them directly; don't inline HTTP calls or wrap them in fixtures. `create_system()` in compliance tests writes directly to the DB (no HTTP intake endpoint in compliance).
- **M2M linking** — `evidence_requirements` is the only M2M join table; uses raw `pg_insert(...).on_conflict_do_nothing()`, not ORM `relationship(secondary=)`. Requirements link to obligations via a direct `obligation_id` FK (1:N), not a join table.
- **Frontend API client** — every React frontend has `src/api/client.ts` with a typed `request<T>()` wrapper, `json()`/`qs()` helpers, and an `api` object with one method per endpoint. All calls go through `request<T>()` — never raw `fetch()` in components. `formatDetail` normalises FastAPI validation errors. Reference: `compliance/frontend/src/api/client.ts`.
- **Pydantic schemas** — response schemas set `model_config = {"from_attributes": True}`. Convert rows with `Schema.model_validate(row)` — never `.from_orm()` (Pydantic v1, removed in v2).
- **Test deps** — `requirements-test.txt` lists PyPI deps only; never `-r requirements.txt`. Editable libs (`-e ../libs/…`) are installed by `make setup`, not from this file. The service `requirements.txt` uses Docker-path `-e /app/libs/…` which is invalid outside containers and would break CI.
- **Lint** — `pyproject.toml` at repo root configures ruff. `ruff` is not on PATH — invoke as `python3 -m ruff check .` and `python3 -m ruff format --check .`; both run as PR gates. Rules F401/F811/E402/E701/E712 are suppressed for pre-existing violations — don't add new suppressions for new code.
- **TypeScript typecheck** — all 10 frontends run `npm run typecheck` (`tsc --noEmit`) as a PR gate. Run locally before pushing. Do not leave unused imports or type errors.
- **CLAUDE.md** — update it as part of any PR that adds or changes a feature, service, endpoint, env var, migration, or architectural pattern. Component-specific detail goes in that component's own `CLAUDE.md`; keep this root file for cross-cutting concerns.

---

## Service URLs

All traffic enters through port 8080 (oauth2-proxy). Frontend and backend ports are not exposed — only reachable via the shell nginx reverse proxy.

| Service | URL |
|---|---|
| Luigi shell / entry point | http://localhost:8080 |
| Keycloak (browser login) | http://localhost:8180 |
| Frontends | `/registry/`, `/overview/`, `/monitoring/`, `/alerts/`, `/dta/`, `/compliance/`, `/iam/`, `/audit/`, `/admin/`, `/ai-test-bed/` under `:8080` |
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

The platform runs in one of two tenancy modes, selected by `TENANCY_MODE` env var (default `single`). The tenancy layer (`libs/tenancy`) is a no-op in `single` mode.

- **`single`** (default) — one organization. Tenant middleware not registered, plain `public` Postgres schema, one Keycloak realm. Mode for the local kind install and any standalone single-org deploy.
- **`jwt`** — multi-tenant. Tenant resolved from a `tenant_id` OIDC claim (`TENANT_CLAIM`), verified against `TENANCY_JWKS_ISSUER_BASE`. Schema-per-tenant Postgres, per-tenant Keycloak realm, per-tenant ClickHouse DB / MinIO bucket. Normally provisioned by the MSP operator bundle — selecting `jwt` alone is not enough.

`make up` prompts for the mode and writes `TENANCY_MODE` into `.env`. Set non-interactively: `TENANCY_MODE=<single|jwt> make up`.

### Authentication (Keycloak + oauth2-proxy)
All traffic enters through **oauth2-proxy** at port 8080. No session → redirect to Keycloak login (port 8180) → JWT stored in an encrypted session cookie → requests forwarded with `Authorization: Bearer <JWT>`. The browser only sees the cookie.

- **Keycloak 25** (`infra/keycloak/`) — realm `ai-trust`, port 8180. Owns accounts, credentials, sessions only.
- **keycloak-provision** — one-shot, idempotent; creates realm, OIDC client, bootstrap admin. Driven by `APP_PUBLIC_URL`.
- **oauth2-proxy v7.6.0** — forwards `X-Forwarded-Preferred-Username` (used by backends) and `X-Forwarded-User` (OIDC `sub`, fallback).
- **Sign out** — `/oauth2/sign_out`, clears session and calls Keycloak logout server-side.
- Bootstrap admin created from `APP_ADMIN_USERNAME` / `APP_ADMIN_PASSWORD`.

### Authorization — RBAC via OpenFGA
**OpenFGA is the sole source of truth for roles and permissions.** Flat RBAC: users are members of roles, roles grant permissions on a single `platform:global` object.

- **`libs/authorization`** — `require_permission("evidence:approve")` is a `Depends()` that reads `X-Forwarded-Preferred-Username`, calls OpenFGA, returns 403 on denial. **Fails closed.** Permission strings + role definitions live in `ai_trust_authorization.constants` (single source of truth).
- **`openfga` + `openfga-provision`** — OpenFGA has its own Postgres DB (`openfga`). Provision creates the store, uploads the model generated from `constants.py`, seeds role→permission tuples, seeds `APP_ADMIN_USERNAME` as Platform Admin, writes store ID to the `openfga-config` volume. Backends read it from `/config/store_id` (or `OPENFGA_STORE_ID` env var, which takes precedence).
- **IAM API** (`users` backend, all at `/v1`): `roles.py` (`GET /roles`) · `iam.py` (`GET /iam/roles` with full permission lists) · `permissions.py` (`GET /me/permissions`, `GET /me`) · `organization.py` (`GET /me/organization-contacts`) · `custom_roles.py` (`GET/POST/PUT/DELETE /iam/custom-roles`) · `users.py` (`GET/POST /users`, `GET /users/by-role`, `PUT/DELETE /users/{id}/roles/{role}`).
- **IAM UI** — separate `iam/` MFE at `/iam/`, shown in nav only to users with `iam:manage`.
- **Built-in roles** — `platform_administrator`, `ai_engineer`, `ai_compliance_officer`, `business_owner`, `auditor`, `executive`. Single-role invariant enforced in `assign_role`. The compliance officer holds `systems:write` (can register/edit systems, not only approve) — per-role permission lists are enumerated only in `ai_trust_authorization.constants.ROLE_PERMISSIONS`.
- **Service principals** — `svc-external-api` seeded unconditionally as `auditor`; forwarded as `X-Forwarded-Preferred-Username` by the registry's external read API.
- **Custom roles** — stored in Postgres (`custom_roles`, IDs prefixed `ROLE-`), permission tuples in OpenFGA. Deletion order: OpenFGA member tuples → permission tuples → Postgres row.
- **Permission naming** — `resource:action` (e.g. `systems:read`). OpenFGA relation = `can_` + name with `:` → `_`. **To add a permission, edit `constants.py` only** — `openfga-provision` regenerates the model at startup. Never hand-edit an FGA schema file.

## Architecture

See [docs/architecture.md](docs/architecture.md) for repo layout, GenAI observability data flow, and Docker startup order.

## Frontend stacks

All React frontends (registry, alerts, DTA, compliance, monitoring, overview, users, iam, audit, admin, ai-test-bed) share:
- **Stack** — React 19, React Router 8, TypeScript 5.8. Use React 19 APIs (no `forwardRef`/`React.FC`, `use()` where applicable).
- **Build** — Vite 6 (`npm run build → dist/`), multi-stage Dockerfile (`node:24-alpine` build → `nginx:alpine` serve).
- **Base path** — `base` in `vite.config.ts` (e.g. `/registry/`) for correct asset resolution under the shell sub-path.
- **Routing** — `HashRouter` (Luigi `useHashRouting: true`). Luigi via `@luigi-project/client`, `addInitListener` handshake in `useLuigi.js`.
- **API base URL** — from `import.meta.env.VITE_*_API_BASE` at build time (relative paths, e.g. `/api/registry/v1`).
- **Health polling** — red banner with auto-retry if backend is down.
- **nginx headers** — `X-Frame-Options: ALLOWALL` and `Content-Security-Policy: frame-ancestors *` (required for Luigi iframe embedding).
- **UI components** — Radix UI primitives + Tailwind CSS 4 (shadcn pattern). Named imports from `@/components/ui/`. Never raw HTML elements where a component exists.

**Exceptions:** DTA uses a dev proxy (`vite.config.ts` proxies `/api/*` → `http://localhost:8006`, no local CORS).

## Backend stacks

All backends are **FastAPI 0.115 + Python 3.12** on port 8001+:
- `main.py` — app, router mounts, `/health` (tests DB connectivity)
- `schemas/` — Pydantic v2, one file per domain
- `routers/` — one file per resource group
- `healthcheck.py` — Docker healthcheck (`python healthcheck.py`), hits `/health` via stdlib urllib

## Shared libs

- **`libs/persistence`** — async SQLAlchemy engine (`database.py`, reads `DATABASE_URL`; pool 5/+10, `pool_pre_ping`), ORM `models/` (one file per entity), Alembic `migrations/versions/` (all tables, all components). **`ai_trust_persistence.governance`** — shared EU AI Act governance logic used by *both* compliance and registry: `obligation_templates.py`/`requirement_templates.py`, `cascade.py` (status cascade + score recalc), `generation.py` (`generate_obligations_in_session` / `generate_requirements_in_session` — insert in caller's transaction, never commit).
- **`libs/clickhouse`** — connection factory (`database.py`, reads `CLICKHOUSE_*`, fail-fast), `tables.py` (single source for table/column names), versioned SQL `migrations/` (tracked in `otel.schema_migrations`).
- **`libs/logging`** — JSON formatter (UTC timestamp, level, logger, correlation ID, `extra={}` fields). `correlation_id_var` is a `contextvars.ContextVar` set per request in `logging_middleware`. Usage: `from ai_trust_logging import get_logger, correlation_id_var`.
- **`libs/react-hooks`** — shared React hooks: `useBranding()` and `useTheme()`. Imported via `@ai-trust/react-hooks` path alias in each MFE's `tsconfig.json` + `vite.config.ts`.

### ClickHouse cold storage (tiered MergeTree → MinIO)
`gen_ai_spans` and `alert_events` use two tiers: **hot** (local disk, default) and **cold** (MinIO S3, triggered by age > 7 days or hot disk > 90% full). Cold data stays queryable; no delete TTL. Swap to AWS S3 via three env vars, no code change. Storage policy in `otel-pipeline/clickhouse-config/config.d/storage.xml`.

## Shell (`shell/`)

Static HTML + `luigi-config.js` served by nginx (Luigi core from CDN). The shell nginx also **reverse-proxies** all MFE and backend traffic.

- If a pod restarts and nginx returns 502, run `kubectl rollout restart deployment/shell -n ai-trust` to clear stale DNS.
- **Sidebar** — `responsiveNavigation: "Fiori3"`, collapsed by default. Alerts is `hideFromNav: true`. "Sign out" links to `/oauth2/sign_out`.
- **Not-found** — any route that doesn't map to a visible nav node (non-existent, or a permission-gated node filtered out of the tree) is handled by `routing.pageNotFoundHandler`, which redirects to a hidden `not-found` node rendering the static `shell/public/not-found.html` — never Luigi's raw "Could not map exact target node" error.

## MVP scope — disabling services without removing code

**Enabled:** core governance (registry, compliance, overview, users/IAM, admin, shell + Postgres/Keycloak/OpenFGA/MinIO), RAG indexing (document-indexing, embedding-service), Audit (backend/frontend, audit-flush-worker, ClickHouse). **Disabled:** AI test-bed MFE + `testbed-seed` Job, GenAI-Observability (monitoring, alerts, decision-trace-analyzer), OTLP pipeline (otel-collector, otel-rmq-bridge, otel-clickhouse-consumer) and with them RabbitMQ. ClickHouse stays — Audit always needs it.

**Nothing is deleted** — a service is switched off by config across build, OCM, Helm, nginx and nav layers; grep `[MVP-off]` to find every toggle.

| Layer | File | How it's toggled |
|---|---|---|
| Build (CI) | `docker-bake.hcl` `group "default"` | image commented out (`target` block stays — build ad-hoc with `docker buildx bake <name>`) |
| OCM (CI) | `.ocm/component-constructor.yaml` | `ociImage` commented out — **mandatory**: must mirror bake list exactly; a listed-but-unbuilt image aborts deploy with `cannot determine digest` |
| Build (kind) | `k8s/scripts/build-and-load-images.sh` | `MVP_DISABLED` guard in `build()`; override with `--service <name>` |
| Deploy (MFE pairs) | `values.yaml` `components[].enabled` + `templates/components.yaml` | `enabled: false` skips rendering |
| Deploy (infra/workers) | `values.yaml` `rabbitmq`/`otel`/`policyChecker` `.enabled` | template wrapped in `{{- if .Values.<x>.enabled }}`. ClickHouse + audit-flush-worker render unconditionally |
| Seed Jobs | `templates/jobs.yaml` | `testbed-seed` Job gated by `{{- if $testbedEnabled }}` — toggled with the `ai-test-bed` component flag |
| Proxy | `shell/nginx.conf` | `location` blocks commented out — **mandatory**: static `proxy_pass` hostnames resolve at startup; missing upstream stops the shell |
| Nav | `shell/public/luigi-config.js` | nav node + alerts bell injection commented out |

**Re-enabling a service:** un-comment in `docker-bake.hcl`, `.ocm/component-constructor.yaml` (must stay in sync), `build-and-load-images.sh`, `shell/nginx.conf`, and `shell/public/luigi-config.js`; flip `enabled` in `values.yaml`; then `make build && make upgrade && make rollout`.

## Components

Each component has `frontend/` (nginx, internal) and `backend/` (FastAPI, internal). All traffic routes through `:8080` via the shell proxy. **Per-component detail lives in each component's own `CLAUDE.md`** (linked below) and loads on demand when you work in that directory.

### Adding a new service
When you add a new service, update all of these together — nothing enforces parity in CI:
- Add a Deployment+Service (or Job) to the Helm chart (`k8s/helm/ai-trust-platform/`).
- Add the image to `k8s/scripts/build-and-load-images.sh` (kind local builds).
- Add a `target` + include it in `group "default"` in `docker-bake.hcl`. Frontends must carry their `VITE_*` build args in the bake `target`'s `args`.
- Add the image as an `ociImage` resource in `.ocm/component-constructor.yaml` — must mirror the bake list exactly (missing entry ships broken; extra entry aborts deploy).
- New/changed env var or secret → add to `.env.example`; it flows to k8s via `k8s/scripts/bootstrap.sh`'s Secret.
- New `depends_on: condition:` → add the matching `waitForTcp`/`waitForHttp`/`waitForJob` initContainer (helpers in `_helpers.tpl`).
- New one-shot Job → use `ai-trust.jobName` helper for `metadata.name` (appends `-r<.Release.Revision>`). Do **not** add `helm.sh/hook` annotations. A Job reusing an existing image does **not** need a new bake target, `build-and-load-images.sh` entry, or OCM resource — see `testbed-seed` Job as the reference.
- Renamed/moved a mounted file → update both `docker-compose.yml` `volumes:` **and** `bootstrap.sh` `--from-file`. Nothing enforces this in CI.
- **Data-artifact images** (`cognee-eval/graph-image/`) are built only by `promote-graph.yml` — intentionally **not** in `docker-bake.hcl` `group "default"` or `build-and-load-images.sh`. See [cognee-eval/CLAUDE.md](cognee-eval/CLAUDE.md).

### Adding a new component
1. Create `new-component/frontend/` and `new-component/backend/`.
2. Add `libs/persistence/ai_trust_persistence/models/your_model.py` and import it in `models/__init__.py`.
3. Add a migration to `libs/persistence/migrations/versions/` and `alembic upgrade head`.
4. Copy `ai-system-registry/backend/Dockerfile` (build context = repo root).
5. Add needed libs to `requirements.txt`: `-e /app/libs/persistence`, `-e /app/libs/clickhouse`, `-e /app/libs/logging`.
6. Add `healthcheck.py` (copy from ai-system-registry, update port).
7. Add the service to the Helm chart with a `healthcheck` and appropriate initContainers. Do **not** expose ports outside the cluster.
8. Add proxy routes to `shell/nginx.conf` (`/new-component/`, `/api/new-component/`).
9. Add `base: "/new-component/"` to the frontend `vite.config.ts`.
10. Add a nav node to `shell/luigi-config.js`.
11. Add the Deployment+Service to the Helm chart — generic backend+frontend → entry in `components` in `values.yaml`; otherwise a new template file. Add image(s) to `build-and-load-images.sh`, `docker-bake.hcl` `group "default"`, and `.ocm/component-constructor.yaml`.
12. Add a `new-component/CLAUDE.md` documenting its routes, data model, and conventions.

### ai-system-registry/ (port 8001, `/api/registry/`)
AI system registration and EU AI Act classification. LLM prompt wording is externalized to `context/prompts/*.md` (loaded by `ai-system-registry/backend/app/llm/templates.py`). Details → [ai-system-registry/CLAUDE.md](ai-system-registry/CLAUDE.md).

**External read API** (`/v1/external/*`) — read-only, guarded by static bearer token (`EXTERNAL_API_TOKEN`; unset → 503). **Single-tenant only** — 401 in `jwt` mode. Details → [ai-system-registry/CLAUDE.md](ai-system-registry/CLAUDE.md).

**Model Cards** (`routers/model_cards.py`, IDs `MDL-`) — standalone model documentation, N:M-linked to AI systems. Full route list → [docs/model-cards-api.md](docs/model-cards-api.md).

### overview/ (port 8004, `/api/overview/`)
Compliance-posture MFE, reads Postgres only. Details → [overview/CLAUDE.md](overview/CLAUDE.md).

### monitoring/ (port 8003, `/api/monitoring/`)
Live signals from ClickHouse + registry analytics from Postgres. Details → [monitoring/CLAUDE.md](monitoring/CLAUDE.md).

### alerts/ (port 8005, `/api/alerts/`)
Rule-based alerting. Rules in Postgres, events in ClickHouse. Includes the `policy-checker-worker`. Details → [alerts/CLAUDE.md](alerts/CLAUDE.md).

### decision-trace-analyzer/ (port 8006, `/api/dta/`)
Trace viewer for GenAI spans, reads ClickHouse only. Details → [decision-trace-analyzer/CLAUDE.md](decision-trace-analyzer/CLAUDE.md).

### compliance/ (port 8007, `/api/compliance/`)
Governance chain — assessments, obligations, requirements, evidence for the EU AI Act. Details → [compliance/CLAUDE.md](compliance/CLAUDE.md).

### audit/ (port 8009, `/api/audit/`)
Immutable audit trail across all platform actions (Postgres buffer → ClickHouse archive). Includes the `audit-flush-worker`. Details → [audit/CLAUDE.md](audit/CLAUDE.md).

### users/ (port 8008, `/api/users/`)
Keycloak-backed user management plus the IAM/roles API (see "Authorization — RBAC via OpenFGA"). Frontend is the separate `iam/` MFE at `/iam/`.

### admin/ (port 8010, `/api/admin/`)
Platform administration — SMTP mail config, platform settings, branding/white-labeling, summary dashboard. Details → [admin/CLAUDE.md](admin/CLAUDE.md).

### document-indexing/ (port 8011, `/api/indexing/`) — k8s-only
Reusable document indexing + retrieval service (chunk → embed → hybrid dense+FTS retrieval), served by `document-indexing/backend`, `document-indexing-worker`, and `embedding-service`. No frontend MFE — UI lives in `ai-test-bed/`. Details → [document-indexing/CLAUDE.md](document-indexing/CLAUDE.md).

### ai-test-bed/ (port 8013, `/api/ai-test-bed/`) — k8s-only — **[MVP-off]**
EU AI Act classification test harness consuming document-indexing and registry. **Disabled in the MVP** (images + `testbed-seed` Job toggled off; RAG layer stays enabled — grep `[MVP-off]`). Details → [ai-test-bed/CLAUDE.md](ai-test-bed/CLAUDE.md).

## Environment variables

All credentials load from `.env` (gitignored; copy from `.env.example`, never commit). All services use `os.environ["KEY"]` (fail-fast). **Exception:** SMTP settings are optional — `SMTP_HOST` unset → registry skips email.

See `.env.example` for the full list. Notable groups:
- **Infra creds** — `POSTGRES_*`, `RABBITMQ_*`, `CLICKHOUSE_*`, `MINIO_ROOT_*`, `DATABASE_URL`.
- **Tenancy** — `TENANCY_MODE` (`single` / `jwt`), `TENANCY_JWKS_ISSUER_BASE` (required if `jwt`), `TENANT_CLAIM` (`tenant_id`).
- **`ALLOWED_ORIGINS`** — comma-separated CORS origins; app refuses to start if unset.
- **`VITE_*`** — API base URLs and cross-MFE deep-link URLs baked into frontend bundles at build time.
- **Auth** — `KEYCLOAK_*`, `USERS_BACKEND_CLIENT_SECRET`, `APP_PUBLIC_URL`, `APP_ADMIN_*`, `OAUTH2_PROXY_COOKIE_SECRET` (exactly 16/24/32 chars).
- **compliance MinIO** — `MINIO_ENDPOINT` (in-cluster uploads), `MINIO_PUBLIC_ENDPOINT` (presigned URLs), `MINIO_SECURE`, `MINIO_REGION`.
- **alerts** — `ALERT_POLL_INTERVAL` (10 dev, 60+ prod).
- **external read API** — `EXTERNAL_API_TOKEN` (static bearer for `/api/registry/v1/external/*`; unset → 503), `EXTERNAL_API_SERVICE_PRINCIPAL` (default `svc-external-api`). Single-tenant only. Details → [ai-system-registry/CLAUDE.md](ai-system-registry/CLAUDE.md).
- **admin SMTP** — `SMTP_*` seed `platform_settings` on first startup; DB value wins afterwards. The registry reads these vars **directly from env** for notifications — it does not read `platform_settings`, so Admin UI SMTP changes do not affect registry emails.
- **registry LLM (Thalamus)** — `THALAMUS_BASE_URL` (unset or `"stub"` = offline stub), `THALAMUS_BEARER_TOKEN` (required with real URL), `THALAMUS_MODEL`, `THALAMUS_VISION_MODEL`; also `ASSIST_TURN_CAP`, `ASSIST_MAX_TEXT_LENGTH`, `QUESTIONNAIRE_MAX_TOKENS`. Thalamus is OpenAI-compatible and is the **platform-default inference backend** for both the registry and cognee-eval; switching models is a config-only change to `THALAMUS_MODEL` (no code change).
- **Bring-your-own-LLM (issue #406)** — a tenant admin can override the platform default with a custom **OpenAI-compatible** endpoint, configured at runtime in the Admin UI (`/llm-provider`), not via env. Config lives in a single-row `llm_provider_config` table (`libs/persistence`, migration `0053`; per-tenant via schema-per-tenant). The registry resolves the provider **per unit of work** via `ai_trust_persistence.llm_config.resolve_llm_config` + `ai-system-registry/backend/app/llm/client.resolve_runtime_config` — precedence is **active BYO row > platform-default Thalamus env > stub**. A long-running assessment-prefill run resolves once and **pins** one provider across all its batches + the dossier; the compliance advisor resolves per chat turn. There is **no silent fallback** between providers on error — a failing active provider surfaces as a 502. Scope is the registry's three AI workflows (AI-assisted intake, assessment prefill/classification, compliance advisor); cognee-eval stays on the Thalamus default. Endpoints are validated against an SSRF guard (`validate_endpoint_url`: https-only, blocks loopback/private/link-local/metadata IPs). Admin owns the CRUD + Test Connection + activate/restore-default endpoints and audits every change — see [admin/CLAUDE.md](admin/CLAUDE.md); the resolved model + provider host is recorded in the assessment dossier for traceability. **SAP AI Core is explicitly out of scope** (it needs OAuth2 client-credentials + the Anthropic `/invoke` wire format, which a static-bearer OpenAI-compatible row can't express).
- **Langfuse tracing** (optional) — `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` (blank = off). `LANGFUSE_TRACING_ENVIRONMENT` is auto-derived from the namespace — never set by hand.

## otel-pipeline/

Receives OTLP from any app, routes through RabbitMQ, stores in ClickHouse. Details → [otel-pipeline/CLAUDE.md](otel-pipeline/CLAUDE.md).

## consumers/

One sub-directory per RabbitMQ consumer — standalone Python worker (no FastAPI, no HTTP port). To add one, use the `/add-consumer` skill. Details → [consumers/CLAUDE.md](consumers/CLAUDE.md).
