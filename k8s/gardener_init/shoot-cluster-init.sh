#!/usr/bin/env bash
# One-time setup on the SHOOT cluster for a new Gardener shoot.
#
# Usage:
#   # Authenticate to the shoot first (gardenctl recommended):
#   gardenctl target --garden <landscape> --project <project> --shoot <cluster-name>
#   eval $(gardenctl kubectl-env bash)
#   bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name>
#
#   # Or with an explicit kubeconfig:
#   export KUBECONFIG=/path/to/shoot-kubeconfig.yaml
#   bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name>
#
# Hostnames are read from k8s/gardener_init/env/<cluster-name>/.env.
# Copy k8s/gardener_init/env/example/.env to env/<cluster-name>/.env and fill in before running.
#
# Example:
#   bash k8s/gardener_init/shoot-cluster-init.sh sr-test
#
# What it does:
#   1. Installs Traefik ingress controller via Helm (skipped if already present).
#   2. Applies rbac.yaml — grants the GitHub Actions OIDC identity the permissions
#      needed by deploy-gardener.yml (namespace, Helm chart resources, cert.gardener.cloud).
#   3. Requests a multi-SAN TLS certificate via Gardener cert-service
#      (cert.gardener.cloud/v1alpha1 Certificate CRD). Gardener uses DNS-01
#      automatically — no port 80 required. The cert is stored in the
#      ai-trust/ai-trust-tls Secret that the Helm Ingress references.
#   4. Annotates the Traefik LoadBalancer Service with Gardener DNS annotations so
#      shoot-dns-service auto-publishes A-records for all ingress hostnames.
#
# NOTE: Traefik is installed by this script on first run. If the deployment already
# exists (e.g. Helm release secret lost after a cluster event), the install is skipped.
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

ENV_FILE="$SCRIPT_DIR/env/${CLUSTER_NAME}/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: env file not found: $ENV_FILE" >&2
  echo "       Copy k8s/gardener_init/env/example/.env to env/${CLUSTER_NAME}/.env and fill in the hostnames." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

APP_HOST="${APP_HOST:-}"
KEYCLOAK_HOST="${KEYCLOAK_HOST:-}"
MINIO_HOST="${MINIO_HOST:-}"

if [[ -z "$APP_HOST" || -z "$KEYCLOAK_HOST" ]]; then
  echo "error: APP_HOST and KEYCLOAK_HOST must be set in $ENV_FILE" >&2
  exit 1
fi

# Derive the shoot base domain from the app host (everything after the first label)
SHOOT_DOMAIN="${APP_HOST#*.}"

echo "KUBECONFIG: ${KUBECONFIG:-<not set>}"
echo "Cluster:    $CLUSTER_NAME"
echo "Domain:     $SHOOT_DOMAIN"
echo ""

echo "==> [1/4] Installing Traefik ingress controller (default namespace)"
if kubectl get deployment traefik -n default &>/dev/null; then
  echo "    Traefik deployment already exists — skipping install."
else
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
fi

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
$([ -n "${MINIO_HOST}" ] && echo "    - \"${MINIO_HOST}\"")
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
echo "    NOTE: all kubectl commands below require the shoot KUBECONFIG to be active."
echo "    If you used gardenctl to authenticate, run: eval \$(gardenctl kubectl-env bash)"
echo ""
echo "    Check certificate status:"
echo "      kubectl get certificate.cert.gardener.cloud ai-trust-tls -n ai-trust"
echo ""
echo "    Get the Traefik LoadBalancer IP:"
echo "      kubectl get svc traefik -n default"
echo ""
echo "    Deploy the platform:"
echo "      gh workflow run deploy-gardener.yml --field cluster=$CLUSTER_NAME --field image_tag=latest"
