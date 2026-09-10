# 02 — The application patch (prepare-app + sidecar)

*Audience: the app's developer. This is the "what happens on the application" half.*

You run **one script** against your app's repository. It adds a Platform-SSO **sidecar** and a build
recipe. **Your application code is never modified** — the tool only *adds* generated files.

Tool location: [`../tools/prepare-app/`](../tools/prepare-app/). Full tool reference:
[`../tools/prepare-app/README.md`](../tools/prepare-app/README.md). The complete script source (and the
templates it fills) is embedded for convenience in [`07-prepare-app-script.md`](./07-prepare-app-script.md).

---

## 2.1 What your app must satisfy (prerequisites)

Minimal:

- It's an **HTTP server** that listens on a TCP port.
- It either **honours the `PORT` environment variable**, or you tell the tool a fixed port with
  `--app-port`.
- Its repository has a **`Dockerfile` with a `CMD`** (the tool reuses your Dockerfile as the build base and
  captures your start command).

That's it. Language, framework, and internals don't matter.

---

## 2.2 Run the script

```bash
# from anywhere; point it at a local checkout …
marketplace/tools/prepare-app/prepare-app.sh /path/to/your-app

# … or let it clone the repo for you
marketplace/tools/prepare-app/prepare-app.sh --repo https://github.com/<owner>/<repo> --ref main
```

**Flags:**

| Flag | Default | Meaning |
|------|---------|---------|
| *(positional)* `<path>` | — | Local checkout to prepare. Alternative to `--repo`. |
| `--repo <git-url>` | — | Clone this repo first, then prepare it. |
| `--ref <name>` | `main` | Branch/ref to clone with `--repo`. |
| `--app-port N` | app `EXPOSE`, else `3000` | Your app's **internal** port (where the sidecar forwards). |
| `--listen-port N` | `8080` | The port the **platform** talks to (the sidecar). Must differ from the app port. |
| `--branch NAME` | `platform-sso` | Branch the CI build triggers on (also referenced in the generated docs). |
| `--slug NAME` | derived from repo name | The Marketplace slug (URL-safe id). |

> There is **no `--sso` flag and no `--new-tab` flag.** SSO is always wired in — that's the tool's whole
> point. "Platform SSO ✅" and "Open in a new tab" are **choices you make later in the Marketplace UI**, not
> script options.

---

## 2.3 What the script generates (nothing else is touched)

| Path (added to your repo) | Purpose |
|---------------------------|---------|
| `.platform-sso/sidecar/server.js` | The reusable OIDC-login reverse proxy (the sidecar). |
| `.platform-sso/sidecar/package.json` | Sidecar dependencies (`express`, `express-session`). |
| `.platform-sso/sidecar/README.md` | Sidecar reference. |
| `.platform-sso/entrypoint.sh` | Starts your app on the internal port **and** the sidecar on the listen port. |
| `Dockerfile.platform-sso` | The wrapper image = your app image + Node + the sidecar. |
| `.github/workflows/publish-image.yml` | Builds + publishes the wrapper image on push (see [`03`](./03-publish-image.md)). |
| `trust_platform_update.md` | A record of exactly what was added, for your repo. |
| `ui_deploy_guide.md` | A filled-in click-through for the Marketplace UI (the platform-side half). |

Your original `Dockerfile`, source files, and start command remain **exactly as they were.**

---

## 2.4 How the wrapper is built

`Dockerfile.platform-sso` is **multi-stage**. The script inlines *your* Dockerfile verbatim (renaming its
first `FROM` to `AS app-base`), then layers the sidecar on top. Simplified:

```dockerfile
# ── your original Dockerfile, inlined, first FROM renamed ──
FROM node:20-alpine AS app-base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "server.js"]        # ← your original start command, captured

# ── Platform-SSO wrapper (generated) ──
FROM app-base
USER root
RUN (command -v node) || (apk add --no-cache nodejs npm) || …   # ensure Node for the sidecar
WORKDIR /opt/platform-sso-sidecar
COPY .platform-sso/sidecar/package.json ./package.json
RUN npm install --omit=dev
COPY .platform-sso/sidecar/server.js ./server.js
COPY .platform-sso/entrypoint.sh /opt/platform-sso-entrypoint.sh
ENV UPSTREAM_PORT=3000            # your app's internal port
ENV LISTEN_PORT=8080             # the port the platform proxies to
EXPOSE 8080
ENTRYPOINT ["/opt/platform-sso-entrypoint.sh"]
```

And the entrypoint starts both processes (the sidecar is the foreground process; if either dies, the
container exits):

```sh
export PORT="$UPSTREAM_PORT"      # force port-respecting apps onto 3000
cd /app && node server.js &        # ← your original CMD, on the internal port
cd /opt/platform-sso-sidecar && node server.js &   # the sidecar on 8080
```

> *(These snippets are the actual output for the reference app `whether-app` — see the worked example
> below.)*

---

## 2.5 What the sidecar does at runtime

The sidecar (`server.js`) is a small Node/Express **OIDC Relying-Party reverse proxy**:

