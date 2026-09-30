# admin/ (port 8010, `/api/admin/`)
Platform administration — SMTP mail service configuration, general platform settings, branding/white-labeling, and a summary dashboard. Access restricted to `platform_administrator` role via `iam:manage` permission.

**Screens** — all gated on `iam:manage`:
- `/admin-home` — Platform Administration dashboard: KPI tiles (user/role counts, mail status) + cards linking to each section.
- `/mail-service` — SMTP configuration.
- `/admin-settings` — General platform settings.
- `/branding` — White-labeling: logos (light/dark mode), colors (primary, secondary, accent, warning), org name, favicon. Draft/publish workflow with live preview.
- Users & Roles — served by the separate IAM MFE (`/iam/`).

**Data model** — single-row `platform_settings` table (migration `0020`, always `id=1`) for SMTP and general settings. Seeded from env vars on first startup; once a row exists the DB is the source of truth and env vars are ignored. Password is stored in the row but **never returned** by GET endpoints — only `has_password: bool` is exposed. Branding is stored separately in the `branding` key-value table (migration `0031`) — each row has a `key` (e.g. `primary_color`), `published` value (live), and `draft` value (preview). This design means no migrations are needed for new branding fields — just INSERT a row. Metadata keys `_published_at` and `_published_by` track publish history.

**Branding system** — white-labeling for multi-tenant or custom single-tenant deployments. Each branding field has a published and draft variant; changes save to draft, preview shows draft via `?preview=true` URL param, publish copies draft → published.
- **Logo storage** — MinIO bucket `branding-assets` (single mode) or `tenant-<org>` (jwt mode). Keys: `branding/{asset_type}/{filename}`. Served via `/v1/branding/public/asset/{key}`.
- **Shell sync** — shell fetches `/v1/branding/public` at init, stores in `localStorage('trust-platform-branding')`, applies logos/colors/favicon. MFEs listen via `useBranding()` hook from `libs/react-hooks/` (StorageEvent on the key).
- **Preview** — BrandingPage embeds an iframe with `?preview=true`; shell loads draft branding in that context.

**Branding API** (`admin/backend/app/routers/branding.py`):
- `GET /v1/branding?mode=published|draft` — get branding (requires `iam:manage`)
- `PUT /v1/branding` — update draft values (colors, org_name)
- `POST /v1/branding/upload/{asset_type}` — upload logo/favicon (multipart)
- `POST /v1/branding/publish` — copy all drafts to published
- `POST /v1/branding/discard` — reset drafts to published
- `POST /v1/branding/reset` — delete all branding rows, revert to platform defaults
- `GET /v1/branding/status` — check for unpublished changes
- `GET /v1/branding/public` — published branding (no auth, for shell/MFEs)
- `GET /v1/branding/public/asset/{key}` — serve logo binary (no auth)

**Backend** (`admin/backend/app/`):
- `GET/PUT /v1/smtp` — SMTP configuration (host, port, user, password, from, from_name, ssl, starttls). PUT preserves the existing password when `smtp_password` is absent from the body.
- `POST /v1/smtp/test` — sends a real test email using the **saved** settings (save first, then test). Returns `{success, message}` with a descriptive error for each failure type (auth, connection refused, recipient rejected, timeout).
- `GET/PUT /v1/settings` — general platform settings (platform_name, support_email).
- `GET /v1/stats` — dashboard KPIs: user/role counts (via internal call to users backend), mail configured flag.
- `startup.py` — `seed_settings_from_env()` called via FastAPI lifespan; reads `SMTP_*`, `PLATFORM_NAME`, `SUPPORT_EMAIL` env vars and inserts the row only if none exists.
