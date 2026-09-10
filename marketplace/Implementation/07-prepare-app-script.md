# 07 — The `prepare-app` script (full source, in one place)

*Audience: developers who want the actual code, not just a description. This embeds the real
`prepare-app.sh` and the files it generates, so you have everything here without hunting through the
repo.*

> The canonical, maintained copy lives in [`../tools/prepare-app/`](../tools/prepare-app/). This page is a
> convenience mirror for reading. If the two ever differ, the tool folder wins — re-run from there.
>
> **What it is:** one Bash script that wraps any HTTP app with a Platform-SSO sidecar (see
> [`02-application-patch.md`](./02-application-patch.md) for the narrative). It only *adds* files; it never
> edits your app's code.

---

## 7.1 `prepare-app.sh` (the script)

```bash
#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# prepare-app.sh — make ANY HTTP app deployable in the AI Trust Marketplace with
# Platform SSO, without changing the app's code, by adding a Platform-SSO sidecar.
#
# Usage:
#   ./prepare-app.sh <path-to-app-repo> [--app-port N] [--listen-port N] [--branch NAME] [--slug NAME]
#   ./prepare-app.sh --repo <git-url> [--ref main] [--app-port N] ...
#
# What it adds to the app repo (never edits existing files):
#   .platform-sso/sidecar/{server.js,package.json,README.md}
#   .platform-sso/entrypoint.sh
#   Dockerfile.platform-sso
#   .github/workflows/publish-image.yml
#   trust_platform_update.md, ui_deploy_guide.md
#
# Idempotent: re-running overwrites only the generated files.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
SIDECAR_DIR="$TOOL_DIR/sidecar"
TMPL_DIR="$TOOL_DIR/templates"

APP_DIR=""; REPO=""; REF="main"
APP_PORT=""; LISTEN_PORT="8080"; BRANCH="platform-sso"; SLUG=""
CLONE_TMP=""

die() { echo "ERROR: $*" >&2; exit 1; }

# ── args ──
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2;;
    --ref) REF="$2"; shift 2;;
    --app-port) APP_PORT="$2"; shift 2;;
    --listen-port) LISTEN_PORT="$2"; shift 2;;
    --branch) BRANCH="$2"; shift 2;;
    --slug) SLUG="$2"; shift 2;;
    -*) die "unknown flag $1";;
    *) APP_DIR="$1"; shift;;
  esac
done

if [ -n "$REPO" ]; then
  CLONE_TMP="$(mktemp -d)"
  echo ">> cloning $REPO@$REF"
  git clone -q --branch "$REF" "$REPO" "$CLONE_TMP" || die "clone failed"
  APP_DIR="$CLONE_TMP"
fi
[ -n "$APP_DIR" ] || die "provide a <path-to-app-repo> or --repo <git-url>"
[ -d "$APP_DIR" ] || die "app dir not found: $APP_DIR"
APP_DIR="$(cd "$APP_DIR" && pwd)"

# ── derive metadata ──
# repo owner/name from git remote (for the ghcr image ref); fall back to dir name.
REMOTE_URL="$(git -C "$APP_DIR" remote get-url origin 2>/dev/null || true)"
# strip protocol/host and a trailing .git, keep the last two path segments (owner/repo). Portable.
REPO_SLUG="$(printf '%s' "$REMOTE_URL" \
  | sed -e 's#\.git$##' -e 's#^.*://##' -e 's#^[^/]*[:/]##' \
  | awk -F/ 'NF>=2{print $(NF-1)"/"$NF} NF<2{print $0}' \
  | tr '[:upper:]' '[:lower:]')"
[ -n "$REPO_SLUG" ] || REPO_SLUG="local/$(basename "$APP_DIR" | tr '[:upper:]' '[:lower:]')"
APP_NAME="$(basename "$APP_DIR")"
[ -n "$SLUG" ] || SLUG="$(basename "$REPO_SLUG" | tr '[:upper:]' '[:lower:]' | sed -e 's#[^a-z0-9]#-#g' -e 's#^-*##' -e 's#-*$##')"

# app port: --app-port, else EXPOSE in Dockerfile, else 3000
if [ -z "$APP_PORT" ]; then
  if [ -f "$APP_DIR/Dockerfile" ]; then
    APP_PORT="$(grep -iE '^EXPOSE ' "$APP_DIR/Dockerfile" | head -1 | awk '{print $2}' | tr -dc '0-9')"
  fi
  [ -n "$APP_PORT" ] || APP_PORT="3000"
fi
UPSTREAM_PORT="$APP_PORT"
[ "$UPSTREAM_PORT" != "$LISTEN_PORT" ] || die "app port ($APP_PORT) must differ from the sidecar listen port ($LISTEN_PORT); pass --listen-port"

# the app's start command (its Dockerfile CMD), captured for the entrypoint.
APP_CMD=""
if [ -f "$APP_DIR/Dockerfile" ]; then
  # take the last CMD; strip CMD and JSON-array brackets/quotes → a shell command line.
  APP_CMD="$(grep -iE '^CMD ' "$APP_DIR/Dockerfile" | tail -1 | sed -E 's/^CMD +//I')"
  case "$APP_CMD" in
    '['*)
      # JSON exec-form: ["node", "server.js"] → node server.js
      APP_CMD="$(printf '%s' "$APP_CMD" \
        | sed -e 's#^\[##' -e 's#\]$##' \
        | sed -e 's#" *, *"# #g' -e 's#"##g' \
        | sed -e 's#^ *##' -e 's# *$##')"
      ;;
  esac
fi
[ -n "$APP_CMD" ] || die "could not detect the app start command (no CMD in Dockerfile); ensure the app has a Dockerfile with a CMD"

# the app's WORKDIR (last WORKDIR in its Dockerfile) so the entrypoint runs the app from there.
APP_WORKDIR="$(grep -iE '^WORKDIR ' "$APP_DIR/Dockerfile" | tail -1 | awk '{print $2}')"
[ -n "$APP_WORKDIR" ] || APP_WORKDIR="/app"

echo ">> app dir     : $APP_DIR"
echo ">> repo slug   : $REPO_SLUG   (image → ghcr.io/$REPO_SLUG:sso)"
echo ">> marketplace slug: $SLUG"
echo ">> app port    : $UPSTREAM_PORT (internal)   sidecar listen: $LISTEN_PORT"
echo ">> app cmd     : $APP_CMD"
echo ">> branch      : $BRANCH"

# ── render helper ──
render() { # <src-tmpl> <dst>
  sed -e "s#@@APP_NAME@@#$APP_NAME#g" \
      -e "s#@@REPO@@#$REPO_SLUG#g" \
      -e "s#@@SLUG@@#$SLUG#g" \
      -e "s#@@UPSTREAM_PORT@@#$UPSTREAM_PORT#g" \
      -e "s#@@LISTEN_PORT@@#$LISTEN_PORT#g" \
      -e "s#@@BRANCH@@#$BRANCH#g" \
      -e "s#@@APP_IMAGE_STAGE@@#app-base#g" \
      -e "s#@@APP_WORKDIR@@#$APP_WORKDIR#g" \
      -e "s#@@APP_CMD@@#$APP_CMD#g" \
      "$1" > "$2"
}

# ── 1. copy the sidecar ──
mkdir -p "$APP_DIR/.platform-sso/sidecar"
cp "$SIDECAR_DIR/server.js" "$SIDECAR_DIR/package.json" "$SIDECAR_DIR/README.md" "$APP_DIR/.platform-sso/sidecar/"

# ── 2. entrypoint ──
render "$TMPL_DIR/entrypoint.sh.tmpl" "$APP_DIR/.platform-sso/entrypoint.sh"
chmod +x "$APP_DIR/.platform-sso/entrypoint.sh"

# ── 3. wrapper Dockerfile ──
# Build the app via its own Dockerfile as a named stage. We inline the app Dockerfile as a base by
# referencing it through a two-stage build: the platform build must `docker build -f Dockerfile.platform-sso`
# with the app Dockerfile available. To keep it single-file + portable, we require the app's own image
# to be buildable as stage "app-base" — achieved by prepending the app Dockerfile with a stage name.
# Simplest robust approach: generate a combined Dockerfile that first includes the app's Dockerfile
# content as stage app-base, then the wrapper stages.
{
  echo "# syntax=docker/dockerfile:1"
  echo "# ── stage app-base: the ORIGINAL app Dockerfile, unmodified ──"
  # rewrite the first FROM to name the stage 'app-base'; leave the rest byte-for-byte.
  awk 'BEGIN{done=0} /^[Ff][Rr][Oo][Mm] / && !done {print $0 " AS app-base"; done=1; next} {print}' "$APP_DIR/Dockerfile"
  echo ""
  echo "# ── Platform-SSO wrapper (generated) ──"
  # append the wrapper body (skip its own syntax line + the two placeholder FROMs; we already have app-base)
  render "$TMPL_DIR/Dockerfile.platform-sso.tmpl" /dev/stdout \
    | awk 'NR==1 && /syntax=/ {next} {print}' \
    | sed -E 's#^FROM app-base AS app$##; s#^FROM app-base$#FROM app-base#'
} > "$APP_DIR/Dockerfile.platform-sso"

# ── 4. CI workflow ──
mkdir -p "$APP_DIR/.github/workflows"
render "$TMPL_DIR/publish-image.yml.tmpl" "$APP_DIR/.github/workflows/publish-image.yml"

# ── 5. docs ──
render "$TMPL_DIR/trust_platform_update.md.tmpl" "$APP_DIR/trust_platform_update.md"
render "$TMPL_DIR/ui_deploy_guide.md.tmpl" "$APP_DIR/ui_deploy_guide.md"

echo ""
echo "✅ Prepared $APP_NAME for the AI Trust Marketplace (Platform-SSO sidecar)."
echo ""
echo "Added (no existing file modified):"
echo "  .platform-sso/sidecar/  .platform-sso/entrypoint.sh"
echo "  Dockerfile.platform-sso  .github/workflows/publish-image.yml"
echo "  trust_platform_update.md  ui_deploy_guide.md"
echo ""
echo "Next steps:"
echo "  cd $APP_DIR"
echo "  git checkout -b $BRANCH && git add -A && git commit -m 'Platform-SSO sidecar' && git push -u origin $BRANCH"
echo "  # CI publishes ghcr.io/$REPO_SLUG:sso  →  register in the Marketplace (see ui_deploy_guide.md)"
[ -n "$CLONE_TMP" ] && echo "  (working copy: $APP_DIR)"
```

