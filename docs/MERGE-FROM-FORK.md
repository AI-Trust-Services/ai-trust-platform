# Merge Documentation: UI Navigation Refactoring

This document describes the changes merged from the `ai-trust-platform-poc-fork` repository into the `martin/ui-navigation-refactoring` branch on August 28, 2026.

## Overview

This merge brings a complete UI redesign with task-driven navigation, a new Platform Administration portal, dark theme support, and several new features while preserving GitHub main's multi-tenancy architecture and model card N:M relationships.

**Total files changed:** 63  
**New files added:** ~45  
**Files modified:** ~35  
**Files deleted:** 7 (useTheme.ts files replaced by shell-based theme sync)

---

## Major Features Added

### 1. Task-Driven Navigation

The application now uses a task-driven navigation model instead of traditional tab-based navigation.

**New Views:**
- `Today.tsx` — Daily work summary with pending tasks and recent activity
- `MyWork.tsx` — Personal task queue with filtering by status
- `SystemWorkspace.tsx` — Unified system detail view with embedded tabs
- `SystemTasks.tsx` — System-specific task management

**Location:** `ai-system-registry/frontend/src/views/`

### 2. Platform Administration Portal

New MFE for platform administrators to manage settings without accessing AI systems.

**Components:**
- Dashboard with KPIs (users, roles, AI providers, mail status)
- AI Providers configuration page
- Mail Service (SMTP) configuration page
- General platform settings

**Location:** `admin/frontend/`

**Docker:** Added `admin-frontend` service in `docker-compose.yml`

### 3. Embedded Compliance Tabs

Compliance information now embedded directly in the System Workspace instead of requiring navigation to the separate Compliance MFE.

**Components:**
- `AssessmentsTab.tsx` — KPI cards, filterable assessment table
- `ObligationsTab.tsx` — Obligation status management
- `ControlsTab.tsx` — Control implementation tracking
- `EvidenceTab.tsx` — Evidence files with download URLs

**Location:** `ai-system-registry/frontend/src/components/compliance/`

### 4. Dark Theme Support

Shell-controlled dark theme that syncs instantly across all MFEs via Luigi custom messages.

**Implementation:**
- Shell broadcasts theme changes via `Luigi.customMessages().sendToAll()`
- MFEs listen via `useLuigiThemeSync()` hook in `useLuigi.ts`
- CSS custom properties with `html.dark` selector

**Files Modified:**
- `shell/public/luigi-config.js` — Theme toggle and broadcast
- All MFE `index.css` — Dark theme CSS variables
- All MFE `useLuigi.ts` — Theme sync hook

**Deleted:** `useTheme.ts` files (7 files) — replaced by shell-based sync

### 5. Review Mode (POC Feedback Collection)

Hidden feature for collecting feedback during demos, activated via Ctrl+K command palette.

**Backend:**
- `routers/review_notes.py` — CRUD + CSV export at `/api/v1/review-notes`
- `schemas/review_note.py` — Pydantic schemas
- `models/review_note.py` — SQLAlchemy model
- Migration `0013_review_notes.py`

**Frontend:**
- `ReviewPanel.tsx` — Floating slide-in panel
- `useReviewMode.tsx` — Context and state management
- `CommandMenu.tsx` — Ctrl+K command palette

### 6. System Notes

Per-system notes feature for internal team communication.

**Backend:**
- `routers/system_notes.py` — CRUD at `/api/v1/systems/{id}/notes`
- `schemas/system_note.py` — Pydantic schemas
- `models/system_note.py` — SQLAlchemy model
- Migration `0014_system_notes.py`

**Frontend:**
- `NotesTab.tsx` — Notes UI in System Workspace

### 7. Platform Settings Service

Database-backed settings with environment variable fallback for runtime configuration.

**Backend:**
- `models/platform_setting.py` — SQLAlchemy model
- `settings_service.py` — Async service with caching
- Migration `0015_platform_settings.py` — Table + seed data

---

## Database Migrations

