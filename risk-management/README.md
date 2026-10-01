# Risk Management Module — AI Trust Platform

Module implementing the iterative risk management cycle required by **EU AI Act Article 9** for
high-risk AI systems (Annex III), as part of the AI Trust Platform's Luigi shell. Risk
identification, evaluation, mitigation, and residual-risk sign-off are all **human-driven** —
AI engineers and compliance officers enter and confirm every risk directly; there is no automated
or LLM-assisted risk identification in this module.

---

## Scope

| Art. 9 Step | Coverage |
|---|---|
| Art. 9(2)(a) — risk identification | Manual risk entry per AI system, optionally pre-filled from a shared, cross-system **Risk Library** |
| Art. 9(2)(b) — evaluation and classification | Severity × likelihood risk-level matrix (Unacceptable / Substantial / Moderate / Acceptable), impact category, misuse scenarios |
| Art. 9(2)(a)/(d) — independent review and mitigation | Per-role confirmation (AI Engineer **and** AI Compliance Officer must each confirm independently); mitigations grouped by hierarchy (eliminate → reduce → mitigate → inform), each linkable to a plan task |
| Art. 9(5) — residual risk argument | Per-risk residual status (acceptable/unacceptable) plus an overall sign-off argument and verdict on the register |
| Art. 9(2)(c) — post-market monitoring | Manual incident log per system, linkable to a specific risk; reassessment triggers re-open an approved register |
| Art. 9(2) — iterative cycle | Prior approved registers are kept as read-only, diffable version history; a new cycle can be started pre-filled from the last one |

---

## Quick Start

### Prerequisites

- Docker Desktop
- `.env` file copied from `.env.example` (repo root)

### Run with docker compose

```bash
# From the repo root
cp .env.example .env   # first time only
docker compose up --build -d
```

Module available at: **http://localhost:8080/risk-management/**

Backend logs:

```bash
docker compose logs -f risk-management-backend
```

### Demo data

```bash
docker compose --profile demo up risk-management-demo-seed
```

Registers 11 diverse AI systems with fully populated risk registers across every traffic-light
state. See [`docs/DEMO_GUIDE.md`](docs/DEMO_GUIDE.md) for the full walkthrough, and
[`docs/DEMO_WALKTHROUGH_EPA.md`](docs/DEMO_WALKTHROUGH_EPA.md) for a guided, field-by-field tour.

### Run the backend locally (without Docker)

```bash
cd risk-management/backend
make setup        # first run — creates .venv
make test-unit    # no DB needed
make test-e2e     # requires Postgres: docker compose up -d postgres
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ALLOWED_ORIGINS` | *(required, fails fast if unset)* | Comma-separated CORS origins |
| `ROOT_PATH` | *(empty)* | FastAPI path prefix (set to `/api/risk-management` in docker-compose) |
| `REGISTRY_INTERNAL_BASE` | `http://ai-system-registry-backend:8001` | In-cluster base URL for proxying AI System Registry data |
| `USERS_BACKEND_URL` | `http://users-backend:8008` | Used to resolve reviewer/owner identities for authorization checks |
| `ADMIN_BACKEND_URL` | `http://admin-backend:8010` | Used to read the platform-wide Risk Library editability setting |

> **Known inconsistency:** `docker-compose.yml` sets `REGISTRY_API_BASE` for
> `risk-management-backend`, but the code reads `REGISTRY_INTERNAL_BASE` instead. The code's
> built-in default happens to match the compose service address, so this has no functional effect
> today — but the compose variable is otherwise dead. Worth cleaning up (either rename the compose
> var or add an alias in code) in a follow-up PR.

---

## Project structure

```
risk-management/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app, CORS, logging middleware, router mounts
│   │   ├── schemas.py              # Pydantic request/response models
│   │   ├── ids.py                  # new_id() domain ID generation
│   │   ├── owner_auth.py           # risk-owner / reviewer authorization for delete confirmation
│   │   └── routers/
│   │       ├── registers.py        # risk registers: CRUD, approve, traffic-light + version history
│   │       ├── risks.py            # risk entries: CRUD, confirm/dismiss per role, mitigations, residual risk
│   │       ├── triggers.py         # reassessment triggers (re-opens an approved register)
│   │       ├── test_reports.py     # test reports linked to a risk
│   │       ├── plan_tasks.py       # plan tasks linked to a risk or a specific mitigation
│   │       ├── incidents.py        # manual incident log (CRUD), optionally linked to a risk
│   │       ├── registry_proxy.py   # read-only proxy to the AI System Registry (system metadata)
│   │       └── risk_library.py     # shared, cross-system reusable risk library
│   └── tests/
│       ├── unit/                   # pure unit tests, no DB
│       └── e2e/                    # full stack via ASGITransport, requires Postgres only
├── demo-seed/                      # one-shot seeder: registers demo systems + full risk registers
├── frontend/                       # React 19 + Vite 6 + Tailwind/Radix (shadcn pattern)
│   └── src/
│       ├── pages/
│       │   ├── SystemsListPage.tsx       # entry point: systems list + Risk Library tab
│       │   └── AssessmentWizardPage.tsx  # single-page register view (risks, mitigations, approval)
│       ├── hooks/usePermissions.ts       # current user's OpenFGA permissions
│       └── api/client.ts                 # typed request<T>() wrapper
└── docs/
    ├── DEMO_GUIDE.md                # quick start + systems overview + module tour
    ├── DEMO_WALKTHROUGH_EPA.md      # guided, field-by-field live walkthrough
    ├── DEMO_PROMPT.md               # prompt for an AI assistant to run the walkthrough interactively
    ├── article9_checklist.md        # regulatory checklist (Art. 9 obligations)
    └── review_checklist.md          # checklist for reviewing a completed assessment before sign-off
```

Database models live in the shared `libs/persistence` package (not inside this module), per the
platform's single-schema convention: `risk_registers`, `risk_entries`, `misuse_scenarios`,
`mitigation_measures`, `reassessment_triggers`, `test_reports`, `plan_tasks`, `incidents`
(`models/risk_management.py`), plus `library_risks` and `library_incidents`
(`models/risk_library.py`).

---

## Tests

```bash
cd risk-management/backend
make setup
make test-unit   # no DB needed
make test-e2e    # requires Postgres: docker compose up -d postgres
make test        # both
```

E2E tests cover registers (CRUD, approve, traffic light, versioning), risks (CRUD, per-role
confirm/dismiss, mitigations, residual risk), plan tasks, test reports, incidents, and the risk
library.

---

## Architecture

The module consists of two containers:

- **risk-management-backend** — FastAPI on port 8009, build context: repo root (required to copy
  `libs/logging`, `libs/persistence`, `libs/authorization`)
- **risk-management-frontend** — React built by Vite, served by nginx

All traffic passes through the shell nginx reverse proxy on port 8080:
- `/risk-management/` → risk-management-frontend
- `/api/risk-management/` → risk-management-backend

Authorization is OpenFGA-based, consistent with the rest of the platform (see the repo-root
`CLAUDE.md` for the full auth model): per-role risk confirmation
(`risks:confirm_engineer` / `risks:confirm_officer`) and the usual `*:read` / `*:write` pairs are
checked via `require_permission()` / `check_permission()`, not Keycloak realm roles.

---

## Roadmap

- [ ] PDF export of the approved register report (currently HTML only)
- [ ] Automated reassessment triggers from registry events (currently manually created)

---

## License

Apache-2.0 (consistent with the rest of the AI Trust platform)
