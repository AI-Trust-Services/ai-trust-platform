#!/usr/bin/env bash
# deploy.sh — one-command install of the AI Trust Platform (standalone) on ANY cluster.
#   1. cp prerequisites/config.env.example prerequisites/config.env  (then edit it)
#   2. point kubectl at your target cluster (KUBECONFIG / kubectl config use-context)
#   3. ./scripts/deploy.sh
# Env toggles: SKIP_BUILD=1 (reuse pushed/loaded images), SKIP_INGRESS=1.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; source "$HERE/lib.sh"

echo ""
echo "######################################################################"
echo "#  AI Trust Platform — standalone install"
echo "######################################################################"

bash "$HERE/0-check-prerequisites.sh" || die "Prerequisites incomplete — fix the errors above and re-run."
load_config

if [ -n "${SKIP_BUILD:-}" ]; then
  bash "$HERE/2-build-images.sh" --skip-build
else
  bash "$HERE/2-build-images.sh"
fi
bash "$HERE/3-deploy-app.sh"
[ -n "${SKIP_INGRESS:-}" ] || bash "$HERE/4-ingress.sh"
bash "$HERE/8-verify.sh" || true

echo ""
ok "DONE — AI Trust Platform at $APP_URL"
echo "   Bootstrap admin password: $STATE/admin-credentials.txt"
echo "   Day-2 update:  ./scripts/update.sh    |    Remove:  ./scripts/reset.sh"
