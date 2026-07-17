CREATE DATABASE IF NOT EXISTS otel;

CREATE TABLE IF NOT EXISTS otel.gen_ai_spans
(
    received_at      DateTime        DEFAULT now(),
    started_at       DateTime64(9),
    trace_id         String,
    span_id          String,
    parent_span_id   String,
    span_name        String,
    span_kind        UInt8,
    status_code      UInt8,
    status_message   String,
    service_name     String,
    gen_ai_system    String,
    operation_name   String,
    request_model    String,
    response_model   String,
    finish_reasons   String,
    input_tokens     UInt32,
    output_tokens    UInt32,
    max_tokens       UInt32,
    duration_ms      Float64,
    input_messages   String,
    output_messages  String,
    attributes       Map(String, String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(received_at)
ORDER BY (received_at, service_name, request_model)
TTL received_at + INTERVAL 7 DAY TO DISK 'minio'
SETTINGS storage_policy = 'tiered';
