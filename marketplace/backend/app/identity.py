"""Build the identity headers the proxy injects into a discovered app's upstream request.

The external app is treated as UNCHANGEABLE, so the proxy adapts to whatever it expects. Four
modes (``MarketplaceService.auth_mode``):

  ``bearer``          → forward the caller's platform JWT as ``Authorization: Bearer <jwt>``. The app
                        validates it against its per-app Keycloak client audience.
  ``header_map``      → set one configured header (``auth_header_name``) to ``auth_value_template``
                        rendered from the caller's platform identity, e.g. ``X-Remote-User:
                        {preferred_username}``.
  ``none``            → forward no identity at all (public app).
  ``oidc_federation`` → inject NOTHING. The app runs its OWN OIDC login (opened in a new tab),
                        federated to the platform ``ai-trust`` realm as an upstream IdP, so it
                        authenticates the user itself. Behaves like ``none`` at the header layer; the
                        proxy is best-effort only (the primary path is a new-tab link, not embedding).

ANTI-SPOOF (critical): a browser can put anything in a request header, and this proxy runs
same-origin. Before injecting, we DROP every inbound copy (case-insensitive) of ``authorization``,
all ``x-forwarded-*`` headers, and the specific header we're about to set — so the app can only ever
see the value WE inject, never a client-supplied one. Kept as a pure function so it is unit-testable
independently of the router.
"""
from __future__ import annotations

from fastapi import Request

# Hop-by-hop headers that must not cross the proxy (mirrors the router's set).
_HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "content-length", "content-encoding",
}

# oauth2-proxy identity headers we always strip from the inbound request before injecting our own,
# so a discovered app can never receive a client-forged identity.
_IDENTITY_STRIP_PREFIXES = ("x-forwarded-",)
_IDENTITY_STRIP_EXACT = {"authorization"}


def _platform_identity(request: Request) -> dict[str, str]:
    """Extract the caller's verified identity from the oauth2-proxy headers (set server-side)."""
    h = request.headers
    return {
        "preferred_username": h.get("x-forwarded-preferred-username", "").strip()
        or h.get("x-forwarded-user", "").strip(),
        "sub": h.get("x-forwarded-user", "").strip(),
        "email": h.get("x-forwarded-email", "").strip(),
        # The platform JWT oauth2-proxy adds server-side; used verbatim in bearer mode.
        "jwt": h.get("authorization", "").removeprefix("Bearer ").removeprefix("bearer ").strip(),
    }


def build_upstream_headers(row, request: Request) -> dict[str, str]:
    """Return the header dict to send upstream for a discovered app.

    Starts from the inbound headers minus hop-by-hop/Host, strips ALL inbound identity headers
    (anti-spoof), then injects only what ``row.auth_mode`` dictates.
    """
    ident = _platform_identity(request)

    def _is_identity(key: str) -> bool:
        kl = key.lower()
        return kl in _IDENTITY_STRIP_EXACT or any(kl.startswith(p) for p in _IDENTITY_STRIP_PREFIXES)

    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in _HOP_BY_HOP and k.lower() != "host" and not _is_identity(k)
    }

    mode = (row.auth_mode or "bearer").lower()
    if mode == "bearer":
        if ident["jwt"]:
            headers["Authorization"] = f"Bearer {ident['jwt']}"
    elif mode == "header_map":
        header_name = (row.auth_header_name or "").strip()
        template = row.auth_value_template or "{preferred_username}"
        if header_name:
            try:
                value = template.format(**ident)
            except (KeyError, IndexError):
                # A template referencing an unknown field must not leak the raw template or 500;
                # fall back to the username.
                value = ident["preferred_username"]
            # Drop any inbound copy of the exact header we're setting (case-insensitive), then set it.
            headers = {k: v for k, v in headers.items() if k.lower() != header_name.lower()}
            headers[header_name] = value
    # mode == "none" or "oidc_federation": nothing injected — the app authenticates the user itself
    # (oidc_federation via its own OIDC login federated to the ai-trust realm). Identity already
    # stripped above, so anti-spoof still holds even if the app is embedded through the proxy.

    return headers
