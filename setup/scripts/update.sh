#!/usr/bin/env bash
# update.sh — DAY-2 update: build the latest APP_GIT_REF under a UNIQUE tag
# ($TAG-<gitsha>), push/load it, roll the running app to it, re-run the migrate
# Jobs, and verify. A per-commit tag guarantees the new code actually rolls out
# even with imagePullPolicy: IfNotPresent, and lets you roll back precisely.
#   ./scripts/update.sh
#   APP_GIT_REF=v1.2.3 ./scripts/update.sh          # pin a tag/branch
#   ROLLBACK_TO=<a prior $TAG-sha> ./scripts/update.sh --rollback
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; source "$HERE/lib.sh"; load_config
SRC="$STATE/app-src"

if [ "${1:-}" = "--rollback" ]; then
  [ -n "${ROLLBACK_TO:-}" ] || die "set ROLLBACK_TO=<a previously-pushed tag> for --rollback"
  log "Rolling app back to '$ROLLBACK_TO'…"
  roll_to_tag "$ROLLBACK_TO"; bash "$HERE/8-verify.sh" || true
  ok "rolled back to $ROLLBACK_TO"; exit 0
fi

# 1. Fetch latest + compute unique tag
if [ -d "$SRC/.git" ]; then
  git -C "$SRC" fetch --depth 1 origin "$APP_GIT_REF" >/dev/null 2>&1 && git -C "$SRC" reset --hard FETCH_HEAD >/dev/null 2>&1 || die "git update failed"
else
  git clone --depth 1 --branch "$APP_GIT_REF" "$APP_GIT_URL" "$SRC" >/dev/null 2>&1 || die "git clone failed"
fi
GITSHA="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)"
NEWTAG="${TAG}-${GITSHA}"
log "Latest $APP_GIT_REF = $GITSHA → building tag '$NEWTAG'"

# 2. Build + push/load under the unique tag (source already fetched)
TAG="$NEWTAG" bash "$HERE/2-build-images.sh" --skip-clone

# 3. Roll the running app (registry modes only; kind reloads on next apply)
if [ "$INGRESS_MODE" != "kind" ]; then roll_to_tag "$NEWTAG"; fi

# 4. Re-run migrate Jobs against the new images (immutable → delete + re-apply)
log "Re-running migrate Jobs…"
OUT="$STATE/k8s-app"; mkdir -p "$OUT"
TAG="$NEWTAG" rewrite_manifest "$CONFIG/k8s-app/20-jobs.yaml" > "$OUT/20-jobs-upd.yaml"
pin_and_storage_inplace "$OUT/20-jobs-upd.yaml"
for j in $(K -n "$APP_NS" get jobs -o name 2>/dev/null); do K -n "$APP_NS" delete "$j" --ignore-not-found >/dev/null 2>&1 || true; done
K apply -f "$OUT/20-jobs-upd.yaml" >/dev/null 2>&1 || warn "migrate Jobs apply returned non-zero"

# 5. Verify
bash "$HERE/8-verify.sh" || warn "verify reported issues — K -n $APP_NS get pods"
echo ""
ok "UPDATE COMPLETE — live tag: $NEWTAG ($APP_GIT_REF @ $GITSHA)"
echo "   Rollback: ROLLBACK_TO=<a prior ${TAG}-…> ./scripts/update.sh --rollback"
