#!/usr/bin/env bash
# Builds every locally-built image (same context/Dockerfile/build-args as the
# matching docker-compose service) and loads them into the kind cluster - no
# registry involved. Third-party images (postgres, keycloak, openfga,
# oauth2-proxy, rabbitmq, clickhouse-server, minio, otel-collector-contrib)
# are pulled normally by kubelet and are not built here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-ai-trust}"
TAG="local"

cd "$REPO_ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  set +u  # .env may contain ${VAR} references not defined in all environments
  _env_tmp=$(mktemp)
  tr -d '\r' < .env > "$_env_tmp"
  source "$_env_tmp"
  rm -f "$_env_tmp"
  set -u
  set +a
fi

images=()

build() {
  local name="$1" context="$2" dockerfile="$3"
  shift 3
  local tag="ai-trust/${name}:${TAG}"
  echo "==> building ${tag}  (context=${context} dockerfile=${dockerfile})"
  docker build -t "$tag" -f "$dockerfile" "$@" "$context"
  images+=("$tag")
}

# ── backends built from repo root (context .) ──
build users-backend . users/backend/Dockerfile
build ai-system-registry-backend . ai-system-registry/backend/Dockerfile
build monitoring-backend . monitoring/backend/Dockerfile
build overview-backend . overview/backend/Dockerfile
build alerts-backend . alerts/backend/Dockerfile
build compliance-backend . compliance/backend/Dockerfile
build decision-trace-analyzer-backend . decision-trace-analyzer/backend/Dockerfile
build policy-checker-worker . policy-checker-worker/Dockerfile
build otel-clickhouse-consumer . consumers/clickhouse-consumer/Dockerfile
build openfga-provision . infra/openfga-provision/Dockerfile

# ── one-shot migration images (own context) ──
build db-migrate ./libs/persistence ./libs/persistence/Dockerfile
build clickhouse-migrate ./libs/clickhouse ./libs/clickhouse/Dockerfile

# ── other own-context images ──
build keycloak-provision ./infra/keycloak ./infra/keycloak/Dockerfile
build shell ./shell ./shell/Dockerfile
build otel-rmq-bridge ./otel-pipeline/rmq-bridge ./otel-pipeline/rmq-bridge/Dockerfile

# ── frontends (Vite build args baked in, same as docker-compose args:) ──
build ai-system-registry-frontend ./ai-system-registry/frontend ./ai-system-registry/frontend/Dockerfile \
  --build-arg "VITE_REGISTRY_API_BASE=${VITE_REGISTRY_API_BASE}" \
  --build-arg "VITE_USERS_API_BASE=${VITE_USERS_API_BASE:-/api/users/v1}"

build monitoring-frontend ./monitoring/frontend ./monitoring/frontend/Dockerfile \
  --build-arg "VITE_MONITORING_API_BASE=${VITE_MONITORING_API_BASE}"

build overview-frontend ./overview/frontend ./overview/frontend/Dockerfile \
  --build-arg "VITE_OVERVIEW_API_BASE=${VITE_OVERVIEW_API_BASE}" \
  --build-arg "VITE_ALERTS_API_BASE=${VITE_ALERTS_API_BASE}" \
  --build-arg "VITE_ALERTS_URL=${VITE_ALERTS_URL}" \
  --build-arg "VITE_REGISTRY_URL=${VITE_REGISTRY_URL}" \
  --build-arg "VITE_COMPLIANCE_URL=${VITE_COMPLIANCE_URL}" \
  --build-arg "VITE_COMPLIANCE_API_BASE=${VITE_COMPLIANCE_API_BASE}" \
  --build-arg "VITE_USERS_API_BASE=${VITE_USERS_API_BASE:-/api/users/v1}"

build alerts-frontend ./alerts/frontend ./alerts/frontend/Dockerfile \
  --build-arg "VITE_ALERTS_API_BASE=${VITE_ALERTS_API_BASE}" \
  --build-arg "VITE_ALERTS_URL=${VITE_ALERTS_URL}" \
  --build-arg "VITE_USERS_API_BASE=${VITE_USERS_API_BASE:-/api/users/v1}"

build compliance-frontend ./compliance/frontend ./compliance/frontend/Dockerfile \
  --build-arg "VITE_COMPLIANCE_API_BASE=${VITE_COMPLIANCE_API_BASE:-/api/compliance/v1}" \
  --build-arg "VITE_REGISTRY_API_BASE=${VITE_REGISTRY_API_BASE:-/api/registry/v1}" \
  --build-arg "VITE_USERS_API_BASE=${VITE_USERS_API_BASE:-/api/users/v1}"

build users-frontend ./users/frontend ./users/frontend/Dockerfile \
  --build-arg "VITE_USERS_API_BASE=${VITE_USERS_API_BASE:-/api/users/v1}"

build decision-trace-analyzer-frontend ./decision-trace-analyzer/frontend ./decision-trace-analyzer/frontend/Dockerfile \
  --build-arg "VITE_DTA_API_BASE=${VITE_DTA_API_BASE}"

build admin-frontend ./admin/frontend ./admin/frontend/Dockerfile

echo "==> loading ${#images[@]} images into kind cluster '${CLUSTER_NAME}'"
kind load docker-image "${images[@]}" --name "$CLUSTER_NAME"

echo "==> done"
