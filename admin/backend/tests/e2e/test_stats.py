"""E2E tests for GET /v1/stats (admin dashboard KPIs)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from tests.e2e.conftest import _default_settings, _make_session


def _internal_stats_resp(user_count: int, role_count: int):
    r = MagicMock()
    r.status_code = 200
    r.json = MagicMock(
        return_value={"user_count": user_count, "role_count": role_count}
    )
    return r


def _mock_http_client(resp):
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=resp)
    return mock_client


# ---------------------------------------------------------------------------
# GET /v1/stats
# ---------------------------------------------------------------------------


async def test_get_stats_returns_counts(client: httpx.AsyncClient):
    session = _make_session()
    mock_client = _mock_http_client(_internal_stats_resp(5, 3))

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


async def test_get_stats_mail_not_configured_when_no_smtp_host(
    client: httpx.AsyncClient,
):
    row = _default_settings()
    row.smtp_host = None
    session = _make_session(row)
    mock_client = _mock_http_client(_internal_stats_resp(0, 0))

    with (
        patch("app.routers.stats.SessionLocal", return_value=session),
        patch("app.routers.stats.httpx.AsyncClient", return_value=mock_client),
    ):
        r = await client.get("/v1/stats")

    assert r.status_code == 200
    assert r.json()["mail_configured"] is False


async def test_get_stats_mail_not_configured_when_no_settings_row(
    client: httpx.AsyncClient,
):
    session = _make_session(row=None)
    session.scalar = AsyncMock(return_value=None)
    mock_client = _mock_http_client(_internal_stats_resp(0, 0))

    with (
        patch("app.routers.stats.SessionLocal", return_value=session),
        patch("app.routers.stats.httpx.AsyncClient", return_value=mock_client),
    ):
        r = await client.get("/v1/stats")

    assert r.status_code == 200
    assert r.json()["mail_configured"] is False


async def test_get_stats_users_backend_failure_returns_zeros(client: httpx.AsyncClient):
    session = _make_session()

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=Exception("connection refused"))

    with (
        patch("app.routers.stats.SessionLocal", return_value=session),
        patch("app.routers.stats.httpx.AsyncClient", return_value=mock_client),
    ):
        r = await client.get("/v1/stats")

    assert r.status_code == 200
    body = r.json()
    assert body["user_count"] == 0
    assert body["role_count"] == 0


async def test_get_stats_calls_internal_endpoint_not_authed_routes(
    client: httpx.AsyncClient,
):
    """Verify the internal /stats endpoint is used, not the permission-gated user/roles routes."""
    session = _make_session()
    mock_client = _mock_http_client(_internal_stats_resp(2, 7))

    with (
        patch("app.routers.stats.SessionLocal", return_value=session),
        patch("app.routers.stats.httpx.AsyncClient", return_value=mock_client),
    ):
        await client.get("/v1/stats")

    call_url = mock_client.get.call_args[0][0]
    assert call_url.endswith("/internal/stats")
    assert "/v1/users" not in call_url
    assert "/v1/roles" not in call_url


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------


async def test_get_stats_requires_iam_manage(client: httpx.AsyncClient):
    from app.main import app
    from ai_trust_authorization.permissions import get_current_user

    app.dependency_overrides[get_current_user] = lambda: "unprivileged-user"
    try:
        with patch(
            "ai_trust_authorization.openfga_client.check",
            new=AsyncMock(return_value=False),
        ):
            r = await client.get("/v1/stats")
    finally:
        app.dependency_overrides[get_current_user] = lambda: "test-user"

    assert r.status_code == 403
