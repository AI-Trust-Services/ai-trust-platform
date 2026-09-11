"""E2E tests for admin general settings endpoints."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from tests.e2e.conftest import _default_settings, _make_session


# ---------------------------------------------------------------------------
# GET /v1/settings
# ---------------------------------------------------------------------------

async def test_get_settings_returns_platform_name(client: httpx.AsyncClient):
    session = _make_session()
    with patch("app.routers.settings.SessionLocal", return_value=session):
        r = await client.get("/v1/settings")
    assert r.status_code == 200
    body = r.json()
    assert body["platform_name"] == "AI Trust Platform"
    assert body["support_email"] == "support@example.com"


async def test_get_settings_support_email_null(client: httpx.AsyncClient):
    row = _default_settings()
    row.support_email = None
    session = _make_session(row)
    with patch("app.routers.settings.SessionLocal", return_value=session):
        r = await client.get("/v1/settings")
    assert r.status_code == 200
    assert r.json()["support_email"] is None


async def test_get_settings_503_when_no_row(client: httpx.AsyncClient):
    session = _make_session(row=None)
    session.scalar = AsyncMock(return_value=None)
    with patch("app.routers.settings.SessionLocal", return_value=session):
        r = await client.get("/v1/settings")
    assert r.status_code == 503


# ---------------------------------------------------------------------------
# PUT /v1/settings
# ---------------------------------------------------------------------------

async def test_put_settings_updates_platform_name(client: httpx.AsyncClient):
    row = _default_settings()
    session = _make_session(row)

    with patch("app.routers.settings.SessionLocal", return_value=session):
        r = await client.put("/v1/settings", json={
            "platform_name": "My Custom Platform",
            "support_email": "help@myplatform.com",
        })

    assert r.status_code == 200
    assert row.platform_name == "My Custom Platform"
    assert row.support_email == "help@myplatform.com"
    session.commit.assert_awaited_once()


async def test_put_settings_clears_support_email(client: httpx.AsyncClient):
    row = _default_settings()
    session = _make_session(row)

    with patch("app.routers.settings.SessionLocal", return_value=session):
        r = await client.put("/v1/settings", json={
            "platform_name": "AI Trust Platform",
            "support_email": "",
        })

    assert r.status_code == 200
    assert row.support_email is None


async def test_put_settings_partial_update_preserves_unset(client: httpx.AsyncClient):
    row = _default_settings()
    original_email = row.support_email
    session = _make_session(row)

    with patch("app.routers.settings.SessionLocal", return_value=session):
        r = await client.put("/v1/settings", json={"platform_name": "Updated"})

    assert r.status_code == 200
    assert row.platform_name == "Updated"
    assert row.support_email == original_email


async def test_put_settings_503_when_no_row(client: httpx.AsyncClient):
    session = _make_session(row=None)
    session.scalar = AsyncMock(return_value=None)
    with patch("app.routers.settings.SessionLocal", return_value=session):
        r = await client.put("/v1/settings", json={"platform_name": "x"})
    assert r.status_code == 503


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------

async def test_endpoints_require_iam_manage(client: httpx.AsyncClient):
    """When OpenFGA returns False, all endpoints must return 403."""
    from app.main import app
    from ai_trust_authorization.permissions import get_current_user

    app.dependency_overrides[get_current_user] = lambda: "unprivileged-user"
    try:
        with patch("ai_trust_authorization.openfga_client.check", new=AsyncMock(return_value=False)):
            r_get_smtp = await client.get("/v1/smtp")
            r_put_smtp = await client.put("/v1/smtp", json={
                "smtp_host": None, "smtp_port": None, "smtp_user": None,
                "smtp_from": None, "smtp_from_name": None,
                "smtp_ssl": False, "smtp_starttls": False,
            })
            r_test_smtp = await client.post("/v1/smtp/test", json={"to": "x@x.com"})
            r_get_settings = await client.get("/v1/settings")
            r_put_settings = await client.put("/v1/settings", json={"platform_name": "x"})
    finally:
        from ai_trust_authorization.permissions import get_current_user as gcu
        app.dependency_overrides[gcu] = lambda: "test-user"

    assert r_get_smtp.status_code == 403
    assert r_put_smtp.status_code == 403
    assert r_test_smtp.status_code == 403
    assert r_get_settings.status_code == 403
    assert r_put_settings.status_code == 403
