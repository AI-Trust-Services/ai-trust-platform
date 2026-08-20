#!/usr/bin/env bash
# One-time setup on the SHOOT cluster for a new Gardener shoot.
#
# Usage:
#   bash k8s/gardener_init/shoot-init.sh <cluster-name>
#
# What it does:
#   1. Applies rbac.yaml — creates the ClusterRole + ClusterRoleBinding that gives
#      the GitHub Actions OIDC identity admin access to the shoot.
#   2. Applies cert-manager-issuer.yaml — creates the Let's Encrypt ClusterIssuer
#      used by the Helm chart for TLS certificates.
#
# Requires:
#   SHOOT_KUBECONFIG — kubeconfig for the shoot cluster
#                      (default: ~/.kube/<cluster-name>-config)
#
# Run cluster-init.sh first (Garden cluster setup + Traefik).
# See k8s/README.md "Adding a new cluster" for the full walkthrough.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER_NAME="${1:-}"

if [[ -z "$CLUSTER_NAME" ]]; then
  echo "usage: bash k8s/gardener_init/shoot-init.sh <cluster-name>" >&2
  exit 1
fi

SHOOT_KUBECONFIG="${SHOOT_KUBECONFIG:-$HOME/.kube/${CLUSTER_NAME}-config}"
echo "Shoot kubeconfig: $SHOOT_KUBECONFIG"
echo "Cluster: $CLUSTER_NAME"
echo ""

echo "==> [1/2] Applying rbac.yaml to shoot cluster"
KUBECONFIG="$SHOOT_KUBECONFIG" kubectl apply -f "$SCRIPT_DIR/rbac.yaml"

echo ""
echo "==> [2/2] Applying cert-manager-issuer.yaml to shoot cluster"
KUBECONFIG="$SHOOT_KUBECONFIG" kubectl apply -f "$SCRIPT_DIR/cert-manager-issuer.yaml"

echo ""
echo "==> shoot-init complete for '$CLUSTER_NAME'."
echo ""
echo "    Get the Traefik LoadBalancer IP:"
echo "      KUBECONFIG=$SHOOT_KUBECONFIG kubectl get svc -A | grep LoadBalancer"
echo ""
echo "    Fill in k8s/env/$CLUSTER_NAME/.env with the LB IP, then deploy:"
echo "      gh workflow run deploy-gardener.yml --field cluster=$CLUSTER_NAME --field image_tag=latest"
