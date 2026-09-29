# admin/ (port 8010, `/api/admin/`)
Platform administration — SMTP mail service configuration, general platform settings, and a summary dashboard. Access restricted to `platform_administrator` role via `iam:manage` permission.

**Screens** — all gated on `iam:manage`:
- `/admin-home` — Platform Administration dashboard: KPI tiles (user/role counts, mail status) + cards linking to each section.
- `/mail-service` — SMTP configuration.
- `/admin-settings` — General platform settings.
- Users & Roles — served by the separate IAM MFE (`/iam/`).

**Data model** — single-row `platform_settings` table (migration `0020`, always `id=1`). Seeded from env vars on first startup; once a row exists the DB is the source of truth and env vars are ignored. Password is stored in the row but **never returned** by GET endpoints — only `has_password: bool` is exposed.

**Backend** (`admin/backend/app/`):
- `GET/PUT /v1/smtp` — SMTP configuration (host, port, user, password, from, from_name, ssl, starttls). PUT preserves the existing password when `smtp_password` is absent from the body.
- `POST /v1/smtp/test` — sends a real test email using the **saved** settings (save first, then test). Returns `{success, message}` with a descriptive error for each failure type (auth, connection refused, recipient rejected, timeout).
- `GET/PUT /v1/settings` — general platform settings (platform_name, support_email).
- `GET /v1/stats` — dashboard KPIs: user/role counts (via internal call to users backend), mail configured flag.
- `startup.py` — `seed_settings_from_env()` called via FastAPI lifespan; reads `SMTP_*`, `PLATFORM_NAME`, `SUPPORT_EMAIL` env vars and inserts the row only if none exists.
