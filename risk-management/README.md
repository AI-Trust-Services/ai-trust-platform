# Risk Management Module — AI Trust Platform

Module implementing the risk management cycle per **EU AI Act Article 9** for high-risk AI systems (Annex III). This is a proof-of-concept integrated into the AI Trust Platform as a Luigi microfrontend.

---

## Scope

| Art. 9 Step | Coverage |
|---|---|
| Art. 9(2)(a) — risk identification | ✅ Three backends: rule-based, LLM-assisted, IBM Risk Atlas Nexus stub |
| Art. 9(2)(b) — evaluation and classification | ✅ Misuse scenarios, vulnerable groups, EU AI Act risk level classification |
| Art. 9(2)(d) — mitigation measures | ✅ Mitigation library with hierarchy (eliminate → reduce → mitigate → inform) |
| Art. 9(5) — residual risk argument | ✅ Structured GSN-inspired acceptability argument |
| Art. 9(2)(c) — post-market monitoring | ❌ Out of scope for this PoC |
| Art. 9(5) — formal assurance case | ❌ Out of scope for this PoC |

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

### Run the backend locally (without Docker)

```bash
cd risk-management/backend
make setup        # first run — creates .venv
make test-unit    # run unit tests
```

---

## Ollama configuration (optional LLM assistance)

By default the module runs in rule-based mode with no LLM. To enable LLM-assisted identification:

1. Install [Ollama](https://ollama.com) locally
2. Pull the model:
   ```bash
   ollama pull llama3.2
   ```
3. Set in `.env`:
   ```
   OLLAMA_BASE_URL=http://host-gateway:11434
   OLLAMA_MODEL=llama3.2
   ```
4. Toggle **LLM-assisted identification** in the UI on the system selection screen

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ALLOWED_ORIGINS` | *(required)* | Comma-separated CORS origins |
| `ROOT_PATH` | `/api/risk-management` | FastAPI path prefix |
| `OLLAMA_BASE_URL` | `http://host-gateway:11434` | Ollama server address |
| `OLLAMA_MODEL` | `llama3.2` | Ollama model name |

---

## Project structure

```
risk-management/
├── backend/
│   ├── app/                        # FastAPI — routers, schemas
│   │   ├── routers/
│   │   │   ├── assessments.py      # POST /v1/assessments/*
│   │   │   ├── demos.py            # GET /v1/demos
│   │   │   └── llm.py              # GET /v1/llm/status
│   │   └── schemas/
│   ├── risk_management/            # Business logic
│   │   ├── models.py               # Pydantic models
│   │   ├── identifier.py           # Risk identification engine
│   │   ├── evaluator.py            # Evaluation and classification
│   │   ├── mitigator.py            # Mitigation assignment
│   │   ├── reporter.py             # JSON/Markdown export
│   │   ├── llm_client.py           # LLM abstraction layer
│   │   ├── classifier.py           # EU AI Act risk level classifier
│   │   ├── vulnerable_groups.py    # Vulnerable group assessment
│   │   ├── incident_lookup.py      # Related AI incidents
│   │   └── residual_risk.py        # Residual risk argument
│   ├── data/
│   │   ├── risk_taxonomy.json      # ~25 risks with taxonomy mappings
│   │   └── mitigation_library.json # ~45 mitigation measures
│   └── demo/
│       ├── creditsense/            # Demo: credit scoring system
│       └── hirefilter/             # Demo: CV screening system
├── frontend/                       # React 19 + Vite 6 + UI5
│   └── src/pages/AssessmentPage.tsx  # 5-step wizard
└── docs/
    ├── risk_identification_explained.md
    ├── risk-atlas-nexus-how-it-works.md
    ├── risk-atlas-nexus-integration-kickoff.md
    ├── article9_checklist.md
    └── review_checklist.md
```

---

## Tests

```bash
cd risk-management/backend
make setup
make test-unit
```

Tests cover: health check, demo list, risk identification (rule-based and stub), LLM status.

---

## Architecture

The module consists of two containers:

- **risk-management-backend** — FastAPI on port 8009, build context: repo root (required to copy `libs/logging`)
- **risk-management-frontend** — React built by Vite, served by nginx

All traffic passes through the shell nginx reverse proxy on port 8080:
- `/risk-management/` → risk-management-frontend
- `/api/risk-management/` → risk-management-backend

---

## Roadmap

- [ ] IBM Risk Atlas Nexus integration (see `docs/risk-atlas-nexus-integration-kickoff.md`)
- [ ] Post-market monitoring incident ingestion (Art. 9(2)(c)) — webhook or file upload
- [ ] Art. 13-compliant instructions for use document generated from the risk register
- [ ] Source code input support (in addition to documentation)
- [ ] DPIA (Data Protection Impact Assessment) module
- [ ] PDF export
- [ ] Risk register persistence in PostgreSQL

---

## License

Apache-2.0 (consistent with the rest of the AI Trust platform)
