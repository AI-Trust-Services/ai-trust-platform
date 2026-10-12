#!/usr/bin/env bash
# Builds locally-built images and loads them into the kind cluster — no
# registry involved. Third-party images (postgres, keycloak, openfga,
# oauth2-proxy, rabbitmq, clickhouse-server, otel-collector-contrib)
# are pulled normally by kubelet and are not built here.
#
# Builds run in parallel via `docker buildx bake` over the same docker-bake.hcl
# that CI uses — one shared BuildKit instance, so common layers (notably the
# shared `backend-base` image) are built once and reused across every service.
# Tags are rewritten to the local `ai-trust/<name>:local` names the Helm
# values-kind.yaml expects, and images are loaded straight into kind.
#
# Usage:
#   build-and-load-images.sh              — build and load every image
#   build-and-load-images.sh --service X  — build and load only image X
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-ai-trust}"
TAG="local"

# Optional filter: --service <name> builds only that one bake target.
FILTER=""
if [[ "${1:-}" == "--service" ]]; then
  FILTER="${2:?--service requires a name}"
fi

cd "$REPO_ROOT"

# Load .env so the VITE_* frontend build args (and anything else bake reads as a
# variable) are present in the environment bake inherits.
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

# bake's tag() needs OWNER/TAG defined; we override the tags per target below,
# so the OWNER value itself is never used in the final tags — but it must be set
# for the HCL to evaluate.
export OWNER="${OWNER:-local}"
export TAG

# The bake group to build: everything by default, or the one named target when
# --service is passed. `backend-base` is pulled in automatically as a dependency
# of the targets that reference it — it never needs to be named explicitly.
TARGET_ARG="default"
if [[ -n "$FILTER" ]]; then
  TARGET_ARG="$FILTER"
fi

# Discover the concrete target names bake will build (expands the "default"
# group, and includes backend-base when any selected target depends on it), so
# we can both rewrite each target's tag to the local name and know what to load.
# `tr -d '\r'` guards against CRLF line endings from jq on Windows/Git Bash,
# which would otherwise corrupt the per-target --set keys below.
mapfile -t targets < <(
  docker buildx bake --file docker-bake.hcl "$TARGET_ARG" --print 2>/dev/null \
    | jq -r '.target | keys[]' | tr -d '\r'
)

if [[ ${#targets[@]} -eq 0 ]]; then
  echo "error: no bake target named '${FILTER}' — check the name and retry" >&2
  exit 1
fi

# Rewrite every target's tags to the local image name and force a docker-format
# load (so `kind load` can pick the images up from the local daemon). The GHA
# cache import/export declared in docker-bake.hcl is CI-only (needs the
# docker-container driver); strip it so the local `docker` driver doesn't error.
set_flags=()
images=()
for t in "${targets[@]}"; do
  set_flags+=("--set" "${t}.tags=ai-trust/${t}:${TAG}")
  set_flags+=("--set" "${t}.output=type=docker")
  set_flags+=("--set" "${t}.cache-from=")
  set_flags+=("--set" "${t}.cache-to=")
  # backend-base is a build-time parent only — never loaded into the cluster.
  [[ "$t" == "backend-base" ]] && continue
  images+=("ai-trust/${t}:${TAG}")
done

echo "==> building ${#targets[@]} target(s) in parallel via docker buildx bake"
docker buildx bake --file docker-bake.hcl "$TARGET_ARG" "${set_flags[@]}"

echo "==> loading ${#images[@]} images into kind cluster '${CLUSTER_NAME}'"
kind load docker-image "${images[@]}" --name "$CLUSTER_NAME"

echo "==> done"
