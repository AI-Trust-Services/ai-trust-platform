#!/usr/bin/env bash
# One-time setup on the SHOOT cluster for a new Gardener shoot.
#
# Usage:
#   export KUBECONFIG=/path/to/shoot-kubeconfig.yaml
#   bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name>
#
# What it does:
#   1. Installs Traefik ingress controller via Helm (default namespace).
#   2. Applies rbac.yaml — creates the ClusterRole + ClusterRoleBinding that gives
#      the GitHub Actions OIDC identity admin access to the shoot.
#   3. Applies cert-manager-issuer.yaml — creates the Let's Encrypt ClusterIssuer
#      used by the Helm chart for TLS certificates.
#
# Run garden-cluster-init.sh first (with the garden KUBECONFIG) for structured auth.
# See k8s/README.md "Adding a new cluster" for the full walkthrough.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER_NAME="${1:-}"

if [[ -z "$CLUSTER_NAME" ]]; then
  echo "usage: export KUBECONFIG=/path/to/shoot-kubeconfig.yaml && bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name>" >&2
  exit 1
fi

echo "KUBECONFIG: ${KUBECONFIG:-<not set>}"
echo "Cluster: $CLUSTER_NAME"
echo ""

echo "==> [1/3] Installing Traefik ingress controller (default namespace)"
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
echo "==> [2/3] Applying rbac.yaml to shoot cluster"
kubectl apply -f "$SCRIPT_DIR/rbac.yaml"

echo ""
echo "==> [3/3] Applying cert-manager-issuer.yaml to shoot cluster"
kubectl apply -f "$SCRIPT_DIR/cert-manager-issuer.yaml"

echo ""
echo "==> shoot-cluster-init complete for '$CLUSTER_NAME'."
echo ""
echo "    Get the Traefik LoadBalancer IP:"
echo "      kubectl get svc traefik -n default"
echo ""
echo "    Fill in k8s/env/$CLUSTER_NAME/.env with the LB IP, then deploy:"
echo "      gh workflow run deploy-gardener.yml --field cluster=$CLUSTER_NAME --field image_tag=latest"
