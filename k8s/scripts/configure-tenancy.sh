#!/usr/bin/env bash
# Sets TENANCY_MODE in .env (creating .env from .env.example on first run).
# Called by `make up` / `make configure`.
#
# Usage:
#   configure-tenancy.sh           — single-tenant (default, non-interactive)
#   configure-tenancy.sh multi     — multi-tenant
#   TENANCY_MODE=jwt make up       — env-var override (same effect, skips prompt)
#
# When stdin is a TTY and no mode is given or env-set, prompts interactively.
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

# 1) positional argument wins (configure-tenancy.sh multi)
# 2) TENANCY_MODE env var wins next
# 3) interactive prompt when stdin is a TTY
# 4) default to single (non-interactive / CI)
arg="${1:-}"
mode="${TENANCY_MODE:-}"

if [[ -n "$arg" ]]; then
  mode="$arg"
elif [[ -z "$mode" ]]; then
  if [[ -t 0 ]]; then
    echo ""
    echo "  Select the tenancy mode for this installation:"
    echo "    1) single  — one organization, no per-tenant isolation (default; kind / standalone)"
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
    mode="single"
    echo "==> non-interactive shell; defaulting to TENANCY_MODE=single"
  fi
fi

# normalize
case "$mode" in
  jwt|multi|2) mode="jwt" ;;
  *)           mode="single" ;;
esac

# write it back into .env (replace existing line or append)
if grep -qE '^TENANCY_MODE=' "$ENV_FILE"; then
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
