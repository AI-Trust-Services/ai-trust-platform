# ADR-001: Tenancy model = the Platform Mesh account id

- **Status:** Accepted (2026-08-13).
- **Context:** GitHub issue #16 — "Adopt Platform Mesh account and tenancy model" (acceptance
  criteria AC1 "documented + maps to the account hierarchy" and AC5 "decision documented").
- **Deciders:** AI Trust Platform team.
- **Related:** ApeiroRA ADR-004; Platform Mesh account model
  (https://documentation.apeirora.eu/docs/best-practices/platform-mesh/account-model).

## Decision

**The AI Trust Platform tenant of record is the Platform Mesh account** — specifically the
account's stable kcp logical-cluster id. That id **is** the app's tenant everywhere:

```
root:orgs:<org>:<account>          Platform Mesh account hierarchy
        └── account  ──►  kcp logical-cluster id  ==  tenant
```

The same value appears as:
- the consumer workspace **cluster id** in kcp;
- the tenant **claim** minted into that tenant's Keycloak tokens (the `tenant_id` claim; per-org
  realm, one realm per org account — the realm name equals the org account);
- the **Postgres schema `tenant_<org>`** and its **per-tenant role `t_<org>`**;
- the **ClickHouse database `tenant_<org>`**;
- the tenant **prefix** on MinIO evidence object keys (`t/<tenant>/...`).

Equivalence: **one subscribing account ⇄ one cluster id ⇄ one tenant.** We do NOT invent a
separate tenant registry — the Platform Mesh account IS the tenant, so the model aligns 1:1
with the APO account structure by construction.

## Isolation model — physical, per store

Isolation is **physical and per store**; there is no in-row tenant discriminator. A request is
*routed* to the tenant's own store, and Postgres denies cross-tenant access at the privilege level:

- **Postgres — schema-per-tenant + per-tenant role.** Each tenant's tables live in its own schema
  `tenant_<org>`, reached via `search_path`, and access is gated by a **per-tenant role `t_<org>`**
  that has `USAGE` on ONLY that schema. The shared login role holds `t_<org>` `WITH INHERIT FALSE`
  (must `SET ROLE` explicitly) and has **no direct grant** on any tenant schema — so Postgres denies
  cross-tenant access at the **privilege level** (`permission denied for schema tenant_<other>`), a
  hard deny, not a row-filter. That schema+role wall is the SOLE, sufficient isolation.
- **ClickHouse — database-per-tenant.** Each tenant's spans/alerts live in that tenant's own
  database `tenant_<org>`; reads and writes go through a per-tenant client so unqualified table
  names resolve against the tenant's database. No in-row filter.
