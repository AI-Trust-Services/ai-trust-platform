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
