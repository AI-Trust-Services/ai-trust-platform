#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
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
#                ask       — prompt interactively (default when stdin is a tty
#                           and --sso-mode is not given)
#   --app-port N  internal port the app listens on (auto-detected from Dockerfile
#                 EXPOSE or defaults to 3000)
#   --listen-port N  sidecar listen port (sidecar mode only, default 8080)
#   --branch NAME    git branch to create (default: platform-sso)
#   --slug NAME      marketplace slug (default: derived from repo name)
#   --repo <url>     clone this repo instead of using a local path
#   --ref <ref>      branch/tag/SHA to clone (default: main)
#
# What it adds (never edits existing files):
#
#   sidecar mode:
#     .platform-sso/sidecar/{server.js,package.json,README.md}
#     .platform-sso/entrypoint.sh
#     Dockerfile.platform-sso   (register at port 8080)
#     .github/workflows/publish-image.yml
#     trust_platform_update.md, ui_deploy_guide.md
#
#   jwt-trust mode:
#     .platform-sso/rbac-platform-patch.js   (drop-in requireAuth that trusts JWT)
#     Dockerfile.nosso                        (plain app, register at app port)
#     .github/workflows/publish-image.yml
#     trust_platform_update.md, ui_deploy_guide.md
#
# Idempotent: re-running overwrites only the generated files.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
SIDECAR_DIR="$TOOL_DIR/sidecar"
TMPL_DIR="$TOOL_DIR/templates"

APP_DIR=""; REPO=""; REF="main"
APP_PORT=""; LISTEN_PORT="8080"; BRANCH="platform-sso"; SLUG=""
SSO_MODE=""; CLONE_TMP=""

die() { echo "ERROR: $*" >&2; exit 1; }

# ── args ──
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)        REPO="$2";        shift 2;;
    --ref)         REF="$2";         shift 2;;
    --app-port)    APP_PORT="$2";    shift 2;;
    --listen-port) LISTEN_PORT="$2"; shift 2;;
    --branch)      BRANCH="$2";      shift 2;;
    --slug)        SLUG="$2";        shift 2;;
    --sso-mode)    SSO_MODE="$2";    shift 2;;
    -*) die "unknown flag $1";;
    *)  APP_DIR="$1"; shift;;
  esac
done

# ── clone if --repo ──
if [ -n "$REPO" ]; then
  CLONE_TMP="$(mktemp -d)"
  echo ">> cloning $REPO@$REF"
  git clone -q --branch "$REF" "$REPO" "$CLONE_TMP" || die "clone failed"
  APP_DIR="$CLONE_TMP"
fi
[ -n "$APP_DIR" ] || die "provide a <path-to-app-repo> or --repo <git-url>"
[ -d "$APP_DIR" ] || die "app dir not found: $APP_DIR"
APP_DIR="$(cd "$APP_DIR" && pwd)"

# ── interactive mode selection ──
if [ -z "$SSO_MODE" ]; then
  if [ -t 0 ]; then
    echo ""
    echo "────────────────────────────────────────────────"
    echo "  AI Trust Platform — App Onboarding"
    echo "────────────────────────────────────────────────"
    echo ""
    echo "Does your app have its OWN login / OIDC?"
    echo ""
    echo "  • If NO  (your app has no login, or you want the platform to handle"
    echo "    login entirely) → the tool wraps your app with a Platform-SSO"
    echo "    sidecar.  NO code changes to your app."
    echo ""
    echo "  • If YES (your app ships its own OIDC server or login form) → the"
    echo "    tool generates a JWT-trust patch.  You apply one small change to"
    echo "    your app's auth middleware so it trusts the platform identity."
    echo ""
    printf "Does your app have its own login? [y/N]: "
    read -r _ans
    case "$_ans" in
      [Yy]*) SSO_MODE="jwt-trust";;
      *)     SSO_MODE="sidecar";;
    esac
  else
    SSO_MODE="sidecar"
  fi
fi

case "$SSO_MODE" in
  sidecar|jwt-trust) ;;
  ask)
    echo ""
    echo "Does your app have its own login / OIDC? [y/N]: "
    read -r _ans2
    case "$_ans2" in
      [Yy]*) SSO_MODE="jwt-trust";;
      *)     SSO_MODE="sidecar";;
    esac
    ;;
  *) die "--sso-mode must be sidecar, jwt-trust, or ask";;
esac

echo ""
echo ">> SSO mode    : $SSO_MODE"

# ── derive metadata ──
REMOTE_URL="$(git -C "$APP_DIR" remote get-url origin 2>/dev/null || true)"
REPO_SLUG="$(printf '%s' "$REMOTE_URL" \
  | sed -e 's#\.git$##' -e 's#^.*://##' -e 's#^[^/]*[:/]##' \
  | awk -F/ 'NF>=2{print $(NF-1)"/"$NF} NF<2{print $0}' \
  | tr '[:upper:]' '[:lower:]')"
