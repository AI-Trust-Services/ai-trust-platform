# 07 — The `prepare-app` script (full source, in one place)

*Audience: developers who want the actual code, not just a description. This embeds the real
`prepare-app.sh` and the key generated files, so you have everything here without hunting through the
repo.*

> The canonical, maintained copy lives in [`../tools/prepare-app/`](../tools/prepare-app/). This page is a
> convenience mirror for reading. If the two ever differ, the tool folder wins — re-run from there.
>
> **What it is:** one Bash script that wraps any HTTP app for the AI Trust Platform Marketplace. Run it
> and answer one question (`Does your app have its own login?`) — it does the rest. See
> [`02-application-patch.md`](./02-application-patch.md) for the narrative.

---

## 7.1 `prepare-app.sh` (the script)

```bash
#!/usr/bin/env bash
# prepare-app.sh — make ANY HTTP app deployable in the AI Trust Marketplace
# with Platform SSO.
#
# Usage:
#   ./prepare-app.sh <path-to-app-repo> [OPTIONS]
#   ./prepare-app.sh --repo <git-url> [--ref main] [OPTIONS]
#
# Options:
#   --sso-mode sidecar|jwt-trust|ask
#                sidecar   (default) — app has NO own login; add a Platform-SSO
#                           sidecar that handles OIDC for it (no app code changes)
#                jwt-trust — app has its OWN OIDC/login; replace it with platform
#                           JWT trust (generates a patch + plain Dockerfile)
#                ask       — prompt interactively
#   --app-port N       app's internal port (auto-detected from Dockerfile EXPOSE, or 3000)
#   --listen-port N    sidecar listen port (Path A only, default 8080)
#   --branch NAME      git branch (default: platform-sso)
#   --slug NAME        marketplace slug (default: from repo name)
#   --repo URL         clone instead of using a local path
#   --ref REF          branch/tag to clone (default: main)
#
# What it adds (never edits existing files):
#
#   Path A — sidecar:
#     .platform-sso/sidecar/{server.js,package.json,README.md}
#     .platform-sso/entrypoint.sh
#     Dockerfile.platform-sso         (register at port 8080)
#     .github/workflows/publish-image.yml
#     trust_platform_update.md, ui_deploy_guide.md
#
#   Path B — jwt-trust:
#     .platform-sso/rbac-platform-patch.js   (drop-in requireAuth)
#     Dockerfile.nosso                        (register at app port)
#     .github/workflows/publish-image.yml
#     trust_platform_update.md, ui_deploy_guide.md
#
# See marketplace/Implementation/ for the full onboarding guide.
```

*(Full source in [`../tools/prepare-app/prepare-app.sh`](../tools/prepare-app/prepare-app.sh))*

---

## 7.2 Interactive mode (when you run it without `--sso-mode`)

When stdin is a tty the script asks:

```
────────────────────────────────────────────────
  AI Trust Platform — App Onboarding
────────────────────────────────────────────────

Does your app have its OWN login / OIDC?

  • If NO  → the tool wraps your app with a Platform-SSO sidecar.
             NO code changes to your app.

  • If YES → the tool generates a JWT-trust patch.
             You apply one small change to your app's auth middleware.

Does your app have its own login? [y/N]:
```

Answer `n` (or Enter) for Path A. Answer `y` for Path B. When stdin is not a tty (CI, piped) it defaults
to Path A / sidecar.

---

## 7.3 Path A generated files

### `.platform-sso/entrypoint.sh` (template)

```bash
#!/bin/sh
# Start the app on its port, then start the Platform-SSO sidecar on the listen port.
# Both run in the same container; the sidecar proxies to the app.
set -e
cd @@APP_WORKDIR@@
@@APP_CMD@@ &   # start the app in the background
cd /app-sso
node sidecar/server.js
```

### `Dockerfile.platform-sso` (template — structure)

```dockerfile
# syntax=docker/dockerfile:1
# ── stage app-base: the ORIGINAL app Dockerfile, unmodified ──
FROM <your-base> AS app-base
# ... all your existing Dockerfile steps ...

# ── Platform-SSO wrapper (generated) ──
FROM node:20-alpine AS sso-builder
WORKDIR /app-sso
COPY .platform-sso/sidecar/package.json ./sidecar/
RUN npm install --omit=dev --prefix ./sidecar

FROM app-base
# copy the sidecar and its deps into the app image
COPY --from=sso-builder /app-sso /app-sso
COPY .platform-sso/sidecar/ /app-sso/sidecar/
COPY .platform-sso/entrypoint.sh /app-sso/entrypoint.sh
ENV UPSTREAM_PORT=@@UPSTREAM_PORT@@
ENV LISTEN_PORT=@@LISTEN_PORT@@
EXPOSE @@LISTEN_PORT@@
ENTRYPOINT ["/app-sso/entrypoint.sh"]
```

---

## 7.4 Path B generated files

### `.platform-sso/rbac-platform-patch.js` (the JWT-trust patch)

This file is generated into the app repo. It contains:

1. `_decodeJwtUsername(authHeader)` — decodes `preferred_username` from a Bearer JWT without signature verification (the platform already verified it).
2. `platformIdentity(req)` — tries `X-Forwarded-Preferred-Username` header first, falls back to the JWT.
3. `requireAuth(req, res, next)` — drop-in middleware: if `PLATFORM_SSO !== "off"`, reads the platform identity and establishes a session; otherwise falls through to the app's own login.

**How to apply:**
1. Open `.platform-sso/rbac-platform-patch.js` in the generated app repo.
2. Copy the three functions into your app's auth middleware file (e.g. `rbac.js`, `auth.js`).
3. Replace your existing `requireAuth` with the one from the patch.
4. Set `PLATFORM_SSO=off` in your local `.env` to keep using your own login during development.

*(The generated file has full inline comments. See also [`08-worked-example-weather-app.md §8.3`](./08-worked-example-weather-app.md#83-the-key-decision--replace-the-apps-oidc-with-platform-oidc).)*

### `Dockerfile.nosso` (template — structure)

```dockerfile
# syntax=docker/dockerfile:1
# Dockerfile.nosso — plain app image, no Platform-SSO sidecar.
# Register in the Marketplace with Platform SSO OFF, app port @@UPSTREAM_PORT@@.
# Generated by prepare-app.sh --sso-mode jwt-trust

# <your full Dockerfile, verbatim>
```

The file is your original `Dockerfile` with a header comment added. No other changes.

---

## 7.5 Shared generated files

### `.github/workflows/publish-image.yml` (template)

```yaml
name: publish-image
on:
  push:
    branches: [platform-sso]
  workflow_dispatch:
permissions:
  contents: read
  packages: write
jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/setup-buildx-action@v3
        with:
          platforms: linux/amd64
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile.<sso|nosso>     # Path A → platform-sso; Path B → nosso
          platforms: linux/amd64
          push: true
          tags: |
            ghcr.io/<owner>/<repo>:<sso|nosso>
            ghcr.io/<owner>/<repo>:${{ github.sha }}
```

> **One-time repo setting required:** if CI fails with `denied: permission_denied: write_package`, go to
> **Settings → Actions → General → Workflow permissions → Read and write permissions**.
> See [`03-publish-image.md §3.3`](./03-publish-image.md#33-one-time-repository-setting-required).

---

## 7.6 Idempotency

Re-running `prepare-app.sh` on the same repo overwrites only the generated files. Your existing source
files are never touched.
