# AI System Registry

EU AI Act compliance registry — register AI systems, get automatic risk classification, and link model cards.

## What it does

- **Registers** AI systems with metadata (name, purpose, deployment context)
- **Classifies** each system automatically into one of four EU AI Act risk tiers:
  - `prohibited` — Art. 5 systems (subliminal manipulation, social scoring, etc.)
  - `high` — Annex III systems (biometrics, credit scoring, law enforcement, etc.)
  - `limited` — chatbots and synthetic content generators
  - `minimal` — everything else
- **Tracks model cards** for the underlying AI models (provider, version, capabilities)
- **Links** systems to their model cards

## Running in isolation

```bash
cd ai-system-registry
docker compose up --build -d
```

| Service | URL |
|---|---|
| Frontend UI | http://localhost:3001 |
| Backend API | http://localhost:8001 |
| API docs (Swagger) | http://localhost:8001/docs |
| Health check | http://localhost:8001/health |

## Running tests

```bash
cd ai-system-registry/backend
make setup        # first time only — creates .venv and installs deps

make test-unit    # pure unit tests, no Docker needed
make test-e2e     # requires Postgres running (docker compose up -d postgres)
make test         # all tests
```

## API overview

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/intake` | Register a new AI system (runs classifier, returns tier) |
| `GET` | `/api/v1/systems` | List all systems (paginated) |
| `GET` | `/api/v1/systems/{id}` | Get a system |
| `PUT` | `/api/v1/systems/{id}` | Update mutable fields |
| `DELETE` | `/api/v1/systems/{id}` | Delete a system |
| `POST` | `/api/v1/systems/{id}/reclassify` | Re-run classifier on existing system |
| `PUT` | `/api/v1/systems/{id}/model` | Link a model card |
| `DELETE` | `/api/v1/systems/{id}/model` | Unlink a model card |
| `GET` | `/api/v1/model-cards` | List all model cards |
| `POST` | `/api/v1/model-cards` | Create a model card |
| `PUT` | `/api/v1/model-cards/{id}` | Update a model card |
| `DELETE` | `/api/v1/model-cards/{id}` | Delete a model card |

Full interactive docs at `/docs` when the backend is running.

## Architecture

See [../docs/architecture.md](../docs/architecture.md).
