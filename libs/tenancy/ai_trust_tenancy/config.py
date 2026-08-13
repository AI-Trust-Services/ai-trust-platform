import os

# TENANCY_MODE selects how a request's tenant is resolved:
#   single  — no tenancy (default). resolve_tenant always returns None, the middleware
#             is a no-op, and the DB scoping hook does nothing. This keeps the exact
#             single-tenant behaviour of the full-copy (Standard_AiTrust_MSP) deploy.
#   jwt     — the tenant comes SOLELY from the cryptographically VERIFIED OIDC token
#             (signature + expiry + allowlisted issuer). A client X-Tenant-Id is IGNORED.
#             Prefers the TENANT_CLAIM claim, falls back to the org parsed from the
#             issuer (.../realms/<org>). Used by the shared multi-tenant deploy.
#   header  — trust an upstream-injected TENANT_HEADER. ONLY for a deployment behind a
#             proxy that sets the header AND strips any inbound client value.
_VALID_MODES = {"single", "jwt", "header"}
MODE = os.environ.get("TENANCY_MODE", "single").strip().lower()

# The JWT claim that carries the tenant id (a per-org claim mapper sets it). Falls back
# to the issuer-realm when the claim is absent.
TENANT_CLAIM = os.environ.get("TENANT_CLAIM", "tenant_id").strip()

# The header carrying the tenant in `header` mode (trusted proxy only).
TENANT_HEADER = os.environ.get("TENANT_HEADER", "x-tenant-id").strip().lower()

# --- jwt-mode verification (SEC-C2) ------------------------------------------------
# Trust anchor: the token's `iss` MUST start with this base, so an attacker cannot point
# us at a JWKS they control. e.g. https://ai-trust-1.<domain>/keycloak/realms
JWKS_ISSUER_BASE = os.environ.get("TENANCY_JWKS_ISSUER_BASE", "").strip().rstrip("/")
# Optional audience check (Keycloak client id). Empty = skip aud verification.
JWT_AUDIENCE = os.environ.get("TENANCY_JWT_AUDIENCE", "").strip()
# Verify the signature (default true). Set false ONLY in a controlled test/dev where the
# token is unsigned — the allowlisted-issuer prefix is still enforced.
JWT_VERIFY = os.environ.get("TENANCY_JWT_VERIFY", "true").strip().lower() not in ("0", "false", "no")


def validate() -> None:
    """Fail-fast on misconfiguration. Called from each backend's main.py at import time.

    Raises RuntimeError so a misconfigured deployment refuses to start rather than
    silently degrading (e.g. jwt mode with no issuer anchor would accept any issuer)."""
    if MODE not in _VALID_MODES:
        raise RuntimeError(
            f"TENANCY_MODE={MODE!r} is invalid; must be one of {sorted(_VALID_MODES)}"
        )
    if MODE == "jwt" and JWT_VERIFY and not JWKS_ISSUER_BASE:
        raise RuntimeError(
            "TENANCY_MODE=jwt requires TENANCY_JWKS_ISSUER_BASE (the trusted issuer prefix) "
            "so tokens are verified against a known JWKS. Refusing to start."
        )
