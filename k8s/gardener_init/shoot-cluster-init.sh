#!/usr/bin/env bash
# One-time setup on the SHOOT cluster for a new Gardener shoot.
#
# Usage:
#   export KUBECONFIG=/path/to/shoot-kubeconfig.yaml
#   bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name> <app-host> <keycloak-host> [<minio-host>]
#
# Example:
#   bash k8s/gardener_init/shoot-cluster-init.sh sr-test \
#     sr-test.ai-trust.shoot.gardener.cc-one.showroom.apeirora.eu \
#     keycloak.sr-test.ai-trust.shoot.gardener.cc-one.showroom.apeirora.eu \
#     minio.sr-test.ai-trust.shoot.gardener.cc-one.showroom.apeirora.eu
#
# What it does:
#   1. Installs Traefik ingress controller via Helm (default namespace).
#   2. Applies rbac.yaml — creates the ClusterRole + ClusterRoleBinding that gives
#      the GitHub Actions OIDC identity admin access to the shoot.
#   3. Requests a wildcard TLS certificate via Gardener cert-service
#      (cert.gardener.cloud/v1alpha1 Certificate CRD). Gardener uses DNS-01
#      automatically — no port 80 required. The cert is stored in the
#      ai-trust/ai-trust-tls Secret that the Helm Ingress references.
#   4. Annotates the Traefik LoadBalancer Service with Gardener DNS annotations so
#      shoot-dns-service auto-publishes A-records for all ingress hostnames.
#
# Run garden-cluster-init.sh first (with the garden KUBECONFIG) for structured auth.
# See k8s/README.md "Adding a new cluster" for the full walkthrough.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER_NAME="${1:-}"
APP_HOST="${2:-}"
KEYCLOAK_HOST="${3:-}"
MINIO_HOST="${4:-}"

if [[ -z "$CLUSTER_NAME" || -z "$APP_HOST" || -z "$KEYCLOAK_HOST" ]]; then
  echo "usage: export KUBECONFIG=/path/to/shoot-kubeconfig.yaml && bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name> <app-host> <keycloak-host> [<minio-host>]" >&2
  exit 1
fi

# Derive the shoot base domain from the app host (everything after the first label)
SHOOT_DOMAIN="${APP_HOST#*.}"

echo "KUBECONFIG: ${KUBECONFIG:-<not set>}"
echo "Cluster:    $CLUSTER_NAME"
echo "Domain:     $SHOOT_DOMAIN"
echo ""

echo "==> [1/4] Installing Traefik ingress controller (default namespace)"
helm repo add traefik https://traefik.github.io/charts --force-update
helm upgrade --install traefik traefik/traefik \
  --namespace default \
  --set ingressClass.enabled=true \
  --set ingressClass.isDefaultClass=true \
  --set "ports.web.port=8000" \
  --set "ports.web.exposedPort=80" \
  --set "ports.websecure.port=8443" \
  --set "ports.websecure.exposedPort=443"
echo "    Traefik installed (LB IP will be pending until OpenStack provisions it)"

echo ""
echo "==> [2/4] Applying rbac.yaml to shoot cluster"
kubectl apply -f "$SCRIPT_DIR/rbac.yaml"

echo ""
echo "==> [3/4] Requesting TLS certificate via Gardener cert-service (DNS-01, no port 80 needed)"
# Ensure the ai-trust namespace exists (deploy-gardener.yml bootstrap.sh creates it, but
# shoot-cluster-init may run before the first deploy).
kubectl create namespace ai-trust --dry-run=client -o yaml | kubectl apply -f -
# cert.gardener.cloud Certificate CRD — Gardener cert-service issues a Let's Encrypt cert
# via DNS-01 and writes it into the ai-trust-tls Secret (the same name the Helm Ingress uses).
# NOTE: no spec.commonName — the X.509 CN is capped at 64 bytes and the Gardener domain is
# longer. List all SANs in dnsNames only (Let's Encrypt ignores CN; uses SAN-only certs).
kubectl apply -f - <<EOF
apiVersion: cert.gardener.cloud/v1alpha1
kind: Certificate
metadata:
  name: ai-trust-tls
  namespace: ai-trust
spec:
  dnsNames:
    - "${APP_HOST}"
    - "${KEYCLOAK_HOST}"
    $([ -n "${MINIO_HOST}" ] && echo "- \"${MINIO_HOST}\"" || true)
  secretRef:
    name: ai-trust-tls
    namespace: ai-trust
EOF
echo "    Certificate requested — Gardener cert-service will issue via DNS-01 (takes ~1-2 min)"
echo "    Monitor: kubectl get certificate ai-trust-tls -n ai-trust -w"

echo ""
echo "==> [4/4] Annotating Traefik LB Service for Gardener-managed DNS"
echo "    Waiting for Traefik deployment to be available..."
kubectl wait --for=condition=available deployment/traefik -n default --timeout=120s || true
DNSNAMES="${APP_HOST},${KEYCLOAK_HOST}"
if [[ -n "$MINIO_HOST" ]]; then
  DNSNAMES="${DNSNAMES},${MINIO_HOST}"
fi
kubectl annotate svc traefik -n default --overwrite \
  dns.gardener.cloud/class=garden \
  "dns.gardener.cloud/dnsnames=${DNSNAMES}" \
  dns.gardener.cloud/ttl="120"
echo "    Annotated Traefik LB Service: ${DNSNAMES}"

echo ""
echo "==> shoot-cluster-init complete for '$CLUSTER_NAME'."
echo ""
echo "    Check certificate status:"
echo "      kubectl get certificate ai-trust-tls -n ai-trust"
echo ""
echo "    Get the Traefik LoadBalancer IP:"
echo "      kubectl get svc traefik -n default"
echo ""
echo "    Deploy the platform:"
echo "      gh workflow run deploy-gardener.yml --field cluster=$CLUSTER_NAME --field image_tag=latest"
