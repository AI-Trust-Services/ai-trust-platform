# prepare-app — onboard ANY app to the AI Trust Marketplace with Platform SSO (no app code changes)

`prepare-app.sh` prepares any HTTP application to run in the SAP AI Trust Marketplace with **Platform
SSO**, **without changing the app's code**. It does this by adding a small **Platform-SSO sidecar** — an
OIDC Relying-Party reverse proxy that fronts the unmodified app, handles the platform login, and
forwards authenticated requests to the app on an internal port.

Works for **any language/framework** (Node, Python, Go, Java, static, …) as long as the app is an HTTP
server with a Dockerfile.

> This is the **no-code-change** alternative to hand-integrating OIDC into the app (Layer 1 of
> [`../../docs/onboard-an-app.md`](../../docs/onboard-an-app.md)). Use `prepare-app` when you can't or
> don't want to modify the app; hand-integrate when you want the app itself to be OIDC-aware.

## Usage

```bash
# against a local checkout:
marketplace/tools/prepare-app/prepare-app.sh /path/to/app-repo

# or clone first:
marketplace/tools/prepare-app/prepare-app.sh --repo https://github.com/acme/app.git --ref main

# options:
#   --app-port N     the app's internal port (default: EXPOSE in its Dockerfile, else 3000)
#   --listen-port N  the sidecar/marketplace port (default 8080; must differ from app-port)
#   --branch NAME    branch name referenced in the generated docs/CI (default platform-sso)
#   --slug NAME      marketplace slug (default: derived from the repo name)
```

It **adds** these files to the app repo (never edits existing ones):

| Path | Purpose |
|------|---------|
| `.platform-sso/sidecar/` | the reusable Platform-SSO OIDC RP reverse proxy (Node, express) |
| `.platform-sso/entrypoint.sh` | starts the app on the internal port + the sidecar on the listen port |
| `Dockerfile.platform-sso` | wrapper image = the app's own image (`app-base` stage) + Node + sidecar |
| `.github/workflows/publish-image.yml` | builds + publishes `ghcr.io/<owner>/<repo>:sso` on push |
| `trust_platform_update.md` | what the tool added |
| `ui_deploy_guide.md` | the Marketplace UI checklist, filled in for this app |

Then:
```bash
cd /path/to/app-repo
git checkout -b platform-sso && git add -A && git commit -m "Platform-SSO sidecar" && git push -u origin platform-sso
# CI publishes ghcr.io/<owner>/<repo>:sso → register it in the Marketplace (see the generated ui_deploy_guide.md)
```

## How the wrapper runs

```
browser ─(platform proxy strips /api/marketplace/v1/proxy/<slug>)→ container
   sidecar :LISTEN_PORT  ──(OIDC login + session, then reverse-proxy)──►  your app :UPSTREAM_PORT (unchanged)
```

The wrapper Dockerfile builds your app from its **own** Dockerfile as a stage named `app-base`, then
layers Node + the sidecar and an entrypoint that runs your original `CMD` (bound to `PORT=UPSTREAM_PORT`,
from your app's `WORKDIR`) plus the sidecar (foreground). Register the service in the Marketplace with
**App port = LISTEN_PORT** (the sidecar's port), **Platform SSO ✅**, and env
`OIDC_ISSUER_INTERNAL=<in-cluster keycloak issuer>`.

## What it does NOT do (limits)

- It does **not** modify your app's source or Dockerfile — it wraps them.
- It does **not** rewrite URLs inside HTML/JS bodies. Apps with hardcoded root-absolute asset paths
  usually still work (the platform proxy + same-origin embed resolve them under the prefix); if not,
  set `PUBLIC_PATHS` (see `sidecar/README.md`) or give the app a base-href.
- If your app has its **own** login, users see the platform login (sidecar) first, then the app's login
  (double login). Apps with no own login get one clean platform login.
- Non-HTTP apps are out of scope.

## Requirements of the target app

1. An HTTP server that listens on a port (honours `PORT` env, or exposes a fixed port you pass via
   `--app-port`).
2. A `Dockerfile` with a `CMD` (the tool captures it to start the app).

## Reference / proof

Validated against `github.com/mirceacraciun/whether-app` `main` (an untouched app): `prepare-app.sh`
produces a wrapper image that starts the app + sidecar, gates unauthenticated requests, derives the
proxy base, and federates to the platform Keycloak — the same verified behaviour as the hand-integrated
`platform-sso` branch, but with zero app code changes.
