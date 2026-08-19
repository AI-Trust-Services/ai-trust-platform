-- 0004: drop the redundant tenant_id column from telemetry tables.
-- Physical isolation is provided by database-per-tenant (tenant_<org> databases) plus the
-- per-tenant ClickHouse clients (get_client_for_tenant) and per-tenant write routing in the
-- consumer. The tenant_id column added in the old 0003 migration was a redundant in-row filter
-- on top of that isolation and is removed here. migrate.py rewrites the 'otel.' prefix to the
-- target database (tenant_<org> or otel), so this runs once per tenant database.
ALTER TABLE otel.gen_ai_spans DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE otel.alert_events DROP COLUMN IF EXISTS tenant_id;
