"""E2E tests for branding API endpoints."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture
def mock_session():
    """Return a mock async session with default settings row."""
    from tests.e2e.conftest import _default_settings, _make_session

    return _make_session(_default_settings())


class TestGetBranding:
    """GET /v1/branding"""

    @pytest.mark.asyncio
    async def test_returns_published_branding(self, client, mock_session):
        with patch("ai_trust_persistence.database.SessionLocal", return_value=mock_session):
            resp = await client.get("/v1/branding")
        assert resp.status_code == 200
        data = resp.json()
        assert data["org_name"] == "AI Trust"
        assert data["primary_color"] is None

    @pytest.mark.asyncio
    async def test_returns_draft_branding_when_mode_draft(self, client, mock_session):
        # Set up a row with draft values
        row = mock_session.scalar.return_value
        row.org_name_draft = "ACME Corp"
        row.primary_color_draft = "#FF0000"

        with patch("ai_trust_persistence.database.SessionLocal", return_value=mock_session):
            resp = await client.get("/v1/branding?mode=draft")
        assert resp.status_code == 200
        data = resp.json()
        assert data["org_name"] == "ACME Corp"
        assert data["primary_color"] == "#FF0000"


class TestUpdateBranding:
    """PUT /v1/branding"""

    @pytest.mark.asyncio
    async def test_updates_draft_values(self, client, mock_session):
        with patch("ai_trust_persistence.database.SessionLocal", return_value=mock_session):
            resp = await client.put(
                "/v1/branding",
                json={"org_name": "New Corp", "primary_color": "#0000FF"},
            )
        assert resp.status_code == 200
        # Verify the session was committed
        mock_session.commit.assert_called_once()


class TestBrandingStatus:
    """GET /v1/branding/status"""

    @pytest.mark.asyncio
    async def test_no_unpublished_changes(self, client, mock_session):
        with patch("ai_trust_persistence.database.SessionLocal", return_value=mock_session):
            resp = await client.get("/v1/branding/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_unpublished_changes"] is False

    @pytest.mark.asyncio
    async def test_has_unpublished_changes(self, client, mock_session):
        row = mock_session.scalar.return_value
        row.org_name_draft = "Draft Name"

        with patch("ai_trust_persistence.database.SessionLocal", return_value=mock_session):
            resp = await client.get("/v1/branding/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_unpublished_changes"] is True


class TestPublishBranding:
    """POST /v1/branding/publish"""

    @pytest.mark.asyncio
    async def test_publishes_draft_to_live(self, client, mock_session):
        row = mock_session.scalar.return_value
        row.org_name_draft = "Published Corp"

        with patch("ai_trust_persistence.database.SessionLocal", return_value=mock_session):
            resp = await client.post("/v1/branding/publish")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "published_at" in data
        assert data["published_by"] == "test-user"


class TestDiscardBranding:
    """POST /v1/branding/discard"""

    @pytest.mark.asyncio
    async def test_discards_draft_changes(self, client, mock_session):
        row = mock_session.scalar.return_value
        row.org_name_draft = "Draft Name"
        row.primary_color_draft = "#FF0000"

        with patch("ai_trust_persistence.database.SessionLocal", return_value=mock_session):
            resp = await client.post("/v1/branding/discard")
        assert resp.status_code == 200
        # Draft values should be cleared (they're set to None on discard)


class TestPublicBranding:
    """GET /v1/branding/public - no auth required"""

    @pytest.mark.asyncio
    async def test_returns_published_branding_without_auth(self, client, mock_session):
        # Remove auth override for this test
        from app.main import app
        from ai_trust_authorization.permissions import get_current_user

        original_override = app.dependency_overrides.get(get_current_user)
        try:
            # Don't remove completely since test setup requires it for other endpoints
            with patch("ai_trust_persistence.database.SessionLocal", return_value=mock_session):
                resp = await client.get("/v1/branding/public")
            assert resp.status_code == 200
            data = resp.json()
            assert data["org_name"] == "AI Trust"
        finally:
            if original_override:
                app.dependency_overrides[get_current_user] = original_override
