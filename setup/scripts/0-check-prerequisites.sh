#!/usr/bin/env bash
# 0-check-prerequisites.sh — validate config + tools + cluster reachability before any action.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; source "$HERE/lib.sh"
FAILS=0
chk(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else err "$1"; [ -n "${3:-}" ] && echo "     fix: $3"; FAILS=$((FAILS+1)); fi; }

echo "======================================================================"
echo "  AI Trust Platform — prerequisite check"
echo "======================================================================"

log "config.env"
if [ -f "$PREREQ/config.env" ]; then
  load_config
  chk "no <PLACEHOLDER> left in config.env" "! grep -qE '<[A-Za-z._-]+>' '$PREREQ/config.env'" "replace every <...> placeholder"
  chk "APP_DOMAIN looks like a hostname" '[[ "$APP_DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]]' "set a real APP_DOMAIN"
  chk "TENANCY_MODE is single or jwt" '[[ "$TENANCY_MODE" =~ ^(single|jwt)$ ]]' "set TENANCY_MODE=single"
else err "config.env missing"; echo "     fix: cp prerequisites/config.env.example prerequisites/config.env"; FAILS=$((FAILS+1)); fi

log "tools"
TOOLS="kubectl python3 openssl curl"
[ "${INGRESS_MODE:-}" = "kind" ] && TOOLS="$TOOLS kind docker" || TOOLS="$TOOLS docker"
for t in $TOOLS; do chk "$t present" "command -v $t" "install $t"; done
python3 -c "import yaml" 2>/dev/null && ok "python3 pyyaml present" || { err "python3 'yaml' module missing"; echo "     fix: pip install pyyaml"; FAILS=$((FAILS+1)); }

log "cluster reachable (current kubectl context)"
if K cluster-info >/dev/null 2>&1; then
  ok "kubectl can reach a cluster: $(K config current-context 2>/dev/null)"
else
  err "kubectl cannot reach a cluster"; echo "     fix: point KUBECONFIG/KUBE_CONTEXT at your target cluster"; FAILS=$((FAILS+1))
fi

log "ingress mode: ${INGRESS_MODE:-ingress}"
case "${INGRESS_MODE:-ingress}" in
  ingress)
    K get ingressclass >/dev/null 2>&1 && ok "IngressClass API present" || warn "no IngressClass found — is an ingress controller installed?"
    case "${TLS_MODE:-provided}" in
      provided)
        if [ -f "$PREREQ/tls.crt" ] && [ -f "$PREREQ/tls.key" ]; then
          openssl x509 -in "$PREREQ/tls.crt" -noout >/dev/null 2>&1 && ok "tls.crt is valid PEM" || { err "tls.crt invalid"; FAILS=$((FAILS+1)); }
          openssl x509 -in "$PREREQ/tls.crt" -noout -checkend 0 >/dev/null 2>&1 && ok "tls.crt not expired" || { err "tls.crt expired"; FAILS=$((FAILS+1)); }
        else err "TLS_MODE=provided but prerequisites/tls.crt / tls.key missing"; echo "     fix: add your cert (see prerequisites/README.md) or set TLS_MODE=cert-manager|none"; FAILS=$((FAILS+1)); fi ;;
      cert-manager) [ -n "${CERT_ISSUER:-}" ] && ok "CERT_ISSUER set ($CERT_ISSUER)" || { err "TLS_MODE=cert-manager needs CERT_ISSUER"; FAILS=$((FAILS+1)); } ;;
      none) ok "TLS_MODE=none (HTTP / TLS handled upstream)";;
      *) err "unknown TLS_MODE '$TLS_MODE'"; FAILS=$((FAILS+1));;
    esac ;;
  gateway)
    for v in GATEWAY_NS GATEWAY_NAME GATEWAY_TLS_SECRET; do
      eval "[ -n \"\${$v:-}\" ]" && ok "$v set" || { err "INGRESS_MODE=gateway needs $v"; FAILS=$((FAILS+1)); }
    done
    [ -n "${GATEWAY_NAME:-}" ] && { K -n "$GATEWAY_NS" get gateway "$GATEWAY_NAME" >/dev/null 2>&1 && ok "gateway $GATEWAY_NAME reachable" || warn "gateway $GATEWAY_NAME not found in $GATEWAY_NS"; } ;;
  kind) command -v kind >/dev/null 2>&1 && ok "kind present" || { err "INGRESS_MODE=kind needs the 'kind' CLI"; FAILS=$((FAILS+1)); } ;;
  none) ok "INGRESS_MODE=none — workloads only, wire your own ingress" ;;
  *) err "unknown INGRESS_MODE '$INGRESS_MODE'"; FAILS=$((FAILS+1)) ;;
esac

if [ "${INGRESS_MODE:-}" != "kind" ]; then
  log "registry"
  chk "REGISTRY set" '[ -n "$REGISTRY" ] && [ "$REGISTRY" != "<your-registry>" ]' "set REGISTRY + run docker login"
fi

echo "======================================================================"
[ "$FAILS" -eq 0 ] && { ok "ALL PREREQUISITES PASSED"; exit 0; } || { err "$FAILS check(s) failed — fix the [error] lines above."; exit 1; }
