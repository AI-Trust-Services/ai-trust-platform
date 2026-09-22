#!/usr/bin/env bash
# One-time (idempotent) setup on the SHOOT cluster for a namespace.
#
# Usage:
#   # Authenticate to the shoot first (gardenctl recommended):
#   gardenctl target --garden <landscape> --project <project> --shoot <cluster-name>
#   eval $(gardenctl kubectl-env bash)
#   bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name> [--namespace=<namespace>]
#
#   # Or with an explicit kubeconfig:
#   export KUBECONFIG=/path/to/shoot-kubeconfig.yaml
#   bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name> [--namespace=<namespace>]
#
# --namespace (default: DEFAULT_NAMESPACE from k8s/gardener_init/env/<cluster>/.env, or "ai-trust" for legacy clusters):
#   The canonical long-running namespace for a cluster (e.g. "main" for ai-trust-main)
#   uses the hostnames declared in the cluster env file verbatim.
#   Pass --namespace=<name> to additionally provision a developer/PR namespace on a
#   shared cluster (e.g. ai-trust-test), derived from the PR author, so it can coexist:
#     bash k8s/gardener_init/shoot-cluster-init.sh ai-trust-test --namespace=alice
#   Steps are idempotent — safe to re-run for a namespace that's already set up.
#
# Hostnames are read from k8s/gardener_init/env/<cluster-name>/.env. For any
# namespace other than ai-trust, the app/keycloak/minio hostnames are instead
# derived as subdomains of the shoot domain: <namespace>.<shoot-domain>,
# keycloak.<namespace>.<shoot-domain>, minio.<namespace>.<shoot-domain>.
# Copy k8s/gardener_init/env/example/.env to env/<cluster-name>/.env and fill in before running.
#
# What it does (all runs, same for every namespace):
#   1. Installs Traefik ingress controller via Helm (skipped if already present).
#   2. Requests a per-namespace TLS certificate via Gardener cert-service (DNS-01).
#      Also creates the per-namespace Traefik ServersTransport for LLM timeout.
#   3. Annotates the Traefik LB Service for Gardener-managed DNS, merging this
#      namespace's hostnames into any already registered by other namespaces.
#   4. Installs OCM controller + Flux (skipped if already at pinned versions).
#   5. Applies rbac.yaml — grants the GitHub Actions OIDC identity the permissions
#      needed by bootstrap-gardener.yml (target namespace + ocm-system namespace).
#
# Run garden-cluster-init.sh first (with the garden KUBECONFIG) for structured auth.
# See k8s/README.md "Adding a new cluster" for the full walkthrough.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER_NAME="${1:-}"

# Parse optional --namespace=<value> argument (resolved after sourcing the env file)
NAMESPACE_OVERRIDE=""
for arg in "${@:2}"; do
  case "$arg" in
    --namespace=*) NAMESPACE_OVERRIDE="${arg#--namespace=}" ;;
    *) echo "warning: unknown argument: $arg" >&2 ;;
  esac
done

if [[ -z "$CLUSTER_NAME" ]]; then
  echo "usage: export KUBECONFIG=/path/to/shoot-kubeconfig.yaml && bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name> [--namespace=<namespace>]" >&2
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

# DEFAULT_NAMESPACE: the canonical long-running namespace for this cluster.
# New cluster env files set it explicitly (e.g. DEFAULT_NAMESPACE=main for ai-trust-main).
# Older env files without it fall back to "ai-trust" for backwards compatibility.
DEFAULT_NAMESPACE="${DEFAULT_NAMESPACE:-ai-trust}"
NAMESPACE="${NAMESPACE_OVERRIDE:-$DEFAULT_NAMESPACE}"

if [[ -z "$APP_HOST" || -z "$KEYCLOAK_HOST" ]]; then
  echo "error: APP_HOST and KEYCLOAK_HOST must be set in $ENV_FILE" >&2
  exit 1
fi

# Derive the shoot base domain from the app host (everything after the first label)
SHOOT_DOMAIN="${APP_HOST#*.}"

# The DEFAULT_NAMESPACE uses the cluster's canonical hostnames from the env file.
# Any other namespace gets derived subdomains so it doesn't collide.
if [[ "$NAMESPACE" != "$DEFAULT_NAMESPACE" ]]; then
  BASE_HOST="$APP_HOST"
  APP_HOST="${NAMESPACE}.${BASE_HOST}"
  KEYCLOAK_HOST="keycloak.${NAMESPACE}.${BASE_HOST}"
  MINIO_HOST="minio.${NAMESPACE}.${BASE_HOST}"
