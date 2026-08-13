from __future__ import annotations

import base64
import binascii
import json

from starlette.requests import Request

from ai_trust_tenancy.config import MODE, TENANT_CLAIM, TENANT_HEADER


def resolve_tenant(request: Request) -> str | None:
    """Resolve the tenant id for an incoming request, per TENANCY_MODE.

    Returns None when no tenant applies (single mode, or the signal is absent) — the
    caller decides whether that is allowed (see middleware). An explicit X-Tenant-Id
    header always wins when present (a deliberate upstream override).
    """
    if MODE == "single":
        return None

    # Explicit override header (nginx forwards X-Tenant-Id) takes precedence in any
    # non-single mode — lets the mesh pin a tenant without touching the token.
    override = request.headers.get(TENANT_HEADER, "").strip()
    if override:
        return override

    if MODE == "header":
        return None  # override was the only source in header mode

    if MODE == "jwt":
        token = _bearer_token(request)
        if not token:
            return None
        claims = _decode_unverified(token)
        if not claims:
            return None
        return _tenant_from_claims(claims)

    return None


def _bearer_token(request: Request) -> str | None:
    """The forwarded OIDC token. oauth2-proxy passes it as Authorization: Bearer <jwt>
    (--pass-authorization-header) and/or X-Forwarded-Access-Token (--pass-access-token)."""
    xat = request.headers.get("x-forwarded-access-token", "").strip()
    if xat:
        return xat
    auth = request.headers.get("authorization", "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def _decode_unverified(token: str) -> dict | None:
    """Decode a JWT payload WITHOUT verifying the signature.

    Safe here: oauth2-proxy already validated the token (signature, issuer, expiry)
    before forwarding it, and the backend is only reachable in-cluster behind it. We
    only need to read claims, not re-establish trust.
    """
    try:
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)  # restore base64url padding
        raw = base64.urlsafe_b64decode(payload_b64)
        return json.loads(raw)
    except (IndexError, ValueError, binascii.Error, json.JSONDecodeError):
        return None


def _tenant_from_claims(claims: dict) -> str | None:
    """Prefer an explicit tenant claim; fall back to the org parsed from the issuer.

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
