#!/usr/bin/env bash
# One-time setup on the SHOOT cluster for a new Gardener shoot or namespace.
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
# --namespace (default: main):
#   When omitted or set to "main", runs the full cluster init (all 5 steps).
#   When set to any other value, skips cluster-scoped steps (Traefik, DNS annotation,
#   OCM controller, Flux) and only runs the namespace-scoped steps (cert, RBAC).
#   Use this to initialise a developer namespace on ai-trust-test before deploying:
#     bash k8s/gardener_init/shoot-cluster-init.sh ai-trust-test --namespace=alice
#
# Hostnames are read from k8s/gardener_init/env/<cluster-name>/.env.
# Copy k8s/gardener_init/env/example/.env to env/<cluster-name>/.env and fill in before running.
#
# What it does (full init, namespace=main):
#   1. Installs Traefik ingress controller via Helm (skipped if already present).
#   2. Requests a multi-SAN TLS certificate via Gardener cert-service
#      (cert.gardener.cloud/v1alpha1 Certificate CRD). Gardener uses DNS-01
#      automatically — no port 80 required. The cert is stored in the
#      <namespace>/ai-trust-tls Secret that the Helm Ingress references.
#   3. Creates a per-namespace DNSEntry resource for Gardener-managed DNS.
#   4. Installs the OCM controller (pinned to OCM_CONTROLLER_VERSION) via the OCM CLI
#      (pinned to OCM_CLI_VERSION), then installs Flux (pinned to FLUX_VERSION) via the
#      Flux CLI (`flux install`). Both are required — OCM manages component versions,
#      Flux (source-controller + helm-controller) applies the HelmRelease.
#      Re-running the script checks the running image tag and reinstalls only if the
#      version doesn't match the pin — safe to re-run after upgrades.
#   5. Applies rbac.yaml — grants the GitHub Actions OIDC identity the permissions
#      needed by bootstrap-gardener.yml (target namespace + ocm-system namespace).
#
# Namespace-only init (--namespace=<ns>):
#   Steps 1, 3 (cluster-scoped) and 4 (OCM+Flux) are skipped.
#   Steps 2 (cert) and 5 (RBAC) run scoped to the given namespace.
#
# NOTE: Traefik is installed by this script on first run. If the deployment already
# exists (e.g. Helm release secret lost after a cluster event), the install is skipped.
#
# Run garden-cluster-init.sh first (with the garden KUBECONFIG) for structured auth.
# See k8s/README.md "Adding a new cluster" for the full walkthrough.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER_NAME="${1:-}"
NAMESPACE="main"

# Parse optional --namespace=<value> argument
for arg in "${@:2}"; do
  case "$arg" in
    --namespace=*) NAMESPACE="${arg#--namespace=}" ;;
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

if [[ -z "$APP_HOST" || -z "$KEYCLOAK_HOST" ]]; then
  echo "error: APP_HOST and KEYCLOAK_HOST must be set in $ENV_FILE" >&2
  exit 1
fi

# Derive the shoot base domain from the app host (everything after the first label)
SHOOT_DOMAIN="${APP_HOST#*.}"

# For non-main namespaces, derive per-namespace hostnames from the shoot domain
if [[ "$NAMESPACE" != "main" ]]; then
  APP_HOST="${NAMESPACE}.${SHOOT_DOMAIN}"
  KEYCLOAK_HOST="keycloak.${NAMESPACE}.${SHOOT_DOMAIN}"
  MINIO_HOST="minio.${NAMESPACE}.${SHOOT_DOMAIN}"
fi

FULL_INIT=false
if [[ "$NAMESPACE" == "main" ]]; then
  FULL_INIT=true
fi

echo "KUBECONFIG: ${KUBECONFIG:-<not set>}"
echo "Cluster:    $CLUSTER_NAME"
echo "Namespace:  $NAMESPACE"
echo "Domain:     $SHOOT_DOMAIN"
echo ""

if [[ "$FULL_INIT" == "true" ]]; then
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
else
  echo "==> [1/5] Skipping Traefik install (namespace-only init)"
  echo ""
fi

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
  name: ai-trust-tls-${NAMESPACE}
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
echo "    Monitor: kubectl get certificate.cert.gardener.cloud ai-trust-tls-${NAMESPACE} -n ${NAMESPACE} -w"

