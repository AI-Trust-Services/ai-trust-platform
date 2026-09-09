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
