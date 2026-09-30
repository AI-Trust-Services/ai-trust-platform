# consumers/
One sub-directory per RabbitMQ consumer — standalone Python worker (no FastAPI, `asyncio.run(main())`, no HTTP port). Each binds a named durable queue to the `otel.traces` fanout exchange, so messages queue while a consumer is down. To add one, use the `/add-consumer` skill.

**`clickhouse-consumer/`** — parses OTLP JSON, skips spans without `gen_ai.operation.name`, batch-inserts into `otel.gen_ai_spans`. Hybrid batching: flush at `BATCH_SIZE` rows (default 100) or `BATCH_TIMEOUT` seconds (default 5). On ClickHouse failure retries 3× (1s/2s/4s backoff) then acks and drops the batch. Flushes on shutdown. Reads `RABBITMQ_URL`, `CLICKHOUSE_*` (fail-fast).