# Traefik ServersTransport that raises the forwarding timeout for LLM-backed routes
# (AI classification, document extraction). Traefik's default responseHeaderTimeout of
# 60s cuts the connection mid-inference; Ollama classification takes 84-120s.
#
# Created here (one-time, cluster infra) rather than in the Helm chart on purpose:
# the oauth2-proxy Service is annotated with
#   traefik.ingress.kubernetes.io/service.serverstransport: ai-trust-llm-timeout@kubernetescrd
# by the chart. If the chart also created this object, Helm would apply the Service
# annotation and the ServersTransport in the same pass, and Traefik could reconcile the
# Service before ingesting the ServersTransport — it would then fail to resolve the
# reference, drop the backend, and return host-wide 404s until its next reconcile.
# Creating it here, once, guarantees the object always predates any Helm deploy, so every
# GitHub Actions rollout (in either direction) resolves the reference on the first try.
# The Traefik CRDs (incl. serverstransports.traefik.io) are installed by the Traefik Helm
# install in step [1/5] above, so this apply always succeeds.
kubectl apply -f - <<EOF
apiVersion: traefik.io/v1alpha1
kind: ServersTransport
metadata:
  name: llm-timeout
  namespace: ai-trust
spec:
  forwardingTimeouts:
    responseHeaderTimeout: 300s
    readIdleTimeout: 300s
EOF
echo "    Created ServersTransport/llm-timeout (300s forwarding timeout for LLM routes)"

echo ""
if [[ "$FULL_INIT" == "true" ]]; then
  echo "==> [3/5] Annotating Traefik LB Service for Gardener-managed DNS"
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
else
  echo "==> [3/5] Creating per-namespace DNSEntry for Gardener-managed DNS"
  echo "    Waiting for Traefik deployment to be available..."
  kubectl wait --for=condition=available deployment/traefik -n default --timeout=120s || true
  LB_IP=$(kubectl get svc traefik -n default -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  if [[ -z "$LB_IP" ]]; then
    echo "    warning: Traefik LB IP not yet assigned — DNSEntry will be created but may not resolve until IP is available" >&2
    LB_IP="0.0.0.0"
  fi
  kubectl apply -f - <<EOF
apiVersion: dns.gardener.cloud/v1alpha1
kind: DNSEntry
metadata:
  name: ai-trust-${NAMESPACE}
  namespace: ${NAMESPACE}
spec:
  dnsName: "*.${NAMESPACE}.${SHOOT_DOMAIN}"
  ttl: 120
  targets:
    - "${LB_IP}"
EOF
  echo "    DNSEntry created: *.${NAMESPACE}.${SHOOT_DOMAIN} -> ${LB_IP}"
fi

echo ""
if [[ "$FULL_INIT" == "true" ]]; then
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
else
  echo "==> [4/5] Skipping OCM controller + Flux install (namespace-only init)"
fi

echo ""
echo "==> [5/5] Applying RBAC (creates ${NAMESPACE} and ocm-system roles for CI)"
# ocm-system namespace is created by 'ocm controller install' above (full init)
# or must already exist (namespace-only init — full init must have run first).
# Apply RBAC with NAMESPACE substituted so Role/RoleBinding target the correct namespace.
export NAMESPACE
envsubst '${NAMESPACE}' < "$SCRIPT_DIR/rbac.yaml" | kubectl apply -f -

echo ""
echo "==> shoot-cluster-init complete for '$CLUSTER_NAME' (namespace: $NAMESPACE)."
echo ""
echo "    NOTE: all kubectl commands below require the shoot KUBECONFIG to be active."
echo "    If you used gardenctl to authenticate, run: eval \$(gardenctl kubectl-env bash)"
echo ""
echo "    Check certificate status:"
echo "      kubectl get certificate.cert.gardener.cloud ai-trust-tls-${NAMESPACE} -n ${NAMESPACE}"
echo ""
if [[ "$FULL_INIT" == "true" ]]; then
  echo "    Get the Traefik LoadBalancer IP:"
  echo "      kubectl get svc traefik -n default"
  echo ""
fi
echo "    Bootstrap and deploy the platform:"
if [[ "$NAMESPACE" == "main" ]]; then
  echo "      gh workflow run bootstrap-gardener.yml --field cluster=${CLUSTER_NAME}"
else
  echo "      Comment /garden-deploy on your PR (namespace ${NAMESPACE} is now ready)"
fi
