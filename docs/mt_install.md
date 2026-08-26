# Multi-tenant install & deployment

How to run the AI Trust Platform in **multi-tenant (MT)** mode, how it differs from the default
single-tenant install, and how tenants are provisioned. This is the deployment companion to
[tenancy-model.md](tenancy-model.md) (the isolation architecture) and [ADR-001](adr/adr-001-tenancy.md)
(the decision record). For the single-tenant install see [k8s/SHOOT-INSTALL.md](../k8s/SHOOT-INSTALL.md).

---

## One codebase, two modes — single is the default

There is **one** codebase. The tenancy mode is chosen entirely at deploy time by the `TENANCY_MODE`
environment variable. **Single-tenant is the default at every layer** — you only get MT when you
explicitly ask for it.

| Layer | Default | Where |
|---|---|---|
| Application code | `single` | `libs/tenancy/config.py` → `os.environ.get("TENANCY_MODE", "single")` — the whole tenancy layer is a **no-op** in single mode |
| `.env.example` | `TENANCY_MODE=single` | shipped default |
| k8s installer (`cd k8s && make up`) | prompts; **Enter = single** | `k8s/scripts/configure-tenancy.sh` |

**How the mode is selected, in priority order:**

1. **Explicit env (non-interactive):** `TENANCY_MODE=jwt make up` → MT. Wins over the prompt.
2. **Interactive prompt:** `make up` asks *"1) single (default) / 2) multi"*. Enter or `1` → single; `2` → MT.
3. **Nothing set anywhere** → the code falls back to `single`.

So: **default install = single-tenant. MT happens only when the user selects it.**

### MT is a selection, not a one-flag flip

Choosing `TENANCY_MODE=jwt` is **necessary but not sufficient**:

- The app **fail-fasts at startup** in `jwt` mode if `TENANCY_JWKS_ISSUER_BASE` is unset
  (`libs/tenancy/config.py::validate()`). A misconfigured MT backend refuses to start.
- Real MT also needs **per-tenant provisioning** (a Keycloak realm, a Postgres schema + role, a
  ClickHouse database, a MinIO bucket prefix per tenant) and per-tenant edge auth. The plain
  `k8s` Helm install with `jwt` alone gives you the jwt *code path* but no tenant provisioning —
  it is intended for single-tenant. **A real MT deployment uses the MSP operator bundle** (below).

---

## MT modes (`TENANCY_MODE`)

| Mode | Tenant source | Use |
|---|---|---|
| `single` (default) | none — one implicit tenant; tenancy code is a no-op | local dev, single-org standalone |
| `jwt` | the **verified** OIDC token (`tenant_id` claim, else org from `iss` `/realms/<org>`) | the shared MT deploy |
| `header` | upstream-injected `X-Tenant-Id` | ONLY behind a trusted proxy that sets it and strips inbound values |

Isolation is **physical per store** (per-tenant Postgres schema + role, ClickHouse database, MinIO
bucket prefix) — see [tenancy-model.md](tenancy-model.md) for the full request→store flow and the
fail-closed guarantees.

### Required env for `jwt` mode

| Env | Purpose |
|---|---|
| `TENANCY_MODE=jwt` | enable token-derived tenancy |
| `TENANCY_JWKS_ISSUER_BASE` | trusted issuer prefix; the token's `iss` must start with it (JWKS derived from the verified `iss`). **App won't start without it.** |
| `TENANT_CLAIM` | JWT claim carrying the tenant (default `tenant_id`) |
| `DATABASE_URL` | the shared login role that `SET LOCAL ROLE`s into each per-tenant role |
| `OWNER_DATABASE_URL` | worker only — owner role that can enumerate the tenant schemas |

---

## How MT is deployed (the MSP operator flow)

MT is delivered as a **Platform Mesh MSP provider**: one shared app is deployed once; each customer
"Enable" creates a **Subscription**, and an operator provisions a tenant *inside* the shared app
(no app-copy per customer).

