# 08 — Worked example: onboarding EU Capitals Weather (a real, warts-and-all run)

*Audience: everyone. This is the actual end-to-end story of onboarding one real app onto the live
multi-tenant tenant `ai-trust-test.…` (realm `test`), including every dead end and the fix that worked.
Read this if the clean happy-path docs (02–05) don't match what you're seeing.*

> **Outcome:** the `EU Capitals Weather` app runs embedded in the platform, the user logs in **once**
> (Platform SSO), and the weather UI renders — the app's **own** OIDC login was replaced by the
> platform's. What made it hard: this app happened to ship its *own* full OIDC server, which is the one
> shape the standard sidecar flow can't wrap.

---

## 8.1 The app

`github.com/mirceacraciun/whether-app` — a Node/Express "EU Capitals Weather" demo. Crucially, it is
**self-contained auth**: it embeds its **own** OIDC Identity Provider (`oidc-provider` at `/oidc`) **and**
its own Relying-Party login (`/login`, `/callback`), with its own user store (`admin`/`admin`) and
server-side RBAC (roles → which capitals you may see). Standalone (local), that all works.

That "own OIDC" is the whole reason the standard onboarding fought back.

---

## 8.2 What went wrong, in order (each a real symptom we hit)

| # | Symptom | Root cause | Fix |
|---|---------|------------|-----|
| 1 | Pod `ErrImagePull`: *"no match for platform in manifest"* | The `:sso` image was **arm64-only** (built on an Apple-Silicon Mac; the GitHub Actions build had failed on `write_package`). Gardener nodes are **amd64**. | Rebuild `--platform linux/amd64` with `docker buildx … --push`. |
| 2 | `{"detail":"Upstream '…' unreachable"}` | No running pod (from #1). | Resolved by #1. |
| 3 | `ERR_TOO_MANY_REDIRECTS` | `APP_PUBLIC_URL` on `marketplace-backend` was the **shared-app host** (`ai-trust-market.…`), but the tenant is browsed at **`ai-trust-test.…`** → the OIDC redirect/cookies were cross-origin. | Set `APP_PUBLIC_URL` (and realm wiring, see [`05`](./05-multitenant-mesh-notes.md)) to the **tenant host**; redeploy re-mints the client with the tenant-host callback. |
| 4 | Loop persisted / then `Internal server error` | **Two (then three) OIDC logins stacked**: platform oauth2-proxy → sidecar → the app's *own* IdP. The app's `oidc-provider` interaction cookie couldn't survive the marketplace proxy stripping the `…/proxy/<slug>` path prefix → *"interaction session id cookie not found"* → 500. | Stop stacking logins — see §8.3. |
| 5 | (after switching image) still redirect loop | The image was pushed under a **typo'd ref** once; and the `:sso` sidecar's own session cookie (`SameSite=lax`, `secure:false`) doesn't survive a cross-site **iframe** embed. | Correct the ref; then §8.3. |
| 6 | App loads but **body empty / no weather cards** | The app's frontend fetched **root-absolute** `/api/weather`, which under the embed prefix escaped to the platform origin and failed. | Make the frontend **prefix-aware** — §8.4. |

---

## 8.3 The key decision — replace the app's OIDC with Platform OIDC

The goal was: **the user authenticates once via the platform; the app trusts that identity.** For an app
that has *no* auth of its own, the **sidecar** ([`02`](./02-application-patch.md)) does this for free. But
this app has its **own** OIDC server, so the sidecar just added a *redundant* login that collided with the
app's — the loop.

The fix was to **drop the sidecar** and make the app **consume the platform identity** directly:

1. **Deploy the plain app image (no sidecar)**, registered **without Platform SSO** (`sso_enabled=false`).
   For a non-gated internal app, the marketplace proxy forwards the caller's headers **and the platform
   JWT** (`Authorization: Bearer …`) straight through to the app, unchanged.
2. **How the identity actually arrives (the non-obvious part):** on this multi-tenant deployment the tenant
   oauth2-proxy forwards the identity **only as the JWT in `Authorization: Bearer`** — it does **not** set
   `X-Forwarded-Preferred-Username` (no `--pass-user-headers`). The shell nginx passes `Authorization`
   through to the marketplace backend. So the app must read the identity from the **JWT**, not just a
   header.
3. **Patch the app to trust the platform identity** — read `X-Forwarded-Preferred-Username` if present,
   else decode `preferred_username` from the Bearer JWT — and **skip its own login entirely**:

   ```js
   // rbac.js — decode preferred_username from the platform-verified Bearer JWT
   function decodeJwtPreferredUsername(authHeader) {
     const m = /^Bearer\s+(.+)$/i.exec(String(authHeader || "").trim());
     if (!m) return "";
     const parts = m[1].split(".");
     if (parts.length < 2) return "";
     const json = Buffer.from(parts[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString("utf8");
     return (JSON.parse(json).preferred_username || "").toString().trim();
   }
   function requireAuth(req, res, next) {
     if (req.session?.user) return next();
     if ((process.env.PLATFORM_SSO || "on").toLowerCase() !== "off") {
       const username =
         (req.headers["x-forwarded-preferred-username"] || req.headers["x-forwarded-user"] || "")
           .toString().trim() || decodeJwtPreferredUsername(req.headers["authorization"]);
       if (username) { req.session.user = { username, roles: ["admin", ...] }; return next(); }
     }
     // fall back to the app's own login only if PLATFORM_SSO=off
     …
   }
   ```

   The platform already role-gates *who can open the tile*, so any user who reaches the app is authorized;
   we grant the app's admin role (all capitals).

> **Security note (important):** the JWT is decoded **without** re-verifying its signature — the platform
> proxy already verified it (issuer/audience/signature) against realm `test`. This is safe **only because
> the app pod is reachable exclusively through the platform proxy**. If the pod were directly reachable, a
> spoofed header/JWT would bypass auth. Harden with a NetworkPolicy restricting ingress to the marketplace
> proxy (and optionally verify the JWT against the platform JWKS in the app). This was flagged but not yet
> applied.

---

## 8.4 The last mile — a prefix-aware frontend

Even with auth fixed, the page was blank because the app's browser JS fetched root-absolute API paths.
Embedded under `…/api/marketplace/v1/proxy/eu-capitals-weather/`, `fetch("/api/weather")` resolves against
the **platform origin root**, not the app. Fix: derive the base from the current path and prefix every
API call + redirect:

```js
const API_BASE = (() => {
  const m = window.location.pathname.match(/^(.*\/api\/marketplace\/v1\/proxy\/[^/]+)\//);
  return m ? m[1] : "";           // "" when standalone; the proxy prefix when embedded
})();
const apiUrl = (p) => `${API_BASE}${p}`;
// fetch(apiUrl("/api/weather"))  …  window.location.href = apiUrl("/login")
```

Asset tags (`styles.css`, `app.js`) were already **relative**, so they loaded fine — only the JS `fetch`
calls and the `/logout`/`/login` links were root-absolute. (This is the "app hardcodes root-absolute URLs"
caveat from [`02` §2.8](./02-application-patch.md#28-limits-know-these-before-you-ship).)

---

## 8.5 The final deployed shape (what actually works)

- **Image:** `ghcr.io/mirceacraciun/whether-app:nosso` — the app's **own** Dockerfile (no sidecar), amd64,
  with the patched `rbac.js` (JWT-trust) + prefix-aware `app.js`.
- **Marketplace registration:** Type = prebuilt image; **Platform SSO OFF**; **App port 3000** (the app's
  own port — no sidecar, so no 8080); open mode **embedded** (`same_window`).
- **Identity flow:** tenant oauth2-proxy (realm `test`) authenticates → forwards `Authorization: Bearer` →
  shell nginx → marketplace embed proxy (forwards it) → app decodes `preferred_username` → session. **One
  login.**
- **Verified end-to-end** with a real user: login → embedded EU Capitals Weather UI → `/api/weather`
  returns all 27 capitals with live data. No second login, no loop, no 500.

### Live changes made (all runtime patches — see durability note)
- `marketplace-backend` env: `APP_PUBLIC_URL`, `KEYCLOAK_URL`, `KEYCLOAK_REALM=test`, `KEYCLOAK_PUBLIC_URL`,
  mesh admin creds ([`05`](./05-multitenant-mesh-notes.md)).
- Deployment `mkt-eu-capitals-weather`: image `:nosso`, containerPort 3000, readiness probe 3000.
- Service `mkt-eu-capitals-weather-svc`: targetPort 3000.
- Postgres `public.marketplace_services` row: `image_ref=:nosso`, `app_port=3000`, `sso_enabled=false`,
  `open_mode=same_window`.

---

## 8.6 Lessons (fold these into the mental model)

1. **Two kinds of app, two paths.** An app with **no** auth of its own → use the **sidecar** (Platform SSO
   on). An app that **already does its own OIDC** → do **not** stack the sidecar; deploy it plain and have
   it **trust the platform JWT** (this doc). Stacking OIDC providers is the loop/500.
2. **Identity arrives as a JWT here, not a header.** On this MT deployment the tenant oauth2-proxy forwards
   only `Authorization: Bearer` (no `--pass-user-headers`). Header-only trust silently never fires.
3. **Build amd64.** Gardener nodes are amd64; a Mac-built (arm64) image fails `ErrImagePull` with *"no
   match for platform."* Use `buildx --platform linux/amd64`, or fix CI (needs the GHCR package linked to
   the repo + repo Actions "read and write").
4. **Host must match the realm you browse.** `APP_PUBLIC_URL` and the Keycloak client redirect URIs must be
   the **tenant** host (`ai-trust-test.…`), not the shared-app host — else cross-origin redirect loop.
5. **Prefix-aware frontends.** Anything root-absolute (`fetch("/api/…")`, `/login`, `/logout`) breaks under
   the embed proxy; derive the base from the path.

---

## 8.7 Durability (make it permanent)

Everything above was applied **live** on the tenant:
- The app changes (`rbac.js`, `app.js`, `index.html`) live in the `:nosso` image and the working checkout —
  **commit them to the `whether-app` repo** so they survive an image rebuild. (CI still can't publish until
  the GHCR package is linked to the repo — until then the image is a manual `buildx` push.)
- The cluster/DB changes are runtime patches; a full tenant redeploy from the chart could revert them. The
  durable home for the `marketplace-backend` realm/host env is the operator ([`05` §5.4](./05-multitenant-mesh-notes.md#54-important-caveat-about-durability)).
- Recommended hardening: a NetworkPolicy restricting the app pod to the marketplace proxy (see the security
  note in §8.3).