[ -n "$REPO_SLUG" ] || REPO_SLUG="local/$(basename "$APP_DIR" | tr '[:upper:]' '[:lower:]')"
APP_NAME="$(basename "$APP_DIR")"
[ -n "$SLUG" ] || SLUG="$(basename "$REPO_SLUG" | tr '[:upper:]' '[:lower:]' \
  | sed -e 's#[^a-z0-9]#-#g' -e 's#^-*##' -e 's#-*$##')"

# app port: --app-port, else EXPOSE in Dockerfile, else 3000
if [ -z "$APP_PORT" ]; then
  if [ -f "$APP_DIR/Dockerfile" ]; then
    APP_PORT="$(grep -iE '^EXPOSE ' "$APP_DIR/Dockerfile" | head -1 | awk '{print $2}' | tr -dc '0-9')"
  fi
  [ -n "$APP_PORT" ] || APP_PORT="3000"
fi
UPSTREAM_PORT="$APP_PORT"

# sidecar-specific: ports must differ
if [ "$SSO_MODE" = "sidecar" ]; then
  [ "$UPSTREAM_PORT" != "$LISTEN_PORT" ] || \
    die "app port ($APP_PORT) must differ from the sidecar listen port ($LISTEN_PORT); pass --listen-port"
fi

# app CMD and WORKDIR (needed for sidecar entrypoint + Dockerfile)
APP_CMD=""
if [ -f "$APP_DIR/Dockerfile" ]; then
  APP_CMD="$(grep -iE '^CMD ' "$APP_DIR/Dockerfile" | tail -1 | sed -E 's/^CMD +//I')"
  case "$APP_CMD" in
    '['*)
      APP_CMD="$(printf '%s' "$APP_CMD" \
        | sed -e 's#^\[##' -e 's#\]$##' \
        | sed -e 's#" *, *"# #g' -e 's#"##g' \
        | sed -e 's#^ *##' -e 's# *$##')"
      ;;
  esac
fi
[ -n "$APP_CMD" ] || die "could not detect the app start command (no CMD in Dockerfile); ensure the app has a Dockerfile with a CMD"

APP_WORKDIR="$(grep -iE '^WORKDIR ' "$APP_DIR/Dockerfile" | tail -1 | awk '{print $2}')"
[ -n "$APP_WORKDIR" ] || APP_WORKDIR="/app"

# image tag suffix: sidecar → :sso, jwt-trust → :nosso
if [ "$SSO_MODE" = "sidecar" ]; then
  IMAGE_TAG="sso"
  REGISTER_PORT="$LISTEN_PORT"
  PLATFORM_SSO_FIELD="✅ tick"
else
  IMAGE_TAG="nosso"
  REGISTER_PORT="$UPSTREAM_PORT"
  PLATFORM_SSO_FIELD="⬜ leave unticked"
fi

echo ">> app dir     : $APP_DIR"
echo ">> repo slug   : $REPO_SLUG   (image → ghcr.io/$REPO_SLUG:$IMAGE_TAG)"
echo ">> marketplace slug: $SLUG"
echo ">> app port    : $UPSTREAM_PORT"
[ "$SSO_MODE" = "sidecar" ] && echo ">> sidecar port: $LISTEN_PORT (register this in the Marketplace)"
echo ">> app cmd     : $APP_CMD"
echo ">> branch      : $BRANCH"

# ── render helper ──
render() {
  sed -e "s#@@APP_NAME@@#$APP_NAME#g" \
      -e "s#@@REPO@@#$REPO_SLUG#g" \
      -e "s#@@SLUG@@#$SLUG#g" \
      -e "s#@@UPSTREAM_PORT@@#$UPSTREAM_PORT#g" \
      -e "s#@@LISTEN_PORT@@#$LISTEN_PORT#g" \
      -e "s#@@REGISTER_PORT@@#$REGISTER_PORT#g" \
      -e "s#@@BRANCH@@#$BRANCH#g" \
      -e "s#@@IMAGE_TAG@@#$IMAGE_TAG#g" \
      -e "s#@@APP_IMAGE_STAGE@@#app-base#g" \
      -e "s#@@APP_WORKDIR@@#$APP_WORKDIR#g" \
      -e "s#@@APP_CMD@@#$APP_CMD#g" \
      -e "s#@@PLATFORM_SSO_FIELD@@#$PLATFORM_SSO_FIELD#g" \
      "$1" > "$2"
}

mkdir -p "$APP_DIR/.platform-sso"

