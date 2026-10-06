<p align="center">
  <img alt="AI Trust Platform logo" src="https://ai-trust-services.github.io/logo.svg" width="120"/>
</p>

<h1 align="center">AI Trust Platform</h1>

<p align="center">
  <strong>EU AI Act compliance by design.</strong><br/>
  Build trust into every AI system — from day one.
</p>

<p align="center">
  <a href="https://api.reuse.software/info/github.com/AI-Trust-Services/ai-trust-platform"><img alt="REUSE status" src="https://api.reuse.software/badge/github.com/AI-Trust-Services/ai-trust-platform"/></a>
  <img alt="License" src="https://img.shields.io/github/license/AI-Trust-Services/ai-trust-platform?style=flat-square"/>
  <img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square"/>
</p>

---

## About this project

**AI Trust Platform** is a unified platform for registering, understanding, assessing, and continuously governing AI systems throughout their lifecycle — with **EU AI Act** compliance built in.

Organizations register their AI assets once and maintain continuous, automated compliance: transparency, monitoring, and documentation are centralized in one place, with automatic requirements updates, gap analysis, and mitigation proposals.

> ⚠️ AI Trust Platform is currently under active development and is **not intended for production use**. The project is in an alpha stage. APIs, interfaces, and underlying concepts are subject to change without prior notice — including breaking changes, significant redesigns, or the deprecation and complete removal of APIs and functionality.

## Why AI Trust Platform

- **EU AI Act — Compliant by Design** — Purpose-built for the EU AI Act — not adapted to it. Automated risk classification, assessments, obligations, and controls translate regulatory requirements into actionable compliance workflows.
- **End-to-End — One Platform** — From initial registration to continuous compliance in one connected workflow. Manage classification, assessments, obligations, controls, evidence, monitoring, alerts, and audit readiness without stitching together multiple governance tools.
- **Role-Based — AI-Assisted** — Make compliance a shared workflow, not a specialist task. Application Owners, AI Engineers, and Compliance Officers see exactly what they need — with clear handovers, guided workflows, and AI assistance along the way.
- **Continuous Compliance — Ready for Change** — Stay compliant as AI systems and regulations evolve. Changes in models, systems, or regulatory requirements can trigger alerts, impact reviews, and re-assessments — keeping compliance aligned throughout the AI lifecycle.

## Getting started

### Requirements

