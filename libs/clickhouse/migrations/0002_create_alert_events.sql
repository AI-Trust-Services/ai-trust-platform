CREATE TABLE IF NOT EXISTS otel.alert_events
(
    id              String,
    rule_id         String,
    rule_name       String,
    category        String,
    severity        String,
    alert_type      String,
    description     String,
    value_at_trigger Float64,
    triggered_at    DateTime DEFAULT now(),
    resolved_at     Nullable(DateTime),
    handled_at      Nullable(DateTime)
) ENGINE = MergeTree()
ORDER BY (triggered_at, category, rule_id);
