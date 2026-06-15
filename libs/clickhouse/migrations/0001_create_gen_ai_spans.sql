CREATE DATABASE IF NOT EXISTS otel;

CREATE TABLE IF NOT EXISTS otel.gen_ai_spans
(
    received_at     DateTime     DEFAULT now(),
    started_at      DateTime,
    trace_id        String,
    span_id         String,
    service_name    String,
    gen_ai_system   String,
    operation_name  String,
    request_model   String,
    response_model  String,
    finish_reasons  String,
    input_tokens    UInt32,
    output_tokens   UInt32,
    max_tokens      UInt32,
    duration_ms     Float64,
    input_messages  String,
    output_messages String
) ENGINE = MergeTree()
ORDER BY (received_at, service_name, request_model);