- Docker
- [kind](https://kind.sigs.k8s.io/) (Kubernetes in Docker)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Helm](https://helm.sh/)

### Quick start

```bash
cp .env.example .env   # fill in credentials (defaults work for local dev)
make up
```

`make up` creates a local kind cluster, provisions secrets, builds all images, and installs the platform via Helm. All traffic enters through the portal at **http://localhost:8080** via the shell reverse proxy behind oauth2-proxy.

See [k8s/README.md](k8s/README.md) for the full local setup guide, and [docs/architecture.md](docs/architecture.md) for the repo layout and data flow diagrams.

### Tear down

```bash
make down        # uninstall Helm release + delete kind cluster (keeps .env)
```

### Local development workflow

After `make up`, you don't need to recreate the cluster for every change:

```bash
make build       # rebuild changed images and reload them into the cluster
make upgrade     # redeploy via Helm (picks up config/chart changes)
make lint        # format Python files in-place + run ruff lint check
```

For a code change to a backend or worker: `make build && make upgrade`. For a Helm/config-only change: `make upgrade` alone is enough.

## Testing

### Backend / Worker microservices

Every backend service and worker follows a consistent two-tier test structure:

| Directory | What runs | Infrastructure needed |
|---|---|---|
| `tests/unit/` | Pure Python — mocked I/O, no DB | None |
| `tests/e2e/` | Full stack via ASGITransport | Postgres (and ClickHouse where applicable) |

All 14 backend/worker components have unit tests:

| Component | Unit test file |
|---|---|
| `admin/backend` | `tests/unit/` |
| `ai-system-registry/backend` | `tests/unit/` |
| `alerts/backend` | `tests/unit/` |
| `audit/backend` | `tests/unit/` |
| `audit-flush-worker` | `tests/unit/` |
| `compliance/backend` | `tests/unit/` |
| `consumers/clickhouse-consumer` | `tests/unit/` |
| `decision-trace-analyzer/backend` | `tests/unit/` |
| `libs/authorization` | `tests/unit/` |
| `monitoring/backend` | `tests/unit/` |
| `otel-pipeline/rmq-bridge` | `tests/unit/` |
| `overview/backend` | `tests/unit/` |
| `policy-checker-worker` | `tests/unit/` |
| `users/backend` | `tests/unit/` |

Run tests for any component:

```bash
cd <component>          # e.g. cd compliance/backend
make setup              # first time only — creates .venv, installs deps
make test-unit          # unit tests only, no Docker needed
make test-e2e           # e2e tests, requires Postgres: make up or docker run postgres
make test               # all tests
```

### Frontend microservices

Frontends are built with React 19 + TypeScript 5.8. There are no unit or integration tests at the moment — this is a known gap.

All 8 frontends have TypeScript type-checking wired up via `npm run typecheck` (`tsc --noEmit`):
`admin`, `ai-system-registry`, `alerts`, `audit`, `compliance`, `decision-trace-analyzer`, `monitoring`, `users`.

To run type-checking on a frontend:

```bash
cd <component>/frontend   # e.g. cd compliance/frontend
npm install
npm run typecheck
```

Frontend unit tests (Vitest) and ESLint are not yet configured — contributions welcome.

### Integration tests

`tests/integration/` is a global cross-service suite that verifies microservice contracts against a **live platform** (kind locally, or a Gardener cluster). It requires all services running — not a substitute for unit or e2e tests.

| Test file | Tests covered |
|---|---|
| `test_01_health.py` | 7 backends `/health` → 200 (`overview` and `dta` are read-only and out of scope) |
| `test_02_registry_compliance.py` | Registry↔compliance shared model, assessment generation, evidence cascade to `ai_systems.compliance`, rejection revert |
| `test_03_rbac.py` | RBAC 403s across services, admin→users internal HTTP call |

**Run locally** (after `make up`):

```bash
make test-int                    # kind cluster, namespace ai-trust
```

`make test-int` starts port-forwards for all 7 backends, runs pytest, then kills the forwards — even on failure. The target is kind-only: the namespace is fixed to `ai-trust`. Targeting a remote Gardener namespace, debugging a single test, and the configuration env vars are documented in [tests/integration/README.md](tests/integration/README.md).

**CI**: the `Integration Tests` workflow triggers automatically after a successful `PR Deployment Test` (PR with `garden-deploy` label) or `Deployment Workflow` (merge to main), and optionally on demand via **Actions → Integration Tests → Run workflow**. It reports to a single `integration-tests` commit status on the deployed commit — `garden-deploy` seeds it pending, and the post-deployment run overwrites it with the final result, so the result is visible on the PR and on main. It runs as a separate workflow — deployment status is unaffected by integration test results.

### Automated PR checks

Every pull request triggers three workflows:

**`pr-unit-tests.yml` — Pre-merge check: unit tests**
- Matrix job, one cell per component, all 14 running in parallel
- Runs `make setup && make test-unit` for each backend/worker component
- No Docker or external services — pure Python only
- A failure in one component does not cancel the others (`fail-fast: false`)
- Each component appears as a separate status check on the PR

**`pr-lint.yml` — Pre-merge check: lint**
- `ruff check .` — lint across the entire Python codebase
- `ruff format --check .` — format check across the entire Python codebase

**`pr-typecheck.yml` — Pre-merge check: typecheck**
- Runs `npm ci && npm run typecheck` for all 8 TypeScript frontends sequentially
- A failure in any frontend fails the whole check and lists all failures at the end

E2E tests are not part of the PR workflow — they require infrastructure (Postgres, ClickHouse) not available in the GitHub Actions runner.

## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/AI-Trust-Services/ai-trust-platform/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Security / Disclosure
If you find any bug that may be a security problem, please follow our instructions at [in our security policy](https://github.com/AI-Trust-Services/ai-trust-platform/security/policy) on how to report it. Please do not create GitHub issues for security-related doubts or problems.

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](https://github.com/AI-Trust-Services/.github/blob/main/CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2026 SAP SE or an SAP affiliate company and ai-trust-platform contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/AI-Trust-Services/ai-trust-platform).

<p align="center"><img alt="Bundesministerium für Wirtschaft und Klimaschutz (BMWK)-EU funding logo" src="https://apeirora.eu/assets/img/BMWK-EU.png" width="400"/></p>
