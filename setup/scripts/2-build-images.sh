#!/usr/bin/env bash
# 2-build-images.sh — build the app images from the git repo, then EITHER push them
# to $REGISTRY (real clusters) OR load them into a kind cluster (INGRESS_MODE=kind).
#   --skip-clone   reuse the already-fetched source (used by update.sh)
#   --skip-build   only push/load already-built images
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; source "$HERE/lib.sh"; load_config

SRC="$BUNDLE/.state/app-src"
if [ "${1:-}" != "--skip-clone" ]; then
  if [ -d "$SRC/.git" ]; then
    git -C "$SRC" fetch --depth 1 origin "$APP_GIT_REF" >/dev/null 2>&1 && git -C "$SRC" reset --hard FETCH_HEAD >/dev/null 2>&1 \
      || die "git update failed in $SRC"
  else
    git clone --depth 1 --branch "$APP_GIT_REF" "$APP_GIT_URL" "$SRC" >/dev/null 2>&1 \
      || die "git clone failed ($APP_GIT_URL@$APP_GIT_REF)"
  fi
fi
[ -d "$SRC" ] || die "app source not found at $SRC (run without --skip-clone first)"

SKIP_BUILD=0; { [ "${1:-}" = "--skip-build" ] || [ "${2:-}" = "--skip-build" ]; } && SKIP_BUILD=1
PUB="$APP_URL"
BACKENDS="ai-system-registry monitoring overview alerts compliance decision-trace-analyzer"

if [ "$SKIP_BUILD" -eq 0 ]; then
  log "Building images from $SRC (public URL baked into frontends: $PUB)…"
  cd "$SRC"
  for c in $BACKENDS; do docker build -q -t "aitrust/$c-backend:build" -f "$c/backend/Dockerfile" . >/dev/null; done
  docker build -q -t aitrust/db-migrate:build            ./libs/persistence          >/dev/null
  docker build -q -t aitrust/clickhouse-migrate:build    ./libs/clickhouse           >/dev/null
  docker build -q -t aitrust/keycloak-provision:build    ./infra/keycloak            >/dev/null
  docker build -q -t aitrust/policy-checker-worker:build -f policy-checker-worker/Dockerfile . >/dev/null
  docker build -q -t aitrust/clickhouse-consumer:build   -f consumers/clickhouse-consumer/Dockerfile . >/dev/null
  docker build -q -t aitrust/rmq-bridge:build            ./otel-pipeline/rmq-bridge  >/dev/null
  # Shell uses ROOT-RELATIVE MFE viewUrls, so the image is host-portable — do NOT bake a host into it.
  docker build -q -t aitrust/shell:build ./shell >/dev/null
  # Frontends: bake relative API bases. VITE_USERS_API_BASE is required by the IAM-aware nav.
  docker build -q -t aitrust/ai-system-registry-frontend:build     --build-arg VITE_REGISTRY_API_BASE=/api/registry/v1 --build-arg VITE_USERS_API_BASE=/api/users/v1 ./ai-system-registry/frontend >/dev/null
  docker build -q -t aitrust/monitoring-frontend:build             --build-arg VITE_MONITORING_API_BASE=/api/monitoring/v1 ./monitoring/frontend >/dev/null
  docker build -q -t aitrust/alerts-frontend:build                 --build-arg VITE_ALERTS_API_BASE=/api/alerts/v1 --build-arg VITE_ALERTS_URL="$PUB/alerts" --build-arg VITE_USERS_API_BASE=/api/users/v1 ./alerts/frontend >/dev/null
  docker build -q -t aitrust/compliance-frontend:build             --build-arg VITE_COMPLIANCE_API_BASE=/api/compliance/v1 --build-arg VITE_REGISTRY_API_BASE=/api/registry/v1 --build-arg VITE_USERS_API_BASE=/api/users/v1 ./compliance/frontend >/dev/null
  docker build -q -t aitrust/decision-trace-analyzer-frontend:build --build-arg VITE_DTA_API_BASE=/api/dta/v1 ./decision-trace-analyzer/frontend >/dev/null
  docker build -q -t aitrust/overview-frontend:build               --build-arg VITE_OVERVIEW_API_BASE=/api/overview/v1 --build-arg VITE_ALERTS_API_BASE=/api/alerts/v1 --build-arg VITE_ALERTS_URL="$PUB/alerts" --build-arg VITE_REGISTRY_URL="$PUB/registry" --build-arg VITE_COMPLIANCE_URL="$PUB/compliance" --build-arg VITE_COMPLIANCE_API_BASE=/api/compliance/v1 --build-arg VITE_USERS_API_BASE=/api/users/v1 ./overview/frontend >/dev/null
  ok "images built"
fi

ALL_BACKENDS="$BACKENDS"
FRONTENDS="ai-system-registry monitoring overview alerts compliance decision-trace-analyzer"
SINGLETONS="db-migrate clickhouse-migrate keycloak-provision policy-checker-worker clickhouse-consumer rmq-bridge shell"

if [ "$INGRESS_MODE" = "kind" ]; then
  : "${KIND_CLUSTER:=kind}"
  log "Loading images into kind cluster '$KIND_CLUSTER' (tag $TAG)…"
  retag_local(){ docker tag "$1" "$2"; kind load docker-image "$2" --name "$KIND_CLUSTER" >/dev/null && echo "  loaded $2"; }
  for c in $ALL_BACKENDS; do retag_local "aitrust/$c-backend:build" "aitrust/$c-backend:$TAG"; done
  for c in $FRONTENDS;    do retag_local "aitrust/$c-frontend:build" "aitrust/$c-frontend:$TAG"; done
  for c in $SINGLETONS;   do retag_local "aitrust/$c:build" "aitrust/$c:$TAG"; done
  ok "all images loaded into kind (tag $TAG)"
else
  log "Retag + push to $REGISTRY (tag $TAG)…"
  push(){ docker tag "$1" "$2"; docker push -q "$2" >/dev/null && echo "  pushed $2"; }
  for c in $ALL_BACKENDS; do push "aitrust/$c-backend:build" "$REGISTRY/aitrust-$c-backend:$TAG"; done
  for c in $FRONTENDS;    do push "aitrust/$c-frontend:build" "$REGISTRY/aitrust-$c-frontend:$TAG"; done
  for c in $SINGLETONS;   do push "aitrust/$c:build" "$REGISTRY/aitrust-$c:$TAG"; done
  ok "all images pushed to $REGISTRY (tag $TAG)"
fi
