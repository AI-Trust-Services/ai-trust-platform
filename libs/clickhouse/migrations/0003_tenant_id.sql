-- 0003: add tenant_id for multi-tenant isolation of telemetry (SEC-C3).
-- ClickHouse ALTER ADD COLUMN appends the column at the END of the on-disk layout, so
-- tenant_id is listed LAST in ai_trust_clickhouse/tables.py COLUMNS and in the consumer
-- row dict. DEFAULT '' keeps pre-existing rows readable as "unscoped/legacy" (empty tenant);
-- new writes carry the real tenant id. Reads filter `AND tenant_id = {tenant:String}` so a
-- tenant never sees another tenant's spans/alerts (legacy '' rows are visible to none in
-- jwt mode — a deliberate, fail-closed choice for pre-migration telemetry).
ALTER TABLE otel.gen_ai_spans   ADD COLUMN IF NOT EXISTS tenant_id String DEFAULT '';
ALTER TABLE otel.alert_events   ADD COLUMN IF NOT EXISTS tenant_id String DEFAULT '';
