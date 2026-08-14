# AI Trust Platform — Multi‑Tenancy Architecture (`infrastructure_mt.md`)

> **Audience:** developers new to the multi‑tenant (MT) variant of the AI Trust Platform. This
> explains **what** we built, **why**, and **how it works end‑to‑end**, so you can reason about,
> extend, operate, and debug it. Read top‑to‑bottom once; then use it as a reference.
>
> **Status:** live on the Gardener shoot `ai-trust-1` (namespace `aitrust-mt-msp`), operator
> `mirceacraciun795/aitrust-mt-operator:v18`, app images tag `aitrust-mt` built from app‑repo branch
> `mircea-mt2`. Change log with the blow‑by‑blow is in `Standard_AiTrust_MT_MSP/CHANGES_2026-08-14.md`.

---

## 1. The big picture — what "multi‑tenant" means here

There are **two** ways to run the AI Trust Platform:

- **Single‑tenant (standalone):** one full copy of the app per customer. Simple, but N copies to
  run/upgrade. This is the default (`TENANCY_MODE=single`) and is **unchanged** by all the MT work.
- **Multi‑tenant (this doc):** **ONE shared app** serves **many customer orgs**. A customer
  "subscribes" and the platform provisions a **tenant** inside the shared app. No app copy is
  stamped per customer. This is `TENANCY_MODE=jwt`.

**Vocabulary (they are all the same string):**

```
org  ==  mesh Keycloak realm  ==  tenant_id (JWT claim)  ==  the tenant
```

A tenant is identified everywhere by its **org** name (e.g. `fridaytest`, `mirceatest`). That one
string is: the Keycloak realm the tenant's users log into, the `tenant_id` claim in their JWT, the
Postgres schema/role name, the ClickHouse database name, and the MinIO bucket name.

**Per‑tenant host:** each tenant reaches the shared app at its own hostname
`https://ai-trust-mt-<org>.<domainSuffix>` (e.g. `ai-trust-mt-fridaytest.ai-trust-1.ai-trust.shoot…`).
The wildcard `*.<domainSuffix>` DNS + cert cover every org, so onboarding a tenant needs no new DNS/cert.

---

## 2. Why we did this (the goals)

1. **One app, many customers** — operational simplicity + cost. Upgrades/patches land once.
2. **Strong data isolation** — this is an EU AI Act *compliance* platform; a customer's AI‑system
   inventory, assessments, evidence, and telemetry must never leak to another customer. We ended up
   choosing the **strongest practical isolation**: physically separate storage per tenant, with a
   database‑enforced access wall — *not just* application‑level row filtering.
3. **Fail‑closed everywhere** — if the tenant can't be determined, the system must show/return
   **nothing**, never another tenant's data or everyone's data.

---

## 3. Request lifecycle (follow one request end‑to‑end)

```
Browser → https://ai-trust-mt-<org>.<suffix>/...
   │
   ▼
[per‑org oauth2-proxy]  (one Deployment per tenant: oauth2-proxy-<org>)
   │  - bound to mesh Keycloak realm <org>
   │  - user logs in at Keycloak → proxy holds the session, forwards the JWT
   │  - JWT carries claim  tenant_id=<org>  (a hardcoded-claim mapper on the realm's client)
   ▼
[shell (nginx)]  → routes /registry, /compliance, /api/*, … to the shared MFEs/backends
   │  - forwards Authorization: Bearer <JWT> + X-Forwarded-Preferred-Username
   ▼
[shared backend]  (ONE deployment each: compliance-backend, users-backend, …)
   │  1. libs/tenancy middleware verifies the JWT (JWKS, exp, allow-listed issuer) →
   │     resolves the tenant and stores it in a ContextVar (tenant_id_var).
   │  2. Every DB transaction / CH query / MinIO op reads that ContextVar and routes to
   │     the tenant's OWN Postgres schema / ClickHouse database / MinIO bucket.
   │  3. Authorization (who can do what) is OpenFGA (roles); identity is Keycloak.
   ▼
[per‑tenant storage]  Postgres schema tenant_<org> · ClickHouse db tenant_<org> · MinIO bucket tenant-<org>
```

The key insight: **the tenant is resolved once (from the verified JWT) into a ContextVar, and all
storage access routes off that ContextVar** — so individual routers/queries didn't have to change.

---

## 4. `libs/tenancy` — the heart of it

`ai-trust-platform-git/libs/tenancy/ai_trust_tenancy/`

