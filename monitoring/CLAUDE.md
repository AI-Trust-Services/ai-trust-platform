# monitoring/ (port 8003, `/api/monitoring/`)
Live signals from ClickHouse + registry analytics from Postgres.
- `GET /v1/services` — distinct services + models. `GET /v1/signals?service=&window=1h` — time-series count/latency/tokens (`window` ∈ `15m`,`1h`,`6h`,`24h`). `GET /v1/stats?lifecycle=` — Postgres analytics.
- All ClickHouse queries use `clickhouse-connect` **parameterized queries** (`{param:Type}`) — never f-string interpolation. `window`/`interval` come from a server-side allowlist.
- Live Signals polls every 30s; filters persist to `localStorage` (`ai_trust_monitoring_filters_v1`), analytics layout to `ai_trust_dashboard_v4`.