fi

echo "KUBECONFIG: ${KUBECONFIG:-<not set>}"
echo "Cluster:    $CLUSTER_NAME"
echo "Namespace:  $NAMESPACE"
echo "Domain:     $SHOOT_DOMAIN"
echo ""

echo "==> [1/5] Installing Traefik ingress controller (default namespace)"
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

echo "==> [2/5] Requesting TLS certificate via Gardener cert-service (DNS-01, no port 80 needed)"
# Ensure the target namespace exists.
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -
# cert.gardener.cloud Certificate CRD — Gardener cert-service issues a Let's Encrypt cert
# via DNS-01 and writes it into the ai-trust-tls Secret (the same name the Helm Ingress uses).
# NOTE: no spec.commonName — the X.509 CN is capped at 64 bytes and the Gardener domain is
# longer. List all SANs in dnsNames only (Let's Encrypt ignores CN; uses SAN-only certs).
kubectl apply -f - <<EOF
apiVersion: cert.gardener.cloud/v1alpha1
kind: Certificate
metadata:
  name: ai-trust-tls
  namespace: ${NAMESPACE}
spec:
  dnsNames:
    - "${APP_HOST}"
    - "${KEYCLOAK_HOST}"
$([ -n "${MINIO_HOST}" ] && echo "    - \"${MINIO_HOST}\"")
  secretRef:
    name: ai-trust-tls
    namespace: ${NAMESPACE}
EOF
echo "    Certificate requested — Gardener cert-service will issue via DNS-01 (takes ~1-2 min)"
echo "    Monitor: kubectl get certificate.cert.gardener.cloud ai-trust-tls -n ${NAMESPACE} -w"

# Traefik ServersTransport that raises the forwarding timeout for LLM-backed routes.
# Must live in the app namespace and be named <namespace>-llm-timeout because the
# oauth2-proxy Service annotation references it as:
#   traefik.ingress.kubernetes.io/service.serverstransport: <Release.Namespace>-llm-timeout@kubernetescrd
# Created here (not in the Helm chart) so the object always predates any Helm deploy —
# if the chart applied the annotation and the object in the same pass, Traefik could
# reconcile the Service first, fail to resolve the reference, and return 404s site-wide.
kubectl apply -f - <<EOF
apiVersion: traefik.io/v1alpha1
kind: ServersTransport
metadata:
  name: llm-timeout
  namespace: ${NAMESPACE}
spec:
  forwardingTimeouts:
    responseHeaderTimeout: 300s
    readIdleTimeout: 300s
EOF
echo "    Created ServersTransport/${NAMESPACE}-llm-timeout (300s forwarding timeout for LLM routes)"
echo ""

echo "==> [3/5] Annotating Traefik LB Service for Gardener-managed DNS"
echo "    Waiting for Traefik deployment to be available..."
kubectl wait --for=condition=available deployment/traefik -n default --timeout=120s || true

NEW_DNSNAMES="${APP_HOST},${KEYCLOAK_HOST}"
if [[ -n "$MINIO_HOST" ]]; then
  NEW_DNSNAMES="${NEW_DNSNAMES},${MINIO_HOST}"
fi

# Merge this namespace's hostnames into whatever is already annotated instead of
# overwriting, so multiple namespaces sharing this Traefik LB Service (e.g. the
# ai-trust namespace plus several developer namespaces on ai-trust-test) keep
# resolving after shoot-cluster-init.sh is (re-)run for any one of them.
EXISTING_DNSNAMES=$(kubectl get svc traefik -n default \
  -o jsonpath='{.metadata.annotations.dns\.gardener\.cloud/dnsnames}' 2>/dev/null || true)
ALL_DNSNAMES=$(printf '%s\n%s' "$EXISTING_DNSNAMES" "$NEW_DNSNAMES" \
  | tr ',' '\n' | sed '/^$/d' | awk '!seen[$0]++' | paste -sd, -)

kubectl annotate svc traefik -n default --overwrite \
  dns.gardener.cloud/class=garden \
  "dns.gardener.cloud/dnsnames=${ALL_DNSNAMES}" \
  dns.gardener.cloud/ttl="120"
echo "    Annotated Traefik LB Service: ${ALL_DNSNAMES}"

