# updategit.md — Multi-tenancy changes to `ai-trust-platform`

## Part 2 — Security/correctness hardening (issue #16 audit remediation, 2026-08-13)
A three-way audit (multi-lens panel + readiness report) found cross-tenant vulnerabilities on top
of the Part-1 foundation. Fixes below are all in this repo (mesh/deploy items excluded per scope).

**ADDED**
- `libs/tenancy/ai_trust_tenancy/security_preflight.py` — `check_no_default_secrets()` (SEC-M4): refuses boot on known-default secrets when `TENANCY_MODE != single`.
- `libs/clickhouse/ai_trust_clickhouse/tenant.py` — `tenant_clause()` helper: adds `AND tenant_id={tenant:String}` to ClickHouse queries; fail-closed (`1=0`) in jwt mode w/o tenant; no-op in single.
- `libs/persistence/.../migrations/versions/0010_tenant_write_own.py` — tightens RLS `WITH CHECK` to write-own (SEC-M1).
- `libs/clickhouse/migrations/0003_tenant_id.sql` — `tenant_id` column on `gen_ai_spans` + `alert_events` (SEC-C3).
- `libs/tenancy/tests/test_resolver.py` + `test_rls_isolation.py` (SEC-H4).
- `docs/adr/adr-001-tenancy.md` + `docs/tenancy-model.md` (issue #16 AC1/AC5).

**MODIFIED**
- `libs/tenancy/ai_trust_tenancy/resolver.py` — **SEC-C1**: `X-Tenant-Id` honored ONLY in `header` mode, never `jwt` (was top-precedence in all non-single modes). **SEC-C2**: replaced blind base64 decode with `PyJWT` JWKS verification (RS256 sig + exp + allowlisted `iss`), fail-closed.
- `libs/tenancy/ai_trust_tenancy/config.py` — new env `TENANCY_JWKS_ISSUER_BASE`/`TENANCY_JWT_AUDIENCE`/`TENANCY_JWT_VERIFY`; `validate()` fail-fast on bad mode / missing issuer base.
- `libs/tenancy/ai_trust_tenancy/middleware.py` — calls `validate()` + `check_no_default_secrets()` at install (startup fail-fast).
- `libs/tenancy/pyproject.toml` — declare `starlette` + `PyJWT[crypto]`. Each backend + worker `requirements.txt` — add `PyJWT[crypto]==2.9.0`.
- `shell/nginx.conf` — **SEC-C1**: strip inbound `X-Tenant-Id` (set "") on all 7 `/api/*`. **SEC-H1/2/3**: `CSP frame-ancestors 'self'` + `X-Frame-Options SAMEORIGIN` (replaces invalid `ALLOWALL`; Luigi MFEs are same-origin so still frame), drop wildcard CORS, add HSTS + `X-Content-Type-Options nosniff` + `Referrer-Policy`.
- `libs/clickhouse/ai_trust_clickhouse/{tables.py,__init__.py}` — `tenant_id` in COLUMNS (last); export `tenant_clause`/`current_tenant`.
- `consumers/clickhouse-consumer/main.py` — stamp `tenant_id` from OTLP resource attr `ai_trust.tenant_id`.
- `alerts/backend/app/routers/alerts.py`, `monitoring/.../monitoring.py`, `decision-trace-analyzer/.../traces.py`, `policy-checker-worker/main.py` — every ClickHouse read scoped via `tenant_clause()`; worker `create_event` stamps `tenant_id`.
- `compliance/backend/app/minio_client.py` — new evidence keys prefixed `t/{tenant_id}/evidence/...`; legacy keys resolve verbatim.

**New runtime env (jwt mode):** `TENANCY_JWKS_ISSUER_BASE` (required), optional `TENANCY_JWT_AUDIENCE`, `TENANCY_JWT_VERIFY` (default true). The instrumented app must emit OTLP resource attr `ai_trust.tenant_id` for ClickHouse scoping. Apply pg migration 0010 + clickhouse migration 0003 on deploy.

**Explicitly OUT of scope (mesh/deploy, not this repo):** K8s namespace/NetworkPolicy/quota isolation (issue #16 AC3), Platform-Mesh CRD adoption, the operator/spec.org, per-tenant OpenFGA store, CI/CD/SBOM/signing. Documented as follow-ups in ADR-001.

---


**Status:** applied to the working tree on 2026-08-13 (not yet committed/PR'd). This doc is the single
record of every change made to this repo to add **real multi-tenancy** so the app can run as ONE shared
instance serving many tenants on Platform Mesh (one Keycloak realm per customer org).

## Why
The app was single-tenant. The `Standard_AiTrust_MT_MSP` mesh bundle deploys it as a shared multi-tenant
provider, but the tenancy code was missing from this repo (the deployed images had RLS in the DB — applied
out-of-band — but no app code to set the tenant, so isolation was effectively off). These changes add the
missing app layer: a `libs/tenancy` package + a migration that reconstructs the DB RLS **and** adds the
INSERT-time tenant stamp that prod lacked.

**Backward compatible:** everything is gated by `TENANCY_MODE` (default `single`). In single mode all the
new code is a no-op, so the full-copy `Standard_AiTrust_MSP` deploy behaves exactly as before.

## Tenancy model (how a request becomes a tenant-scoped query)
```
oauth2-proxy (per-org realm)                → forwards Authorization: Bearer <JWT> (+ optional X-Tenant-Id)
  → shell/nginx.conf forwards those headers to every /api/* backend
    → libs/tenancy middleware resolves tenant  (jwt: tenant_id claim, else org parsed from iss /realms/<org>;
      or explicit X-Tenant-Id override) and sets tenant_id_var (a ContextVar)
      → libs/tenancy session hook issues  SELECT set_config('app.current_tenant', <tenant>, true)  at each
        transaction BEGIN on the engine
        → Postgres RLS policy `tenant_id = current_setting('app.current_tenant', true) OR tenant_id IS NULL`
          filters reads; the column DEFAULT stamps tenant_id on INSERT. Runtime connects as the non-superuser
          role `ai_trust_app` (NOBYPASSRLS) so the policy is enforced.
```

## Files ADDED
- `libs/tenancy/pyproject.toml` — package metadata (mirrors `libs/logging`).
- `libs/tenancy/ai_trust_tenancy/__init__.py` — exports `tenant_id_var`, `install_tenant_middleware`, `install_tenant_scoping`, `resolve_tenant`.
- `libs/tenancy/ai_trust_tenancy/context.py` — `tenant_id_var: ContextVar[str|None]` (mirrors `correlation_id_var`).
- `libs/tenancy/ai_trust_tenancy/config.py` — reads `TENANCY_MODE` (single|jwt|header, default single), `TENANT_CLAIM` (default `tenant_id`), `TENANT_HEADER` (default `x-tenant-id`).
- `libs/tenancy/ai_trust_tenancy/resolver.py` — `resolve_tenant(request)`: X-Tenant-Id override → jwt (decode forwarded token, prefer `tenant_id` claim, fall back to org from `iss` `/realms/<org>`).
- `libs/tenancy/ai_trust_tenancy/middleware.py` — `install_tenant_middleware(app)`: sets `tenant_id_var` per request; 401 in jwt mode when unresolved (except /health, /docs, /openapi.json, /redoc).
- `libs/tenancy/ai_trust_tenancy/session.py` — `install_tenant_scoping(engine)`: `@event.listens_for(engine.sync_engine, "begin")` → `SELECT set_config('app.current_tenant', %s, true)`.
- `libs/persistence/ai_trust_persistence/models/_tenant.py` — `TenantMixin` (nullable `tenant_id String(64)`, indexed).
- `libs/persistence/ai_trust_persistence/migrations/versions/0009_tenancy.py` — `down_revision="0008"`. Idempotent: adds `tenant_id` + index + `SET DEFAULT current_setting('app.current_tenant', true)` + `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation (USING + WITH CHECK)` on the 11 tenant tables (`ai_systems, assessments, obligations, controls, evidence, evidence_versions, evidence_controls, evidence_obligations, control_obligations, alert_rules, service_model_baselines`).

## Files MODIFIED
- `libs/persistence/ai_trust_persistence/database.py` — after the engine is created, `install_tenant_scoping(engine)` (guarded `try/except ImportError`).
- `libs/persistence/ai_trust_persistence/models/{ai_system,alert_rule,assessment,control,evidence,obligation}.py` — the 7 scoped ORM classes now inherit `TenantMixin` (AISystem, AlertRule, Assessment, Control, Evidence, EvidenceVersion, Obligation).
- `{ai-system-registry,monitoring,overview,alerts,compliance,decision-trace-analyzer,users}/backend/app/main.py` (7) — import + `install_tenant_middleware(app)` after the CORS middleware.
- `{...7 backends...}/backend/requirements.txt` — add `-e /app/libs/tenancy` **before** `-e /app/libs/persistence` (persistence imports tenancy).
- `{...7 backends...}/backend/Dockerfile` — add `COPY libs/tenancy /app/libs/tenancy` **before** the first `COPY libs/` line.
- `shell/nginx.conf` — every `/api/*` backend location now forwards BOTH the authZ identity headers (`X-Forwarded-User`, `X-Forwarded-Preferred-Username`) AND the tenancy signals (`Authorization`, `X-Tenant-Id`). (The previously-deployed shell had dropped the username headers — a latent authZ bug this fixes.)
- `shell/public/luigi-config.js` — all 10 nav `viewUrl`s changed from hardcoded `http://localhost:8080/<mfe>/` to RELATIVE (`/overview/`, `/registry/`, `/dta/`, `/monitoring/`, `/alerts/`, `/compliance/#/...`, `/users/`). The localhost URLs caused a white screen on the mesh (per-org host) because the MFE iframes pointed at a dead origin; relative paths resolve against the current host via the shell nginx. Works for both local docker-compose and the mesh.
- `policy-checker-worker/main.py` — the worker connects as the RLS role, so it now runs `evaluate_once()` **once per tenant**: `install_tenant_scoping(engine)`; a new `OWNER_DATABASE_URL` env drives an owner-scoped engine used only to `SELECT DISTINCT tenant_id`; `evaluate_all_tenants()` loops tenants (setting `tenant_id_var`) + a trailing None pass for shared rows. Falls back to a single unscoped pass when `OWNER_DATABASE_URL` is unset (single-tenant/local).
- `policy-checker-worker/{requirements.txt,Dockerfile}` — add `libs/tenancy` (before persistence).

## Deferred (Phase 4 — NOT in this change)
ClickHouse tenant column + query scoping (monitoring/alerts/dta reads, clickhouse-consumer writes) and MinIO
evidence key prefixing. Postgres RLS is the primary isolation; these are defense-in-depth, tracked separately.

## Runtime env (set by the MT deploy, not by this repo)
- `TENANCY_MODE=jwt`, `TENANT_CLAIM=tenant_id` — on all backends in the MT bundle.
- Backends' `DATABASE_URL` = the non-superuser `ai_trust_app` role (so RLS is enforced). Migrations/seeders
  use the owner (`postgres`) URL.
- `policy-checker-worker` additionally gets `OWNER_DATABASE_URL` = the owner URL (for tenant enumeration).

## Rebuild + apply
1. `Standard_AiTrust_MT_MSP/scripts/2b-build-app-images.sh` clones this repo and builds all images (tag
   `aitrust-mt`). The new `libs/tenancy` is picked up automatically now that each Dockerfile COPYs it and
   each requirements.txt installs it. No build-script change required.
2. **Apply migration 0009** with the OWNER (`postgres`) `DATABASE_URL` before starting backends: run the
   `db-migrate` job (it runs `alembic upgrade head`). 0009 is idempotent, so on the already-provisioned prod
   DB it only adds the missing `SET DEFAULT` (columns/policies already exist) — do NOT `alembic stamp`; let
   it run so the default is applied.
3. Roll the backends + worker to the new images.

## DB provenance / grants (operational — not a git file, but load-bearing)
- **Migrations must run IN ORDER from an empty DB** (`alembic upgrade head`, 0001→0009). Do NOT `alembic
  stamp` past a version without running it: the original deployed DB was stamped past `0008_custom_roles`
  without running it, so the `custom_roles` table was missing and `users-backend` `/iam/custom-roles` +
  `/users` 500'd (`relation "custom_roles" does not exist`). All seed data lives IN the migrations (0001
  seeds 12 model_cards, 0002 seeds alert_rules, 0003 seeds 3 frameworks, 0004 adds expiry rules), so a clean
  `upgrade head` restores everything — no separate seeder.
- **Runtime role grants:** `ai_trust_app` needs EXPLICIT per-table grants (no role inheritance). `pg-init`
  (`Standard_AiTrust_MT_MSP/config/shared-app/01-cm-pg-init-mt.yaml`) sets `ALTER DEFAULT PRIVILEGES`, but
  that only covers tables created AFTER it ran (first boot). `Standard_AiTrust_MT_MSP/scripts/3b-shared-app.sh`
  now has a post-migrate GRANT-RECONCILE step (`GRANT ... ON ALL TABLES/SEQUENCES ... TO ai_trust_app`) so a
  fresh deploy is always fully granted. If you ever hand-create a table, GRANT it to `ai_trust_app` too.

## Verification
- RLS SQL (as `ai_trust_app`): seed rows for two tenant_ids as owner; `SET app.current_tenant='A'` → see only
  A (+ NULL); switch to B → only B; an INSERT with no tenant_id under a set tenant → row auto-stamped.
- 2-tenant browser test in poc2; then a brand-new org end-to-end (see `Standard_AiTrust_MT_MSP` operator).
- Backward-compat: `TENANCY_MODE=single` → all no-op; `Standard_AiTrust_MSP` unchanged.
