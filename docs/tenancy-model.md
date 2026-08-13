# Tenancy model

How the AI Trust Platform isolates tenants when run as a shared multi-tenant instance on
Platform Mesh. The decision record is [ADR-001](adr/adr-001-tenancy.md); this document is the
operational reference.

## Modes (`TENANCY_MODE`)

| Mode | Tenant source | Use |
|---|---|---|
| `single` (default) | none — everything is one implicit tenant | local dev + the single-tenant full-copy deploy. All tenancy code is a **no-op**. |
| `jwt` | the **verified** OIDC token: `tenant_id` claim, else org parsed from `iss` `/realms/<org>` | the shared multi-tenant deploy. |
| `header` | an upstream-injected `X-Tenant-Id` | ONLY behind a trusted proxy that sets the header AND strips any inbound client value. |

`libs/tenancy/config.py::validate()` fail-fasts on an invalid mode, and (jwt mode) when
`TENANCY_JWKS_ISSUER_BASE` is unset — a misconfigured backend refuses to start.

## The tenant id

`tenant_id` = the Platform Mesh **account** (kcp logical-cluster id). See ADR-001 for the
`root:orgs:<org>:<account>` → cluster-id → `tenant_id` mapping. One account ⇄ one cluster id ⇄
one tenant. The org's Keycloak realm mints `tenant_id` into the token; realm name == org account.

## Request → row flow (jwt mode)

1. **Edge:** per-org oauth2-proxy authenticates against the org's mesh Keycloak realm and forwards
   `Authorization: Bearer <JWT>`. The shell nginx **strips** any client-supplied `X-Tenant-Id`
   (SEC-C1) and does NOT set CORS wildcards; it adds CSP `frame-ancestors 'self'`, HSTS, nosniff.
2. **Resolve (`libs/tenancy/resolver.py`):** in jwt mode the tenant comes SOLELY from the token.
   The JWT is **verified** (RS256 signature via the issuer's JWKS, `exp`, and `iss` must start
   with `TENANCY_JWKS_ISSUER_BASE`) — SEC-C2. A client `X-Tenant-Id` is ignored in jwt mode.
3. **Propagate (`context.py`):** the resolved tenant is stored in `tenant_id_var` (a ContextVar),
   which flows through every `await` in the request — no explicit passing.
4. **Postgres (`session.py`):** a SQLAlchemy `begin` hook issues
   `SELECT set_config('app.current_tenant', <tenant>, true)` per transaction. Row-Level Security
   (migrations 0009 + 0010) then enforces:
   - **read:** `tenant_id = current_setting('app.current_tenant', true) OR tenant_id IS NULL`
     (own rows + shared/catalog rows).
   - **write:** `tenant_id = current_setting('app.current_tenant', true)` (own tenant ONLY — a
     tenant cannot write another tenant's rows nor globally-shared NULL rows). SEC-M1.
   Runtime connects as the non-superuser `ai_trust_app` role (NOBYPASSRLS); migrations/seeders
   run as the owner (bypass, to seed shared catalog rows).
5. **ClickHouse:** no RLS, so `ai_trust_clickhouse.tenant_clause()` adds `AND tenant_id = {tenant}`
   to every read (monitoring, alerts, DTA, worker) and `tenant_id` is stamped on every write.
   Fail-closed: jwt mode with no tenant → `AND 1=0` (no rows). The instrumented app emits its
   tenant as the OTLP resource attribute `ai_trust.tenant_id`. SEC-C3.
6. **MinIO:** new evidence object keys are prefixed `t/<tenant_id>/evidence/...`; downloads use the
   key stored on the RLS-scoped evidence row, so cross-tenant download is blocked at the DB. SEC-C3.

## Fail-closed guarantees

- Unresolved tenant in jwt mode → HTTP 401 (middleware), `AND 1=0` (ClickHouse).
- Forged / unsigned / wrong-issuer token → tenant unresolved (verification fails).
- A tenant can never write another tenant's or a shared (NULL) row (RLS WITH CHECK).
- `TENANCY_MODE=single` → all of the above is a no-op.

## Non-request contexts

`policy-checker-worker` has no HTTP request: it enumerates distinct tenants via an owner
connection (`OWNER_DATABASE_URL`) and sets `tenant_id_var` per pass, so RLS + `tenant_clause()`
scope each tenant's evaluation. It fails to a single unscoped pass only when no owner URL is set
(single-tenant / local).

## Configuration (jwt mode)

| Env | Purpose |
|---|---|
| `TENANCY_MODE=jwt` | enable token-derived tenancy |
| `TENANT_CLAIM` | JWT claim carrying the tenant (default `tenant_id`) |
| `TENANCY_JWKS_ISSUER_BASE` | trusted issuer prefix; `iss` must start with it (JWKS derived from verified iss) |
| `TENANCY_JWT_AUDIENCE` | optional `aud` check |
| `TENANCY_JWT_VERIFY` | default `true`; `false` only for controlled test/dev |
| `DATABASE_URL` | runtime = the RLS-bound `ai_trust_app` role |
| `OWNER_DATABASE_URL` | worker only — owner role for tenant enumeration |

## Tests

`libs/tenancy/tests/test_resolver.py` (unit: X-Tenant-Id ignored in jwt mode; unsigned/wrong-iss
→ None; iss fallback; config fail-fast) and `test_rls_isolation.py` (integration: 2-tenant read
isolation + write-own enforcement, `SET ROLE ai_trust_app`).
