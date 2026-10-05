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

The registry can be run as part of the full platform (`make up` from the repo root). For standalone backend development, start Postgres separately:

```bash
docker run -d --name pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ai_trust -p 5432:5432 postgres:16-alpine
```

## Running tests

```bash
cd ai-system-registry/backend
make setup        # first time only — creates .venv and installs deps

make test-unit    # pure unit tests, no Docker needed
make test-e2e     # requires Postgres running (see above)
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
| `GET` | `/api/v1/systems/{id}/models` | List linked model cards |
| `POST` | `/api/v1/systems/{id}/models` | Link a model card (with optional `role`) |
| `DELETE` | `/api/v1/systems/{id}/models/{model_id}` | Unlink a model card |
| `GET` | `/api/v1/model-cards` | List all model cards |
| `POST` | `/api/v1/model-cards` | Create a model card |
| `PUT` | `/api/v1/model-cards/{id}` | Update a model card |
| `DELETE` | `/api/v1/model-cards/{id}` | Delete a model card |

Full interactive docs at `/docs` when the backend is running.

## Architecture

See [../docs/architecture.md](../docs/architecture.md).
