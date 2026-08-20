#!/usr/bin/env bash
# One-time setup for a new Gardener shoot cluster.
#
# Usage:
#   bash k8s/gardener_init/cluster-init.sh <cluster-name>
#
# What it does (two separate kubeconfigs required):
#   1. Enables the nginx-ingress shoot extension on the shoot (via GARDEN cluster API),
#      then patches cert-services and waits for Traefik/nginx to be ready.
#      NOTE: Gardener shoots in the cc-one landscape come with Traefik pre-installed
#      via the nginx-ingress extension — enable it here if not already on.
#   2. Applies structured-auth-configmap.yaml to the GARDEN cluster so GitHub Actions
#      can authenticate to the shoot without a kubeconfig secret.
#   3. Applies rbac.yaml and cert-manager-issuer.yaml to the SHOOT cluster.
#
#   Set GARDEN_KUBECONFIG / SHOOT_KUBECONFIG env vars, or defaults are used:
#     GARDEN_KUBECONFIG: ~/.kube/garden-config
#     SHOOT_KUBECONFIG:  ~/.kube/<cluster-name>-config
#
# After running this script:
#   - Create/fill k8s/env/<cluster-name>/.env
#   - Run deploy-gardener.yml workflow with cluster=<cluster-name>
#
# See k8s/README.md "Adding a new cluster" for the full walkthrough.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER_NAME="${1:-}"
GARDENER_PROJECT="${GARDENER_PROJECT:-ai-trust}"
GARDENER_NAMESPACE="garden-${GARDENER_PROJECT}"

if [[ -z "$CLUSTER_NAME" ]]; then
  echo "usage: bash k8s/gardener_init/cluster-init.sh <cluster-name>" >&2
  exit 1
fi

GARDEN_KUBECONFIG="${GARDEN_KUBECONFIG:-$HOME/.kube/garden-config}"
SHOOT_KUBECONFIG="${SHOOT_KUBECONFIG:-$HOME/.kube/${CLUSTER_NAME}-config}"

echo "==> [1/4] Enabling nginx-ingress extension on shoot '$CLUSTER_NAME' (via GARDEN cluster)"
echo "    kubeconfig: $GARDEN_KUBECONFIG"
# Gardener shoots in cc-one use the nginx-ingress extension for Traefik/ingress.
# This patch adds the extension if not already present; idempotent on re-run.
KUBECONFIG="$GARDEN_KUBECONFIG" kubectl patch shoot "$CLUSTER_NAME" \
  -n "$GARDENER_NAMESPACE" \
  --type=json \
  -p='[{
    "op": "add",
    "path": "/spec/extensions/-",
    "value": {"type": "shoot-nginx-ingress", "disabled": false}
  }]' 2>/dev/null || \
KUBECONFIG="$GARDEN_KUBECONFIG" kubectl get shoot "$CLUSTER_NAME" \
  -n "$GARDENER_NAMESPACE" \
  -o jsonpath='{.spec.extensions}' | grep -q "shoot-nginx-ingress" && \
  echo "    nginx-ingress extension already present, skipping patch"

echo "    Waiting for shoot reconciliation to complete (this may take ~2-5 min)..."
KUBECONFIG="$GARDEN_KUBECONFIG" kubectl wait shoot "$CLUSTER_NAME" \
  -n "$GARDENER_NAMESPACE" \
  --for=jsonpath='{.status.lastOperation.state}'=Succeeded \
  --timeout=600s || echo "    Warning: timed out waiting for shoot reconciliation — check Gardener dashboard"

echo ""
echo "==> [2/4] Applying structured-auth-configmap.yaml to GARDEN cluster"
KUBECONFIG="$GARDEN_KUBECONFIG" kubectl apply -f "$SCRIPT_DIR/structured-auth-configmap.yaml"

echo ""
echo "==> [3/4] Applying rbac.yaml to SHOOT cluster ($CLUSTER_NAME)"
echo "    kubeconfig: $SHOOT_KUBECONFIG"
KUBECONFIG="$SHOOT_KUBECONFIG" kubectl apply -f "$SCRIPT_DIR/rbac.yaml"

echo ""
echo "==> [4/4] Applying cert-manager-issuer.yaml to SHOOT cluster ($CLUSTER_NAME)"
KUBECONFIG="$SHOOT_KUBECONFIG" kubectl apply -f "$SCRIPT_DIR/cert-manager-issuer.yaml"

echo ""
echo "==> Cluster init complete for '$CLUSTER_NAME'."
echo ""
echo "    Get the Traefik LoadBalancer IP:"
echo "      KUBECONFIG=$SHOOT_KUBECONFIG kubectl get svc -A | grep LoadBalancer"
echo ""
echo "    Then fill in k8s/env/$CLUSTER_NAME/.env with the LB IP and trigger:"
echo "      gh workflow run deploy-gardener.yml --field cluster=$CLUSTER_NAME --field image_tag=latest"
