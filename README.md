# AI Trust Platform

A platform for governing AI systems under the **EU AI Act** — register AI systems, classify their risk tier automatically, track model cards, and observe GenAI usage in production.

## What's inside

| Component | Description |
|---|---|
| [AI System Registry](ai-system-registry/) | Register and classify AI systems by EU AI Act risk tier (prohibited → high → limited → minimal) |
| [OTel Pipeline](otel-pipeline/) | Ingest GenAI spans from any application via OpenTelemetry → RabbitMQ → ClickHouse |
| [Consumers](consumers/) | RabbitMQ consumers — one per sink (ClickHouse, SSE, etc.) |
| Shell | Luigi micro-frontend host that composes all UIs into a single portal |

See [docs/architecture.md](docs/architecture.md) for the full repo layout, data flow diagrams, and Docker startup order.

## Quick start

```bash
cp .env.example .env          # fill in credentials (defaults work for local dev)
docker compose up --build -d
```

| Service | URL |
|---|---|
| Portal (Luigi shell) | http://localhost:8080 |
| AI System Registry UI | http://localhost:3001 |
| AI System Registry API | http://localhost:8001 |
| API docs (Swagger) | http://localhost:8001/docs |
| RabbitMQ management | http://localhost:15672 |
| ClickHouse HTTP API | http://localhost:8123 |

## Tear down

```bash
docker compose down --remove-orphans          # stop, keep data
docker compose down -v --remove-orphans       # stop, wipe all data (fresh start)
```

## Requirements

- Docker + Docker Compose
- No local language runtime needed — everything runs in containers

