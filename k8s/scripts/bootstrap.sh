#!/usr/bin/env bash
# Creates everything the Helm chart expects to already exist: namespace, the
# Secret sourced from .env (single source of truth shared with docker-compose),
# ConfigMaps sourced from the existing (non-k8s-specific) config files, and the
# RBAC needed for the "wait for job completion" initContainer pattern.
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
# docker-compose builds DATABASE_URL/RABBITMQ_URL from .env via YAML anchors
# (x-db-env/x-rmq-env) at `docker compose up` time - .env itself only has the
# bare POSTGRES_*/RABBITMQ_* credentials. Compute the same two URLs here so
# every backend can just `envFrom: secretRef: ai-trust-env` and get them too.
# (kubectl create secret rejects --from-env-file combined with --from-literal,
# so every .env line is passed through as its own --from-literal instead.)
set -a
# shellcheck disable=SC1091
source "$REPO_ROOT/.env"
set +a

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

kubectl create secret generic ai-trust-env \
  "${literal_args[@]}" \
  --from-literal=DATABASE_URL="postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/ai_trust" \
  --from-literal=RABBITMQ_URL="amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@rabbitmq:5672/" \
  --from-literal=OPENFGA_DATASTORE_URI="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/openfga?sslmode=disable" \
  -n "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

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

echo "==> bootstrap complete (namespace: $NAMESPACE)"
