from __future__ import annotations

import threading

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


def resolve_tenant(request: Request) -> str | None:
    """Resolve the tenant id for an incoming request, per TENANCY_MODE. Fail-closed.

    - single: no tenancy (returns None).
    - header: trust an upstream-injected TENANT_HEADER (X-Tenant-Id). This mode is ONLY
      for deployments behind a proxy that itself sets the header AND strips any inbound
      client value. The client header is NOT trusted in any other mode.
    - jwt: the tenant comes SOLELY from the cryptographically VERIFIED OIDC token
      (signature + expiry + allowlisted issuer). A client-supplied X-Tenant-Id is IGNORED.

    SEC-C1: in jwt mode a forged X-Tenant-Id can no longer override the token.
    SEC-C2: the token is verified against the issuer's JWKS, not blindly decoded.
    """
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
