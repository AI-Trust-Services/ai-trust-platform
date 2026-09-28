"""Unit tests for _compute_allowed_categories."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.routers.alerts import _compute_allowed_categories


def _fga_roles(*slugs: str):
    return [f"role:{s}" for s in slugs]


def _custom_role(name: str, cats: list[str] | None):
    row = MagicMock()
    row.name = name
    row.alert_categories = cats
    return row


async def _mock_session(rows: list):
    ctx = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    ctx.__aenter__.return_value.execute = AsyncMock(return_value=result)
    return ctx


@pytest.mark.asyncio
async def test_platform_administrator_returns_none():
    with patch("app.routers.alerts.fga.read_user_roles", return_value=_fga_roles("platform_administrator")):
        assert await _compute_allowed_categories("alice") is None


@pytest.mark.asyncio
async def test_ai_engineer_returns_observability():
    with patch("app.routers.alerts.fga.read_user_roles", return_value=_fga_roles("ai_engineer")):
        result = await _compute_allowed_categories("alice")
    assert result == ["observability"]


@pytest.mark.asyncio
async def test_mixed_builtin_roles_returns_union():
    with patch("app.routers.alerts.fga.read_user_roles", return_value=_fga_roles("ai_engineer", "business_owner")):
        result = await _compute_allowed_categories("alice")
    assert result is not None
    assert set(result) == {"observability", "risk", "compliance"}


@pytest.mark.asyncio
async def test_custom_role_with_categories():
    rows = [_custom_role("Risk Reviewer", ["risk"])]
    session_ctx = await _mock_session(rows)
    with (
        patch("app.routers.alerts.fga.read_user_roles", return_value=_fga_roles("risk_reviewer")),
        patch("app.routers.alerts.SessionLocal", return_value=session_ctx),
    ):
        result = await _compute_allowed_categories("alice")
    assert result == ["risk"]


@pytest.mark.asyncio
async def test_custom_role_with_empty_categories_returns_empty_list():
    rows = [_custom_role("Restricted Role", [])]
    session_ctx = await _mock_session(rows)
    with (
        patch("app.routers.alerts.fga.read_user_roles", return_value=_fga_roles("restricted_role")),
        patch("app.routers.alerts.SessionLocal", return_value=session_ctx),
    ):
        result = await _compute_allowed_categories("alice")
    assert result == []


@pytest.mark.asyncio
async def test_custom_role_with_none_categories_returns_none():
    rows = [_custom_role("Super Viewer", None)]
    session_ctx = await _mock_session(rows)
    with (
        patch("app.routers.alerts.fga.read_user_roles", return_value=_fga_roles("super_viewer")),
        patch("app.routers.alerts.SessionLocal", return_value=session_ctx),
    ):
        result = await _compute_allowed_categories("alice")
    assert result is None


@pytest.mark.asyncio
async def test_one_none_role_among_restricted_roles_returns_none():
    rows = [_custom_role("Super Viewer", None)]
    session_ctx = await _mock_session(rows)
    with (
        patch("app.routers.alerts.fga.read_user_roles", return_value=_fga_roles("ai_engineer", "super_viewer")),
        patch("app.routers.alerts.SessionLocal", return_value=session_ctx),
    ):
        result = await _compute_allowed_categories("alice")
    assert result is None


@pytest.mark.asyncio
async def test_no_roles_returns_none():
    with patch("app.routers.alerts.fga.read_user_roles", return_value=[]):
        assert await _compute_allowed_categories("alice") is None
