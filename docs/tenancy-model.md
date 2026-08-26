# Tenancy model

How the AI Trust Platform isolates tenants when run as a shared multi-tenant instance on
Platform Mesh. The decision record is [ADR-001](adr/adr-001-tenancy.md); this document is the
operational reference. For **how to install/deploy** MT (and why single-tenant is the default), see
[mt_install.md](mt_install.md).

Isolation is **physical, per store** — each tenant gets its own Postgres schema (reached through
a per-tenant Postgres role), its own ClickHouse database, and its own MinIO bucket prefix. There
is no in-row tenant discriminator: a request is *routed* to the tenant's own store and Postgres
denies cross-tenant access at the privilege level.

## Modes (`TENANCY_MODE`)

| Mode | Tenant source | Use |
|---|---|---|
| `single` (default) | none — everything is one implicit tenant | local dev + the single-tenant full-copy deploy. All tenancy code is a **no-op**. |
| `jwt` | the **verified** OIDC token: `tenant_id` claim, else org parsed from `iss` `/realms/<org>` | the shared multi-tenant deploy. |
| `header` | an upstream-injected `X-Tenant-Id` | ONLY behind a trusted proxy that sets the header AND strips any inbound client value. |

`libs/tenancy/config.py::validate()` fail-fasts on an invalid mode, and (jwt mode) when
`TENANCY_JWKS_ISSUER_BASE` is unset — a misconfigured backend refuses to start.

## The tenant id

The tenant id = the Platform Mesh **account** (kcp logical-cluster id). See ADR-001 for the
`root:orgs:<org>:<account>` → cluster-id → tenant mapping. One account ⇄ one cluster id ⇄
one tenant. The org's Keycloak realm mints the tenant into the token (in the `tenant_id` claim);
realm name == org account. The tenant string is used to derive the tenant's store names:
`tenant_<org>` Postgres schema, `t_<org>` Postgres role, `tenant_<org>` ClickHouse database, and
the `t/<tenant>/…` MinIO object-key prefix (`-`→`_` where an identifier is required).

## Request → store flow (jwt mode)

1. **Edge:** per-org oauth2-proxy authenticates against the org's mesh Keycloak realm and forwards
   `Authorization: Bearer <JWT>`. The shell nginx **strips** any client-supplied `X-Tenant-Id`
   (SEC-C1) and does NOT set CORS wildcards; it adds CSP `frame-ancestors 'self'`, HSTS, nosniff.
2. **Resolve (`libs/tenancy/resolver.py`):** in jwt mode the tenant comes SOLELY from the token.
   The JWT is **verified** (RS256 signature via the issuer's JWKS, `exp`, and `iss` must start
   with `TENANCY_JWKS_ISSUER_BASE`) — SEC-C2. A client `X-Tenant-Id` is ignored in jwt mode.
3. **Propagate (`context.py`):** the resolved tenant is stored in `tenant_id_var` (a ContextVar),
   which flows through every `await` in the request — no explicit passing. This ContextVar is the
   single routing signal every store reads.
4. **Postgres (`session.py`):** a SQLAlchemy `begin` hook, per transaction, points `search_path`
   at the tenant's own schema (`tenant_<org>`) and `SET LOCAL ROLE`s to the per-tenant role
   (`t_<org>`). That role has `USAGE` on ONLY its own schema, so Postgres itself **denies** any
   cross-tenant access at the privilege level — a hard deny, not a filter (SEC-M1). Fail-closed:
   no valid tenant → no role switch and `search_path=public` (no tenant tables reachable).
5. **ClickHouse:** each tenant's spans/alerts live in that tenant's OWN database (`tenant_<org>`).
   Reads and writes go through a per-tenant client (`get_client_for_tenant(current_tenant())`),
   so queries use UNQUALIFIED table names that resolve against the tenant's database — no in-row
   filter. The instrumented app emits its tenant as the OTLP resource attribute
   `ai_trust.tenant_id`; the consumer routes each span to that tenant's database (SEC-C3).
   Fail-closed: no tenant → the legacy `otel` database, which holds no real tenant rows.
6. **MinIO:** new evidence object keys are prefixed `t/<tenant>/evidence/...`; downloads use the
   key stored on the tenant-scoped evidence row, so cross-tenant download is blocked at the DB
   (that row is only reachable inside the tenant's own schema). SEC-C3.

## Fail-closed guarantees

- Unresolved tenant in jwt mode → HTTP 401 (middleware).
- Forged / unsigned / wrong-issuer token → tenant unresolved (verification fails).
- A tenant can never reach another tenant's rows: the per-tenant Postgres role has no privilege
  on any other schema, and ClickHouse/MinIO are physically separate databases/buckets.
- `TENANCY_MODE=single` → all of the above is a no-op.

## Non-request contexts

`policy-checker-worker` has no HTTP request: it enumerates the tenants from the per-tenant
Postgres schemas via an owner connection (`OWNER_DATABASE_URL`) and sets `tenant_id_var` per
pass, so the schema/role routing hook and the per-tenant ClickHouse client scope each tenant's
evaluation to that tenant's own stores. It falls back to a single unscoped pass only when no
owner URL is set (single-tenant / local).

## Configuration (jwt mode)

| Env | Purpose |
|---|---|
| `TENANCY_MODE=jwt` | enable token-derived tenancy |
| `TENANT_CLAIM` | JWT claim carrying the tenant (default `tenant_id`) |
| `TENANCY_JWKS_ISSUER_BASE` | trusted issuer prefix; `iss` must start with it (JWKS derived from verified iss) |
| `TENANCY_JWT_AUDIENCE` | optional `aud` check |
| `TENANCY_JWT_VERIFY` | default `true`; `false` only for controlled test/dev |
| `DATABASE_URL` | runtime = the shared login role that `SET LOCAL ROLE`s into the per-tenant role |
| `OWNER_DATABASE_URL` | worker only — owner role that can list the tenant schemas |

## Tests

`libs/tenancy/tests/test_resolver.py` (unit: X-Tenant-Id ignored in jwt mode; unsigned/wrong-iss
→ None; iss fallback; config fail-fast) covers tenant resolution. Physical store isolation
(per-tenant schema/role, database, bucket) is exercised by the deploy/provisioning integration
suites.
