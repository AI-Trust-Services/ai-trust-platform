# overview/ (port 8004, `/api/overview/`)
Compliance-posture MFE, reads Postgres only, static HTML frontend.
- `GET /api/overview/v1/stats?lifecycle=` — KPI counts, tier distribution, compliance data, recent registrations. Dashboard layout persists to `localStorage` (`ai_trust_overview_dashboard_v1`).
