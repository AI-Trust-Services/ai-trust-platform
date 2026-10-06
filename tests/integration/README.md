# Integration Tests

Cross-service API tests that verify microservice contracts against a live platform. Requires all services running — not a substitute for per-service unit or e2e tests.

## What is tested

| File | IDs | Contract |
|---|---|---|
| `test_01_health.py` | IT-09 | 7 backends `/health` → 200 (`overview` and `dta` are read-only and out of scope) |
| `test_02_registry_compliance.py` | IT-01–IT-04 | Shared `ai_systems` FK integrity; assessment generation; evidence approval cascades `compliance` score back to registry; rejection reverts it |
| `test_03_rbac.py` | IT-05–IT-08 | `auditor` 403 on registry write; `ai_engineer` 403 on evidence approve; `platform_administrator` 403 on assessments read; admin→users internal HTTP call |

## Running locally

Requires a running platform — `make up` from the repo root (kind).

```bash
# From the repo root:
make test-int    # kind cluster, namespace ai-trust
```

`make test-int` handles port-forwards automatically (start → pytest → stop, even on failure). The make
targets are kind-only: the namespace is fixed to `ai-trust` and is **not** overridable from the
environment. A remote Gardener namespace is targeted by calling the scripts directly, which is exactly
what the CI workflow does:

```bash
# From the repo root:
bash k8s/scripts/forward-ports.sh <namespace>
pytest tests/integration/ -v
bash k8s/scripts/kill-port-forwards.sh
```

**Manual iteration** (when debugging a specific test):

```bash
# From the repo root:
make forward-ports                 # backgrounds 7 port-forwards, returns prompt
pytest tests/integration/test_03_rbac.py -v -k "test_auditor"
make stop-forwards
```

## Configuration

All URLs default to `localhost:<port>` (after port-forwarding). Override via env vars:

| Variable | Default |
|---|---|
| `REGISTRY_URL` | `http://localhost:8001` |
| `COMPLIANCE_URL` | `http://localhost:8007` |
| `ALERTS_URL` | `http://localhost:8005` |
| `USERS_URL` | `http://localhost:8008` |
| `AUDIT_URL` | `http://localhost:8009` |
| `ADMIN_URL` | `http://localhost:8010` |
| `MONITORING_URL` | `http://localhost:8003` |
| `APP_ADMIN_USERNAME` | `admin` |

## CI

The `Integration Tests` workflow (`.github/workflows/integration-tests.yml`) triggers after a successful:
- **`PR Deployment Test`** — PR labeled `garden-deploy` → namespace = PR author, cluster = `ai-trust-test`
- **`Deployment Workflow`** — merge to main → namespace = `ai-trust`, cluster = `ai-trust-main`

It can also be re-run on demand, without redeploying, via **Actions → Integration Tests → Run
workflow** — both inputs have defaults, so it is a one-click run; override them to target another
cluster or namespace.

Everything reports to one commit status context, **`integration-tests`**, which is keyed by name and
overwritten in place — so the PR shows a single entry that transitions rather than several separate
results:

| When | `integration-tests` status |
|---|---|
| `garden-deploy` added | 🟡 pending — "Waiting for deployment to finish..." |
| deployment succeeds, tests start | 🟡 pending — "Running against `<cluster>`/`<namespace>`..." |
| tests finish | ✅ success / ❌ failure, linking to the run log |
| deployment fails | 🔴 error — "Skipped — deployment did not succeed." |

The pending status is seeded by a **step** inside `pr-deployment-test.yml`'s existing job, not by a
job in `integration-tests.yml`. That is deliberate: every job in a `pull_request`-triggered workflow is
pinned to the PR as its own check run, and `pull_request: [labeled]` fires for *every* label (GitHub
has no label-name filter in `on:`) — which previously left a permanently **Skipped** check plus a
redundant seed-job check on the PR. Steps create no check runs, so the PR now shows only the single
`integration-tests` status.

A commit status is used rather than a check run because `workflow_run` runs attach to the **default
branch** rather than the PR head, so their native checks never appear on the PR at all. This is the
same pattern `pr-full-update-test.yml` uses for its `deploy-test` status.

Deployment workflow status is not affected by integration test results — they run as a separate workflow.

## Auth model

Tests set `X-Forwarded-Preferred-Username` directly, bypassing oauth2-proxy. This is the same pattern used by per-service e2e tests. RBAC tests assign roles via the IAM API using the platform admin user before asserting 403s.

## Out of scope (future milestones)

- Alert rule firing (requires seeding ClickHouse spans)
- Audit flush worker (requires ClickHouse + async timing)
- Browser e2e (Keycloak OAuth2 flow, nginx routing, Luigi MFE wiring)
