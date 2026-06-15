# Consumers

RabbitMQ consumers for the [OTel Pipeline](../otel-pipeline/) pipeline. Each consumer binds a durable queue to the `otel.traces` fanout exchange and processes GenAI span messages independently.

Messages are queued while a consumer is down and processed on reconnect — no spans are lost during restarts.

## Consumers

| Consumer | Sink | Description |
|---|---|---|
| [clickhouse-consumer](clickhouse-consumer/) | ClickHouse `otel.gen_ai_spans` | Parses OTLP JSON, filters spans with `gen_ai.operation.name`, batch-inserts into ClickHouse. Uses `ai_trust_clickhouse` for connection and schema constants |

## How it works

```
RabbitMQ fanout exchange: otel.traces
        │
        ├── queue: clickhouse-consumer  →  ClickHouse
        └── queue: sse-consumer (future) →  SSE stream
```

Each consumer:
1. Connects to RabbitMQ and declares its own named durable queue
2. Binds the queue to the `otel.traces` fanout exchange
3. Processes messages — failures are logged, message is still acked to avoid poison-pill loops

## Adding a new consumer

Use the `/add-consumer` skill in Claude Code, or follow the pattern manually:

1. Create `consumers/<name>-consumer/main.py` — `asyncio.run(main())` entrypoint, no HTTP port
2. Declare a durable queue with a unique name and bind it to `otel.traces`
3. Add `Dockerfile`, `entrypoint.sh`, `requirements.txt`
4. Add the service to root `docker-compose.yml` with `depends_on: rabbitmq + clickhouse`

## Environment variables

| Variable | Description |
|---|---|
| `RABBITMQ_URL` | `amqp://user:pass@host:5672/` |
| `CLICKHOUSE_HOST` | ClickHouse hostname |
| `CLICKHOUSE_PORT` | ClickHouse HTTP port (default `8123`) |
| `CLICKHOUSE_USER` | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | ClickHouse password |

All variables are required — the consumer exits immediately if any are missing.
