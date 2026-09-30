# alerts/ (port 8005, `/api/alerts/`)

Rule-based alerting. Rules in Postgres, events in ClickHouse.
- `GET /v1/active` (unresolved/unhandled) · `GET /v1/history` · `GET /v1/rules` (incl. `parameters`, `is_custom`) · `GET /v1/count` (bell badge).
- `POST /v1/events/{id}/handle` (sets `handled_at` + `resolved_at`) · `/approve-model` (marks handled + updates `service_model_baselines`; body `{service_name, new_model}`) · `/reject-model` (marks handled, baseline unchanged) · `POST /v1/rules/{id}/toggle`.

**policy-checker-worker/** — standalone background job (no HTTP port). Evaluates enabled rules every `ALERT_POLL_INTERVAL`s (10s dev, 60s+ prod) against Postgres + ClickHouse; creates events in `otel.alert_events`, auto-resolves threshold events when conditions clear. Event-type alerts suppressed 24h after handling (except `model_diverged`). Evaluators return `tuple[bool, float]` (aggregate) or `list[EvalResult]` (entity-scoped, one event per entity).

Seeded rules: `prohibited_exists`, `avg_compliance_below`, `high_risk_on_market_low_compliance`, `no_signals`, `high_latency`, `market_system_no_model_card`, `gpai_no_compliance`, `model_diverged`.

**Model divergence (`model_diverged`)** — detects a service switching models via a persistent baseline in `service_model_baselines` (Postgres), not a sliding window. First span → stores baseline, no alert. Later spans → compares `argMax(request_model, received_at)` against the baseline; if different, fires "Model changed for {service}: {old} → {new}". Baseline updates only on explicit human approve; rejecting leaves it unchanged and the alert re-fires every 24h until approved or the service reverts.
