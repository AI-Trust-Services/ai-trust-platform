# 02 — Patching your app for the Marketplace

*Audience: developers. How to run `prepare-app.sh`, what it generates, and what happens in each path.*

---

## 2.1 The one question: does your app have its own login?

```
Does your app have its own login / OIDC?
        │
        ├── NO  → Path A: Platform-SSO sidecar
        │           No code changes. A sidecar handles OIDC for your app.
        │
        └── YES → Path B: JWT trust
                    One small change to your auth middleware.
                    The platform identity arrives as a Bearer JWT.
```

Run `prepare-app.sh` and it asks you this question. Or pass `--sso-mode sidecar` / `--sso-mode jwt-trust`
to skip the prompt in CI / scripted runs.

---

## 2.2 Prerequisites

| Requirement | Notes |
|-------------|-------|
| Node.js ≥ 18 | Required by the sidecar (Path A only) |
| Docker with `buildx` | Builds `linux/amd64` images (Gardener nodes are amd64) |
| Your app has a `Dockerfile` with a `CMD` | The script reads the start command from it |
| Your app listens on a TCP port | Any language; any port |

---

## 2.3 Running the script

```bash
# Interactive (asks the SSO question):
./marketplace/tools/prepare-app/prepare-app.sh /path/to/your-app

# Non-interactive — Path A (sidecar, no own login):
./marketplace/tools/prepare-app/prepare-app.sh /path/to/your-app --sso-mode sidecar

# Non-interactive — Path B (JWT trust, own login):
./marketplace/tools/prepare-app/prepare-app.sh /path/to/your-app --sso-mode jwt-trust

# Clone a remote repo instead of using a local path:
./marketplace/tools/prepare-app/prepare-app.sh --repo https://github.com/owner/repo --ref main
```

All flags:

| Flag | Default | Notes |
|------|---------|-------|
| `--sso-mode sidecar\|jwt-trust\|ask` | interactive if stdin is a tty, else `sidecar` | Path selector |
| `--app-port N` | from `EXPOSE` in Dockerfile, or `3000` | The port your app listens on |
| `--listen-port N` | `8080` | Sidecar's listen port (Path A only) |
| `--branch NAME` | `platform-sso` | Branch to commit generated files to |
| `--slug NAME` | derived from repo name | Marketplace slug (URL-safe, lower-case) |
| `--repo URL` | — | Clone this URL instead of using a local path |
| `--ref REF` | `main` | Branch/tag to clone |

---

## 2.4 Path A — Platform-SSO sidecar (no own login)

### What it generates

| Generated file | Purpose |
|----------------|---------|
| `.platform-sso/sidecar/server.js` | Node/Express OIDC RP reverse proxy |
| `.platform-sso/sidecar/package.json` | sidecar npm dependencies |
| `.platform-sso/sidecar/README.md` | sidecar env vars reference |
| `.platform-sso/entrypoint.sh` | starts the app on its port + the sidecar on 8080 |
| `Dockerfile.platform-sso` | wrapper image: your app base + Node + sidecar |
| `.github/workflows/publish-image.yml` | builds + pushes `:sso` on push to `platform-sso` |
| `trust_platform_update.md` | summary of what was added |
| `ui_deploy_guide.md` | field-by-field Marketplace deploy checklist |

**Your existing files are not modified.**

### How the sidecar works

```
browser
  → platform proxy (strips /api/marketplace/v1/proxy/<slug>/ prefix)
  → sidecar :8080  (OIDC Authorization-Code + PKCE; session cookie)
  → your app :<app-port>  (receives authenticated requests unchanged)
```

The sidecar:
- Discovers the OIDC provider via `OIDC_ISSUER_INTERNAL` (in-cluster) for token exchange, but redirects the browser to the public `OIDC_ISSUER` URL.
- Sets `X-Forwarded-User` and `X-Forwarded-Preferred-Username` on every proxied request.
- Derives its redirect URI from the `BASE` env var (injected by the platform at deploy time) so it works correctly under the embed prefix.

### Register in the Marketplace

