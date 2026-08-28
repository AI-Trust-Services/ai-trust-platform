#!/usr/bin/env bash
# 3-deploy-app.sh — deploy the AI Trust app into $APP_NS: namespace, config/secret,
# infra, init Jobs, backends/frontends/workers/shell/oauth2-proxy. Cluster-agnostic.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; source "$HERE/lib.sh"; load_config
K="$CONFIG/k8s-app"; OUT="$STATE/k8s-app"; mkdir -p "$OUT"

# --- 0. Generate any secrets not already pinned in config.env --------------
gen_hex(){ openssl rand -hex "$1"; }
: "${POSTGRES_PASSWORD:=$(gen_hex 16)}"
: "${KEYCLOAK_ADMIN_PASSWORD:=$(gen_hex 16)}"
: "${APP_ADMIN_PASSWORD:=$(gen_hex 12)}"
: "${MINIO_ROOT_PASSWORD:=$(gen_hex 16)}"
: "${KEYCLOAK_CLIENT_SECRET:=$(gen_hex 16)}"
: "${USERS_BACKEND_CLIENT_SECRET:=$(gen_hex 16)}"
export COOKIE_SECRET="$(gen_hex 16)"   # 32 hex chars = valid oauth2-proxy cookie secret
export POSTGRES_PASSWORD KEYCLOAK_ADMIN_PASSWORD APP_ADMIN_PASSWORD MINIO_ROOT_PASSWORD KEYCLOAK_CLIENT_SECRET USERS_BACKEND_CLIENT_SECRET
# Persist the generated admin password so the operator can log in.
printf '%s\n' "APP_ADMIN_USERNAME=admin" "APP_ADMIN_PASSWORD=$APP_ADMIN_PASSWORD" > "$STATE/admin-credentials.txt"

# --- 1. Namespace, config + secret -----------------------------------------
log "Namespace + config + secret…"
rewrite_manifest "$K/00-namespace.yaml" | K apply -f - >/dev/null
render "$K/02-secret-config.tmpl"        | K apply -f - >/dev/null
for f in 01-cm-ch-config 01-cm-otelcol 01-cm-pg-init; do
  rewrite_manifest "$K/$f.yaml" | K apply -f - >/dev/null
done

# --- 2. Infra (Postgres, ClickHouse, MinIO, RabbitMQ, Keycloak) ------------
log "Infra…"
rewrite_manifest "$K/10-infra.yaml" > "$OUT/10-infra.yaml"
pin_and_storage_inplace "$OUT/10-infra.yaml"
K apply -f "$OUT/10-infra.yaml" >/dev/null

# Keycloak served UNDER /keycloak on the single public host (issuer must match APP_URL).
K -n "$APP_NS" set env deploy/keycloak \
  KC_HOSTNAME="$APP_URL/keycloak" KC_HOSTNAME_STRICT=false KC_HTTP_RELATIVE_PATH=/keycloak >/dev/null 2>&1 || true
K -n "$APP_NS" patch deploy keycloak --type=json \
  -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/keycloak/realms/master"}]' >/dev/null 2>&1 || true

# --- 3. Init Jobs (immutable after create → pin BEFORE apply) ---------------
log "Init Jobs…"
rewrite_manifest "$K/20-jobs.yaml" > "$OUT/20-jobs.yaml"
pin_and_storage_inplace "$OUT/20-jobs.yaml"
K apply -f "$OUT/20-jobs.yaml" >/dev/null

# --- 4. App: backends + frontends + workers + shell + oauth2-proxy ----------
log "App workloads…"
rewrite_manifest "$K/30-app.yaml"                 > "$OUT/30-app.yaml"; pin_and_storage_inplace "$OUT/30-app.yaml"
rewrite_manifest "$K/40-workers-shell-proxy.yaml" > "$OUT/40-workers-shell-proxy.yaml"; pin_and_storage_inplace "$OUT/40-workers-shell-proxy.yaml"
K apply -f "$OUT/30-app.yaml" -f "$OUT/40-workers-shell-proxy.yaml" >/dev/null

# oauth2-proxy: all Keycloak URLs under /keycloak; cookie-secure on for HTTPS ingress.
# The $(VAR) tokens are Kubernetes downward-env references resolved by kubelet, NOT shell —
# they must reach the container args verbatim. Build the patch with python3 json.dumps so
# APP_URL is safely escaped (no shell-concat JSON injection if the URL has odd characters).
COOKIE_SECURE=true; [ "${TLS_MODE:-provided}" = "none" ] && [ "${INGRESS_MODE:-}" != "gateway" ] && COOKIE_SECURE=false
OAUTH_PATCH="$(APP_URL="$APP_URL" COOKIE_SECURE="$COOKIE_SECURE" python3 - <<'PY'
import json, os
u = os.environ["APP_URL"]; cs = os.environ["COOKIE_SECURE"]
args = [
  "--provider=oidc", "--client-id=oauth2-proxy", "--client-secret=$(KEYCLOAK_CLIENT_SECRET)",
  "--oidc-issuer-url=http://keycloak:8080/keycloak/realms/ai-trust",
  f"--login-url={u}/keycloak/realms/ai-trust/protocol/openid-connect/auth",
  "--redeem-url=http://keycloak:8080/keycloak/realms/ai-trust/protocol/openid-connect/token",
  "--oidc-jwks-url=http://keycloak:8080/keycloak/realms/ai-trust/protocol/openid-connect/certs",
  "--skip-oidc-discovery=true", "--insecure-oidc-skip-issuer-verification=true",
  f"--redirect-url={u}/oauth2/callback", "--upstream=http://shell:80",
  "--http-address=0.0.0.0:4180", "--cookie-secret=$(OAUTH2_PROXY_COOKIE_SECRET)",
  f"--cookie-secure={cs}", "--email-domain=*", "--pass-authorization-header=true",
  "--backend-logout-url=http://keycloak:8080/keycloak/realms/ai-trust/protocol/openid-connect/logout",
]
print(json.dumps([{"op": "replace", "path": "/spec/template/spec/containers/0/args", "value": args}]))
PY
)"
K -n "$APP_NS" patch deploy oauth2-proxy --type=json -p "$OAUTH_PATCH" >/dev/null 2>&1 || warn "oauth2-proxy arg patch skipped"

log "Waiting for the app to settle (first boot ~5-8 min)…"
K -n "$APP_NS" rollout status deploy/oauth2-proxy --timeout=600s 2>&1 | tail -1 || true
K -n "$APP_NS" rollout status deploy/shell        --timeout=300s 2>&1 | tail -1 || true
notready=$(K -n "$APP_NS" get pods --no-headers 2>/dev/null | grep -vE "Running|Completed" | wc -l | tr -d ' ')
[ "$notready" -eq 0 ] && ok "all app pods Running/Completed" || warn "$notready pod(s) not ready — K -n $APP_NS get pods"
ok "app deployed. Bootstrap admin: admin / (see .state/admin-credentials.txt)"
