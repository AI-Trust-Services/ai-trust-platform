#!/usr/bin/env bash
# Builds locally-built images and loads them into the kind cluster — no
# registry involved. Third-party images (postgres, keycloak, openfga,
# oauth2-proxy, rabbitmq, clickhouse-server, otel-collector-contrib)
# are pulled normally by kubelet and are not built here.
#
# Usage:
#   build-and-load-images.sh              — build and load every image
#   build-and-load-images.sh --service X  — build and load only image X
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-ai-trust}"
TAG="local"

# Optional filter: --service <name> builds only that one image.
FILTER=""
if [[ "${1:-}" == "--service" ]]; then
  FILTER="${2:?--service requires a name}"
fi

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
  [[ -n "$FILTER" && "$name" != "$FILTER" ]] && return 0
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
build embedding-service . embedding-service/Dockerfile
build document-indexing-backend . document-indexing/backend/Dockerfile
build document-indexing-worker . document-indexing-worker/Dockerfile
build otel-clickhouse-consumer . consumers/clickhouse-consumer/Dockerfile
build openfga-provision . infra/openfga-provision/Dockerfile

# ── one-shot migration images (own context) ──
build db-migrate ./libs/persistence ./libs/persistence/Dockerfile
build clickhouse-migrate ./libs/clickhouse ./libs/clickhouse/Dockerfile

# ── other own-context images ──
build keycloak-provision ./infra/keycloak ./infra/keycloak/Dockerfile
build minio ./infra/minio ./infra/minio/Dockerfile
build mc ./infra/mc ./infra/mc/Dockerfile
build shell ./shell ./shell/Dockerfile
build otel-rmq-bridge ./otel-pipeline/rmq-bridge ./otel-pipeline/rmq-bridge/Dockerfile

# ── frontends (Vite build args baked in) ──
build ai-system-registry-frontend . ./ai-system-registry/frontend/Dockerfile \
  --build-arg "VITE_REGISTRY_API_BASE=${VITE_REGISTRY_API_BASE}" \
  --build-arg "VITE_USERS_API_BASE=${VITE_USERS_API_BASE:-/api/users/v1}"

build monitoring-frontend . ./monitoring/frontend/Dockerfile \
  --build-arg "VITE_MONITORING_API_BASE=${VITE_MONITORING_API_BASE}"

build overview-frontend . ./overview/frontend/Dockerfile \
  --build-arg "VITE_OVERVIEW_API_BASE=${VITE_OVERVIEW_API_BASE}" \
  --build-arg "VITE_ALERTS_API_BASE=${VITE_ALERTS_API_BASE}" \
  --build-arg "VITE_ALERTS_URL=${VITE_ALERTS_URL}" \
  --build-arg "VITE_REGISTRY_URL=${VITE_REGISTRY_URL}" \
  --build-arg "VITE_COMPLIANCE_URL=${VITE_COMPLIANCE_URL}" \
  --build-arg "VITE_COMPLIANCE_API_BASE=${VITE_COMPLIANCE_API_BASE}" \
  --build-arg "VITE_USERS_API_BASE=${VITE_USERS_API_BASE:-/api/users/v1}"

build alerts-frontend . ./alerts/frontend/Dockerfile \
  --build-arg "VITE_ALERTS_API_BASE=${VITE_ALERTS_API_BASE}" \
  --build-arg "VITE_ALERTS_URL=${VITE_ALERTS_URL}" \
  --build-arg "VITE_USERS_API_BASE=${VITE_USERS_API_BASE:-/api/users/v1}"

build compliance-frontend . ./compliance/frontend/Dockerfile \
  --build-arg "VITE_COMPLIANCE_API_BASE=${VITE_COMPLIANCE_API_BASE:-/api/compliance/v1}" \
  --build-arg "VITE_REGISTRY_API_BASE=${VITE_REGISTRY_API_BASE:-/api/registry/v1}" \
  --build-arg "VITE_USERS_API_BASE=${VITE_USERS_API_BASE:-/api/users/v1}"

build users-frontend . ./users/frontend/Dockerfile \
  --build-arg "VITE_USERS_API_BASE=${VITE_USERS_API_BASE:-/api/users/v1}"

build audit-backend . audit/backend/Dockerfile

build audit-frontend . ./audit/frontend/Dockerfile \
  --build-arg "VITE_AUDIT_API_BASE=${VITE_AUDIT_API_BASE:-/api/audit/v1}" \
  --build-arg "VITE_USERS_API_BASE=${VITE_USERS_API_BASE:-/api/users/v1}"

build audit-flush-worker . audit-flush-worker/Dockerfile

build admin-backend . admin/backend/Dockerfile

build admin-frontend . ./admin/frontend/Dockerfile \
  --build-arg "VITE_ADMIN_API_BASE=${VITE_ADMIN_API_BASE:-/api/admin/v1}" \
  --build-arg "VITE_USERS_API_BASE=${VITE_USERS_API_BASE:-/api/users/v1}"

build decision-trace-analyzer-frontend . ./decision-trace-analyzer/frontend/Dockerfile \
  --build-arg "VITE_DTA_API_BASE=${VITE_DTA_API_BASE}"

build document-indexing-frontend ./document-indexing/frontend ./document-indexing/frontend/Dockerfile \
  --build-arg "VITE_INDEXING_API_BASE=${VITE_INDEXING_API_BASE:-/api/indexing/v1}" \
  --build-arg "VITE_USERS_API_BASE=${VITE_USERS_API_BASE:-/api/users/v1}" \
  --build-arg "VITE_REGISTRY_API_BASE=${VITE_REGISTRY_API_BASE:-/api/registry/v1}"

build cognee-eval-backend . cognee-eval/backend/Dockerfile
build ai-gateway . ai-gateway/Dockerfile

echo "==> loading ${#images[@]} images into kind cluster '${CLUSTER_NAME}'"
if [[ ${#images[@]} -eq 0 ]]; then
  echo "error: no image named '${FILTER}' — check the name and retry" >&2
  exit 1
fi
kind load docker-image "${images[@]}" --name "$CLUSTER_NAME"

echo "==> done"
