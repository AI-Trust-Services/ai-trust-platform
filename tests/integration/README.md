# Integration Tests

Cross-service API tests that verify microservice contracts against a live platform. Requires all services running — not a substitute for per-service unit or e2e tests.

## What is tested

| File | IDs | Contract |
|---|---|---|
| `test_01_health.py` | IT-09 | All 7 backends `/health` → 200 |
| `test_02_registry_compliance.py` | IT-01–IT-04 | Shared `ai_systems` FK integrity; assessment generation; evidence approval cascades `compliance` score back to registry; rejection reverts it |
| `test_03_rbac.py` | IT-05–IT-08 | `auditor` 403 on registry write; `ai_engineer` 403 on evidence approve; `platform_administrator` 403 on assessments read; admin→users internal HTTP call |

## Running locally

Requires a running platform — either `cd k8s && make up` (kind) or a remote Gardener cluster with port-forwarding.

```bash
# From the k8s/ directory:
make test-int                      # kind default (namespace=ai-trust)
NAMESPACE=sebastian make test-int  # remote namespace
```

`make test-int` handles port-forwards automatically (start → pytest → stop, even on failure).

**Manual iteration** (when debugging a specific test):

```bash
cd k8s
make forward-ports                 # backgrounds 7 port-forwards, returns prompt
pytest ../tests/integration/test_03_rbac.py -v -k "test_auditor"
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

Deployment workflow status is not affected by integration test results — they run as a separate workflow.

## Auth model

Tests set `X-Forwarded-Preferred-Username` directly, bypassing oauth2-proxy. This is the same pattern used by per-service e2e tests. RBAC tests assign roles via the IAM API using the platform admin user before asserting 403s.

## Out of scope (future milestones)

- Alert rule firing (requires seeding ClickHouse spans)
- Audit flush worker (requires ClickHouse + async timing)
- Browser e2e (Keycloak OAuth2 flow, nginx routing, Luigi MFE wiring)
