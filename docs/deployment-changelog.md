# Deployment Changelog

This document tracks implementations, their Docker images, and deployment status to the Gardener K8s cluster (`aitrust-msp` namespace).

## Quick Reference: Current Deployed Images

| Component | Docker Image | K8s Deployed |
|-----------|--------------|--------------|
| shell | `martinkorn50245/aitrust-shell:v20260828-1113` | ✅ Yes |
| ai-system-registry-frontend | `martinkorn50245/aitrust-ai-system-registry-frontend:v20260828-1113` | ✅ Yes |
| admin-frontend | `martinkorn50245/aitrust-admin-frontend:v20260828-1113` | ✅ Yes |
| compliance-frontend | `martinkorn50245/aitrust-compliance-frontend:v20260828-1113` | ✅ Yes |
| monitoring-frontend | `martinkorn50245/aitrust-monitoring-frontend:v20260828-1113` | ✅ Yes |
| alerts-frontend | `martinkorn50245/aitrust-alerts-frontend:v20260828-1113` | ✅ Yes |
| users-frontend | `martinkorn50245/aitrust-users-frontend:v20260828-1113` | ✅ Yes |
| ai-system-registry-backend | `martinkorn50245/aitrust-ai-system-registry-backend:v20260827` | ✅ Yes |
| db-migrate | `martinkorn50245/aitrust-db-migrate:v3` | ✅ Yes (job) |
| users-backend | `martinkorn50245/aitrust-users-backend:latest` | ✅ Yes |

---

## Changelog

### 2026-08-28

#### Dark Theme Support (All MFEs)
**Shell Image:** `martinkorn50245/aitrust-shell:v20260828-1113`
**Frontend Images:** All frontends tagged `v20260828-1113`
**K8s Deployed:** ✅ Yes

**Dark Mode Implementation:**
- Shell broadcasts theme changes to MFE iframes via Luigi custom messages
- All MFEs now sync with shell theme toggle
- Consistent dark palette across all views:
  - Background: `#0f172a`, Cards: `#1e293b`, Text: `#f1f5f9`
  - Primary accent: `#3b82f6` (blue-500)
  - Semantic colors adjusted for dark backgrounds

**Files modified:**
- `shell/public/luigi-config.js` — `applyShellTheme()` broadcasts `theme-changed` message
- All MFE `hooks/useLuigi.ts` — Added `useLuigiThemeSync()` hook
- All MFE `App.tsx` — Call `useLuigiThemeSync()` on mount
- All MFE `index.css` — Added `html.dark {}` CSS variable overrides

**Components affected:**
- shell, ai-system-registry-frontend, admin-frontend
- compliance-frontend, monitoring-frontend, alerts-frontend, users-frontend

---

### 2026-08-27

#### AI System Registry - Embedded Compliance & System Features
**Frontend Image:** `martinkorn50245/aitrust-ai-system-registry-frontend:v20260827`
**Backend Image:** `martinkorn50245/aitrust-ai-system-registry-backend:v20260827`
**K8s Deployed:** ✅ Yes

**Embedded Compliance Tabs (SystemWorkspace):**
- Assessments tab — KPI cards, filterable table, detail panel with obligations
- Obligations tab — status badges, inline status change
- Controls tab — category filters, implementation status
- Evidence tab — file list with download URLs, status management
- All tabs call compliance API directly (`/api/compliance/v1/*`)
- Cross-MFE navigation via LuigiClient.linkManager().navigate()

**Model Picker Modal:**
- Dialog for selecting/linking models to systems
- Search and selection from registered models
- Component: `ModelPickerModal.tsx`

**Activity Tab:**
- Timeline view from workflow history
- Step types: created, submitted, approved, rejected, updated
- Relative timestamps with hover for full date
- System timestamps card

**Notes Tab:**
- Full CRUD for system-specific notes
- Inline editing with save/cancel
- Author attribution and timestamps
- Backend: `system_notes` table + router at `/api/registry/v1/systems/{id}/notes`

**Review Mode Fixes:**
- Fixed button overlap when panel is open (button moves left)
- Auto-refresh on mode toggle

**Database:**
- Migration `0014_system_notes.py` — creates `system_notes` table with FK to `ai_systems`
- Migration image: `martinkorn50245/aitrust-db-migrate:v3`

