from __future__ import annotations

import importlib
import os
import threading
from typing import Callable, Optional

from starlette.requests import Request

from ai_trust_tenancy.config import (
    MODE,
    TENANT_CLAIM,
    TENANT_HEADER,
    JWKS_ISSUER_BASE,
    JWT_AUDIENCE,
    JWT_VERIFY,
)

# jwt verification lib is only needed in jwt mode; import lazily so `single`/`header`
# deployments (and non-DB tooling) don't require PyJWT to be installed.
_jwks_clients: dict[str, object] = {}
_jwks_lock = threading.Lock()

# --- Extensibility hook (issue #16 AC4: replaceable/adaptable tenancy module) ---------
# An enterprise can supply its OWN tenant resolution (a different IdP, a bespoke claim
# scheme, a lookup service) WITHOUT forking this package, in two ways:
#   1. Programmatic: call register_resolver(fn) at startup, fn(request) -> str | None.
#   2. Config: set TENANCY_RESOLVER="my_pkg.my_module:my_resolver" — it is imported and
#      registered automatically on first use.
# A registered custom resolver takes precedence over the built-in single/jwt/header modes;
# returning None from it falls through to the built-in resolution (so it can augment, not
# only replace). This keeps the three built-ins as sensible defaults.
ResolverFn = Callable[[Request], Optional[str]]
_custom_resolver: ResolverFn | None = None
_custom_loaded = False


def register_resolver(fn: ResolverFn | None) -> None:
    """Register (or clear, with None) a custom tenant resolver. Takes precedence over
    the built-in modes; return None from it to fall through to the built-in logic."""
    global _custom_resolver, _custom_loaded
    _custom_resolver = fn
    _custom_loaded = True


def _load_custom_from_env() -> None:
    """Load TENANCY_RESOLVER="module.path:callable" once, if set."""
    global _custom_loaded
    _custom_loaded = True
    spec = os.environ.get("TENANCY_RESOLVER", "").strip()
    if not spec:
        return
    mod, _, attr = spec.partition(":")
    fn = getattr(importlib.import_module(mod), attr)
    register_resolver(fn)


def resolve_tenant(request: Request) -> str | None:
    """Resolve the tenant id for an incoming request. Fail-closed.

    Order: a registered CUSTOM resolver (if any) first — enterprises plug in here (AC4);
    then the built-in TENANCY_MODE logic:
    - single: no tenancy (returns None).
    - header: trust an upstream-injected TENANT_HEADER (X-Tenant-Id). ONLY for deployments
      behind a proxy that itself sets the header AND strips any inbound client value.
    - jwt: the tenant comes SOLELY from the cryptographically VERIFIED OIDC token
      (signature + expiry + allowlisted issuer). A client-supplied X-Tenant-Id is IGNORED.

    SEC-C1: in jwt mode a forged X-Tenant-Id can no longer override the token.
    SEC-C2: the token is verified against the issuer's JWKS, not blindly decoded.
    """
    if not _custom_loaded:
        _load_custom_from_env()
    if _custom_resolver is not None:
        t = _custom_resolver(request)
        if t:
            return t  # custom wins; None falls through to built-ins

    if MODE == "single":
        return None

    if MODE == "header":
        # Trusted-proxy contract: the header is authoritative ONLY here.
        v = request.headers.get(TENANT_HEADER, "").strip()
        return v or None

    if MODE == "jwt":
        token = _bearer_token(request)
        if not token:
            return None
        claims = _verify_and_decode(token)
        if not claims:
            return None
        return _tenant_from_claims(claims)

    return None


def _bearer_token(request: Request) -> str | None:
    """The forwarded OIDC token. oauth2-proxy passes it as X-Forwarded-Access-Token
    (--pass-access-token) and/or Authorization: Bearer <jwt> (--pass-authorization-header)."""
    xat = request.headers.get("x-forwarded-access-token", "").strip()
    if xat:
        return xat
    auth = request.headers.get("authorization", "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def _issuer_of(token: str) -> str | None:
    """Read the UNVERIFIED `iss` claim only to select the JWKS endpoint. The token is
    fully verified against that issuer's keys before any claim is trusted."""
    try:
        import jwt  # PyJWT

        unverified = jwt.decode(token, options={"verify_signature": False})
        iss = unverified.get("iss", "")
        return iss or None
    except Exception:
        return None


def _jwks_client_for(issuer: str):
    """Cached PyJWKClient for the issuer's JWKS endpoint (Keycloak realm)."""
    import jwt  # PyJWT

    url = issuer.rstrip("/") + "/protocol/openid-connect/certs"
    with _jwks_lock:
        c = _jwks_clients.get(url)
        if c is None:
            c = jwt.PyJWKClient(url)
            _jwks_clients[url] = c
        return c


def _verify_and_decode(token: str) -> dict | None:
    """Verify the JWT (signature via the issuer's JWKS, expiry, issuer) and return its
    claims, or None on ANY failure (fail-closed → 401 in jwt mode).

    Trust is anchored on JWKS_ISSUER_BASE: the token's `iss` must start with it, so an
    attacker cannot point us at an issuer/JWKS they control. JWT_VERIFY=false disables
    verification (NOT recommended — only for a controlled test/dev where the token is
    unsigned); it still requires the allowlisted issuer prefix.
    """
    issuer = _issuer_of(token)
    if not issuer:
        return None
    # Anchor: only accept issuers under the configured, trusted base.
    if JWKS_ISSUER_BASE and not issuer.startswith(JWKS_ISSUER_BASE):
        return None

    if not JWT_VERIFY:
        # Escape hatch (test/dev only): trust the allowlisted-issuer token without sig check.
        try:
            import jwt
            return jwt.decode(token, options={"verify_signature": False})
        except Exception:
            return None

    try:
        import jwt
        signing_key = _jwks_client_for(issuer).get_signing_key_from_jwt(token)
        options = {"verify_aud": bool(JWT_AUDIENCE)}
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "RS384", "RS512", "ES256"],
            audience=JWT_AUDIENCE or None,
            issuer=issuer,
            options=options,
        )
    except Exception:
        return None  # signature/expiry/issuer/JWKS failure → fail-closed


def _tenant_from_claims(claims: dict) -> str | None:
    """Prefer the explicit tenant claim; fall back to the org parsed from the issuer.

    The mesh names one realm per org (issuer .../keycloak/realms/<org>) and realm==org
    account, so the realm segment is a reliable tenant signal even with no claim mapper.
    """
    claimed = claims.get(TENANT_CLAIM)
    if claimed:
        return str(claimed)
    issuer = claims.get("iss", "")
    marker = "/realms/"
    if marker in issuer:
        return issuer.rsplit(marker, 1)[1].strip("/") or None
    return None
