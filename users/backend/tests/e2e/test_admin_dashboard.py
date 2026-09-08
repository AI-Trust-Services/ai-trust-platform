"""E2E tests for GET /admin/dashboard and GET /admin/dashboard/activity."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest


def _setting_stub(key: str, value=None, category: str = "mail",
                  label: str = "label", description: str = "",
                  value_type: str = "string", is_secret: bool = False,
                  updated_at=None, updated_by: str | None = None) -> MagicMock:
    s = MagicMock()
    s.key = key
    s.value = value
    s.category = category
    s.label = label
    s.description = description
    s.value_type = value_type
    s.is_secret = is_secret
    s.updated_at = updated_at
    s.updated_by = updated_by
    return s


def _patch_session(scalars_list=None, scalar_value=0):
    """Patch SessionLocal used by admin_dashboard router."""
    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)

    result = MagicMock()
    result.scalars.return_value.all.return_value = scalars_list or []
    result.scalar.return_value = scalar_value
    session.execute = AsyncMock(return_value=result)

    return patch("app.routers.admin_dashboard.SessionLocal", return_value=session)


# ---------------------------------------------------------------------------
# GET /admin/dashboard
# ---------------------------------------------------------------------------

async def test_dashboard_returns_expected_shape(client: httpx.AsyncClient):
    with (
        _patch_session(),
        patch("app.routers.admin_dashboard._count_users_from_keycloak", return_value=3),
        patch("app.routers.admin_dashboard.get_smtp_config", return_value={}),
        patch("app.routers.admin_dashboard.get_llm_config", return_value={"provider": "stub"}),
    ):
        r = await client.get("/v1/admin/dashboard")

    assert r.status_code == 200
    body = r.json()
    assert "kpis" in body
    assert "configuration_status" in body
    kpis = body["kpis"]
    assert kpis["user_count"] == 3
    assert isinstance(kpis["role_count"], int)
    assert kpis["role_count"] > 0  # at least the built-in roles
    assert kpis["mail_status"] == "not_configured"


async def test_dashboard_mail_connected_when_smtp_configured(client: httpx.AsyncClient):
    smtp = {"host": "smtp.example.com", "from": "noreply@example.com"}
    with (
        _patch_session(),
        patch("app.routers.admin_dashboard._count_users_from_keycloak", return_value=1),
        patch("app.routers.admin_dashboard.get_smtp_config", return_value=smtp),
        patch("app.routers.admin_dashboard.get_llm_config", return_value={"provider": "stub"}),
    ):
        r = await client.get("/v1/admin/dashboard")

    assert r.status_code == 200
    assert r.json()["kpis"]["mail_status"] == "connected"


async def test_dashboard_configuration_status_list(client: httpx.AsyncClient):
    with (
        _patch_session(),
        patch("app.routers.admin_dashboard._count_users_from_keycloak", return_value=0),
        patch("app.routers.admin_dashboard.get_smtp_config", return_value={}),
        patch("app.routers.admin_dashboard.get_llm_config", return_value={"provider": "stub"}),
    ):
        r = await client.get("/v1/admin/dashboard")

    statuses = r.json()["configuration_status"]
    assert isinstance(statuses, list)
    assert len(statuses) >= 1
    for s in statuses:
        assert "key" in s
        assert "status" in s


# ---------------------------------------------------------------------------
# GET /admin/dashboard/activity
# ---------------------------------------------------------------------------

async def test_activity_returns_empty_when_no_updates(client: httpx.AsyncClient):
    with _patch_session(scalars_list=[]):
        r = await client.get("/v1/admin/dashboard/activity")

    assert r.status_code == 200
    assert r.json()["activities"] == []


async def test_activity_includes_updated_settings(client: httpx.AsyncClient):
    setting = _setting_stub(
        key="mail.host",
        value="smtp.example.com",
        updated_by="admin",
        updated_at=datetime(2024, 6, 1, tzinfo=timezone.utc),
    )
    with _patch_session(scalars_list=[setting]):
        r = await client.get("/v1/admin/dashboard/activity")

    assert r.status_code == 200
    activities = r.json()["activities"]
    assert len(activities) == 1
    assert activities[0]["action"] == "setting_updated"
    assert activities[0]["actor"] == "admin"