---

## 7.2 What it reads: the templates

The script fills these templates (`../tools/prepare-app/templates/`) by substituting `@@…@@`
placeholders, then writes the result into your app repo.

### `entrypoint.sh.tmpl` → `.platform-sso/entrypoint.sh`

```sh
#!/bin/sh
# GENERATED by marketplace/tools/prepare-app — starts the wrapped app + the Platform-SSO sidecar.
# The app runs on 127.0.0.1:$UPSTREAM_PORT (we pass PORT=$UPSTREAM_PORT so port-respecting apps bind
# there); the sidecar runs on $LISTEN_PORT (the port the marketplace proxies to) as the foreground
# process. If the sidecar exits, the container exits.
set -e

: "${UPSTREAM_PORT:=@@UPSTREAM_PORT@@}"
: "${LISTEN_PORT:=@@LISTEN_PORT@@}"
export PORT="$UPSTREAM_PORT"          # most apps read PORT; force the app onto the internal port
export UPSTREAM_PORT LISTEN_PORT

echo "[platform-sso] starting wrapped app on 127.0.0.1:$UPSTREAM_PORT …"
cd "@@APP_WORKDIR@@"
@@APP_CMD@@ &                          # the original app's CMD, captured from its Dockerfile
APP_PID=$!

term() { kill "$APP_PID" "$SIDE_PID" 2>/dev/null || true; exit 0; }
trap term TERM INT

echo "[platform-sso] starting sidecar on :$LISTEN_PORT …"
cd /opt/platform-sso-sidecar
node server.js &
SIDE_PID=$!

# Exit when either process exits (portable — busybox sh has no `wait -n`).
while kill -0 "$APP_PID" 2>/dev/null && kill -0 "$SIDE_PID" 2>/dev/null; do
  sleep 2
done
term
```

