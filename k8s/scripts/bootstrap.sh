#!/usr/bin/env bash
# Creates everything the Helm chart expects to already exist: namespace, the
# Secret sourced from .env, ConfigMaps sourced from the existing config files,
# and the RBAC needed for the "wait for job completion" initContainer pattern.
#
# Safe to re-run - every command is idempotent (apply, not create).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
NAMESPACE="${NAMESPACE:-ai-trust}"

if [[ ! -f "$REPO_ROOT/.env" ]]; then
  echo "error: $REPO_ROOT/.env not found - copy .env.example to .env and fill it in first" >&2
  exit 1
fi

echo "==> namespace/$NAMESPACE"
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

echo "==> secret/ai-trust-env (from .env, plus computed connection strings)"
# .env only has bare POSTGRES_*/RABBITMQ_* credentials. Compute DATABASE_URL and
# RABBITMQ_URL here so every backend can just `envFrom: secretRef: ai-trust-env`
# and get them too.
# (kubectl create secret rejects --from-env-file combined with --from-literal,
# so every .env line is passed through as its own --from-literal instead.)
set -a
# shellcheck disable=SC1091
set +u  # .env may contain ${VAR} references (e.g. ${LB_IP}) not defined in all environments
# Use a temp file so tr -d '\r' (Windows line endings) works AND variables
# propagate into the current shell (source <(...) does not export in all bash versions)
_env_tmp=$(mktemp)
tr -d '\r' < "$REPO_ROOT/.env" > "$_env_tmp"
source "$_env_tmp"
rm -f "$_env_tmp"
set -u
set +a

# kind maps MinIO's API to host port 19000 (kind-config.yaml extraPortMappings;
# 9000 is commonly held by corporate VPN/proxy agents, e.g. Zscaler). The shared
# .env carries the docker-compose value localhost:9000, so browser presigned URLs
# would point at a dead port under kind. Rewrite only the compose default — the
# Gardener env files set MINIO_PUBLIC_ENDPOINT to a real DNS host and are untouched.
if [[ "${MINIO_PUBLIC_ENDPOINT:-}" == "localhost:9000" ]]; then
  export MINIO_PUBLIC_ENDPOINT="localhost:19000"
fi

# Build --from-literal args from the *expanded* environment (post-source),
# so variable references like APP_PUBLIC_URL=https://${LB_IP}.nip.io work.
# Only export keys that were defined in the .env file (skip LB_IP itself and
# shell builtins) by reading key names from the file, then resolving via printenv.
literal_args=()
while IFS='=' read -r key _; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  value=$(printenv "$key" 2>/dev/null || true)
  literal_args+=(--from-literal="${key}=${value}")
done < <(tr -d '\r' < "$REPO_ROOT/.env" | grep -v '^\s*#' | grep -v '^\s*$')

# Derive ingress hostnames from the public URLs (strip scheme) so FluxDeployer
# valuesFrom can map them directly to ingress.host / ingress.keycloakHost.
INGRESS_HOST=$(echo "${APP_PUBLIC_URL:-}" | sed -E 's#^[a-zA-Z]+://##')
INGRESS_KEYCLOAK_HOST=$(echo "${KEYCLOAK_PUBLIC_URL:-}" | sed -E 's#^[a-zA-Z]+://##')
INGRESS_MINIO_HOST=$(echo "${MINIO_PUBLIC_URL:-}" | sed -E 's#^[a-zA-Z]+://##')

kubectl create secret generic ai-trust-env \
  "${literal_args[@]}" \
  --from-literal=DATABASE_URL="postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/ai_trust" \
  --from-literal=RABBITMQ_URL="amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@rabbitmq:5672/" \
  --from-literal=OPENFGA_DATASTORE_URI="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/openfga?sslmode=disable" \
  --from-literal=INGRESS_HOST="${INGRESS_HOST}" \
  --from-literal=INGRESS_KEYCLOAK_HOST="${INGRESS_KEYCLOAK_HOST}" \
  --from-literal=INGRESS_MINIO_HOST="${INGRESS_MINIO_HOST}" \
  -n "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# Pull secret for private GHCR images (e.g. the cognee-eval read-only graph
# snapshot). Only created when GHCR_PULL_TOKEN is set in .env — devs who don't
# pull private images can leave it blank. Mirrors the Gardener deploy, which
# creates the same-named secret from the CI GHCR_PULL_TOKEN.
GHCR_OWNER="${GITHUB_REPOSITORY_OWNER:-ai-trust-services}"
GHCR_OWNER="$(echo "$GHCR_OWNER" | tr '[:upper:]' '[:lower:]')"
if [[ -n "${GHCR_PULL_TOKEN:-}" ]]; then
  echo "==> secret/ghcr-pull-secret (private GHCR image pulls)"
  kubectl create secret docker-registry ghcr-pull-secret \
    --docker-server=ghcr.io \
    --docker-username="$GHCR_OWNER" \
    --docker-password="$GHCR_PULL_TOKEN" \
    -n "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
fi