- **MinIO — bucket/prefix-per-tenant.** Evidence object keys are prefixed `t/<tenant>/...`; the key
  is stored on the tenant-scoped evidence row (only reachable inside the tenant's own schema), so
  cross-tenant download is blocked at the DB.

## How tenant context flows (AC2)

```
per-org Keycloak realm (mesh)                → OIDC token with tenant_id claim + iss=/realms/<org>
  → oauth2-proxy (per-org)                    → forwards Authorization: Bearer <JWT>
    → libs/tenancy resolver (jwt mode)         → VERIFIES the JWT (sig+exp+allowlisted iss via JWKS),
                                                 reads tenant_id claim (fallback: org from iss)
      → tenant_id_var (ContextVar)             → propagates through every await in the request
        → Postgres: session `begin` hook       → search_path=tenant_<org>, SET LOCAL ROLE t_<org>
        → ClickHouse: get_client_for_tenant()  → per-tenant database tenant_<org> (routing)
        → MinIO: object_key()                  → t/<tenant>/evidence/... on new uploads
```

Isolation is **fail-closed**: in `jwt` mode an unresolved/forged/unverified token → 401 (HTTP);
Postgres then does not switch role and stays on `public` (no tenant tables), and ClickHouse falls
back to the empty legacy `otel` database — never cross-tenant data.

## Consequences

- (+) Aligns exactly with the APO/Platform Mesh account hierarchy; no separate tenant registry
  or sync to drift.
- (+) `TENANCY_MODE=single` (default) makes all of this a no-op, so the single-tenant deploy is
  unchanged (backward compatible).
- (+) Isolation is a hard, DB-enforced privilege wall (Postgres) + physically separate databases /
  buckets (ClickHouse / MinIO) — no reliance on every query remembering a filter.
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

## MANDATORY runtime requirement — the per-tenant Postgres role wall

**Postgres schema-per-tenant + the per-tenant role `t_<org>` is the backbone of tenant DATA
isolation.** For multi-tenant deployments:

- Runtime backends + worker MUST connect via `DATABASE_URL` using a **non-superuser** shared login
  role that `SET LOCAL ROLE`s into `t_<org>` per transaction. A superuser connection would bypass
  the privilege wall — there would be NO tenant isolation.
- The shared login role must hold each `t_<org>` `WITH INHERIT FALSE` and hold **no direct grant**
  on any tenant schema, so cross-tenant access is denied at the privilege level.
- Migrations/seeders run as the owner/superuser (they must, to create schemas/roles and seed shared
  catalog data); expected and safe.
- The role + `DATABASE_URL` wiring live in the deployment layer, NOT this repo. Verify on every
  deploy: `SELECT rolsuper FROM pg_roles WHERE rolname='<login role>'` → false, and that a
  cross-tenant `SELECT` returns `permission denied for schema tenant_<other>`.

## Known follow-ups / explicitly out of scope of this app-repo change

These are **Platform-Mesh / deployment** concerns, tracked separately (not in the app repo):
- **Kubernetes-resource-level isolation** (issue #16 AC3): today isolation is data-level
  (schema/role-per-tenant Postgres + database-per-tenant ClickHouse + bucket-per-tenant MinIO)
  inside one shared namespace. Per-namespace / NetworkPolicy / ResourceQuota isolation is a
  deploy-bundle decision, not an app-repo change.
- **Platform Mesh CRD adoption** (APIExport/APIBinding/api-syncagent/ProviderMetadata): handled
  by the external deployment layer, not this repo.
- **OpenFGA per-tenant store:** authorization currently checks a single shared store on
  `platform:global` (role→permission graph is identical per tenant); tenant DATA isolation is via
  the per-store physical separation above. Per-tenant OpenFGA stores are a mesh-authz architecture
  decision, deferred.
- **JWT verification reachability:** `jwt` mode verifies against the issuer's JWKS. In the mesh
  deploy the token `iss` is the public host; confirm the backends can reach that JWKS (or point
  `TENANCY_JWKS_ISSUER_BASE` + JWKS at the in-cluster mesh Keycloak) — validated per deployment.
- **Postgres owner credential (SEC-M4 follow-up):** `POSTGRES_PASSWORD` is still the default
  `postgres` in the current deploy. It is the DB owner cred, internal-only (Postgres is not exposed
  outside the cluster). Rotating it is high-risk (baked into the running DB + every
  DATABASE_URL/APP_DATABASE_URL + the worker's OWNER_DATABASE_URL) and should be a planned
  maintenance step in the deploy bundle, not an app-repo change. The MinIO root password WAS rotated
  (2026-08-13). Tracked as a deploy follow-up.
- **Worker owner connection (SEC-M2 follow-up):** `policy-checker-worker` uses `OWNER_DATABASE_URL`
  SOLELY to enumerate the tenant schemas for its per-tenant evaluation loop; all actual rule
  evaluation runs on the tenant-scoped engine with the role set. Least-privilege hardening = give
  the worker a dedicated role that can only list schemas (or a narrow view) instead of the owner —
  deploy-bundle work, deferred.
- **JWT insecure-mode opt-in (SEC-L1 — CLOSED):** `TENANCY_JWT_VERIFY=false` in
  jwt mode now REQUIRES an explicit `TENANCY_ALLOW_INSECURE_JWT=true`; otherwise `validate()` refuses
  to start. Prevents accidentally shipping with signature verification off.
