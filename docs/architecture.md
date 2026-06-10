# Architecture

## Repository Layout

```
ai-trust-platform/
├── libs/
│   ├── persistence/              ← shared Python package (models, migrations, DB session)
│   │   ├── Dockerfile            ← one-shot migration container
│   │   ├── pyproject.toml        ← pip installable as ai-trust-persistence
│   │   ├── alembic.ini           ← migration config, reads DATABASE_URL from env
│   │   └── ai_trust_persistence/
│   │       ├── database.py       ← engine (pool_size=5), SessionLocal, Base
│   │       ├── models/           ← all SQLAlchemy ORM models (shared across all backends)
│   │       └── migrations/       ← single Alembic setup for all tables
│   └── logging/                  ← shared structured JSON logging package
├── shell/                        ← Luigi host (nginx + luigi-config.js)
├── ai-system-registry/           ← EU AI Act registry component
│   ├── frontend/                 ← static HTML + UI5 Web Components (nginx, port 3001)
│   └── backend/                  ← FastAPI + SQLAlchemy async (port 8001)
├── otel-observer/                ← GenAI observability pipeline
│   ├── collector/                ← OTel Collector config
│   │   └── otel-collector-config.yaml
│   ├── rmq-bridge/               ← FastAPI OTLP→RabbitMQ bridge (port 8002)
│   │   └── app/main.py
│   └── clickhouse/               ← ClickHouse schema
│       └── init.sql
├── consumers/                    ← RabbitMQ consumers (one sub-dir per sink)
│   └── clickhouse-consumer/      ← writes GenAI spans to ClickHouse
│       └── main.py
└── docker-compose.yml            ← orchestrates all services
```

## GenAI Observability Data Flow

```mermaid
flowchart TD
    App["App\n(any language, OTLP configured)"]

    App -->|"OTLP/gRPC :4317\nor OTLP/HTTP :4318"| Collector["otel-collector"]
    Collector -->|"OTLP/HTTP JSON"| Bridge["otel-rmq-bridge :8002"]
    Bridge -->|"fanout: otel.traces"| RMQ["RabbitMQ"]
    RMQ --> CH["clickhouse-consumer"]
    RMQ -.->|"future"| SSE["sse-consumer"]
    CH --> ClickHouse[("ClickHouse :8123\notel.gen_ai_spans")]
```

> **Note:** `encoding: json` and `compression: none` are required in the OTel Collector config — the collector defaults to protobuf binary which the bridge cannot parse.

## Docker Startup Order

```mermaid
flowchart TD
    PG["postgres\n(healthy)"]
    Migrate["db-migrate\nruns alembic upgrade head\nthen exits"]
    Backend["ai-system-registry-backend\n(healthy)"]
    Frontend["ai-system-registry-frontend\n(service_started)"]
    Shell["shell :8080"]
    RMQ["rabbitmq\n(healthy)"]
    Bridge["otel-rmq-bridge\n(healthy)"]
    Collector["otel-collector"]
    CH["clickhouse\n(healthy)"]
    CHConsumer["otel-clickhouse-consumer"]

    PG --> Migrate
    Migrate --> Backend
    Migrate --> Frontend
    Backend --> Shell
    Frontend --> Shell

    RMQ --> Bridge
    Bridge --> Collector

    CH --> CHConsumer
    RMQ --> CHConsumer
```

`db-migrate` is a one-shot container built from `libs/persistence/Dockerfile`. It owns all migrations — backends never run migrations, they just start the API server.

**If db-migrate fails:** check logs with `docker compose logs db-migrate`. Common causes: postgres not ready (retry `docker compose up db-migrate`), or a bad migration file. Fix the migration, then re-run with `docker compose up --build db-migrate`. The backend will not start until db-migrate exits successfully.