| File | Responsibility |
|---|---|
| `config.py` | Reads `TENANCY_MODE` (`single`\|`jwt`\|`header`), `TENANT_CLAIM` (default `tenant_id`), `TENANCY_JWKS_ISSUER_BASE`, audience/verify flags. `validate()` fail‑fasts on misconfig. |
| `context.py` | `tenant_id_var: ContextVar[str|None]` — the resolved tenant for the current request. Propagates through `await` automatically (like a correlation id). `None` = no tenant. |
| `resolver.py` | `resolve_tenant(request)` — in jwt mode: extract the Bearer token, **verify** it (signature via the issuer's JWKS, expiry, and the issuer must start with `TENANCY_JWKS_ISSUER_BASE`), then read `tenant_id` claim (fallback: the realm segment of the issuer). Fail‑closed: any failure → `None`. Also supports a pluggable custom resolver via `TENANCY_RESOLVER`. |
| `middleware.py` | FastAPI middleware: calls `resolve_tenant`, sets `tenant_id_var`. Installed by each backend's `main.py` (`install_tenant_middleware(app)`). |
| `session.py` | **The DB routing seam.** Registers a SQLAlchemy `begin` hook so every transaction, per request, does: `SET search_path='tenant_<org>,public'`, `SET app.current_tenant='<org>'`, and `SET LOCAL ROLE t_<org>`. Fail‑closed to `public` + no role when no tenant. (See §5.) |

**Why a ContextVar + engine hook, not per‑route code?** It covers **every** `async with SessionLocal()`
block with zero call‑site edits, and it can't be forgotten by a new router.

---

## 5. Isolation model — the "much safer" design

We isolate at **three layers of storage**, each **physically per‑tenant**, and keep the old
row‑level filters as a **backup** (belt‑and‑suspenders). This was a deliberate choice over the
simpler "shared table + `tenant_id` column" approach, for a compliance product.

### 5a. Postgres — schema‑per‑tenant + per‑tenant role (the hard wall)

- Each tenant has its own **schema** `tenant_<org>` (org with `-`→`_`), containing the **full table
  set** (including duplicated catalog tables: `frameworks`, `model_cards`, `custom_roles`) + its own
  `alembic_version` + the RLS policies (backup layer).
- Each tenant has its own **Postgres role** `t_<org>` (NOLOGIN) that has privileges on **only** its
  own schema.
- The shared login role **`ai_trust_app`** is `NOINHERIT` and holds **no ambient access** to any
  tenant schema. It is a *member* of every `t_<org>` — but the membership is granted
  `WITH INHERIT FALSE`, so it gets nothing until it explicitly `SET ROLE t_<org>` (done per‑request by
  the `session.py` hook).

**Net effect:** even if application code has a bug (missing WHERE, wrong `search_path`, RLS mistake),
Postgres itself returns **`permission denied for schema tenant_<other>`** — cross‑tenant access is
impossible. RLS + the `tenant_id` column still exist inside each schema as a second line of defense.

> ⚠️ **PG16 gotcha (cost us hours, don't repeat):** `pg_auth_members.inherit_option` is snapshotted at
> GRANT time and **overrides** the role‑level `NOINHERIT`. So you MUST set `ai_trust_app NOINHERIT`
> **before** granting memberships, AND grant them `WITH INHERIT FALSE` explicitly. A plain
> `GRANT t_x TO ai_trust_app` issued before NOINHERIT silently leaves `inherit_option=true` →
> ambient cross‑tenant access. The provisioning Job does both correctly.

### 5b. ClickHouse — database‑per‑tenant

- Each tenant has its own **database** `tenant_<org>` with the full CH schema (`gen_ai_spans`,
  `alert_events`, `schema_migrations`).
- **Reads:** `ch_query`/`ch_command` (in `libs/clickhouse/async_utils.py`) connect via
  `get_client_for_tenant(current_tenant())` → the tenant's DB. Table names are **unqualified**
  (`gen_ai_spans`, not `otel.gen_ai_spans`) so they resolve against the per‑tenant connection.
  Fail‑closed: no tenant → the legacy `otel` DB, which holds no real tenant rows.
- **Writes (the interesting part):** the `clickhouse-consumer` reads spans off RabbitMQ (no HTTP/JWT
  on this path). It learns the tenant from the OTLP resource/span attribute **`ai_trust.tenant_id`**
  (the instrumented app emits it). The consumer groups each batch by that value and inserts into the
  matching `tenant_<org>` DB (cached per‑tenant clients). Empty tenant → legacy `otel` DB (kept, not
  dropped — backward compatible).
- ClickHouse has **no row‑level security**; the `tenant_id` column + `tenant_clause()` filter remain
  as the backup layer.

### 5c. MinIO — bucket‑per‑tenant

- Each tenant's evidence files live in its own bucket **`tenant-<org>`** (lowercase, `_`→`-`, DNS‑safe).
- `compliance/backend/app/minio_client.py` resolves the bucket per operation from `tenant_id_var`.
  jwt mode is **fail‑closed**: no tenant → it *raises* (400), never falls back to a shared bucket.
  `single` mode keeps the legacy shared `evidence-files` bucket.
- Object keys are the simple `evidence/{id}/{file}` layout (the bucket now provides isolation).

### Isolation summary

| Store | Physical unit per tenant | Enforcement | Backup layer |
|---|---|---|---|
| Postgres | schema `tenant_<org>` | **DB role wall** (`SET ROLE t_<org>`, NOINHERIT) | RLS + `tenant_id` column |
| ClickHouse | database `tenant_<org>` | connection routing (per‑tenant client) | `tenant_id` column + `tenant_clause()` |
| MinIO | bucket `tenant-<org>` | bucket resolved per request, fail‑closed | (n/a — bucket is the unit) |

---

## 6. Auth — Keycloak vs OpenFGA (hard separation)

- **Keycloak = authentication** (who you are). Each org is its **own realm** in the mesh Keycloak.
  A user logs into `realms/<org>`. The realm's `aitrust-mt-app` OIDC client has a hardcoded‑claim
  mapper that stamps `tenant_id=<org>` into every token.
- **OpenFGA = authorization** (what you can do). ONE shared OpenFGA store holds role→permission
  tuples on a global `platform:global` object. The backend derives the user subject from the
  `preferred_username` the proxy forwards and asks OpenFGA. There is currently **one shared store**
  (authz is not per‑tenant‑partitioned; data isolation is what the storage layers provide).
- **IAM user management is per‑tenant:** the `users-backend` creates/lists users in the **request's
  tenant realm** (resolved from `tenant_id_var`), authenticating to Keycloak with the mesh
  bootstrap‑admin creds. (Earlier it was hard‑wired to one realm → new users landed in the wrong
  realm and couldn't log in. Fixed.)
- **Logout is front‑channel:** the shell's Sign‑out builds
  `/oauth2/sign_out?rd=<keycloak realm logout with post_logout_redirect_uri=<origin>/oauth2/start>`.
  A backchannel‑only logout leaves the Keycloak SSO cookie alive → silent re‑login. The per‑tenant
  `aitrust-mt-app` client has `post.logout.redirect.uris` set so Keycloak accepts the redirect back.

---

## 7. The subscription operator (how a tenant gets provisioned)

`Standard_AiTrust_MT_MSP/operator/` (Go, controller‑runtime; templates in `operator/manifests/*.tmpl`
are **`//go:embed`‑baked into the binary** — editing a template requires rebuilding + rolling the
operator image, and bumping `OPERATOR_TAG`).

A customer clicks **Enable** in the Platform Mesh portal → a **Subscription** CR is created (its
`spec.org` = the org/realm). The operator reconciles it. Per Subscription, in order:

1. **One‑subscription‑per‑org guard** — the tenant URL/schema/etc. are all derived from `spec.org`,
   so a second Subscription for the same org would collide. The operator refuses duplicates
   (oldest active sub wins) → **Degraded** with a clear "only one subscription per organization"
   message. (See `orgOwner()` in `main.go`.)
2. **Realm gate** — verify the mesh Keycloak realm `<org>` actually exists (fail‑closed; a phantom
   org → Degraded, nothing stamped).
3. **Per‑tenant stores** (`tenant-stores-job.tmpl`, gates Ready on success) — ONE Job that provisions
   all three stores idempotently:
   - init `ch-migrate`: `CREATE DATABASE tenant_<org>` + run CH migrations into it.
   - init `minio-bucket`: `mc mb tenant-<org>`.
   - main `provision` (Postgres): create schema, `alembic upgrade head` with `TARGET_SCHEMA`, create
     role `t_<org>` (schema‑only), `GRANT t_<org> TO ai_trust_app WITH INHERIT FALSE`, revoke any
     direct `ai_trust_app` grants.
4. **Per‑org OIDC client** (`keycloak-client-job.tmpl`) — creates/updates the `aitrust-mt-app` client
   in realm `<org>` with the `tenant_id` mapper + `post.logout.redirect.uris`.
5. **Per‑org oauth2‑proxy** (`oauth2-proxy-org.tmpl`) — Deployment + Service + HTTPRoute +
   ReferenceGrant for host `ai-trust-mt-<org>.<suffix>`, bound to realm `<org>`.
6. **OpenFGA admin tuple** — seeds the org admin (`spec.adminEmail`) as platform_administrator.
7. **Status Ready** — with the tenant URL. (Until stores + auth are provisioned it sits
   `Provisioning`/`Degraded` — the host is never advertised before its stores exist.)

**Naming derivations (must stay consistent across operator, `session.py`, `libs/clickhouse`,
`minio_client.py`):**

```
Postgres schema / CH database :  tenant_<org>     (org: '-' → '_')
Postgres role                 :  t_<org>          (org: '-' → '_')
MinIO bucket                  :  tenant-<org>     (org: lowercase, '_' → '-')
Per-tenant host               :  ai-trust-mt-<org>.<domainSuffix>
```

---

## 8. Migrations — now N× (per tenant)

- **Postgres:** `libs/persistence/.../migrations/env.py` honors `TARGET_SCHEMA`. `alembic upgrade head`
  with `TARGET_SCHEMA=tenant_<org>` builds the whole schema in that tenant's schema (via
  `schema_translate_map` for Core DDL + session `search_path` for raw‑SQL RLS migrations +
  `version_table_schema`). Default `public` = single‑tenant unchanged.
- **ClickHouse:** `libs/clickhouse/migrate.py` honors `TARGET_CH_DB` (default `otel`) and rewrites the
  `otel.` prefix to the target DB.
- **Consequence:** a new migration must run against **every** tenant schema/DB, and every **new
  tenant** gets a fresh full migrate at provision time. Never hardcode `public.` / `otel.` in a
  migration in a way the rewrite can't handle. Adding a migration = re‑run the provisioning path
  (delete + let the operator re‑stamp the `tenant-stores` Job, or run the migrate image per tenant).

---

## 9. Fail‑closed behavior (memorize this)

| Situation | Result |
|---|---|
| No valid JWT / tenant unresolved (jwt mode) | Postgres: `search_path=public`, no `SET ROLE` → no tenant data. CH reads: legacy `otel` (empty of tenant rows). MinIO: **raises** (refuses). |
| App code forgets `SET ROLE` | Postgres denies the tenant schema (role wall). |
| Cross‑tenant query as the wrong role | `permission denied for schema tenant_<other>`. |
| CH span with empty `ai_trust.tenant_id` | Written to legacy `otel` DB (not another tenant, not dropped). |
| Duplicate subscription for an org | Degraded — "only one subscription per organization". |
| Phantom org (no realm) | Degraded at the realm gate; nothing stamped. |

---

## 10. Operating it (common tasks)

- **Deploy from source:** build operator (`scripts/2-build-operator-image.sh`) + app images
  (`scripts/2b-build-app-images.sh`), deploy shared app (`scripts/3b-shared-app.sh`), then Subscriptions.
  Config in `prerequisites/config.env` (`OPERATOR_TAG`, `TAG`, domain, etc.).
- **Editing an operator template** (`manifests/*.tmpl`): it's embedded → **rebuild + push the operator
  image with a new `OPERATOR_TAG`**, roll `deploy/aitrust-mt-operator`. Rolling the same tag is a
  cache no‑op. Then re‑stamp existing tenants (delete the `tenant-stores-<org>` / `kc-client-<org>`
  Job and let reconcile recreate it, or bump an annotation on the Subscription).
- **Shoot access (Gardener):** the admin kubeconfig is short‑lived (~4h). Re‑mint after
  `prerequisites/login.sh` (browser flow — a human must do it). Scripts live under `.state/`.
- **luigi-config.js** (shell nav/logout) is served `Cache-Control: no-cache` — config changes
  propagate on next load. If a rebuilt frontend is missing a `VITE_*` value, rebuild with
  `--no-cache` (Docker layer cache can reuse an arg‑less `npm run build`).

---

## 11. Debugging playbook (symptom → where to look)

| Symptom | Likely cause / where |
|---|---|
| Menus show "no access" | A frontend MFE crashed on a missing `VITE_*` build arg (e.g. overview/users need `VITE_USERS_API_BASE`). Check the browser console + grep the served bundle. |
| Logged in but every `/api/*` → 403 | Stale browser session (oauth2-proxy rejecting the cookie) — re‑login / incognito. Not a backend bug if `/health` (internal) is 200. |
| New user can't log in | User created in the wrong Keycloak realm, or `UPDATE_PASSWORD` required action (temp password → forced reset on first login, which is intended). Check the realm's users via kcadm. |
| Logout "doesn't work" (still logged in after refresh) | Front‑channel logout / `post.logout.redirect.uris` / SSO cookie. See §6. |
| Cross‑tenant data visible | Should be impossible — verify `ai_trust_app` is `NOINHERIT`, memberships are `WITH INHERIT FALSE` (check `pg_auth_members.inherit_option`), and the session hook is firing `SET ROLE`. |
| Tenant stuck `Provisioning` | The `tenant-stores-<org>` Job hasn't succeeded — check its init container logs (`ch-migrate`, `minio-bucket`) and the main `provision` container. |

---

## 12. Where things live

**App repo `ai-trust-platform-git` (branch `mircea-mt2`):**
- `libs/tenancy/` — resolver, middleware, ContextVar, DB session hook, config.
- `libs/persistence/.../migrations/env.py` — `TARGET_SCHEMA` schema‑per‑tenant migrations; `0009–0011` = RLS.
- `libs/clickhouse/` — `database.py` (`get_client_for_tenant`, `db_for_tenant`), `async_utils.py`
  (tenant‑routed `ch_query`), `tables.py` (unqualified names), `migrate.py` (`TARGET_CH_DB`).
- `consumers/clickhouse-consumer/main.py` — per‑tenant write routing.
- `compliance/backend/app/minio_client.py` — bucket‑per‑tenant.
- `users/backend/app/keycloak.py` + `routers/users.py` — per‑tenant IAM.
- `shell/public/luigi-config.js` + `shell/nginx.conf` — front‑channel logout + no‑cache.

**MT deploy bundle `Standard_AiTrust_MT_MSP/`:**
- `operator/main.go`, `operator/helpers.go`, `operator/manifests/*.tmpl` — the subscription operator.
- `config/k8s-app/*` , `config/shared-app/*` — the shared app manifests + MT overlay (pg‑init with the
  `ai_trust_app` NOINHERIT role, `TENANCY_MODE=jwt` app‑config).
- `charts/aitrust-mt-app/` , `charts/aitrust-mt-pm-app/` — helm charts (operator env/values, portal ContentConfiguration).
- `scripts/` — build/deploy/verify.
- `prerequisites/config.env` — the single knob file. `CHANGES_2026-08-14.md` — the detailed history.

---

## 13. Known limitations / follow‑ups

- **Migrations scale linearly** with tenant count (N× per schema change). Fine for tens of tenants;
  revisit if it grows large.
- **Duplicated catalog** (frameworks/model_cards/custom_roles per schema) means a catalog change must
  re‑seed every schema — no shared‑catalog reconcile pass exists yet.
- **OpenFGA is a single shared store** (authz global roles). Data isolation is the storage layers, not
  OpenFGA partitioning. Fine today; note it if you extend authz.
- **The shared `ai-trust-mt.<suffix>` host** (bare, non‑tenant) still binds to the `poc2` realm and is
  not part of the per‑tenant flow — cosmetic follow‑up.
- **CH ingest depends on the app emitting `ai_trust.tenant_id`** — spans without it are "legacy"
  (`otel` DB). This contract must be honored by instrumented apps for real per‑tenant telemetry.
- **Source is not yet pushed:** the `mircea-mt2` app‑repo commits are unpushed to origin, and the
  bundle is version‑controlled separately. Until pushed, build with `2b-build-app-images.sh --skip-clone`.

---

## 14. One‑paragraph summary for the impatient

The shared multi‑tenant AI Trust Platform runs **one** app for **many** orgs. Every request arrives on
a per‑org host, authenticates against that org's own Keycloak realm, and carries a verified
`tenant_id` claim. `libs/tenancy` resolves that into a ContextVar, and every storage access routes off
it to the tenant's **own Postgres schema (with a `SET ROLE` DB‑enforced wall), ClickHouse database, and
MinIO bucket** — with RLS/`tenant_id` filters retained as a backup. A Go **subscription operator**
provisions all of that per tenant, idempotently, gating the tenant Ready until its stores exist.
Everything is **fail‑closed**: no tenant → no data.
