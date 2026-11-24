# admin/ (port 8010, `/api/admin/`)
Platform administration — SMTP mail service configuration, general platform settings, branding/white-labeling, the bring-your-own-LLM provider config, and a summary dashboard. Access restricted to `platform_administrator` role via `iam:manage` permission.

**Screens** — all gated on `iam:manage`:
- `/admin-home` — Platform Administration dashboard: KPI tiles (user/role counts, mail status) + cards linking to each section.
- `/mail-service` — SMTP configuration.
- `/admin-settings` — General platform settings.
- `/branding` — White-labeling: logos (light/dark mode), colors (primary, secondary, accent, warning), org name, favicon. Draft/publish workflow with live preview.
- `/llm-provider` — Bring-your-own-LLM provider config (issue #406): endpoint URL + model + API token, Test Connection, activate / restore-platform-default. Save → Test → Activate flow (activation gated on a passing test). Shows an amber **silent-stub warning** when no custom provider is active and the platform default isn't live (see `platform_default_live` below); the **admin-home** dashboard shows the same warning as a clickable alert that navigates to this page.
- Users & Roles — served by the separate IAM MFE (`/iam/`).

**Data model** — single-row `platform_settings` table (migration `0020`, always `id=1`) for SMTP and general settings. Seeded from env vars on first startup; once a row exists the DB is the source of truth and env vars are ignored. Password is stored in the row but **never returned** by GET endpoints — only `has_password: bool` is exposed. Branding is stored separately in the `branding` key-value table (migration `0031`) — each row has a `key` (e.g. `primary_color`), `published` value (live), and `draft` value (preview). This design means no migrations are needed for new branding fields — just INSERT a row. Metadata keys `_published_at` and `_published_by` track publish history. The **bring-your-own-LLM** provider config is a separate single-row `llm_provider_config` table (migration `0053`, `id=1`) — see the LLM provider endpoints below.

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
- `GET /v1/external-api/token` — read-only exposure of the external read-API bearer token (`routers/external_api.py`, `iam:manage`). Returns `{configured, token, service_principal}` read straight from the env (`EXTERNAL_API_TOKEN` / `EXTERNAL_API_SERVICE_PRINCIPAL`) — **not** stored in `platform_settings`, not generated here. Lets an admin without cluster access copy the token (shown masked with reveal/copy on the `/admin-settings` page) to hand to the team integrating an off-platform service. Rotation = change the secret + redeploy. The token itself is validated by the **registry** (`/v1/external/*`).
- `GET /v1/stats` — dashboard KPIs: user/role counts (via internal call to users backend), mail configured flag.
- **LLM provider** (`routers/llm_provider.py`, issue #406, all `iam:manage`) — bring-your-own OpenAI-compatible endpoint. Single-row `llm_provider_config` table (migration `0053`, `id=1`, per-tenant via schema-per-tenant). The token is stored plaintext but **never returned** (only `has_token: bool`), matching SMTP. **`GET /v1/llm-provider`** — current config (masked). **`PUT /v1/llm-provider`** — upsert; SSRF-validates the URL (422 on a non-routable/internal host), preserves the stored token when `api_token` is omitted, and **resets `is_active` + clears the last-test status on any change** (so activation must re-pass Test Connection). **`POST /v1/llm-provider/test`** — live 1-token `chat/completions` probe (via `httpx`, not the openai SDK) of the *candidate* config (request fields win, else the stored row); maps 401/403→auth, 400/404→model-unavailable, non-OpenAI shape→incompatible; records `last_test_status`. **`POST /v1/llm-provider/activate`** — requires `last_test_status == "ok"` (422 otherwise) + re-validates the URL; sets `is_active`. **`POST /v1/llm-provider/deactivate`** — "restore the platform default" (workflows fall back to the Thalamus env config). Every mutation is audited via `log_audit_event` (`resource_type="llm_provider_config"`; the token is logged as `token_changed: bool`, never the value). `GET /v1/llm-provider` also returns **`platform_default_live`** — `True` when `THALAMUS_BASE_URL` is a real gateway (not unset/`"stub"`); when `False` and no BYO is active, AI workflows run on the offline stub (placeholder output), which the UI warns about. The SSRF validator + resolver live in `libs/persistence/ai_trust_persistence/llm_config.py` (shared with the registry, which reads this config at request time — see root `CLAUDE.md` "Bring-your-own-LLM" and `ai-system-registry/CLAUDE.md`).
- `startup.py` — `seed_settings_from_env()` called via FastAPI lifespan; reads `SMTP_*`, `PLATFORM_NAME`, `SUPPORT_EMAIL` env vars and inserts the row only if none exists.
