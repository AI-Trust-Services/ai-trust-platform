#!/usr/bin/env bash
# Interactive install-time prompt: choose single-tenant vs multi-tenant and write
# TENANCY_MODE into .env (creating .env from .env.example on first run). Called by
# `make up` / `make configure`. Non-interactive callers can skip the prompt by
# setting TENANCY_MODE in the environment (e.g. TENANCY_MODE=jwt make up), or by
# having already set it in .env.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
EXAMPLE="$REPO_ROOT/.env.example"

# Ensure a .env exists (copy the template on first run).
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$EXAMPLE" ]]; then
    echo "==> no .env found — creating one from .env.example"
    cp "$EXAMPLE" "$ENV_FILE"
  else
    echo "error: neither .env nor .env.example found in $REPO_ROOT" >&2
    exit 1
  fi
fi

# current value (if any) from .env
current="$(grep -E '^TENANCY_MODE=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true)"

# 1) explicit override from the environment wins and is non-interactive.
mode="${TENANCY_MODE:-}"

# 2) otherwise prompt (unless stdin is not a TTY — then keep whatever .env has / default single).
if [[ -z "$mode" ]]; then
  if [[ -t 0 ]]; then
    echo ""
    echo "  Select the tenancy mode for this installation:"
    echo "    1) single  — one organization, no per-tenant isolation (default; docker-compose / kind / standalone)"
    echo "    2) multi   — multi-tenant (TENANCY_MODE=jwt); tenant from JWT claim, per-tenant data isolation"
    echo ""
    default_choice="1"; [[ "$current" == "jwt" ]] && default_choice="2"
    read -r -p "  Enter 1 or 2 [${default_choice}]: " choice || true
    choice="${choice:-$default_choice}"
    case "$choice" in
      2|multi|jwt) mode="jwt" ;;
      *)           mode="single" ;;
    esac
  else
    mode="${current:-single}"
    echo "==> non-interactive shell; using TENANCY_MODE=$mode"
  fi
fi

# normalize
case "$mode" in
  jwt|multi) mode="jwt" ;;
  *)         mode="single" ;;
esac

# write it back into .env (replace existing line or append)
if grep -qE '^TENANCY_MODE=' "$ENV_FILE"; then
  # portable in-place edit (works on GNU + BSD sed) via a temp file
  tmp="$(mktemp)"
  sed -E "s|^TENANCY_MODE=.*|TENANCY_MODE=${mode}|" "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
else
  printf '\nTENANCY_MODE=%s\n' "$mode" >> "$ENV_FILE"
fi

echo "==> TENANCY_MODE=${mode} written to .env"
if [[ "$mode" == "jwt" ]]; then
  echo "    Multi-tenant selected. Make sure TENANCY_JWKS_ISSUER_BASE is set in .env"
  echo "    (trusted issuer prefix, e.g. https://<host>/keycloak/realms/) — the app"
  echo "    fails fast at startup without it. Multi-tenant is normally deployed via the"
  echo "    MSP operator bundle; the plain kind install is intended for single-tenant."
fi
