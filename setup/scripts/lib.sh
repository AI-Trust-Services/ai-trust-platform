#!/usr/bin/env bash
# lib.sh — shared helpers for the AI Trust Platform deploy (portable, cluster-agnostic).
# Works on Linux / macOS / WSL with any kubeconfig your `kubectl` already points at.
# No dependency on a specific cloud, Gardener, or a Platform Mesh.

# Resolve bundle layout relative to THIS file (works regardless of caller CWD).
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE="$(cd "$LIB_DIR/.." && pwd)"
PREREQ="$BUNDLE/prerequisites"
CONFIG="$BUNDLE/config"
STATE="$BUNDLE/.state"; mkdir -p "$STATE"

# Colours (disabled when not a TTY, e.g. CI logs).
if [ -t 1 ]; then
  c_reset=$'\033[0m'; c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_blu=$'\033[36m'
else
  c_reset=""; c_red=""; c_grn=""; c_yel=""; c_blu=""
fi
log(){  echo "${c_blu}==>${c_reset} $*"; }
ok(){   echo "${c_grn}[ok]${c_reset} $*"; }
warn(){ echo "${c_yel}[warn]${c_reset} $*"; }
err(){  echo "${c_red}[error]${c_reset} $*" >&2; }
die(){  err "$*"; exit 1; }

# ---- config -----------------------------------------------------------------
load_config(){
  [ -f "$PREREQ/config.env" ] || die "Missing $PREREQ/config.env — copy prerequisites/config.env.example to it and fill it in."
  set -a; # shellcheck disable=SC1090
  source "$PREREQ/config.env"; set +a

  # Defaults for anything the user left unset.
  : "${TENANCY_MODE:=single}"
  : "${APP_NS:=ai-trust-app}"
  : "${TAG:=v1}"
  : "${INGRESS_MODE:=ingress}"
  : "${TLS_MODE:=provided}"
  : "${IMAGE_PULL_POLICY:=IfNotPresent}"
  : "${APP_GIT_URL:=https://github.com/AI-Trust-Services/ai-trust-platform.git}"
  : "${APP_GIT_REF:=main}"
  : "${GATEWAY_LISTENER:=terminate-aitrust}"
  : "${GATEWAY_PORT:=8443}"
  : "${NODE_TAINT:=false}"

  # Required, always.
  [ -n "${APP_DOMAIN:-}" ] && [ "$APP_DOMAIN" != "<your.app.hostname>" ] || die "Set APP_DOMAIN in config.env."
  [ -n "${APP_URL:-}" ]    && [[ "$APP_URL" != *"<your"* ]]              || die "Set APP_URL in config.env."

  # Registry required for every mode EXCEPT kind (which loads images locally).
  if [ "$INGRESS_MODE" != "kind" ]; then
    [ -n "${REGISTRY:-}" ] && [ "$REGISTRY" != "<your-registry>" ] || die "Set REGISTRY in config.env (or use INGRESS_MODE=kind)."
  fi

  export TENANCY_MODE APP_NS APP_DOMAIN APP_URL REGISTRY TAG INGRESS_MODE TLS_MODE CERT_ISSUER INGRESS_CLASS
  export GATEWAY_NS GATEWAY_NAME GATEWAY_LISTENER GATEWAY_TLS_SECRET GATEWAY_PORT
  export NODE_LABEL_KEY NODE_LABEL_VALUE NODE_TAINT STORAGE_CLASS IMAGE_PULL_POLICY APP_GIT_URL APP_GIT_REF
}

# ---- kubectl ----------------------------------------------------------------
# Uses whatever KUBECONFIG / current-context the caller already has. Set
# KUBECONFIG or KUBE_CONTEXT in your shell (or config.env) to target a cluster.
K(){ if [ -n "${KUBE_CONTEXT:-}" ]; then kubectl --context "$KUBE_CONTEXT" "$@"; else kubectl "$@"; fi; }

require_tools(){
  local miss=0 t
  for t in "$@"; do command -v "$t" >/dev/null 2>&1 || { err "missing tool: $t"; miss=1; }; done
  [ "$miss" -eq 0 ] || die "install the missing tool(s) above and re-run."
}

# ---- templating (no envsubst dependency; pure sed of __X__ tokens) -----------
render(){
  sed -e "s|__APP_DOMAIN__|${APP_DOMAIN}|g" \
      -e "s|__APP_URL__|${APP_URL}|g" \
      -e "s|__APP_NS__|${APP_NS}|g" \
      -e "s|__REGISTRY__|${REGISTRY}|g" \
      -e "s|__TAG__|${TAG}|g" \
      -e "s|__COOKIE_SECRET__|${COOKIE_SECRET:-}|g" \
      -e "s|__KEYCLOAK_CLIENT_SECRET__|${KEYCLOAK_CLIENT_SECRET:-}|g" \
      -e "s|__USERS_BACKEND_CLIENT_SECRET__|${USERS_BACKEND_CLIENT_SECRET:-}|g" \
      -e "s|__POSTGRES_PASSWORD__|${POSTGRES_PASSWORD:-}|g" \
      -e "s|__KEYCLOAK_ADMIN_PASSWORD__|${KEYCLOAK_ADMIN_PASSWORD:-}|g" \
      -e "s|__APP_ADMIN_PASSWORD__|${APP_ADMIN_PASSWORD:-}|g" \
      -e "s|__MINIO_ROOT_PASSWORD__|${MINIO_ROOT_PASSWORD:-}|g" \
      -e "s|__TENANCY_MODE__|${TENANCY_MODE:-single}|g" \
      -e "s|__GATEWAY_NAME__|${GATEWAY_NAME:-}|g" \
      -e "s|__GATEWAY_NS__|${GATEWAY_NS:-}|g" \
      -e "s|__GATEWAY_LISTENER__|${GATEWAY_LISTENER:-terminate-aitrust}|g" \
      -e "s|__GATEWAY_PORT__|${GATEWAY_PORT:-8443}|g" \
      -e "s|__GATEWAY_TLS_SECRET__|${GATEWAY_TLS_SECRET:-}|g" \
      "$1"
}