echo ""
echo "==> [4/5] Installing OCM controller and Flux"
# Pinned versions — update together after testing on a non-prod cluster.
# OCM controller (github.com/open-component-model/ocm-controller) and
# OCM CLI (github.com/open-component-model/ocm) are versioned independently.
OCM_CONTROLLER_VERSION="v0.33.0"
OCM_CLI_VERSION="v0.50.0"
FLUX_VERSION="v2.9.5"

_install_ocm_cli() {
  echo "    Installing OCM CLI ${OCM_CLI_VERSION}..."
  curl -sSfL \
    "https://github.com/open-component-model/ocm/releases/download/${OCM_CLI_VERSION}/ocm-${OCM_CLI_VERSION#v}-linux-amd64.tar.gz" \
    | sudo tar -xz -C /usr/local/bin ocm
}

if kubectl get deployment ocm-controller -n ocm-system &>/dev/null; then
  RUNNING=$(kubectl get deployment ocm-controller -n ocm-system \
    -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null \
    | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' || true)
  if [[ "$RUNNING" == "$OCM_CONTROLLER_VERSION" ]]; then
    echo "    OCM controller ${OCM_CONTROLLER_VERSION} already installed — skipping."
  else
    echo "    OCM controller running ${RUNNING:-unknown}, want ${OCM_CONTROLLER_VERSION} — reinstalling."
    command -v ocm &>/dev/null || _install_ocm_cli
    ocm controller install --version "${OCM_CONTROLLER_VERSION}"
    echo "    OCM controller reinstalled at ${OCM_CONTROLLER_VERSION}."
  fi
else
  command -v ocm &>/dev/null || _install_ocm_cli
  ocm controller install --version "${OCM_CONTROLLER_VERSION}"
  echo "    OCM controller ${OCM_CONTROLLER_VERSION} installed."
fi

if kubectl get deployment source-controller -n flux-system &>/dev/null; then
  RUNNING=$(kubectl get deployment source-controller -n flux-system \
    -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null \
    | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' || true)
  if [[ "$RUNNING" == "${FLUX_VERSION#v}"* ]] || kubectl get ns flux-system -o jsonpath='{.metadata.labels.app\.kubernetes\.io/version}' 2>/dev/null | grep -q "${FLUX_VERSION#v}"; then
    echo "    Flux ${FLUX_VERSION} already installed — skipping."
  else
    echo "    Flux running ${RUNNING:-unknown}, want ${FLUX_VERSION} — reinstalling."
    if ! command -v flux &>/dev/null; then
      echo "    Installing Flux CLI ${FLUX_VERSION}..."
      curl -s https://fluxcd.io/install.sh | sudo FLUX_VERSION="${FLUX_VERSION}" bash
    fi
    flux install --version="${FLUX_VERSION}"
    echo "    Flux reinstalled at ${FLUX_VERSION}."
  fi
else
  if ! command -v flux &>/dev/null; then
    echo "    Installing Flux CLI ${FLUX_VERSION}..."
    curl -s https://fluxcd.io/install.sh | sudo FLUX_VERSION="${FLUX_VERSION}" bash
  fi
  flux install --version="${FLUX_VERSION}"
  echo "    Flux ${FLUX_VERSION} installed."
fi

echo ""
echo "==> [5/5] Applying RBAC (creates ${NAMESPACE} and ocm-system roles for CI)"
sed "s/\${NAMESPACE}/${NAMESPACE}/g" "$SCRIPT_DIR/rbac.yaml" | kubectl apply -f -

echo ""
echo "==> shoot-cluster-init complete for '$CLUSTER_NAME' (namespace: $NAMESPACE)."
echo ""
echo "    NOTE: all kubectl commands below require the shoot KUBECONFIG to be active."
echo "    If you used gardenctl to authenticate, run: eval \$(gardenctl kubectl-env bash)"
echo ""
echo "    Check certificate status:"
echo "      kubectl get certificate.cert.gardener.cloud ai-trust-tls -n ${NAMESPACE}"
echo "      kubectl describe certificate.cert.gardener.cloud ai-trust-tls -n ${NAMESPACE}"
echo ""
echo "    Bootstrap and deploy the platform:"
echo "      ai-trust namespace: gh workflow run bootstrap-gardener.yml --field cluster=${CLUSTER_NAME}"
echo "      other namespaces:   comment /garden-deploy on your PR (namespace ${NAMESPACE} is now ready)"
