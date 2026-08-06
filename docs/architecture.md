# Architecture

## Repository Layout

```
ai-trust-platform/
├── infra/
│   └── keycloak/                 ← Keycloak provisioning
│       ├── Dockerfile            ← one-shot provision container
│       ├── init.sh               ← creates keycloak DB in PostgreSQL on first boot
│       └── provision.py          ← idempotent Admin API script (realm, client, bootstrap admin user)
├── libs/
│   ├── persistence/              ← shared Python package (models, migrations, DB session)
│   │   ├── Dockerfile            ← one-shot migration container
│   │   ├── pyproject.toml        ← pip installable as ai-trust-persistence
│   │   ├── alembic.ini           ← migration config, reads DATABASE_URL from env
│   │   └── ai_trust_persistence/
│   │       ├── database.py       ← engine (pool_size=5), SessionLocal, Base
│   │       ├── models/           ← all SQLAlchemy ORM models (shared across all backends)
│   │       └── migrations/       ← single Alembic setup for all tables
│   ├── clickhouse/               ← shared Python package (ClickHouse connection + schema)
│   │   ├── Dockerfile            ← one-shot migration container
│   │   ├── pyproject.toml        ← pip installable as ai-trust-clickhouse
│   │   ├── migrate.py            ← idempotent migration runner
│   │   ├── migrations/           ← versioned SQL files tracked in otel.schema_migrations
│   │   └── ai_trust_clickhouse/
│   │       ├── database.py       ← get_client() factory
│   │       └── tables.py         ← GEN_AI_SPANS table name + COLUMNS list
│   └── logging/                  ← shared structured JSON logging package
├── shell/                        ← Luigi host (nginx + luigi-config.js); reverse proxy for all MFEs and APIs
├── ai-system-registry/           ← EU AI Act registry component
│   ├── frontend/                 ← React 18 + Vite SPA (nginx, internal port 80, served at /registry/)
│   └── backend/                  ← FastAPI + SQLAlchemy async (internal port 8001, served at /api/registry/)
├── overview/                     ← Compliance overview MFE
│   ├── frontend/                 ← static HTML + Chart.js (nginx, internal port 80, served at /overview/)
│   └── backend/                  ← FastAPI (internal port 8004, served at /api/overview/), reads Postgres only
├── monitoring/                   ← Live signals MFE
│   ├── frontend/                 ← static HTML + Chart.js (nginx, internal port 80, served at /monitoring/)
│   └── backend/                  ← FastAPI (internal port 8003, served at /api/monitoring/), reads Postgres + ClickHouse
├── alerts/                       ← Alerts MFE
│   ├── frontend/                 ← React 18 + TypeScript + Vite SPA (nginx, internal port 80, served at /alerts/)
│   └── backend/                  ← FastAPI (internal port 8005, served at /api/alerts/), reads Postgres (rules) + ClickHouse (events)
├── compliance/                   ← Governance chain MFE (assessments, obligations, controls, evidence)
│   ├── frontend/                 ← React 18 + TypeScript + Vite SPA (nginx, internal port 80, served at /compliance/)
│   └── backend/                  ← FastAPI (internal port 8007, served at /api/compliance/), reads/writes Postgres + MinIO (evidence files)
├── policy-checker-worker/                 ← Background job, evaluates alert rules every N seconds
│   └── main.py                   ← reads Postgres rules, writes ClickHouse events
├── otel-pipeline/                ← GenAI observability pipeline
│   ├── collector/                ← OTel Collector config
│   │   └── otel-collector-config.yaml
│   ├── clickhouse-config/        ← ClickHouse server config overrides (mounted read-only)
│   │   └── config.d/
│   │       ├── storage.xml       ← S3 disk (MinIO) + tiered storage policy definition
│   │       └── listen.xml        ← binds ClickHouse HTTP to 0.0.0.0 (required for Docker networking)
│   └── rmq-bridge/               ← FastAPI OTLP→RabbitMQ bridge (port 8002)
│       └── app/main.py
├── consumers/                    ← RabbitMQ consumers (one sub-dir per sink)
│   └── clickhouse-consumer/      ← writes GenAI spans to ClickHouse
│       └── main.py
└── docker-compose.yml            ← orchestrates all services
```

