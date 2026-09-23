#!/usr/bin/env bash
# 4-ingress.sh — expose the app at $APP_DOMAIN. Branches on INGRESS_MODE:
#   ingress  -> a standard Kubernetes Ingress (+ TLS Secret per TLS_MODE)
#   gateway  -> a Gateway-API listener + HTTPRoutes on an existing Gateway
#   kind     -> NodePort service (reach via kubectl port-forward / node IP)
#   none     -> nothing (you wire your own)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; source "$HERE/lib.sh"; load_config
ING="$CONFIG/ingress"; OUT="$STATE/ingress"; mkdir -p "$OUT"

case "${INGRESS_MODE:-ingress}" in
  ingress)
    # TLS secret
    case "${TLS_MODE:-provided}" in
      provided)
        [ -f "$PREREQ/tls.crt" ] && [ -f "$PREREQ/tls.key" ] || die "TLS_MODE=provided needs prerequisites/tls.crt + tls.key"
        log "Creating TLS Secret 'app-tls' from prerequisites/tls.{crt,key}…"
        K -n "$APP_NS" create secret tls app-tls --cert="$PREREQ/tls.crt" --key="$PREREQ/tls.key" \
          --dry-run=client -o yaml | K apply -f - >/dev/null ;;
      cert-manager) log "TLS via cert-manager issuer '$CERT_ISSUER' (annotation added to the Ingress).";;
      none) log "TLS_MODE=none — Ingress will serve HTTP (or TLS is handled upstream).";;
    esac

    log "Applying Ingress…"
    render "$ING/ingress.tmpl" > "$OUT/ingress.yaml"
    # Post-process the Ingress for the chosen TLS/class using python3 (portable).
    python3 - "$OUT/ingress.yaml" "${TLS_MODE:-provided}" "${CERT_ISSUER:-}" "${INGRESS_CLASS:-}" <<'PY'
import sys, yaml
path, tls_mode, issuer, cls = sys.argv[1:5]
d = yaml.safe_load(open(path))
spec = d.setdefault("spec", {})
meta = d.setdefault("metadata", {})
ann = meta.setdefault("annotations", {})
if cls:
    spec["ingressClassName"] = cls
if tls_mode == "cert-manager" and issuer:
    ann["cert-manager.io/cluster-issuer"] = issuer
elif tls_mode == "none":
    spec.pop("tls", None)
yaml.safe_dump(d, open(path, "w"), default_flow_style=False, sort_keys=False)
PY
    K apply -f "$OUT/ingress.yaml" >/dev/null
    ok "Ingress applied for https://$APP_DOMAIN"
    echo "   Point DNS for $APP_DOMAIN at your ingress controller's external address:"
    K get svc -A 2>/dev/null | grep -iE 'ingress|traefik|nginx' | grep -i loadbalancer || true
    ;;

  gateway)
    [ -n "${GATEWAY_NAME:-}" ] && [ -n "${GATEWAY_NS:-}" ] || die "gateway mode needs GATEWAY_NAME + GATEWAY_NS"
    CUR="$(K -n "$GATEWAY_NS" get gateway "$GATEWAY_NAME" -o jsonpath="{.spec.listeners[?(@.name==\"$GATEWAY_LISTENER\")].hostname}" 2>/dev/null || true)"
    if [ -z "$CUR" ]; then
      log "Adding '$GATEWAY_LISTENER' listener to gateway $GATEWAY_NAME…"
      render "$ING/gateway-listener-patch.tmpl" > "$OUT/gw-patch.yaml"
      K -n "$GATEWAY_NS" patch gateway "$GATEWAY_NAME" --type=json --patch-file "$OUT/gw-patch.yaml"
    elif [ "$CUR" != "$APP_DOMAIN" ]; then
      warn "listener '$GATEWAY_LISTENER' has stale hostname '$CUR' — updating to '$APP_DOMAIN'"
      IDX="$(K -n "$GATEWAY_NS" get gateway "$GATEWAY_NAME" -o json \
        | python3 -c "import json,sys;d=json.load(sys.stdin);print([i for i,l in enumerate(d['spec']['listeners']) if l['name']=='$GATEWAY_LISTENER'][0])")"
      K -n "$GATEWAY_NS" patch gateway "$GATEWAY_NAME" --type=json \
        -p "[{\"op\":\"replace\",\"path\":\"/spec/listeners/$IDX/hostname\",\"value\":\"$APP_DOMAIN\"}]"
    else ok "listener '$GATEWAY_LISTENER' already present"; fi

    log "Applying HTTPRoutes + ReferenceGrant…"
    render "$ING/httproute.tmpl" > "$OUT/httproute.yaml"
    K apply -f "$OUT/httproute.yaml" >/dev/null
    ok "Gateway routing wired for https://$APP_DOMAIN (listener port ${GATEWAY_PORT})"
    ;;

  kind)
    log "kind mode — exposing oauth2-proxy as a NodePort (30080)…"
    K -n "$APP_NS" patch svc oauth2-proxy --type=merge \
      -p '{"spec":{"type":"NodePort","ports":[{"name":"http","port":8080,"targetPort":4180,"nodePort":30080}]}}' >/dev/null 2>&1 || \
      warn "could not patch oauth2-proxy service — reach it via: K -n $APP_NS port-forward svc/oauth2-proxy 8080:8080"
    ok "kind: reach the app at http://localhost:8080 via:"
    echo "     kubectl -n $APP_NS port-forward svc/oauth2-proxy 8080:8080"
    echo "   NOTE: APP_URL must resolve for OIDC — for local trials set APP_URL=http://localhost:8080 in config.env."
    ;;

  none) ok "INGRESS_MODE=none — workloads are up; wire your own ingress to Service oauth2-proxy:8080 in $APP_NS." ;;
esac
