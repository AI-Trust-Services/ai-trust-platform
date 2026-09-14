#!/usr/bin/env bash
# 8-verify.sh — confirm the app pods are healthy and (best-effort) reachable.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; source "$HERE/lib.sh"; load_config

log "1) App pods Running/Completed?"
notrun=$(K -n "$APP_NS" get pods --no-headers 2>/dev/null | awk '$3!="Running" && $3!="Completed"{print "     "$1" "$3}')
[ -z "$notrun" ] && ok "all app pods Running/Completed" || { warn "not-ready pods:"; echo "$notrun"; }

log "2) Init Jobs Complete?"
K -n "$APP_NS" get jobs --no-headers 2>/dev/null | awk '{print "     "$1" "$2}' || true

log "3) HTTP reachability (best-effort, in-cluster)"
LBIP=""
if [ "${INGRESS_MODE:-}" = "gateway" ] && [ -n "${GATEWAY_NS:-}" ]; then
  LBIP=$(K -n "$GATEWAY_NS" get gateway "${GATEWAY_NAME:-}" -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
fi
[ -n "$LBIP" ] || LBIP=$(K get svc -A -o jsonpath='{range .items[?(@.spec.type=="LoadBalancer")]}{.status.loadBalancer.ingress[0].ip}{"\n"}{end}' 2>/dev/null | grep -E '^[0-9]' | head -1)
if [ -n "$LBIP" ]; then
  pc=$(K -n "$APP_NS" run vfy-$$ --rm -i --restart=Never --image=curlimages/curl:8.9.1 --timeout=60s -- \
    curl -sk -o /dev/null -w "%{http_code}" --resolve "$APP_DOMAIN:443:$LBIP" "https://$APP_DOMAIN/" 2>/dev/null | grep -oE '^[0-9]{3}' | head -1)
  case "$pc" in
    200|302|403) ok "app at $APP_URL -> HTTP $pc (served + auth-gated as expected)";;
    *) warn "app -> HTTP ${pc:-000} (check ingress/oauth2, or DNS/TLS from outside)";;
  esac
else
  warn "no LoadBalancer IP discovered — verify externally: curl -I $APP_URL/"
fi

echo ""
echo "======================================================================"
ok "Verification summary"
echo "   URL:      $APP_URL/"
echo "   Keycloak: $APP_URL/keycloak/"
echo "   Admin:    admin / (see $STATE/admin-credentials.txt)"
echo "======================================================================"