# Rewrite the placeholder image refs (aitrust/<name>:kind) + namespace + pull policy
# in a k8s-app manifest so it targets $REGISTRY/$TAG/$APP_NS. Prints to stdout.
# In kind mode the images stay as local `aitrust/<name>:<TAG>` (loaded into the node).
rewrite_manifest(){
  local f="$1"
  if [ "$INGRESS_MODE" = "kind" ]; then
    sed -E "s#image: aitrust/([a-z0-9-]+):kind#image: aitrust/\1:${TAG}#g; \
            s#imagePullPolicy: IfNotPresent#imagePullPolicy: Never#g; \
            s#namespace: ai-trust-app#namespace: ${APP_NS}#g" "$f"
  else
    sed -E "s#image: aitrust/([a-z0-9-]+):kind#image: ${REGISTRY}/aitrust-\1:${TAG}#g; \
            s#imagePullPolicy: IfNotPresent#imagePullPolicy: ${IMAGE_PULL_POLICY}#g; \
            s#namespace: ai-trust-app#namespace: ${APP_NS}#g" "$f"
  fi
}

# ---- node pinning (optional) ------------------------------------------------
# Emits a strategic-merge patch fragment (JSON) for nodeSelector + toleration,
# or empty string if NODE_LABEL_KEY is unset. Used by the deploy script.
node_pin_patch(){
  [ -n "${NODE_LABEL_KEY:-}" ] || { echo ""; return; }
  local sel tol=""
  sel="\"nodeSelector\":{\"${NODE_LABEL_KEY}\":\"${NODE_LABEL_VALUE}\"}"
  if [ "${NODE_TAINT:-false}" = "true" ]; then
    tol=",\"tolerations\":[{\"key\":\"${NODE_LABEL_KEY}\",\"value\":\"${NODE_LABEL_VALUE}\",\"effect\":\"NoSchedule\"}]"
  fi
  echo "{\"spec\":{\"template\":{\"spec\":{${sel}${tol}}}}}"
}

# Inject nodeSelector/toleration (+ optional storageClassName) into a multi-doc
# YAML file IN PLACE. Delegates to the shared pin_and_storage.py so bash and
# PowerShell behave identically. Safe no-op when no pinning/storage is configured.
# Jobs are immutable post-create, so this must run BEFORE `kubectl apply`.
pin_and_storage_inplace(){
  [ -f "$LIB_DIR/pin_and_storage.py" ] || die "pin_and_storage.py not found at $LIB_DIR — bundle layout is broken."
  python3 "$LIB_DIR/pin_and_storage.py" "$1" \
    "${NODE_LABEL_KEY:-}" "${NODE_LABEL_VALUE:-}" "${NODE_TAINT:-false}" "${STORAGE_CLASS:-}"
}

wait_for(){ local t=$1 i=$2 d=$3; shift 3; local w=0; log "Waiting: $d (timeout ${t}s)"
  while ! "$@" >/dev/null 2>&1; do sleep "$i"; w=$((w+i)); [ "$w" -ge "$t" ] && { err "timeout: $d"; return 1; }; printf '.'; done; echo; ok "$d"; }

# roll_to_tag <newtag> — repoint every app image ($REGISTRY/aitrust-*) in $APP_NS
# to <newtag> and wait for the rollouts. Used by update.sh.
roll_to_tag(){
  local newtag="$1"; [ -n "$newtag" ] || die "roll_to_tag: no tag"
  local d c img base setargs
  for d in $(K -n "$APP_NS" get deploy -o name 2>/dev/null); do
    setargs=""
    while IFS=$'\t' read -r c img; do
      case "$img" in
        "$REGISTRY"/aitrust-*:*)
          base="${img%:*}"; setargs="$setargs ${c}=${base}:${newtag}" ;;
      esac
    done < <(K -n "$APP_NS" get "$d" -o jsonpath='{range .spec.template.spec.containers[*]}{.name}{"\t"}{.image}{"\n"}{end}' 2>/dev/null)
    if [ -n "$setargs" ]; then
      # shellcheck disable=SC2086
      K -n "$APP_NS" set image "$d" $setargs >/dev/null 2>&1 \
        && ok "set image ${d#deployment.apps/} -> :$newtag" || warn "set image failed for $d"
    fi
  done
  for d in oauth2-proxy shell; do
    K -n "$APP_NS" rollout status deploy/"$d" --timeout=300s 2>&1 | tail -1 || true
  done
}
