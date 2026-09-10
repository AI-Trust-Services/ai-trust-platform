# 05 — Multi-tenant mesh deployments (the per-tenant realm caveat)

*Audience: operators running the platform as a multi-tenant (MSP / Platform Mesh) tenant. Advanced.*

> **TL;DR** — On a multi-tenant deployment you log in against a **per-tenant Keycloak realm** (e.g. `test`),
> not the built-in single-tenant realm `ai-trust`. The Marketplace backend, by default, mints an SSO app's
> login client in `ai-trust`. If those don't match, a Platform-SSO app will deploy "successfully" but its
> login will bounce or dead-end. You must point the `marketplace-backend` at the **mesh** Keycloak and the
> **tenant's realm** first.

---

## 5.1 Why this happens

The existing marketplace docs and the deploy code were written for the **single-tenant** shape:

- One Keycloak, one realm named **`ai-trust`**.
- The deploy path calls `keycloak.ensure_app_client(...)`, which creates the per-app client
  `aitrust-app-<slug>` in the realm named by the backend's `KEYCLOAK_REALM` env — **default `ai-trust`** —
  on the Keycloak at `KEYCLOAK_URL` / `KEYCLOAK_PUBLIC_URL`.

On a **multi-tenant mesh / MSP** deployment the shape is different:

- Each tenant authenticates against its **own realm** in the shared **mesh** Keycloak — e.g. realm `test`
  for tenant `test`. That's the realm your browser login uses.
- The tenant's app namespace *also* ships a small local Keycloak (used for other purposes) that still has
  the old `ai-trust` realm.

So out of the box the mismatch is:

| | Your tenant login | What the SSO deploy uses (defaults) |
|---|---|---|
| Keycloak | **mesh** (`keycloak-service.platform-mesh-system…`) | local `keycloak` in the tenant namespace |
| Realm | **`<org>`** (e.g. `test`) | `ai-trust` |
| Users | your real users | only a local `admin` |

The app's sidecar would send the user to `…/realms/ai-trust/...` to log in — a *different* Keycloak and
realm than the session they already have — so SSO can't transfer.

---

## 5.2 The fix — point `marketplace-backend` at the mesh realm

Override five environment variables on the tenant's `marketplace-backend` deployment so the SSO app path
uses the **same** Keycloak + realm the user logs in with:

```bash
NS=aitrust-<tenant-ns>          # e.g. aitrust-market
ORG=<org>                       # e.g. test  — the tenant's mesh realm

MESH_KC_INTERNAL="http://keycloak-service.platform-mesh-system.svc.cluster.local:8080/keycloak"
MESH_KC_PUBLIC="https://<apex-host>/keycloak"   # the shoot's apex Keycloak host (what Keycloak advertises)

MU=$(kubectl -n "$NS" get secret mesh-keycloak-admin -o jsonpath='{.data.username}' | base64 -d)
MP=$(kubectl -n "$NS" get secret mesh-keycloak-admin -o jsonpath='{.data.password}' | base64 -d)

kubectl -n "$NS" set env deploy/marketplace-backend \
  KEYCLOAK_URL="$MESH_KC_INTERNAL" \
  KEYCLOAK_REALM="$ORG" \
  KEYCLOAK_PUBLIC_URL="$MESH_KC_PUBLIC" \
  KEYCLOAK_ADMIN="$MU" \
  KEYCLOAK_ADMIN_PASSWORD="$MP"
kubectl -n "$NS" rollout status deploy/marketplace-backend --timeout=90s
```

What each does:

| Var | Set to | Why |
|-----|--------|-----|
| `KEYCLOAK_URL` | mesh internal Keycloak (`…svc.cluster.local:8080/keycloak`) | Back-channel: where the backend creates the client + reads its secret. |
| `KEYCLOAK_REALM` | the tenant org, e.g. `test` | So `aitrust-app-<slug>` is created in the realm you log into. |
| `KEYCLOAK_PUBLIC_URL` | mesh apex Keycloak host + `/keycloak` | Becomes the app's browser-facing `OIDC_ISSUER` (realm `<org>`). |
| `KEYCLOAK_ADMIN` / `_PASSWORD` | the **mesh** admin creds (`mesh-keycloak-admin` secret) | The default `app-secrets` creds are for the *local* Keycloak; the mesh realm needs the mesh admin. |

**Precondition to check first:** the mesh admin must be able to manage clients in the tenant realm. Verify
before you deploy any SSO app:

```bash
# get a mesh master token with the mesh admin creds, then:
curl -s -o /dev/null -w "%{http_code}\n" \
  "<MESH_KC_PUBLIC>/admin/realms/<org>/clients?max=1" \
  -H "Authorization: Bearer <token>"     # expect 200
```

After the override, a deployed SSO app receives
`OIDC_ISSUER = https://<apex-host>/keycloak/realms/<org>` — the same realm as your session — and SSO
transfers silently.

---

## 5.3 Symptom → cause quick reference (MT-specific)

| Symptom | Cause | Fix |
|---------|-------|-----|
| SSO app opens but bounces to a login you can't satisfy / "client not found" | `marketplace-backend` minted the client in realm `ai-trust`, not your tenant realm | §5.2 override, then re-deploy the app |
| Deploy "succeeds" but the app's login page is a *different* Keycloak host | `KEYCLOAK_PUBLIC_URL` still points at the local/app host | Set it to the mesh apex `…/keycloak` (§5.2) |
| Client-creation step fails on deploy | backend still using local `admin` creds against the mesh realm | Set `KEYCLOAK_ADMIN`/`_PASSWORD` from `mesh-keycloak-admin` (§5.2) |

---

## 5.4 Important caveat about durability

The commands in §5.2 are a **runtime override** on the live deployment. If the platform/operator
re-reconciles the tenant or redeploys it from the Helm chart / gold manifests, these env values can revert
to the single-tenant defaults, and you'd have to re-apply them.

The **durable** fix belongs upstream: the operator / gold manifests should set `KEYCLOAK_REALM=<org>`,
point `KEYCLOAK_URL`/`KEYCLOAK_PUBLIC_URL` at the mesh Keycloak, and mount the mesh admin creds for
`marketplace-backend` **per tenant**. Until that lands, treat §5.2 as a required post-deploy step on each
tenant, and re-check it after any tenant redeploy.

---

## 5.5 Related platform-side facts (context)

These aren't SSO-app-specific, but they're part of the same MT surface and are worth knowing when
diagnosing "the app deployed but nothing works":

- **Per-tenant login URL** must be an **absolute** URL on the mesh apex Keycloak host, or the tenant itself
  redirect-loops (`ERR_TOO_MANY_REDIRECTS`). This is the tenant's own oauth2-proxy, upstream of the
  Marketplace.
- **OpenFGA store id** must be injected into every backend (not left as a `__OPENFGA_STORE_ID__`
  placeholder), or all permission checks fail closed (403 everywhere, empty nav).
- **The OpenFGA model** in the tenant store must include every permission the app version uses (e.g.
  `can_manage_marketplace`), or the "list my permissions" call 400s and the nav collapses to Overview only.

These are tenant-provisioning concerns handled during platform deploy; they're listed here so that if the
Marketplace itself looks broken, you can rule them in or out. See [`06-troubleshooting.md`](./06-troubleshooting.md).
