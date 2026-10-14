"""Scenario 0 — Authentication.

A user authenticates via Keycloak OIDC → oauth2-proxy issues a session cookie → the shell is
reachable through port 8080. Proven black-box: the ``engineer`` fixture performs a real
authorization-code login (see conftest.login), so a successful authenticated request IS the proof.
The negative test confirms the auth gate is real — an unauthenticated request is refused.
"""

from __future__ import annotations

import httpx


async def test_oidc_login_grants_session(engineer):
    """A persona that logged in via real OIDC can reach the shell and a backend through :8080."""
    # Shell entry page — served by nginx behind oauth2-proxy once the session cookie is valid.
    r = await engineer.get("/")
    assert r.status_code == 200, f"shell / not reachable after login: {r.status_code}"
    assert "text/html" in r.headers.get("content-type", ""), (
        f"shell / did not return HTML: {r.headers.get('content-type')!r}"
    )

    # A backend reached through the shell proxy (health is mounted at the backend root → /api/registry/health).
    h = await engineer.get("/api/registry/health")
    assert h.status_code == 200, f"registry health through proxy failed: {h.status_code} {h.text[:200]}"


async def test_unauthenticated_request_is_blocked(app_url):
    """Without a session cookie, a protected API call through :8080 is refused (no header bypass)."""
    async with httpx.AsyncClient(base_url=app_url, follow_redirects=False, timeout=15) as anon:
        r = await anon.get("/api/registry/v1/systems")
    assert r.status_code in (302, 401, 403), (
        f"expected the oauth2-proxy auth gate (302/401/403), got {r.status_code}"
    )