```
Portal "Enable"  →  Subscription CR (kcp)  →  api-syncagent mirrors it to the shoot
      →  MT operator reconciles:
           • tenantId = the consumer's kcp cluster id;  realm = <org>
           • provisions the tenant's Postgres schema tenant_<org> (+ role t_<org>),
             ClickHouse database tenant_<org>, MinIO bucket, and a per-tenant Keycloak realm
           • stamps a per-tenant oauth2-proxy bound to that realm; host ai-trust-<org>.<suffix>
           • seeds the Subscription's adminEmail as platform_administrator in the shared OpenFGA store
      →  status.url / realm / tenantId flow back; the tenant logs in at its own URL
```

**The initial admin gets ALL permissions automatically.** On every reconcile the operator writes
`user:<adminEmail> → member → role:platform_administrator` to the shared OpenFGA store
(`platform_administrator` grants all permissions — see `libs/authorization/constants.py`). No manual
role assignment is needed for the subscription's first admin.

The shared app runs with `TENANCY_MODE=jwt`, `TENANCY_JWKS_ISSUER_BASE=<keycloak>/realms/`,
`TENANT_CLAIM=tenant_id`. Each request's tenant is resolved from its verified JWT and routed to that
tenant's own stores.

> The operator, its manifests, worker-pool sizing, and cluster-specific values live in the MSP
> operator bundle (kept outside this repo). This document covers the app-side contract; the bundle
> covers the mesh/kcp/operator mechanics.

---

## Adding a tenant (day-2)

1. The customer clicks **Enable** in the portal (or a `Subscription` CR is created in their account).
2. The operator provisions the tenant's stores + realm and seeds the `adminEmail` as
   `platform_administrator`.
3. The tenant opens its URL (`ai-trust-<org>.<suffix>`), logs in via its own realm, and has full
   admin access out of the box.

**New app migrations:** each tenant schema carries its own `alembic_version`. When the app adds a
migration, every existing tenant schema must be upgraded — run a per-tenant `db-migrate`
(`TARGET_SCHEMA=tenant_<org>`, `alembic upgrade head`); `libs/persistence/migrations/env.py` scopes
the run to that schema. Fresh tenants get the current head at provision time.

---

## Verifying an MT admin has full access

The subscription admin (and any built-in `platform_administrator`) resolves all permissions. To
check a user against the shared OpenFGA store:

```
# for each relation the app uses (can_read_systems, …, can_manage_iam), a Check should return allowed=true
POST /stores/<store-id>/check  {"tuple_key":{"user":"user:<email>","relation":"can_read_systems","object":"platform:global"}}
```

The UI reads this via `GET /api/users/v1/me/permissions`. If an admin sees **"No Access"** despite
holding the role, it is almost always a **frontend build** issue, not a grant issue — the
registry/compliance/alerts/overview frontends bake `VITE_USERS_API_BASE` at build time and call
`/api/users/v1/me/permissions` through it; if that build-arg is missing the call fails and every
permission gate denies. Ensure those frontends are built with
`--build-arg VITE_USERS_API_BASE=/api/users/v1`.

---

## Common gotchas

- **App won't start in jwt mode** → `TENANCY_JWKS_ISSUER_BASE` unset. Set the trusted issuer prefix.
- **`/api/...` 500 "No tenant resolved"** → the request reached a backend without a resolved tenant
  (missing/failed JWT). Real browser requests carry the tenant JWT; server-to-server calls must too.
- **OpenFGA model missing a relation** (e.g. a newly-added permission) → `/me/permissions` errors and
  nav collapses. Re-run `openfga-provision` — it diffs the model against `constants.py` and adds any
  new relation + role tuples.
- **Admin "No Access" on a page** → frontend `VITE_USERS_API_BASE` build-arg missing (see above).
- **Single vs MT confusion** → confirm the running mode: `kubectl -n <ns> get deploy users-backend -o jsonpath='{...TENANCY_MODE...}'` (or check the `ai-trust-env` Secret). Default is `single`.
