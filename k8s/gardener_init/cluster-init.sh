#!/usr/bin/env bash
# One-time setup for a new Gardener shoot cluster.
#
# Usage:
#   bash k8s/gardener_init/cluster-init.sh <cluster-name>
#
# What it does (two separate kubeconfigs required):
#   1. Applies structured-auth-configmap.yaml to the GARDEN cluster
#      (the Gardener control plane, not the shoot). This trusts GitHub OIDC
#      so GitHub Actions can authenticate to the shoot without a kubeconfig secret.
#      Set GARDEN_KUBECONFIG env var or default ~/.kube/garden-config is used.
#
#   2. Applies rbac.yaml and cert-manager-issuer.yaml to the SHOOT cluster.
#      Set SHOOT_KUBECONFIG env var or default ~/.kube/<cluster-name>-config is used.
#
# After running this script:
#   - Create k8s/env/<cluster-name>/.env (copy k8s/env/sr-test/.env.example, fill in values)
#   - Add GitHub secrets: AI_TRUST_ENV_<CLUSTER_UPPER>
#   - Add GitHub variables: GARDENER_SHOOT_API_SERVER_<CLUSTER_UPPER>,
#                           GARDENER_CA_DISCOVERY_URL_<CLUSTER_UPPER>,
#                           GARDENER_OIDC_AUDIENCE_<CLUSTER_UPPER>
#   - Run deploy-gardener.yml workflow with cluster=<cluster-name>
#
# See k8s/README.md "Adding a new cluster" for the full walkthrough.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER_NAME="${1:-}"

if [[ -z "$CLUSTER_NAME" ]]; then
  echo "usage: bash k8s/gardener_init/cluster-init.sh <cluster-name>" >&2
  exit 1
fi

GARDEN_KUBECONFIG="${GARDEN_KUBECONFIG:-$HOME/.kube/garden-config}"
SHOOT_KUBECONFIG="${SHOOT_KUBECONFIG:-$HOME/.kube/${CLUSTER_NAME}-config}"

echo "==> [1/3] Applying structured-auth-configmap.yaml to GARDEN cluster"
echo "    kubeconfig: $GARDEN_KUBECONFIG"
KUBECONFIG="$GARDEN_KUBECONFIG" kubectl apply -f "$SCRIPT_DIR/structured-auth-configmap.yaml"

echo "==> [2/3] Applying rbac.yaml to SHOOT cluster ($CLUSTER_NAME)"
echo "    kubeconfig: $SHOOT_KUBECONFIG"
KUBECONFIG="$SHOOT_KUBECONFIG" kubectl apply -f "$SCRIPT_DIR/rbac.yaml"

echo "==> [3/3] Applying cert-manager-issuer.yaml to SHOOT cluster ($CLUSTER_NAME)"
KUBECONFIG="$SHOOT_KUBECONFIG" kubectl apply -f "$SCRIPT_DIR/cert-manager-issuer.yaml"

echo ""
echo "==> Cluster init complete for '$CLUSTER_NAME'."
echo "    Next steps:"
echo "    1. Create k8s/env/$CLUSTER_NAME/.env (copy k8s/env/sr-test/.env.example)"
echo "    2. Add GitHub secret AI_TRUST_ENV_$(echo "${CLUSTER_NAME//-/_}" | tr '[:lower:]' '[:upper:]')"
echo "    3. Add GitHub variables GARDENER_SHOOT_API_SERVER_*, GARDENER_CA_DISCOVERY_URL_*, GARDENER_OIDC_AUDIENCE_*"
echo "    4. Trigger deploy-gardener.yml with cluster=$CLUSTER_NAME"
