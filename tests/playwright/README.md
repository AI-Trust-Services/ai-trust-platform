# Playwright frontend tests

Browser tests for the AI Trust Platform **MVP frontends**, driven black-box against a **live**
platform through the single entry point (oauth2-proxy on `APP_URL`). Authentication is a **real
Keycloak OIDC login** — the same auth model as [`tests/e2e_system/`](../e2e_system/), but through a
real browser instead of `httpx`.

Not a PR gate. Runs locally on demand, and in CI via the **`playwright-test`** PR label (see below).

## What it covers (MVP baseline)

| Kind | Scenario | Persona |
|---|---|---|
| Smoke | registry / compliance / audit / overview MFE mounts + backend healthy | `engineer` (`ai_engineer`) |
| Smoke | admin / users (IAM) MFE mounts + backend healthy | `admin` (`platform_administrator`) |
| Deep | register a new AI system end-to-end (name + description → toast → list row) | `engineer` |

Two personas cover all six MVP MFEs because the shell nav is permission-gated
(`libs/authorization/ai_trust_authorization/constants.py`). MVP-off MFEs (ai-test-bed, monitoring,
alerts, dta) and visual-regression snapshots are out of scope — see [docs/tests.md](../../docs/tests.md).

## How it works

- **`auth.setup.ts`** (setup project) logs the bootstrap admin in, provisions an `engineer` persona
  via the users API (mirrors `conftest.py::_provision_user`), logs the engineer in (swapping the
  forced temporary password), and saves one `storageState` per persona under `.auth/`. The unique
  run suffix + created user ids are persisted to `.auth/run.json`.
- **`tests/*.spec.ts`** reuse those sessions via `test.use({ storageState })` — no re-login.
- **`cleanup.teardown.ts`** (teardown project, runs even on failure) deletes created systems (as
  `engineer`) and users (as `admin`).

## Prerequisites

- Node 24 (matches the frontends).
- A **running** platform reachable at `APP_URL`.
- The **bootstrap admin password** in `APP_ADMIN_PASSWORD` (the suite logs in via real OIDC — there
  is no header bypass).

```bash
npm install
npx playwright install --with-deps chromium
```


## Run locally

### Against a kind cluster (`make up` from the repo root)

```bash
APP_URL=http://localhost:8080 \
APP_ADMIN_USERNAME=admin \
APP_ADMIN_PASSWORD="$(grep ^APP_ADMIN_PASSWORD ../../.env | cut -d= -f2-)" \
npx playwright test
```

### Against a deployed Gardener namespace

```bash
APP_URL=https://<namespace>.ai-trust-test.ai-trust.shoot.gardener.cc-one.showroom.apeirora.eu \
APP_ADMIN_USERNAME=admin \
APP_ADMIN_PASSWORD=<secret> \
npx playwright test
```

### Useful flags

```bash
npx playwright test --ui          # step through the OIDC login + registration visually
npx playwright test --headed      # watch the real browser
npx playwright show-report        # open the HTML report after a run
```

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `APP_URL` | `http://localhost:8080` | Platform entry point (oauth2-proxy). |
| `APP_ADMIN_USERNAME` | `admin` | Bootstrap admin username. |
| `APP_ADMIN_PASSWORD` | — (required) | Bootstrap admin password. |
| `E2E_SUFFIX` | random 8 hex | Override the per-run uniqueness suffix (usernames / system names). |
| `CI` | — | When set, enables 2 retries. |

## CI

[`.github/workflows/playwright-frontend-tests.yml`](../../.github/workflows/playwright-frontend-tests.yml)
runs this suite against the PR author's **already-deployed** namespace on `ai-trust-test`, triggered
by the **`playwright-test`** PR label. Prerequisites: deploy the namespace first (add `garden-deploy`)
and initialise it once with `shoot-cluster-init.sh ai-trust-test --namespace=<github-username>`.
The HTML report and `test-results/` (traces, failure screenshots, videos) are uploaded as artifacts.
