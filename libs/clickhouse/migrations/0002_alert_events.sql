CREATE TABLE IF NOT EXISTS otel.alert_events
(
    id               String,
    rule_id          String,
    rule_name        String,
    category         String,
    severity         String,
    alert_type       String,
    description      String,
    value_at_trigger Float64,
    entity_id        String  DEFAULT '',
    entity_type      String  DEFAULT '',
    entity_model     String  DEFAULT '',
    triggered_at     DateTime DEFAULT now(),
    resolved_at      Nullable(DateTime),
    handled_at       Nullable(DateTime)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(triggered_at)
ORDER BY (triggered_at, category, rule_id)
TTL triggered_at + INTERVAL 7 DAY TO DISK 'minio'
SETTINGS storage_policy = 'tiered';
