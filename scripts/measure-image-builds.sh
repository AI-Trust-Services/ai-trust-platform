#!/usr/bin/env bash
#
# Measure per-image build time + final image size for the targets in
# docker-bake.hcl, then print a table sorted by size (largest first).
#
# The target list is read from `docker buildx bake --print`, so it stays in
# sync with docker-bake.hcl automatically — no hardcoded list to maintain.
#
# Usage:
#   scripts/measure-image-builds.sh                    # all targets, cold build
#   scripts/measure-image-builds.sh embedding indexing # only targets matching a substring
#   NO_CACHE=0 scripts/measure-image-builds.sh         # warm build (reuse local layer cache)
#
# Notes:
#   - Cold (--no-cache, the default) is the honest before/after number: it
#     includes the full pip/npm install cost. All 36 targets cold takes a while
#     — pass substrings to measure just the images you touched.
#   - Builds for the host's native arch (docker-bake pins linux/amd64; on an
#     arm64 Mac that would run under qemu and skew timings). Absolute seconds
#     differ from CI, but the relative before/after delta is representative.
#     Image SIZE is arch-insensitive and maps almost 1:1 to CI push/pull time.
#
set -euo pipefail

cd "$(dirname "$0")/.."  # repo root

command -v jq >/dev/null || { echo "jq required (brew install jq)" >&2; exit 1; }

# docker-bake's tag() needs OWNER/TAG; the values only matter for local naming.
export OWNER="${OWNER:-local}"
export TAG="${TAG:-measure}"
PLATFORM="linux/$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
NO_CACHE="${NO_CACHE:-1}"

# Every target name defined in docker-bake.hcl (while-read, not mapfile, so this
# works on the stock bash 3.2 that ships with macOS).
ALL=()
while IFS= read -r line; do ALL+=("$line"); done \
  < <(docker buildx bake --print 2>/dev/null | jq -r '.target | keys[]')
[ "${#ALL[@]}" -gt 0 ] || { echo "could not read targets from docker-bake.hcl" >&2; exit 1; }

# Optional substring filters (any match keeps the target).
TARGETS=()
if [ "$#" -gt 0 ]; then
  for t in "${ALL[@]}"; do
    for pat in "$@"; do
      [[ "$t" == *"$pat"* ]] && { TARGETS+=("$t"); break; }
    done
  done
else
  TARGETS=("${ALL[@]}")
fi
[ "${#TARGETS[@]}" -gt 0 ] || { echo "no targets match: $*" >&2; exit 1; }

RESULTS=$(mktemp)
LOGDIR=$(mktemp -d)
trap 'rm -rf "$RESULTS" "$LOGDIR"' EXIT

cache_flag=()
[ "$NO_CACHE" = "1" ] && cache_flag+=(--no-cache)

echo "Building ${#TARGETS[@]} target(s) for $PLATFORM (no-cache=$NO_CACHE)..." >&2

for t in "${TARGETS[@]}"; do
  printf '  ▶ %-36s ' "$t" >&2
  start=$(date +%s)
  if OWNER="$OWNER" TAG="$TAG" docker buildx bake "$t" \
        --set "*.platform=$PLATFORM" \
        --set "*.cache-from=" --set "*.cache-to=" \
        "${cache_flag[@]}" --load >"$LOGDIR/$t.log" 2>&1; then
    end=$(date +%s)
    img="ghcr.io/$OWNER/ai-trust-platform/$t:$TAG"
    size=$(docker image inspect "$img" --format '{{.Size}}' 2>/dev/null || echo 0)
    printf '%dm%02ds\n' $(((end - start) / 60)) $(((end - start) % 60)) >&2
    printf '%s\t%s\t%s\n' "$t" "$((end - start))" "$size" >> "$RESULTS"
  else
    echo "FAILED (log: $LOGDIR/$t.log)" >&2
    cp "$LOGDIR/$t.log" "/tmp/bake-$t.log"  # preserve past the trap for inspection
    printf '%s\t%s\t%s\n' "$t" "-1" "0" >> "$RESULTS"
  fi
done

# Table, sorted by size descending.
echo
printf '%-38s %9s %12s\n' "IMAGE" "TIME" "SIZE"
printf '%-38s %9s %12s\n' "--------------------------------------" "---------" "------------"
sort -t"$(printf '\t')" -k3 -nr "$RESULTS" | while IFS=$(printf '\t') read -r name secs bytes; do
  if [ "$secs" = "-1" ]; then
    tstr="FAILED"
  else
    tstr=$(printf '%dm%02ds' $((secs / 60)) $((secs % 60)))
  fi
  if [ "$bytes" = "0" ]; then
    sstr="-"
  else
    sstr=$(awk -v b="$bytes" 'BEGIN { printf "%.0f MB", b / 1048576 }')
  fi
  printf '%-38s %9s %12s\n' "$name" "$tstr" "$sstr"
done
