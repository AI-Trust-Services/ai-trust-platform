# overview/ (port 8004, `/api/overview/`)
Compliance-posture MFE, reads Postgres only. The frontend is a React/Vite MFE (the per-user **Landing Zone** at route `overview`, `views/Landing.tsx`); it renders an owner view or a compliance-officer view (`ComplianceLanding`) depending on the caller's OpenFGA roles from `GET /api/users/v1/me`.
- `GET /api/overview/v1/stats?lifecycle=` — KPI counts, tier distribution, compliance data, recent registrations. Dashboard layout persists to `localStorage` (`ai_trust_overview_dashboard_v1`).
- `GET /api/overview/v1/recent-systems?limit=` — the N most recently registered AI systems org-wide (`limit` 1–20, default 5), ordered by `created_at desc`. Powers the compliance-officer landing's "Recent AI Systems" row (id, name, version, tier, workflow_status, Art. 50 flags, created_at).

The landing also calls other backends directly (build-time `VITE_*_API_BASE`): registry `/me/open-tasks` + `/me/systems`, compliance `/assessments`, and users `/me` + `/me/organization-contacts` + `/users/by-role`.