## GenAI Observability Data Flow

```mermaid
flowchart TD
    subgraph External["External (outside ai-trust-platform)"]
        direction LR
        App1["AI Application"]
        App2["AI Agent"]
        App3["..."]
    end

    subgraph AiTrust["ai-trust-platform"]
        direction TB

        subgraph Pipeline["Ingestion Pipeline"]
            direction LR
            Collector["OTel Collector"]
            Bridge["RMQ Bridge"]
            RMQ["RabbitMQ"]
            Consumer["ClickHouse Consumer"]
            Collector -->|OTLP/HTTP JSON| Bridge
            Bridge -->|fanout exchange| RMQ
            RMQ --> Consumer
        end

        subgraph Storage["Storage"]
            direction LR
            PG[("PostgreSQL\nai_systems\nmodel_cards\nalert_rules\nservice_model_baselines\nframeworks\nassessments\nobligations\ncontrols\nevidence")]
            subgraph CH["ClickHouse"]
                direction TB
                Hot[("Hot Disk\nnew data")]
                Hot -->|"age > 7 days or disk > 90%"| MinIO[("MinIO\ncold data + evidence files")]
                MinIO <-->|"read-through cache"| Cache["Local Cache\nrecently read cold parts"]
            end
        end

        subgraph Services["Services"]
            direction TB
            Registry["AI System Registry"]
            Overview["Overview"]
            Monitoring["Monitoring"]
            Alerts["Alerts"]
            Compliance["Compliance"]
            AlertWorker["Policy Checker Worker"]
        end

        Consumer -->|insert| Hot

        PG --> Registry
        PG --> Overview
        PG --> Monitoring
        PG --> Alerts
        PG --> Compliance
        PG -->|"rules + baselines"| AlertWorker

        CH --> Monitoring
        CH --> Alerts
        CH --> AlertWorker
        AlertWorker -->|writes events| CH
        Compliance -->|"evidence files"| MinIO
    end

    App1 -->|OTLP| Collector
    App2 -->|OTLP| Collector
    App3 -->|OTLP| Collector
```

> **Note:** `encoding: json` and `compression: none` are required in the OTel Collector config — the collector defaults to protobuf binary which the bridge cannot parse.

### ClickHouse Storage Tiers

ClickHouse uses a **tiered MergeTree** storage policy with three layers:

| Tier | Location | What lives here |
|---|---|---|
| Hot | Local disk (`clickhouse_data` volume) | All newly ingested data |
| Cold | MinIO S3 (`minio_data` volume) | Data older than 7 days, or when hot disk > 90% full |
| Cache | Local disk (`filesystem_cache/minio/`) | Recently read cold parts, up to 10 GB |

**Read path:** ClickHouse checks hot disk first, then local cache, then fetches from MinIO (and populates the cache). This is fully transparent — all queries use normal SQL regardless of which tier the data is on.

**Write path:** All inserts always go to hot disk. The TTL rule moves parts to MinIO in the background. The cache is never written to directly — it is populated lazily on first read of a cold part.

**Cache invalidation:** Handled automatically by ClickHouse. When a mutation (`ALTER TABLE ... UPDATE/DELETE`) rewrites a part, the cached version is invalidated and the new part is fetched from MinIO on next read. In practice this is rare — `gen_ai_spans` is write-once (spans are never mutated), and `alert_events` mutations only occur when a user handles an alert.

## Docker Startup Order

