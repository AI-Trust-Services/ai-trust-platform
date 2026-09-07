"""Platform-SSO OIDC env assembly for internal ``kind="dockerfile"`` apps.

A dockerfile app we deploy runs its OWN OIDC login against the platform ``ai-trust`` realm. On deploy
(when ``sso_enabled``) the platform mints a per-app confidential Keycloak client (reusing
``keycloak.ensure_app_client``) and injects a generic ``OIDC_*`` env set into the container. The app
is reached same-origin, embedded through the marketplace proxy, so its OIDC callback is same-origin
under that proxy path — which lets ``ensure_app_client`` be reused verbatim (it scopes redirectUris to
``{base}/*`` and webOrigins to ``[base]``).

The client secret is delivered to the container separately (a k8s Secret on k8s, inline env on
compose) and is NEVER produced here, returned here, or logged.
"""
from __future__ import annotations

import os

from fastapi import HTTPException

from app import keycloak


def _app_public_url() -> str:
    """The browser-facing base of the platform (oauth2-proxy origin). 500 if unset — a hard
    prerequisite for assembling the app's same-origin OIDC callback."""
    base = os.environ.get("APP_PUBLIC_URL", "").rstrip("/")
    if not base:
        raise HTTPException(500, "APP_PUBLIC_URL is not configured on the marketplace backend")
    return base


def issuer() -> str:
    """The ``ai-trust`` realm's browser-facing OIDC issuer (from KEYCLOAK_PUBLIC_URL, never the
    in-cluster KEYCLOAK_URL). 500 if KEYCLOAK_PUBLIC_URL is unset (same rule as _federation_setup)."""
    public = os.environ.get("KEYCLOAK_PUBLIC_URL", "").rstrip("/")
    if not public:
        raise HTTPException(500, "KEYCLOAK_PUBLIC_URL is not configured on the marketplace backend")
    return f"{public}/realms/{keycloak.REALM}"


def embed_base(name: str) -> str:
    """Same-origin base the embedded app is reached at, e.g.
    ``https://platform.example.com/api/marketplace/v1/proxy/weather``. Used both as the Keycloak
    client ``base_url`` (→ redirectUris ``{base}/*``, webOrigins ``[base]``) and to derive the
    app's OIDC callback."""
    return f"{_app_public_url()}/api/marketplace/v1/proxy/{name}"


def redirect_uri(name: str) -> str:
    """The app's OIDC callback (same-origin under the embed proxy path). The app must honour this
    via its injected ``OIDC_REDIRECT_URI`` and run under the embed base path."""
    return f"{embed_base(name)}/oauth/callback"


def oidc_env(client_id: str, name: str) -> dict[str, str]:
    """The NON-SECRET generic OIDC env injected into the container. ``OIDC_CLIENT_SECRET`` is
    delivered separately (k8s Secret / compose env) and is intentionally absent here."""
    return {
        "OIDC_ISSUER": issuer(),
        "OIDC_CLIENT_ID": client_id,
        "OIDC_REDIRECT_URI": redirect_uri(name),
        "OIDC_SCOPES": "openid profile email",
    }
