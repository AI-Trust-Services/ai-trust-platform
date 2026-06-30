ALTER TABLE otel.alert_events ADD COLUMN IF NOT EXISTS entity_id    String DEFAULT '';
ALTER TABLE otel.alert_events ADD COLUMN IF NOT EXISTS entity_type  String DEFAULT '';
ALTER TABLE otel.alert_events ADD COLUMN IF NOT EXISTS entity_model String DEFAULT '';
