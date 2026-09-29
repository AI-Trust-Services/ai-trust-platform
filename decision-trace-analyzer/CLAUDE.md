# decision-trace-analyzer/ (port 8006, `/api/dta/`)
Trace viewer for GenAI spans, reads ClickHouse only.
- `GET /api/v1/traces` — groups spans by `trace_id`, paginated. Dev: `vite.config.ts` proxies `/api/*` → `http://localhost:8006`. Prod: nginx proxies `/api/` → `decision-trace-analyzer-backend:8006`.