**Files added/modified:**
- `components/compliance/AssessmentsTab.tsx`, `ObligationsTab.tsx`, `ControlsTab.tsx`, `EvidenceTab.tsx`
- `components/ModelPickerModal.tsx`, `ActivityTab.tsx`, `NotesTab.tsx`
- `utils/compliance.ts` — status metadata and helpers
- `api/client.ts` — compliance API methods, systemNotes API methods
- `types/index.ts` — Assessment, Obligation, Control, Evidence, SystemNote types
- `hooks/useLuigi.ts` — added navigateToPath()
- Backend: `routers/system_notes.py`, `schemas/system_note.py`
- Model: `libs/persistence/.../models/system_note.py`

---

### 2026-08-26 (Evening)

#### AI System Registry Frontend - Review Mode Feature
**Image:** `martinkorn50245/aitrust-ai-system-registry-frontend:review-mode-v2`
**K8s Deployed:** ✅ Yes

**Hidden Review Notes Feature:**
- Command palette (Ctrl+K) with "Enable Review Mode" option
- Floating review panel (bottom-right) when review mode is active
- Per-page note collection with status management (pending/confirmed/rejected/done)
- CSV export with page context and timestamp
- Backend API at `/api/registry/v1/review-notes` (CRUD + export)
- Database table `review_notes` with migration `0013_review_notes.py`
- Frontend components: `CommandMenu.tsx`, `ReviewPanel.tsx`, `useReviewMode.tsx`
- Uses `cmdk` library for command palette

**Build Fix:**
- Added `MSYS_NO_PATHCONV=1` to prevent Git Bash from converting `/api/registry/v1` to `C:/Program Files/Git/api/registry/v1`
- Build args: `VITE_REGISTRY_API_BASE=/api/registry/v1`, `VITE_USERS_API_BASE=/api/users/v1`

**Deployment Note:**
- Requires Git Bash (not PowerShell) for kubectl with gardenlogin plugin
- `kubectl-gardenlogin` must be in PATH for OIDC authentication

### 2026-08-26

#### Shell Updates
**Image:** `martinkorn50245/aitrust-shell:v20260826-latest`
**K8s Deployed:** ✅ Yes

- Command bar updates in header
- nginx proxy configuration for all MFE routes and backend APIs

#### AI System Registry Frontend
**Image:** `martinkorn50245/aitrust-ai-system-registry-frontend:v20260826-latest`
**K8s Deployed:** ✅ Yes

**Context-Aware System Actions:**
- Replaced static "Edit system" button with dynamic contextual primary action
- New `getPrimarySystemAction()` resolver in `src/utils/systemActions.ts`
- Actions change based on lifecycle stage, workflow status, and user role:
  - `draft` → "Continue registration" (owner only)
  - `pending_review` → "Continue technical review" (assignee only)
  - `high/gpai-systemic` tier in comply stage → "Continue assessment"
  - `market/post-market` approved → "Start change"
  - Default → "View details"

**Dedicated Tasks View:**
- New route `/systems/:systemId/tasks` with `SystemTasks.tsx`
- Tabs: All, Needs me, In progress, Waiting, Completed
- URL params support: `?assignee=me` filters to user's tasks
- Summary cards with task counts

**Task Navigation Updates:**
- "View my tasks" → "Open my tasks" (navigates to `/systems/:id/tasks?assignee=me`)
- "View all tasks" → "View all system tasks" (navigates to `/systems/:id/tasks`)
- Removed scroll-to-card behavior, replaced with proper navigation

**Shared Task Utilities:**
- New `src/utils/taskUtils.ts` with:
  - `deriveTasksFromSystem()` - derives tasks from system state
  - `getMyTasks()` - filters tasks assigned to current user
  - `getTotalTaskCount()` - returns total open tasks count
- Reused across StatusBanner, SystemTasks, Today views

**Owner Display Fixes:**
- Added `owner_username: string | null` to AISystem interface in `src/types/index.ts`
- Removed redundant "Application Owner" labels from Systems.tsx and SystemWorkspace.tsx
- Owner now displays just the username

**Type Additions (`src/types/index.ts`):**
- `SystemAction` interface for contextual actions
- `SystemTask` interface for task items
- `TaskStatus` and `TaskPriority` types

#### AI System Registry Backend
**Image:** `martinkorn50245/aitrust-ai-system-registry-backend:latest`
**K8s Deployed:** ✅ Yes (with manual env var patches)

**Schema Updates:**
- Added `owner_username: str | None` to `AISystemResponse` in `app/schemas/ai_system.py`

**K8s Environment Variables (patched manually):**
- `LLM_PROVIDER=external`
- `AI_AUTH_URL=https://sen-aicore-eu10-wewpowaz.authentication.sap.hana.ondemand.com/oauth/token`
- `AI_CLIENT_ID`, `AI_CLIENT_SECRET`, `AI_API_URL`, `AI_DEPLOYMENT_ID`, `AI_RESOURCE_GROUP` from `sap-ai-core-credentials` secret
- `OPENFGA_URL=http://openfga.platform-mesh-system.svc.cluster.local:8080`
- `OPENFGA_STORE_ID=01M05KV6EW8FHPF3VNM2W7RJAX`
- `OPENFGA_MODEL_ID=01M05KV6F4R5JDTYWWH6C4R0X3`