### `Dockerfile.platform-sso.tmpl` (the wrapper body)

The script prepends your **own Dockerfile** (renaming its first `FROM` to `AS app-base`), then appends this:

```dockerfile
# syntax=docker/dockerfile:1
# GENERATED by marketplace/tools/prepare-app — Platform-SSO wrapper.
# Wraps the ORIGINAL app image with a Platform-SSO sidecar. The app is built by its
# own Dockerfile (unchanged) and runs on 127.0.0.1:@@UPSTREAM_PORT@@; the sidecar
# terminates the platform login and reverse-proxies to it, listening on @@LISTEN_PORT@@.

FROM @@APP_IMAGE_STAGE@@ AS app
FROM @@APP_IMAGE_STAGE@@

# Ensure Node for the sidecar (no-op if the base already has it).
USER root
RUN (command -v node >/dev/null 2>&1) || \
    (command -v apk >/dev/null 2>&1 && apk add --no-cache nodejs npm) || \
    (command -v apt-get >/dev/null 2>&1 && apt-get update && apt-get install -y --no-install-recommends nodejs npm && rm -rf /var/lib/apt/lists/*) || \
    echo "WARNING: could not install node automatically; ensure the base image has node"

WORKDIR /opt/platform-sso-sidecar
COPY .platform-sso/sidecar/package.json ./package.json
RUN npm install --omit=dev
COPY .platform-sso/sidecar/server.js ./server.js

COPY .platform-sso/entrypoint.sh /opt/platform-sso-entrypoint.sh
RUN chmod +x /opt/platform-sso-entrypoint.sh

ENV UPSTREAM_PORT=@@UPSTREAM_PORT@@
ENV LISTEN_PORT=@@LISTEN_PORT@@
EXPOSE @@LISTEN_PORT@@

ENTRYPOINT ["/opt/platform-sso-entrypoint.sh"]
```