New migrations added (building on GitHub's 0012):

| Migration | Description |
|-----------|-------------|
| `0013_review_notes.py` | Review notes table for POC feedback |
| `0014_system_notes.py` | System-specific notes |
| `0015_platform_settings.py` | Platform configuration table with seed data |

**Migration Sequence:**
```
0010 (shared)
  ↓
0011_ai_system_model_cards (GitHub)
  ↓
0012_field_confirmations (GitHub)
  ↓
0013_review_notes (fork)
  ↓
0014_system_notes (fork)
  ↓
0015_platform_settings (fork)
```

---

## Architecture Decisions

### Preserved from GitHub Main

1. **Multi-tenancy** — `libs/tenancy/` library and `install_tenant_middleware()` in backends
2. **Model Card N:M** — `ai_system_model_cards` table (systems can have multiple models)
3. **CI/CD Pipeline** — Gardener deployment workflows unchanged

### Changed from Fork

1. **Theme sync** — Shell-based broadcast instead of localStorage
2. **Navigation** — Task-driven with permission-gated visibility
3. **Luigi config** — Complete rewrite (920 → 1755 lines)

### Changed Roles/Permissions

1. **Platform Administrator role** — Now has only `iam:manage` permission (admin-only view)
   - Changed in `libs/authorization/ai_trust_authorization/constants.py`
   - Platform admins see only Administration menu, not AI Systems/Today/My Work
   - This is the correct behavior for admin-only users who manage IAM

### Dropped from Fork

1. **owner_username field** — Removed; derive owner from workflow data instead

---

## File Changes Summary

### New Directories

| Directory | Contents |
|-----------|----------|
| `admin/frontend/` | Platform Admin MFE (48 files) |
| `ai-system-registry/frontend/src/components/compliance/` | Embedded compliance tabs |
| `ai-system-registry/frontend/src/components/layout/` | Layout components (Sidebar, TopBar) |
| `ai-system-registry/frontend/src/utils/` | Utility functions |

### Modified Files (Key)

| File | Changes |
|------|---------|
| `shell/public/luigi-config.js` | Permission-gated task-driven navigation, theme broadcast |
| `shell/nginx.conf` | Added `/admin/` proxy route |
| `docker-compose.yml` | Added `admin-frontend` service |
| `ai-system-registry/backend/app/main.py` | Added review_notes and system_notes routers |
| All MFE `index.css` | Dark theme CSS variables |
| All MFE `useLuigi.ts` | Theme sync hook |

### Deleted Files

| File | Reason |
|------|--------|
| `*/frontend/src/hooks/useTheme.ts` (7 files) | Replaced by shell-based theme sync |

---

## Post-Merge Fixes

The following fixes were applied after the initial merge:

### 1. DTA Frontend Build Error

**Problem:** `decision-trace-analyzer/frontend` failed to build with `Cannot find module './hooks/useTheme'`

**Fix:**
- Added `useLuigiThemeSync()` function to `decision-trace-analyzer/frontend/src/hooks/useLuigi.ts`
- Updated `decision-trace-analyzer/frontend/src/App.tsx` to use `useLuigiThemeSync` instead of removed `useTheme`

### 2. Platform Administrator Role Permissions

**Problem:** Platform Administrator had all 14 permissions, showing full navigation instead of admin-only view

**Fix:**
- Changed `libs/authorization/ai_trust_authorization/constants.py`:
  ```python
  # Before
  "platform_administrator": ALL_PERMISSIONS,
  
  # After
  "platform_administrator": [IAM_MANAGE],  # Admin-only: manages users/roles
  ```
- Deleted and recreated OpenFGA store to clear old permission tuples
- Rebuilt `openfga-provision` and `users-backend` images

**Result:** Platform admins now see only Administration menu (Users & Roles, AI Providers, Mail Service, Settings)

---

## Testing Checklist

After pulling these changes:

1. **Database**
   ```bash
   cd libs/persistence
   alembic upgrade head
   ```

2. **Docker**
   ```bash
   docker compose up --build
   ```
   
   **Note:** If OpenFGA has old permission data, you may need to delete and recreate the store:
   ```bash
   # The openfga-provision container will recreate the store on next startup
   docker compose down openfga openfga-provision
   docker compose up -d
   ```

3. **Verify Features**
   - [ ] Platform Admin user sees only Administration menu (not Today/My Work/AI Systems)
   - [ ] Platform Administrator role card shows only 1 permission (Manage users & roles)
   - [ ] Dark theme toggle in shell syncs across all MFEs
   - [ ] AI Engineer user sees Today/My Work/AI Systems navigation
   - [ ] System Workspace has all tabs (Overview, Details, Tasks, Compliance, Activity, Notes)
   - [ ] Admin portal loads at `/admin/`
   - [ ] Ctrl+K opens command palette
   - [ ] Review Mode activates from command palette

4. **Run Tests**
   ```bash
   cd ai-system-registry/backend && make test
   ```

---

## Breaking Changes

1. **useTheme.ts removed** — If any custom code imports `useTheme`, switch to `useLuigiThemeSync` from `useLuigi.ts`
2. **Luigi navigation structure** — Navigation nodes completely restructured; any hardcoded paths may need updates

---

## Known Issues

1. **IDE errors without node_modules** — TypeScript errors appear in newly copied files until `npm install` runs
2. **Package.json dependencies** — May need to add `cmdk` package for command palette

---

## Rollback

If issues arise, the fork's state is preserved at:
- Fork backup branch: `fork-backup-before-merge` in `ai-trust-platform-poc-fork`
- GitHub branch before merge: Check git reflog for previous HEAD

---

## Contact

For questions about these changes:
- UI/Navigation: Martin Korn
- Backend/Migrations: Martin Korn
