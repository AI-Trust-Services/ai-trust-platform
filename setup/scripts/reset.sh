#!/usr/bin/env bash
# reset.sh — remove the app + its ingress. Leaves the cluster/nodes otherwise untouched.
#   reset.sh   → delete the app namespace + ingress/route/listener for this app
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; source "$HERE/lib.sh"; load_config

case "${INGRESS_MODE:-ingress}" in
  ingress)
    log "Deleting Ingress + TLS secret…"
    K -n "$APP_NS" delete ingress ai-trust-app --ignore-not-found >/dev/null 2>&1 || true
    K -n "$APP_NS" delete secret  app-tls      --ignore-not-found >/dev/null 2>&1 || true ;;
  gateway)
    log "Deleting HTTPRoutes + ReferenceGrant + the app's gateway listener…"
    K -n "$GATEWAY_NS" delete httproute ai-trust-app ai-trust-keycloak --ignore-not-found >/dev/null 2>&1 || true
    K -n "$APP_NS" delete referencegrant allow-gateway-to-app --ignore-not-found >/dev/null 2>&1 || true
    # Drop ONLY this app's listener from the shared gateway (python3, no jq needed).
    K -n "$GATEWAY_NS" get gateway "$GATEWAY_NAME" -o json 2>/dev/null \
      | python3 -c "import json,sys;d=json.load(sys.stdin);d['spec']['listeners']=[l for l in d['spec']['listeners'] if l.get('name')!='$GATEWAY_LISTENER'];print(json.dumps(d))" \
      | K apply -f - >/dev/null 2>&1 || true ;;
esac

log "Deleting the app namespace '$APP_NS'…"
K delete namespace "$APP_NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true
ok "reset done — app + ingress removed. Re-run ./scripts/deploy.sh to reinstall."
