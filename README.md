# AI Trust Platform

A platform for governing AI systems under the **EU AI Act** — register AI systems, classify their risk tier automatically, track model cards, and observe GenAI usage in production.

## What's inside

| Component | Description |
|---|---|
| [AI System Registry](ai-system-registry/) | Register and classify AI systems by EU AI Act risk tier (prohibited → high → limited → minimal). Manage model cards and link them to systems. |
| [Overview](overview/) | Compliance posture at a glance — KPI cards, tier distribution, compliance charts, customizable analytics dashboard. |
| [Monitoring](monitoring/) | Live observability dashboard — GenAI inference signals from ClickHouse + registry analytics from Postgres. Customizable chart dashboard. |
| [Alerts](alerts/) | Rule-based alerting — active alerts, history, and configurable rules. Background worker evaluates conditions and auto-resolves when conditions clear. |
| [OTel Pipeline](otel-pipeline/) | Ingest GenAI spans from any application via OpenTelemetry → RabbitMQ → ClickHouse |
| [Consumers](consumers/) | RabbitMQ consumers — one per sink (ClickHouse) |
| [Policy Checker Worker](policy-checker-worker/) | Background job evaluating alert rules against Postgres + ClickHouse |
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
| Overview UI | http://localhost:3003 |
| Overview API | http://localhost:8004 |
| Monitoring UI | http://localhost:3002 |
| Monitoring API | http://localhost:8003 |
| Alerts UI | http://localhost:3004 |
| Alerts API | http://localhost:8005 |
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

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details

<p align="center"><img alt="Bundesministerium für Wirtschaft und Klimaschutz (BMWK)-EU funding logo" src="https://apeirora.eu/assets/img/BMWK-EU.png" width="400"/></p>
