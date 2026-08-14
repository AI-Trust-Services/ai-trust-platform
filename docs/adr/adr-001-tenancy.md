# ADR-001: Tenancy model = the Platform Mesh account id

- **Status:** Accepted (2026-08-13)
- **Context:** GitHub issue #16 — "Adopt Platform Mesh account and tenancy model" (acceptance
  criteria AC1 "documented + maps to the account hierarchy" and AC5 "decision documented").
- **Deciders:** AI Trust Platform team.
- **Related:** ApeiroRA ADR-004; Platform Mesh account model
  (https://documentation.apeirora.eu/docs/best-practices/platform-mesh/account-model).

## Decision

**The AI Trust Platform tenant of record is the Platform Mesh account** — specifically the
account's stable kcp logical-cluster id. That id **is** the app's `tenant_id` everywhere:

```
root:orgs:<org>:<account>          Platform Mesh account hierarchy
        └── account  ──►  kcp logical-cluster id  ==  tenant_id
```

The same value appears as:
- the consumer workspace **cluster id** in kcp;
- the `tenant_id` **claim** minted into that tenant's Keycloak tokens (per-org realm, one realm
  per org account — the realm name equals the org account);
- the `tenant_id` **column** on every tenant-scoped Postgres row (RLS) and ClickHouse row;
- the tenant **prefix** on MinIO evidence object keys (`t/<tenant_id>/...`).

Equivalence: **one subscribing account ⇄ one cluster id ⇄ one tenant.** We do NOT invent a
separate tenant registry — the Platform Mesh account IS the tenant, so the model aligns 1:1
with the APO account structure by construction.

## How tenant context flows (AC2)

```
per-org Keycloak realm (mesh)                → OIDC token with tenant_id claim + iss=/realms/<org>
  → oauth2-proxy (per-org)                    → forwards Authorization: Bearer <JWT>
    → libs/tenancy resolver (jwt mode)         → VERIFIES the JWT (sig+exp+allowlisted iss via JWKS),
                                                 reads tenant_id claim (fallback: org from iss)
      → tenant_id_var (ContextVar)             → propagates through every await in the request
        → Postgres: session `begin` hook       → SELECT set_config('app.current_tenant', <t>, true)
                                                 → RLS: read own+catalog, WRITE OWN ONLY (0009+0010)
        → ClickHouse: tenant_clause()          → AND tenant_id = {tenant} on every read; stamped on write
        → MinIO: object_key()                  → t/<tenant>/evidence/... on new uploads
```

Isolation is **fail-closed**: in `jwt` mode an unresolved/forged/unverified token → 401
(HTTP) or `AND 1=0` (ClickHouse) — never cross-tenant data.

## Consequences

- (+) Aligns exactly with the APO/Platform Mesh account hierarchy; no separate tenant registry
  or sync to drift.
- (+) `TENANCY_MODE=single` (default) makes all of this a no-op, so the single-tenant deploy is
  unchanged (backward compatible).
- (−) The model is **flat** (account = tenant); sub-account hierarchy levels are not modeled as
  nested tenants. Acceptable for the current provider-consumer shape; revisit if hierarchical
  sub-tenant isolation is required.

## Modularity (issue #16 AC4)

The tenancy layer is a self-contained package (`libs/tenancy`) with two levels of adaptability:
- **Config-level:** `TENANCY_MODE = single | jwt | header` selects the built-in strategy; `single`
  (default) is a full no-op for the single-tenant deploy.
- **Extension-level (replaceable):** an enterprise can plug in its OWN tenant resolution WITHOUT
  forking — either programmatically via `register_resolver(fn)` (fn: `Request -> str | None`), or by
  config via `TENANCY_RESOLVER="my_pkg.my_module:my_resolver"`. A registered resolver takes
  precedence over the built-ins; returning `None` falls through to them (augment, not only replace).
  This satisfies AC4's "modular / replaceable / adaptable to enterprise-specific requirements."

## MANDATORY runtime requirement — the non-superuser DB role (RLS enforcement)

**Postgres RLS is the backbone of tenant DATA isolation, and RLS is BYPASSED by superusers and
by the table owner.** Therefore, for multi-tenant deployments:

- Runtime backends + worker MUST connect via `DATABASE_URL` using the **non-superuser role
  `ai_trust_app`** (`NOSUPERUSER NOBYPASSRLS`). If the app connects as `postgres` (superuser), RLS
  does nothing and there is NO tenant isolation — the well-formed policies are silently inert.