### `publish-image.yml.tmpl` → `.github/workflows/publish-image.yml`

```yaml
name: publish-image

on:
  push:
    branches: [@@BRANCH@@]
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
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile.platform-sso
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:sso
            ghcr.io/${{ github.repository }}:${{ github.sha }}
```

> **One-time repo setting:** if the first run fails with `denied: permission_denied: write_package`, set
> *Settings → Actions → General → Workflow permissions → Read and write permissions*.

The tool also renders `trust_platform_update.md` and `ui_deploy_guide.md` into the app repo — a record of
what was added and a filled-in UI checklist.

---

## 7.3 The sidecar (`sidecar/server.js`)

The sidecar is the reusable OIDC-login reverse proxy the script copies into every app. It's ~240 lines;
rather than duplicate it here (where it could drift), read the maintained source and its reference:

- Source: [`../tools/prepare-app/sidecar/server.js`](../tools/prepare-app/sidecar/server.js)
- Reference: [`../tools/prepare-app/sidecar/README.md`](../tools/prepare-app/sidecar/README.md)
- Behaviour + env contract are summarised in [`02-application-patch.md §2.5–2.6`](./02-application-patch.md#25-what-the-sidecar-does-at-runtime).

Its dependencies (`sidecar/package.json`) are just Express + express-session:

```json
{
  "name": "aitrust-platform-sso-sidecar",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": { "start": "node server.js" },
  "engines": { "node": ">=18" },
  "dependencies": {
    "express": "^4.21.2",
    "express-session": "^1.18.1"
  }
}
```

---

## 7.4 Run it

```bash
# from the ai-trust-platform repo root, against a local app checkout:
marketplace/tools/prepare-app/prepare-app.sh /path/to/your-app

# or clone-and-prepare in one shot:
marketplace/tools/prepare-app/prepare-app.sh --repo https://github.com/<owner>/<repo> --ref main
```

Then commit + push the `platform-sso` branch → CI publishes `ghcr.io/<owner>/<repo>:sso`
([`03-publish-image.md`](./03-publish-image.md)) → register it in the Marketplace
([`04-platform-register-and-deploy.md`](./04-platform-register-and-deploy.md)).