# ── sidecar mode ──
if [ "$SSO_MODE" = "sidecar" ]; then
  # 1. copy sidecar
  mkdir -p "$APP_DIR/.platform-sso/sidecar"
  cp "$SIDECAR_DIR/server.js" "$SIDECAR_DIR/package.json" "$SIDECAR_DIR/README.md" \
     "$APP_DIR/.platform-sso/sidecar/"

  # 2. entrypoint
  render "$TMPL_DIR/entrypoint.sh.tmpl" "$APP_DIR/.platform-sso/entrypoint.sh"
  chmod +x "$APP_DIR/.platform-sso/entrypoint.sh"

  # 3. wrapper Dockerfile (inlines app Dockerfile as stage app-base)
  {
    echo "# syntax=docker/dockerfile:1"
    echo "# ── stage app-base: the ORIGINAL app Dockerfile, unmodified ──"
    awk 'BEGIN{done=0} /^[Ff][Rr][Oo][Mm] / && !done {print $0 " AS app-base"; done=1; next} {print}' \
      "$APP_DIR/Dockerfile"
    echo ""
    echo "# ── Platform-SSO wrapper (generated) ──"
    render "$TMPL_DIR/Dockerfile.platform-sso.tmpl" /dev/stdout \
      | awk 'NR==1 && /syntax=/ {next} {print}' \
      | sed -E 's#^FROM app-base AS app$##; s#^FROM app-base$#FROM app-base#'
  } > "$APP_DIR/Dockerfile.platform-sso"

# ── jwt-trust mode ──
else
  # 1. JWT-trust rbac patch
  render "$TMPL_DIR/rbac-platform-patch.js.tmpl" "$APP_DIR/.platform-sso/rbac-platform-patch.js"

  # 2. plain Dockerfile (no sidecar; just copies the app as-is with a nosso tag marker)
  {
    echo "# syntax=docker/dockerfile:1"
    echo "# ── Dockerfile.nosso — plain app image, no Platform-SSO sidecar ──"
    echo "# Register in the Marketplace with Platform SSO OFF, app port @@UPSTREAM_PORT@@."
    echo "# Generated by prepare-app.sh --sso-mode jwt-trust"
    echo "#"
    echo "# The app trusts the platform identity from the Bearer JWT."
    echo "# See .platform-sso/rbac-platform-patch.js for the requireAuth patch."
    cat "$APP_DIR/Dockerfile"
  } | sed "s#@@UPSTREAM_PORT@@#$UPSTREAM_PORT#g" > "$APP_DIR/Dockerfile.nosso"
fi

# ── shared: CI workflow ──
mkdir -p "$APP_DIR/.github/workflows"
# publish-image.yml is the same for both modes; IMAGE_TAG controls the docker tag
render "$TMPL_DIR/publish-image.yml.tmpl" "$APP_DIR/.github/workflows/publish-image.yml"

# ── shared: docs ──
render "$TMPL_DIR/trust_platform_update.md.tmpl" "$APP_DIR/trust_platform_update.md"
render "$TMPL_DIR/ui_deploy_guide.md.tmpl"       "$APP_DIR/ui_deploy_guide.md"

# ── summary ──
echo ""
if [ "$SSO_MODE" = "sidecar" ]; then
  echo "✅ Prepared $APP_NAME for the AI Trust Marketplace (Path A — Platform-SSO sidecar)."
  echo ""
  echo "Added (no existing file modified):"
  echo "  .platform-sso/sidecar/   .platform-sso/entrypoint.sh"
  echo "  Dockerfile.platform-sso  .github/workflows/publish-image.yml"
  echo "  trust_platform_update.md  ui_deploy_guide.md"
  echo ""
  echo "Marketplace registration:"
  echo "  Image ref  : ghcr.io/$REPO_SLUG:sso"
  echo "  App port   : $LISTEN_PORT  (the sidecar port)"
  echo "  Platform SSO: ON"
else
  echo "✅ Prepared $APP_NAME for the AI Trust Marketplace (Path B — JWT trust)."
  echo ""
  echo "Added (no existing file modified):"
  echo "  .platform-sso/rbac-platform-patch.js"
  echo "  Dockerfile.nosso  .github/workflows/publish-image.yml"
  echo "  trust_platform_update.md  ui_deploy_guide.md"
  echo ""
  echo "NEXT: apply the JWT-trust patch to your app's auth middleware."
  echo "  See .platform-sso/rbac-platform-patch.js for the drop-in requireAuth."
  echo ""
  echo "Marketplace registration:"
  echo "  Image ref  : ghcr.io/$REPO_SLUG:nosso"
  echo "  App port   : $UPSTREAM_PORT  (the app's own port, no sidecar)"
  echo "  Platform SSO: OFF"
fi
echo ""
echo "Next steps:"
echo "  cd $APP_DIR"
echo "  git checkout -b $BRANCH && git add -A && git commit -m 'Platform Marketplace onboarding' && git push -u origin $BRANCH"
echo "  # CI publishes ghcr.io/$REPO_SLUG:$IMAGE_TAG  →  register in the Marketplace (see ui_deploy_guide.md)"
[ -n "$CLONE_TMP" ] && echo "  (working copy: $APP_DIR)"
