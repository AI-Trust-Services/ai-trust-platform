"""E2E tests for GET /v1/stats (admin dashboard KPIs)."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from tests.e2e.conftest import _default_settings, _make_session


def _users_resp(total: int):
    r = MagicMock()
    r.status_code = 200
    r.json = MagicMock(return_value={"total": total})
    return r


def _roles_resp(built_in: list, custom: list):
    bi = MagicMock()
    bi.status_code = 200
    bi.json = MagicMock(return_value=built_in)
    cu = MagicMock()
    cu.status_code = 200
    cu.json = MagicMock(return_value=custom)
    return bi, cu


# ---------------------------------------------------------------------------
# GET /v1/stats
# ---------------------------------------------------------------------------

async def test_get_stats_returns_counts(client: httpx.AsyncClient):
    session = _make_session()
    bi, cu = _roles_resp(["r1", "r2"], ["r3"])

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=[_users_resp(5), bi, cu])

    with (
        patch("app.routers.stats.SessionLocal", return_value=session),
        patch("app.routers.stats.httpx.AsyncClient", return_value=mock_client),
    ):
        r = await client.get("/v1/stats")

    assert r.status_code == 200
    body = r.json()
    assert body["user_count"] == 5
    assert body["role_count"] == 3
    assert body["mail_configured"] is True


async def test_get_stats_mail_not_configured_when_no_smtp_host(client: httpx.AsyncClient):
    row = _default_settings()
    row.smtp_host = None
    session = _make_session(row)
    bi, cu = _roles_resp([], [])

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=[_users_resp(0), bi, cu])

    with (
        patch("app.routers.stats.SessionLocal", return_value=session),
        patch("app.routers.stats.httpx.AsyncClient", return_value=mock_client),
    ):
        r = await client.get("/v1/stats")

    assert r.status_code == 200
    assert r.json()["mail_configured"] is False


async def test_get_stats_mail_not_configured_when_no_settings_row(client: httpx.AsyncClient):
    session = _make_session(row=None)
    session.scalar = AsyncMock(return_value=None)
    bi, cu = _roles_resp([], [])

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=[_users_resp(0), bi, cu])

    with (
        patch("app.routers.stats.SessionLocal", return_value=session),
        patch("app.routers.stats.httpx.AsyncClient", return_value=mock_client),
    ):
        r = await client.get("/v1/stats")

    assert r.status_code == 200
    assert r.json()["mail_configured"] is False


async def test_get_stats_users_backend_failure_returns_zero(client: httpx.AsyncClient):
    session = _make_session()
    bi, cu = _roles_resp(["r1"], [])

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    # First call (users) raises, subsequent calls (roles) succeed
    mock_client.get = AsyncMock(side_effect=[Exception("connection refused"), bi, cu])

    with (
        patch("app.routers.stats.SessionLocal", return_value=session),
        patch("app.routers.stats.httpx.AsyncClient", return_value=mock_client),
    ):
        r = await client.get("/v1/stats")

    assert r.status_code == 200
    body = r.json()
    assert body["user_count"] == 0
    assert body["role_count"] == 1


async def test_get_stats_roles_backend_failure_returns_zero(client: httpx.AsyncClient):
    session = _make_session()

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    # Users call succeeds, roles call raises
    mock_client.get = AsyncMock(side_effect=[_users_resp(3), Exception("timeout")])

    with (
        patch("app.routers.stats.SessionLocal", return_value=session),
        patch("app.routers.stats.httpx.AsyncClient", return_value=mock_client),
    ):
        r = await client.get("/v1/stats")

    assert r.status_code == 200
    body = r.json()
    assert body["user_count"] == 3
    assert body["role_count"] == 0


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------

async def test_get_stats_requires_iam_manage(client: httpx.AsyncClient):
    from app.main import app
    from ai_trust_authorization.permissions import get_current_user

    app.dependency_overrides[get_current_user] = lambda: "unprivileged-user"
    try:
        with patch("ai_trust_authorization.openfga_client.check", new=AsyncMock(return_value=False)):
            r = await client.get("/v1/stats")
    finally:
        app.dependency_overrides[get_current_user] = lambda: "test-user"

    assert r.status_code == 403