# Flux's HelmRelease valuesFrom has no cross-namespace support — the secret must exist
# in the same namespace as the HelmRelease (ocm-system). Only the 5 non-sensitive URL/
# hostname values needed by the FluxDeployer are stored here; all credentials stay in
# the ai-trust-env secret in the target namespace ($NAMESPACE).
echo "==> secret/ai-trust-flux-values-${NAMESPACE} in ocm-system (Helm chart URL values for FluxDeployer)"
kubectl create namespace ocm-system --dry-run=client -o yaml | kubectl apply -f -
OLLAMA_ENABLED="false"
[[ "${LLM_PROVIDER:-stub}" == "ollama" ]] && OLLAMA_ENABLED="true"

kubectl create secret generic "ai-trust-flux-values-${NAMESPACE}" \
  --from-literal=APP_PUBLIC_URL="${APP_PUBLIC_URL:-}" \
  --from-literal=KEYCLOAK_PUBLIC_URL="${KEYCLOAK_PUBLIC_URL:-}" \
  --from-literal=INGRESS_HOST="${INGRESS_HOST}" \
  --from-literal=INGRESS_KEYCLOAK_HOST="${INGRESS_KEYCLOAK_HOST}" \
  --from-literal=INGRESS_MINIO_HOST="${INGRESS_MINIO_HOST}" \
  --from-literal=IMAGE_TAG="${IMAGE_TAG:-latest}" \
  --from-literal=OLLAMA_ENABLED="${OLLAMA_ENABLED}" \
  --from-literal=MINIO_IMAGE="ghcr.io/${GHCR_OWNER}/ai-trust-platform/minio:${IMAGE_TAG:-latest}" \
  --from-literal=MC_IMAGE="ghcr.io/${GHCR_OWNER}/ai-trust-platform/mc:${IMAGE_TAG:-latest}" \
  -n ocm-system --dry-run=client -o yaml | kubectl apply -f -

echo "==> configmap/postgres-init (from infra/postgres/init.sh)"
kubectl create configmap postgres-init \
  --from-file=init.sh="$REPO_ROOT/infra/postgres/init.sh" \
  -n "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

echo "==> configmap/otel-collector-config (from otel-pipeline/collector/otel-collector-config.yaml)"
kubectl create configmap otel-collector-config \
  --from-file=otel-collector-config.yaml="$REPO_ROOT/otel-pipeline/collector/otel-collector-config.yaml" \
  -n "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

echo "==> configmap/clickhouse-config (from otel-pipeline/clickhouse-config/config.d/)"
kubectl create configmap clickhouse-config \
  --from-file="$REPO_ROOT/otel-pipeline/clickhouse-config/config.d/" \
  -n "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

echo "==> RBAC for the wait-for-job initContainer pattern"
kubectl create serviceaccount job-waiter -n "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
cat <<EOF | kubectl apply -n "$NAMESPACE" -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: job-waiter
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "create", "update", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: job-waiter
subjects:
  - kind: ServiceAccount
    name: job-waiter
    namespace: $NAMESPACE
roleRef:
  kind: Role
  name: job-waiter
  apiGroup: rbac.authorization.k8s.io
EOF

echo "==> RBAC for keycloak-ssl-patch job (needs deployment patch to trigger restart)"
kubectl create serviceaccount keycloak-restarter -n "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
cat <<EOF | kubectl apply -n "$NAMESPACE" -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: keycloak-restarter
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: keycloak-restarter
subjects:
  - kind: ServiceAccount
    name: keycloak-restarter
    namespace: $NAMESPACE
roleRef:
  kind: Role
  name: keycloak-restarter
  apiGroup: rbac.authorization.k8s.io
EOF

echo "==> prune completed/failed jobs from prior Helm revisions"
# Helm only prunes resources from the last *successful* release. When multiple
# upgrades fail in a row the old per-revision jobs (db-migrate-rN, etc.) pile up
# and clutter the namespace. We keep any job whose name ends in the CURRENT Helm
# release revision and delete everything older.
#
# The current revision is the highest -rN suffix present in the namespace (the
# most recently created set). We never delete Running/Pending jobs — those belong
# to a live upgrade that may still be in flight.
CURRENT_REV=$(kubectl get jobs -n "$NAMESPACE" --no-headers \
  -o custom-columns=NAME:.metadata.name 2>/dev/null \
  | grep -oE '\-r[0-9]+$' | grep -oE '[0-9]+' | sort -n | tail -1 || true)

if [[ -n "$CURRENT_REV" ]]; then
  STALE=$(kubectl get jobs -n "$NAMESPACE" --no-headers \
    -o custom-columns=NAME:.metadata.name,STATUS:.status.conditions[-1:].type 2>/dev/null \
    | awk -v rev="$CURRENT_REV" '
        $1 ~ /-r[0-9]+$/ && $1 !~ ("-r"rev"$") && ($2 == "Complete" || $2 == "Failed") { print $1 }
      ' || true)
  if [[ -n "$STALE" ]]; then
    echo "$STALE" | xargs kubectl delete job -n "$NAMESPACE" --ignore-not-found
  else
    echo "no stale jobs to prune"
  fi
else
  echo "no prior jobs found — skipping prune"
fi

echo "==> bootstrap complete (namespace: $NAMESPACE)"