1. **Terminates the platform login** — OpenID Connect *Authorization-Code + PKCE* against the platform's
   Keycloak.
2. **Establishes a session cookie** (scoped to `Path=/`, because the platform proxy serves the app under a
   sub-path but the cookie must cover it).
3. **Reverse-proxies every authenticated request** to your app on `127.0.0.1:$UPSTREAM_PORT`, adding the
   user's identity as `X-Forwarded-User` / `X-Forwarded-Preferred-Username` headers (your app *may* use
   them; it doesn't have to).

Two clever details worth knowing:

- **Two issuers.** The sidecar does OIDC *discovery* and *token exchange* over an **internal**,
  container-reachable Keycloak URL (`OIDC_ISSUER_INTERNAL`), but rewrites the **browser-facing** endpoints
  (where it sends the user to log in) to the **public** URL (`OIDC_ISSUER`). Back-channel stays internal;
  front-channel goes to the public host.
- **The path prefix is stripped by the platform, not the sidecar.** The platform proxy removes the
  `…/proxy/<slug>` prefix before the request reaches the sidecar, so the sidecar effectively serves at
  root. It *derives* the app's public base path from the OIDC redirect URI so its own login/callback URLs
  match what Keycloak whitelisted.

---

## 2.6 The environment contract

Three groups of variables. **You only ever set the middle group (and usually not even that).**

**Injected by the platform automatically on deploy** (when Platform SSO is ticked — see [`04`](./04-platform-register-and-deploy.md)):

| Var | Meaning |
|-----|---------|
| `OIDC_ISSUER` | Browser-facing realm issuer — where the user is sent to log in. |
| `OIDC_CLIENT_ID` | The per-app confidential client, `aitrust-app-<slug>`. |
| `OIDC_CLIENT_SECRET` | The client secret (delivered as a Kubernetes Secret; never logged). |
| `OIDC_REDIRECT_URI` | The whitelisted callback, `<platform>/api/marketplace/v1/proxy/<slug>/oauth/callback`. |
| `OIDC_SCOPES` | `openid profile email`. |
| `ISSUER` | The app's public base path under the proxy (auto-set for embedded apps). |

**Set by you at registration (the env box in the UI):**

| Var | When to set it |
|-----|----------------|
| `OIDC_ISSUER_INTERNAL` | The in-cluster Keycloak URL the container can reach for discovery/token. **Falls back to `OIDC_ISSUER` if unset.** On modern deployments you usually leave the whole env box empty — see the note below and [`05`](./05-multitenant-mesh-notes.md). |

**Sidecar knobs (set by the generated Dockerfile; you rarely touch these):**

| Var | Default | Meaning |
|-----|---------|---------|
| `UPSTREAM_PORT` | detected from your Dockerfile | Your app's internal port. |
| `LISTEN_PORT` / `PORT` | `8080` | The port the platform proxies to. |
| `PUBLIC_PATHS` | *(empty)* | Comma-list of path prefixes served **without** auth (e.g. a public health endpoint or static assets). |
| `SESSION_SECRET` | random per process | Session/state signing key. |

> **About `OIDC_ISSUER_INTERNAL`:** older guides tell you to put
> `OIDC_ISSUER_INTERNAL=http://keycloak:8080/realms/ai-trust` in the env box. That value is specific to the
> old single-tenant, local-docker setup. On current deployments the platform injects a working
> `OIDC_ISSUER` and the sidecar falls back to it, so **leave the env box empty** unless you have a genuine
> back-channel-only reachability problem. On a multi-tenant mesh the realm is *not* `ai-trust` — see
> [`05`](./05-multitenant-mesh-notes.md).

---

## 2.7 Ports — the one thing people get wrong

- The **App port you register in the Marketplace = the sidecar's listen port = `8080`.**
- Your app runs **internally on `3000`** (or whatever `--app-port` detected). It is never exposed
  directly; the sidecar is the only thing the platform talks to.

Register **8080**, not 3000.

---

## 2.8 Limits (know these before you ship)

- **The sidecar does not rewrite URLs inside HTML/JS bodies.** Redirect `Location` headers are handled (by
  the platform proxy), but if your app hard-codes root-absolute asset URLs like `/app.js` that don't
  resolve under the proxy sub-path, either set `PUBLIC_PATHS` for those assets or give the app a base-href.
- **Double login if your app has its own login.** The user sees the platform login (sidecar) first; if
  your app *also* has a login screen, they'll see that second. Apps with no login of their own get a single
  clean platform login.
- **HTTP only.** Non-HTTP protocols are out of scope for the sidecar.

---

## 2.9 Worked example — `whether-app`

Reference app: `github.com/mirceacraciun/whether-app` (a small Node "EU Capitals Weather" app on port
`3000`). Running `prepare-app.sh` against it produced exactly the files in the table above; the resulting
image is **`ghcr.io/mirceacraciun/whether-app:sso`**. The generated `Dockerfile.platform-sso` and
`entrypoint.sh` are the snippets shown in §2.4. Register it with **App port 8080**, Platform SSO ✅.

Next: [`03-publish-image.md`](./03-publish-image.md) — turn this into a published image.