| Field | Value |
|-------|-------|
| **Image ref** | `ghcr.io/<owner>/<repo>:sso` |
| **App port** | `8080` (the sidecar's port) |
| **Platform SSO** | ✅ ON |

---

## 2.5 Path B — JWT trust (app has its own login)

### Why not the sidecar?

Stacking two OIDC flows (sidecar + the app's own login) causes a redirect loop: the app's OIDC
interaction cookies can't survive the platform proxy stripping the `/api/marketplace/v1/proxy/<slug>/`
prefix. The result is `500 interaction session id cookie not found` or a `ERR_TOO_MANY_REDIRECTS`.

The fix is to **remove** the app's own login when running inside the platform and trust the identity that
the platform already verified.

### What it generates

| Generated file | Purpose |
|----------------|---------|
| `.platform-sso/rbac-platform-patch.js` | drop-in `requireAuth` that trusts the platform JWT |
| `Dockerfile.nosso` | plain app image (no sidecar) — build and push this |
| `.github/workflows/publish-image.yml` | builds + pushes `:nosso` on push to `platform-sso` |
| `trust_platform_update.md` | summary of what was added |
| `ui_deploy_guide.md` | field-by-field Marketplace deploy checklist |

### Applying the patch

Open `.platform-sso/rbac-platform-patch.js`. It contains two functions — `platformIdentity` and
`requireAuth` — with inline instructions at the top. Copy them into your app's auth middleware and replace
your existing `requireAuth` (or equivalent).

**What the patch does:**

```js
function requireAuth(req, res, next) {
  if (req.session?.user) return next();            // already have a session

  if (PLATFORM_SSO !== "off") {
    const username = platformIdentity(req);        // read from JWT or header
    if (username) {
      req.session.user = { username, roles: [...] }; // establish session
      return next();
    }
  }

  // fall through to your own login only when PLATFORM_SSO=off (local dev)
}
```

Set `PLATFORM_SSO=off` in your local `.env` to keep using your own login during development.

### How the identity arrives

On a multi-tenant (MT) deployment, the tenant oauth2-proxy forwards the identity **only** as a JWT in
`Authorization: Bearer <token>` — it does **not** set `X-Forwarded-Preferred-Username` (the
`--pass-user-headers` flag is not set). The patch reads both: header first, then JWT. If you're on a
single-tenant deployment with `--pass-user-headers`, the header will be populated and the JWT decode is
skipped.

### Register in the Marketplace

| Field | Value |
|-------|-------|
| **Image ref** | `ghcr.io/<owner>/<repo>:nosso` |
| **App port** | the app's own port (e.g. `3000`) |
| **Platform SSO** | ⬜ OFF |

---

## 2.6 The environment contract

### Platform-injected (Platform SSO ON, Path A only)

Injected automatically at deploy time — **leave the env box empty** in the form:

| Var | Value injected |
|-----|---------------|
| `OIDC_ISSUER` | public Keycloak URL (browser-reachable) |
| `OIDC_ISSUER_INTERNAL` | in-cluster Keycloak URL (for token exchange) |
| `OIDC_CLIENT_ID` | `aitrust-app-<slug>` |
| `OIDC_CLIENT_SECRET` | minted at deploy time, read from k8s Secret |
| `OIDC_REDIRECT_URI` | `https://<platform>/api/marketplace/v1/proxy/<slug>/callback` |
| `OIDC_SCOPES` | `openid profile email` |
| `LISTEN_PORT` | same as App port (default 8080) |
| `UPSTREAM_PORT` | app's internal port |
| `BASE` | the embed prefix path (for the sidecar's redirect URI derivation) |

### Owner-supplied (optional, via the env box in the form)

Set these only for Path A if your app needs them:

| Var | Purpose |
|-----|---------|
| `PUBLIC_PATHS` | comma-separated path prefixes to serve without auth (e.g. `/public,/health`) |

### Path B knob

| Var | Default | Purpose |
|-----|---------|---------|
| `PLATFORM_SSO` | `on` | set to `off` to disable platform JWT trust and use the app's own login (local dev) |

---

## 2.7 Ports at a glance

| | Path A (sidecar) | Path B (JWT trust) |
|---|---|---|
| **Register in Marketplace** | `8080` (sidecar listen port) | your app's own port (e.g. `3000`) |
| **App runs internally on** | your app's port (e.g. `3000`) | your app's port (e.g. `3000`) |
| **Sidecar runs on** | `8080` | — (no sidecar) |

---

## 2.8 Limits — know these before you ship

1. **Root-absolute frontend URLs** — neither the sidecar nor the JWT-trust path rewrites HTML/JS bodies.
   If your app's browser JS fetches `/api/something` (root-absolute), that request escapes the embed
   prefix and lands at the platform origin, not your app.
   **Fix:** derive an `API_BASE` from `window.location.pathname` and prefix every `fetch()` call.
   See [`08-worked-example`](./08-worked-example-weather-app.md#84-the-last-mile--a-prefix-aware-frontend)
   for the exact pattern.

2. **Double login for Path A apps that have their own login** — if you deploy an app that has its own
   OIDC under Path A (sidecar), the user sees two login screens. Use Path B for such apps.

3. **JWT trust requires NetworkPolicy** — Path B decodes the JWT without re-verifying the signature. This
   is safe only while the pod is reachable exclusively through the platform proxy. Add a NetworkPolicy
   restricting ingress to the marketplace proxy pod(s).

4. **`linux/amd64` required** — Gardener/Kyma cluster nodes are `amd64`. Build with
   `docker buildx build --platform linux/amd64` or use the generated CI workflow (it sets `platforms: linux/amd64`).
   A Mac-built arm64 image fails `ErrImagePull` with *"no match for platform."*
