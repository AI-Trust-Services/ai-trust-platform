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
#   3. Applies cert-manager-issuer.yaml — creates the Let's Encrypt ClusterIssuer
#      used by the Helm chart for TLS certificates.
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

echo "KUBECONFIG: ${KUBECONFIG:-<not set>}"
echo "Cluster: $CLUSTER_NAME"
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
echo "==> [3/4] Applying cert-manager-issuer.yaml to shoot cluster"
kubectl apply -f "$SCRIPT_DIR/cert-manager-issuer.yaml"

echo ""
echo "==> [4/4] Annotating Traefik LB Service for Gardener-managed DNS"
echo "    Waiting for Traefik LB Service to be available..."
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
echo "    Get the Traefik LoadBalancer IP:"
echo "      kubectl get svc traefik -n default"
echo ""
echo "    Deploy the platform:"
echo "      gh workflow run deploy-gardener.yml --field cluster=$CLUSTER_NAME --field image_tag=latest"