```mermaid
flowchart TD
    PG["postgres\n(healthy)"]
    Migrate["db-migrate\nruns alembic upgrade head\nthen exits"]
    Backend["ai-system-registry-backend\n(healthy)"]
    Frontend["ai-system-registry-frontend\n(service_started)"]
    MonBackend["monitoring-backend\n(healthy)"]
    MonFrontend["monitoring-frontend\n(service_started)"]
    OvBackend["overview-backend\n(healthy)"]
    OvFrontend["overview-frontend\n(service_started)"]
    AlertBackend["alerts-backend\n(healthy)"]
    AlertFrontend["alerts-frontend\n(service_started)"]
    AlertWorker["policy-checker-worker\n(restart: on-failure)"]
    CompBackend["compliance-backend\n(healthy)"]
    CompFrontend["compliance-frontend\n(service_started)"]
    DTABackend["decision-trace-analyzer-backend\n(healthy)"]
    DTAFrontend["decision-trace-analyzer-frontend\n(service_started)"]
    KC["keycloak :8180\n(healthy)"]
    KCProv["keycloak-provision\ncreates realm, client, bootstrap admin\nthen exits"]
    OP["oauth2-proxy :8080\nsingle entry point"]
    Shell["shell\n(nginx reverse proxy)"]
    RMQ["rabbitmq\n(healthy)"]
    Bridge["otel-rmq-bridge\n(healthy)"]
    Collector["otel-collector"]
    MinIO["minio :9000\n(healthy)"]
    MinIOInit["minio-init\ncreates clickhouse + evidence-files buckets\nthen exits"]
    CH["clickhouse\n(healthy)"]
    CHMigrate["clickhouse-migrate\nruns migrate.py\nthen exits"]
    CHConsumer["otel-clickhouse-consumer"]

    PG --> Migrate
    PG --> KC
    KC --> KCProv
    KCProv --> OP
    Migrate --> Backend
    Migrate --> Frontend
    Migrate --> MonBackend
    Migrate --> OvBackend
    Migrate --> AlertBackend
    Migrate --> AlertWorker
    Migrate --> CompBackend
    MinIO --> MinIOInit
    MinIOInit --> CH
    MinIOInit --> CompBackend
    CH --> MonBackend
    CH --> AlertBackend
    CH --> AlertWorker
    CHMigrate --> AlertWorker
    CHMigrate --> AlertBackend
    CHMigrate --> DTABackend
    Backend --> Shell
    Frontend --> Shell
    MonBackend --> Shell
    MonFrontend --> Shell
    OvBackend --> Shell
    OvFrontend --> Shell
    CompBackend --> Shell
    CompFrontend --> Shell
    AlertFrontend --> Shell
    DTABackend --> Shell
    DTAFrontend --> Shell
    Shell --> OP

    RMQ --> Bridge
    Bridge --> Collector

    CH --> CHMigrate
    CHMigrate --> CHConsumer
    RMQ --> CHConsumer
```

`db-migrate` is a one-shot container built from `libs/persistence/Dockerfile`. It owns all Postgres migrations — backends never run migrations, they just start the API server.

`clickhouse-migrate` is a one-shot container built from `libs/clickhouse/Dockerfile`. It owns all ClickHouse schema migrations — consumers never run migrations.

`minio-init` is a one-shot container that creates the `clickhouse` and `evidence-files` buckets in MinIO on first startup. ClickHouse depends on it completing before it starts, ensuring the bucket exists before any data part moves to cold storage.

`keycloak-provision` is a one-shot container built from `infra/keycloak/Dockerfile`. It uses the Keycloak Admin REST API to idempotently configure the `ai-trust` realm, the `oauth2-proxy` OIDC client, and the bootstrap admin user (credentials from `APP_ADMIN_USERNAME` / `APP_ADMIN_PASSWORD`). oauth2-proxy depends on it completing successfully before starting.

**If db-migrate fails:** check logs with `docker compose logs db-migrate`. Common causes: postgres not ready (retry `docker compose up db-migrate`), or a bad migration file. Fix the migration, then re-run with `docker compose up --build db-migrate`. The backend will not start until db-migrate exits successfully.

**If clickhouse-migrate fails:** check logs with `docker compose logs clickhouse-migrate`. Common causes: clickhouse not ready (retry `docker compose up clickhouse-migrate`), or a bad SQL file. Fix the migration, then re-run with `docker compose up --build clickhouse-migrate`. The consumer will not start until clickhouse-migrate exits successfully.

**If minio-init fails:** check logs with `docker compose logs minio-init`. Most likely cause: MinIO not ready yet. Retry with `docker compose up minio-init`. ClickHouse will not start until minio-init exits successfully.
