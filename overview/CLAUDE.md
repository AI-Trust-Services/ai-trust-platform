# overview/ (port 8004, `/api/overview/`)
Compliance-posture MFE, reads Postgres only. The frontend is a React/Vite MFE (the per-user **Landing Zone** at route `overview`, `views/Landing.tsx`); it renders an owner view or a compliance-officer view (`ComplianceLanding`) depending on the caller's OpenFGA roles from `GET /api/users/v1/me`.
- `GET /api/overview/v1/stats?lifecycle=` — KPI counts, tier distribution, compliance data, recent registrations. Dashboard layout persists to `localStorage` (`ai_trust_overview_dashboard_v1`).
- `GET /api/overview/v1/recent-systems?limit=` — the N most recently registered AI systems org-wide (`limit` 1–20, default 5), ordered by `created_at desc`. Powers the compliance-officer landing's "Recent AI Systems" row (id, name, version, tier, workflow_status, Art. 50 flags, created_at).

The landing also calls other backends directly (build-time `VITE_*_API_BASE`): registry `/me/open-tasks` + `/me/systems`, compliance `/assessments`, and users `/me` + `/me/organization-contacts` + `/users/by-role`.

## Routes (HashRouter, `src/index.tsx`)
The overview MFE serves **two** nav-accessible pages from one bundle; each Luigi nav node points at a different hash route (same pattern as compliance's `#/assessments`, `#/obligations`, …):
- `#/overview` → `views/Landing.tsx` — the Landing Zone (owner / CO variants). Nav node `overview`.
- `#/tasks` → `views/TaskView.tsx` — **Task View** (issue #276): a standalone page listing the current user's open questionnaire tasks, grouped per AI system, with AI-system / Owner multi-select filters, a Refresh (reset-filters) control and a sortable assign date. Scope: the `required` + `assigned` sources of `/me/open-tasks` (CO `review` rows are excluded — those live in the CO landing's "Ready for review" queue). Reuses `AssessmentStageCell` / `InitialsAvatar` and the landing's `/me/open-tasks` endpoint; stages come from the compliance `/assessments` fetch, which is resilient (a failed load shows an inline notice rather than blanking the list). Nav node `task-view`, both gated on `systems:read` in `shell/public/luigi-config.js`.

