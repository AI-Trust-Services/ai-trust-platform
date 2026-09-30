# otel-pipeline/
Receives OTLP from any app, routes through RabbitMQ, stores in ClickHouse.
- **`collector/otel-collector-config.yaml`** — receives OTLP gRPC/HTTP, exports to rmq-bridge as OTLP/HTTP JSON. `encoding: json` and `compression: none` are required (the collector defaults to protobuf binary, which the bridge can't parse).
- **`rmq-bridge/`** — FastAPI; `POST /v1/traces` publishes raw OTLP JSON to the RabbitMQ fanout exchange `otel.traces` (no parsing/filtering — that's the consumer's job). Reads `RABBITMQ_URL` (fail-fast).
- **ClickHouse schema** — managed by `clickhouse-migrate` (migrations in `libs/clickhouse/migrations/`, tracked in `otel.schema_migrations`).

**Connecting an external app** — point it at the host collector: `OTEL_EXPORTER_OTLP_ENDPOINT=http://<host-ip>:4317` (gRPC) or `:4318` (HTTP). To capture prompt/response content (off by default for privacy), set `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` **on the instrumented app**. When false, `input_messages`/`output_messages` are empty strings.