#### Database Migrations
**Image:** `martinkorn50245/aitrust-db-migrate:v2`
**K8s Deployed:** ✅ Yes

**Migrations applied:**
- `0010_ai_assisted_fields.py` - AI-assisted registration fields
- `0011_field_confirmations.py` - Added `field_confirmations` JSONB column to `ai_systems`
- `0012_owner_username.py` - Added `owner_username` column to `ai_systems`

**Note:** Migration 0011 was applied directly via SQL due to alembic driver issues:
```sql
ALTER TABLE ai_systems ADD COLUMN IF NOT EXISTS field_confirmations JSONB;
```

#### Keycloak Configuration (martin realm)
**K8s Applied:** ✅ Yes

- Created `users-backend` client in `martin` realm
- Assigned `view-users`, `manage-users`, `query-users` roles to service account
- Client secret: `change-me-users-backend-secret` (matches `app-secrets`)

---

### 2026-08-25

#### AI System Registry Frontend
**Image:** `martinkorn50245/aitrust-ai-system-registry-frontend:standalone-v4`
**K8s Deployed:** ⚠️ Superseded by v20260826-latest

- Standalone frontend deployment (no Luigi shell)
- ShadCN UI components integration
- Today view with work summary
- MyWork view
- SystemWorkspace with tabs (Overview, Details, Tasks, Compliance, Monitoring)

#### Shell
**Image:** `martinkorn50245/aitrust-shell:v20260825-2346`
**K8s Deployed:** ⚠️ Superseded by v20260826-latest

- Luigi shell integration
- nginx reverse proxy for all MFEs and backends

---

## K8s Deployment Notes

### Namespace
`aitrust-msp`

### Kubeconfig
```bash
export KUBECONFIG="$HOME/.garden/kubeconfig-shoot-ai-trust-1.yaml"
```

### Common Commands
```bash
# Update frontend image
kubectl set image deployment/ai-system-registry-frontend -n aitrust-msp \
  ai-system-registry-frontend=martinkorn50245/aitrust-ai-system-registry-frontend:<tag>

# Update shell image
kubectl set image deployment/shell -n aitrust-msp \
  shell=martinkorn50245/aitrust-shell:<tag>

# Update backend image
kubectl set image deployment/ai-system-registry-backend -n aitrust-msp \
  ai-system-registry-backend=martinkorn50245/aitrust-ai-system-registry-backend:<tag>

# Check rollout status
kubectl rollout status deployment/<name> -n aitrust-msp

# Check logs
kubectl logs -n aitrust-msp -l app=<app-name> --tail=50
```

### Secrets
| Secret | Keys |
|--------|------|
| `app-secrets` | DATABASE_URL, USERS_BACKEND_CLIENT_SECRET, etc. |
| `sap-ai-core-credentials` | SAP_AI_CORE_CLIENT_ID, SAP_AI_CORE_CLIENT_SECRET, SAP_AI_CORE_AUTH_URL, SAP_AI_CORE_API_URL, SAP_AI_CORE_DEPLOYMENT_ID, SAP_AI_CORE_RESOURCE_GROUP |

### Test Users (martin realm)
| Username | Role | Password |
|----------|------|----------|
| thomas | application_owner | Welcome!1 |
| lena@host.com | ai_engineer | Welcome!1 |
| sarah@host.com | ai_compliance_officer | Welcome!1 |
| admin@local.dev | platform_administrator | Welcome!1 |
| martin.korn@sap.com | platform_administrator | Welcome!1 |

---

## Pending / Not Yet Deployed

_Items implemented locally but not yet in K8s:_

(none currently)

---

## Known Issues & Workarounds

1. **DB Migrations**: Alembic with `postgresql+asyncpg://` driver doesn't work in the migration job. Workaround: apply migrations directly via `kubectl exec` into postgres.

2. **SAP AI Core Auth URL**: Must include `/oauth/token` path - the base URL alone returns 302 redirect.

3. **OpenFGA Env Vars**: When patching backend deployments, ensure OPENFGA_URL, OPENFGA_STORE_ID, and OPENFGA_MODEL_ID are included or permissions will fail with 403.

4. **Browser Cache**: After frontend updates, users may need hard refresh (Ctrl+Shift+R) to see changes.