- Migrations/seeders run as the owner/superuser (they must, to seed shared catalog rows with
  `tenant_id IS NULL`); expected and safe.
- Migration `0011` adds `FORCE ROW LEVEL SECURITY` as defense-in-depth (RLS applies to the table
  owner too), but a superuser/BYPASSRLS connection still bypasses it — FORCE is NOT a substitute
  for connecting as `ai_trust_app`.
- The `ai_trust_app` role + `DATABASE_URL` wiring live in the deployment bundle
  (`Standard_AiTrust_MT_MSP`), NOT this repo. Verify on every deploy:
  `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='ai_trust_app'` → both false, and the
  backends' `DATABASE_URL` points at `ai_trust_app`. (Confirmed live on ai-trust-1: rolsuper=false,
  rolbypassrls=false, and a cross-tenant/NULL write returns "new row violates row-level security".)

## Known follow-ups / explicitly out of scope of this app-repo change

These are **Platform-Mesh / deployment** concerns, tracked separately (not in the app repo):
- **Kubernetes-resource-level isolation** (issue #16 AC3): today isolation is data-level (RLS +
  tenant-scoped ClickHouse/MinIO) inside one shared namespace. Per-namespace / NetworkPolicy /
  ResourceQuota isolation is a deploy-bundle decision, not an app-repo change.
- **Platform Mesh CRD adoption** (APIExport/APIBinding/api-syncagent/ProviderMetadata): handled
  by the external `Standard_AiTrust_MT_MSP` bundle, not this repo.
- **OpenFGA per-tenant store:** authorization currently checks a single shared store on
  `platform:global` (role→permission graph is identical per tenant); tenant DATA isolation is via
  RLS. Per-tenant OpenFGA stores are a mesh-authz architecture decision, deferred.
- **JWT verification reachability:** `jwt` mode verifies against the issuer's JWKS. In the mesh
  deploy the token `iss` is the public host; confirm the backends can reach that JWKS (or point
  `TENANCY_JWKS_ISSUER_BASE` + JWKS at the in-cluster mesh Keycloak) — validated per deployment.
- **Postgres owner credential (SEC-M4 follow-up):** `POSTGRES_PASSWORD` is still the default
  `postgres` in the current deploy. It is the DB owner cred, internal-only (Postgres is not exposed
  outside the cluster) and NOT caught by the `check_no_default_secrets()` guard because backends
  connect via `DATABASE_URL` (the RLS `ai_trust_app` role), not `POSTGRES_PASSWORD`. Rotating it is
  high-risk (baked into the running DB + every DATABASE_URL/APP_DATABASE_URL + the worker's
  OWNER_DATABASE_URL) and should be a planned maintenance step in the deploy bundle, not an app-repo
  change. The MinIO root password WAS rotated (2026-08-13). Tracked as a deploy follow-up.
- **Worker owner connection (SEC-M2 follow-up):** `policy-checker-worker` uses `OWNER_DATABASE_URL`
  (an RLS-bypassing superuser connection) SOLELY to `SELECT DISTINCT tenant_id` for its per-tenant
  evaluation loop; all actual rule evaluation runs on the RLS-bound `ai_trust_app` engine with the
  tenant set. Least-privilege hardening = give the worker a dedicated role granted only `SELECT
  (tenant_id)` (or a narrow view) instead of the owner — deploy-bundle work, deferred.
- **Legacy `tenant_id IS NULL` rows (SEC-L2 follow-up):** the RLS `USING` clause makes NULL-tenant
  rows readable by every tenant. This is INTENTIONAL for shared catalog data (frameworks,
  model_cards, alert_rules seeded by migrations). There are currently no stray tenant-business rows
  with NULL. If single-tenant data is ever migrated into the shared instance, it must be backfilled
  with a real `tenant_id` first (else it leaks to all tenants). Tenant deprovisioning/backfill
  lifecycle is a deploy/ops decision, deferred.
- **JWT insecure-mode opt-in (SEC-L1 — CLOSED):** `TENANCY_JWT_VERIFY=false` in
  jwt mode now REQUIRES an explicit `TENANCY_ALLOW_INSECURE_JWT=true`; otherwise `validate()` refuses
  to start. Prevents accidentally shipping with signature verification off.
