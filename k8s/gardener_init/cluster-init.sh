#!/usr/bin/env bash
# One-time setup on the GARDEN cluster for a new shoot.
#
# Usage:
#   export KUBECONFIG=/path/to/garden-kubeconfig.yaml
#   bash k8s/gardener_init/cluster-init.sh <cluster-name>
#
# What it does:
#   1. Enables the shoot-nginx-ingress extension so Traefik is installed
#      as the ingress controller (cc-one landscape).
#   2. Waits for shoot reconciliation to complete.
#   3. Applies structured-auth-configmap.yaml so GitHub Actions can authenticate
#      to the shoot without a kubeconfig secret (Structured Authentication + OIDC).
#
# Run shoot-init.sh next (with the shoot's KUBECONFIG) to configure the shoot itself.
# See k8s/README.md "Adding a new cluster" for the full walkthrough.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER_NAME="${1:-}"
GARDENER_PROJECT="${GARDENER_PROJECT:-ai-trust}"
GARDENER_NAMESPACE="garden-${GARDENER_PROJECT}"

if [[ -z "$CLUSTER_NAME" ]]; then
  echo "usage: export KUBECONFIG=/path/to/garden-kubeconfig.yaml && bash k8s/gardener_init/cluster-init.sh <cluster-name>" >&2
  exit 1
fi

echo "KUBECONFIG: ${KUBECONFIG:-<not set>}"
echo "Shoot: $CLUSTER_NAME (namespace: $GARDENER_NAMESPACE)"
echo ""

echo "==> [1/3] Enabling shoot-nginx-ingress extension on '$CLUSTER_NAME'"
# Idempotent — skips the patch if the extension is already present.
if kubectl get shoot "$CLUSTER_NAME" \
    -n "$GARDENER_NAMESPACE" \
    -o jsonpath='{.spec.extensions[*].type}' 2>/dev/null | grep -q "shoot-nginx-ingress"; then
  echo "    shoot-nginx-ingress already present, skipping patch"
else
  kubectl patch shoot "$CLUSTER_NAME" \
    -n "$GARDENER_NAMESPACE" \
    --type=json \
    -p='[{"op":"add","path":"/spec/extensions/-","value":{"type":"shoot-nginx-ingress","disabled":false}}]'
  echo "    Extension added"
fi

echo ""
echo "==> [2/3] Waiting for shoot reconciliation (may take ~2-5 min)..."
kubectl wait shoot "$CLUSTER_NAME" \
  -n "$GARDENER_NAMESPACE" \
  --for=jsonpath='{.status.lastOperation.state}'=Succeeded \
  --timeout=600s || echo "    Warning: timed out — check Gardener dashboard before continuing"

echo ""
echo "==> [3/3] Applying structured-auth-configmap.yaml to GARDEN cluster"
kubectl apply -f "$SCRIPT_DIR/structured-auth-configmap.yaml"

echo ""
echo "==> cluster-init complete for '$CLUSTER_NAME'."
echo ""
echo "    Next: run shoot-init.sh with the shoot kubeconfig:"
echo "      export KUBECONFIG=/path/to/shoot-kubeconfig.yaml"
echo "      bash k8s/gardener_init/shoot-init.sh $CLUSTER_NAME"
