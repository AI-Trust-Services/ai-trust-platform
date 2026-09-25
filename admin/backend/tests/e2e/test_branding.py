"""E2E tests for branding API endpoints.

Tests the full HTTP contract against real Postgres. MinIO operations are patched.
Covers:
  - GET/PUT branding (draft/published modes)
  - Upload validation (asset_type, content_type, size)
  - Color validation (hex pattern, CSS injection prevention)
  - SVG sanitization (XSS prevention)
  - Publish/discard/reset workflows
  - Public endpoints (no auth)
  - Error paths (400/422)
"""
from __future__ import annotations

import pytest
from sqlalchemy import select, text

# ---------------------------------------------------------------------------
# GET /v1/branding
# ---------------------------------------------------------------------------


class TestGetBranding:
    """GET /v1/branding — returns published or draft branding."""

    @pytest.mark.asyncio
    async def test_returns_published_branding_by_default(self, client):
        resp = await client.get("/v1/branding")
        assert resp.status_code == 200
        data = resp.json()
        assert data["org_name"] == "AI Trust Platform"  # from platform_name
        assert data["primary_color"] is None  # no colors set yet

    @pytest.mark.asyncio
    async def test_returns_draft_branding_when_mode_draft(self, client, db_session):
        # Set up draft values directly in branding table
        await db_session.execute(
            text("INSERT INTO branding (key, published, draft) VALUES ('primary_color', NULL, '#FF0000')")
        )
        await db_session.commit()

        resp = await client.get("/v1/branding?mode=draft")
        assert resp.status_code == 200
        data = resp.json()
        # Draft falls back to published for org_name (derived from platform_name)
        assert data["org_name"] == "AI Trust Platform"
        # Draft color returned
        assert data["primary_color"] == "#FF0000"

    @pytest.mark.asyncio
    async def test_draft_mode_falls_back_to_published_when_draft_null(self, client, db_session):
        # Set only published value
        await db_session.execute(
            text("INSERT INTO branding (key, published, draft) VALUES ('primary_color', '#0000FF', NULL)")
        )
        await db_session.commit()

        resp = await client.get("/v1/branding?mode=draft")
        assert resp.status_code == 200
        data = resp.json()
        # Should fall back to published
        assert data["primary_color"] == "#0000FF"


# ---------------------------------------------------------------------------
# PUT /v1/branding
# ---------------------------------------------------------------------------


class TestUpdateBranding:
    """PUT /v1/branding — updates draft values."""

    @pytest.mark.asyncio
    async def test_updates_draft_color(self, client, db_session):
        resp = await client.put("/v1/branding", json={"primary_color": "#1147E9"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["primary_color"] == "#1147E9"

        # Verify persisted in DB
        from ai_trust_persistence.models.branding import Branding
        row = await db_session.get(Branding, "primary_color")
        assert row.draft == "#1147E9"
        assert row.published is None  # Published unchanged

    @pytest.mark.asyncio
    async def test_updates_multiple_colors(self, client):
        resp = await client.put("/v1/branding", json={
            "primary_color": "#1147E9",
            "secondary_color": "#7C3AED",
            "accent_color": "#10B981",
            "warning_color": "#F59E0B",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["primary_color"] == "#1147E9"
        assert data["secondary_color"] == "#7C3AED"
        assert data["accent_color"] == "#10B981"
        assert data["warning_color"] == "#F59E0B"

    @pytest.mark.asyncio
    async def test_updates_advanced_colors(self, client, db_session):
        resp = await client.put("/v1/branding", json={
            "advanced_colors": {
                "tier_prohibited": "#DC2626",
                "tier_high": "#F59E0B",
            }
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["advanced_colors"]["tier_prohibited"] == "#DC2626"
        assert data["advanced_colors"]["tier_high"] == "#F59E0B"

    @pytest.mark.asyncio
    async def test_rejects_invalid_hex_color(self, client):
        resp = await client.put("/v1/branding", json={"primary_color": "red"})
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert any("Invalid hex color" in str(e) for e in detail)

    @pytest.mark.asyncio
    async def test_rejects_css_injection_attempt(self, client):
        # Attempt to inject CSS via color value
        resp = await client.put("/v1/branding", json={
            "primary_color": "#000;background:url(evil.com)"
        })
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_rejects_invalid_advanced_color(self, client):
        resp = await client.put("/v1/branding", json={
            "advanced_colors": {"tier_prohibited": "not-a-color"}
        })
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_accepts_3_digit_hex_color(self, client):
        resp = await client.put("/v1/branding", json={"primary_color": "#F00"})
        assert resp.status_code == 200
        assert resp.json()["primary_color"] == "#F00"

    @pytest.mark.asyncio
    async def test_accepts_8_digit_hex_color_with_alpha(self, client):
        resp = await client.put("/v1/branding", json={"primary_color": "#1147E9CC"})
        assert resp.status_code == 200
        assert resp.json()["primary_color"] == "#1147E9CC"


# ---------------------------------------------------------------------------
# POST /v1/branding/upload/{asset_type}
# ---------------------------------------------------------------------------


class TestUploadLogo:
    """POST /v1/branding/upload/{asset_type} — upload validation."""

    @pytest.mark.asyncio
    async def test_upload_logo_success(self, client):
        # MinIO is mocked — this tests the route wiring and validation
        resp = await client.post(
            "/v1/branding/upload/logo_icon",
            files={"file": ("icon.svg", b"<svg></svg>", "image/svg+xml")},
        )
        assert resp.status_code == 200
        data = resp.json()
        # Draft logo key returned (from mocked upload_file)
        assert "logo_icon" in data

    @pytest.mark.asyncio
    async def test_rejects_invalid_asset_type(self, client):
        resp = await client.post(
            "/v1/branding/upload/invalid_type",
            files={"file": ("icon.svg", b"<svg></svg>", "image/svg+xml")},
        )
        assert resp.status_code == 400
        assert "Invalid asset type" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_rejects_invalid_content_type(self, client):
        resp = await client.post(
            "/v1/branding/upload/logo_icon",
            files={"file": ("script.js", b"alert(1)", "application/javascript")},
        )
        assert resp.status_code == 400
        assert "Invalid content type" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_rejects_oversized_file(self, client):
        # Create a file larger than MAX_FILE_SIZE (2MB)
        large_data = b"x" * (2 * 1024 * 1024 + 1)
        resp = await client.post(
            "/v1/branding/upload/logo_icon",
            files={"file": ("large.png", large_data, "image/png")},
        )
        assert resp.status_code == 400
        assert "too large" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_allowed_asset_types(self, client):
        # Test all valid asset types
        for asset_type in ["logo_horizontal_light", "logo_horizontal_dark", "logo_icon", "favicon"]:
            resp = await client.post(
                f"/v1/branding/upload/{asset_type}",
                files={"file": ("test.png", b"PNG", "image/png")},
            )
            assert resp.status_code == 200, f"Failed for {asset_type}"

    @pytest.mark.asyncio
    async def test_allowed_content_types(self, client):
        # Test various allowed content types
        test_cases = [
            ("test.svg", b"<svg></svg>", "image/svg+xml"),
            ("test.png", b"PNG", "image/png"),
            ("test.ico", b"ICO", "image/x-icon"),
            ("test.ico", b"ICO", "image/vnd.microsoft.icon"),
            ("test.jpg", b"JPG", "image/jpeg"),
        ]
        for filename, content, content_type in test_cases:
            resp = await client.post(
                "/v1/branding/upload/logo_icon",
                files={"file": (filename, content, content_type)},
            )
            assert resp.status_code == 200, f"Failed for {content_type}"


# ---------------------------------------------------------------------------
# SVG Sanitization (unit test of branding_storage.sanitize_svg)
# ---------------------------------------------------------------------------


class TestSvgSanitization:
    """Test SVG XSS prevention via sanitize_svg()."""

    def test_removes_script_tags(self):
        from app.branding_storage import sanitize_svg
        svg = b'<svg><script>alert("xss")</script><rect/></svg>'
        result = sanitize_svg(svg)
        assert b"script" not in result.lower()
        assert b"rect" in result

    def test_removes_event_handlers(self):
        from app.branding_storage import sanitize_svg
        svg = b'<svg><rect onclick="alert(1)" onload="evil()"/></svg>'
        result = sanitize_svg(svg)
        assert b"onclick" not in result
        assert b"onload" not in result

    def test_removes_javascript_uris(self):
        from app.branding_storage import sanitize_svg
        svg = b'<svg><a href="javascript:alert(1)"><rect/></a></svg>'
        result = sanitize_svg(svg)
        assert b"javascript:" not in result.lower()

    def test_preserves_safe_svg(self):
        from app.branding_storage import sanitize_svg
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#F00"/></svg>'
        result = sanitize_svg(svg)
        assert b"rect" in result
        assert b"width" in result
        assert b"fill" in result

    def test_rejects_invalid_svg(self):
        from app.branding_storage import sanitize_svg
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            sanitize_svg(b"not valid xml <><>")
        assert exc_info.value.status_code == 400
        assert "Invalid SVG" in exc_info.value.detail


# ---------------------------------------------------------------------------
# POST /v1/branding/publish
# ---------------------------------------------------------------------------


class TestPublishBranding:
    """POST /v1/branding/publish — copy draft to published."""

    @pytest.mark.asyncio
    async def test_publishes_draft_values(self, client, db_session):
        # Set up draft values in branding table
        await db_session.execute(
            text("INSERT INTO branding (key, published, draft) VALUES ('primary_color', NULL, '#1147E9')")
        )
        await db_session.execute(
            text("INSERT INTO branding (key, published, draft) VALUES ('secondary_color', NULL, '#7C3AED')")
        )
        await db_session.commit()

        resp = await client.post("/v1/branding/publish")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["published_by"] == "test-user"
        assert "published_at" in data

        # Verify published values in DB
        from ai_trust_persistence.models.branding import Branding
        row = await db_session.get(Branding, "primary_color")
        assert row.published == "#1147E9"
        # Draft cleared after publish
        assert row.draft is None

    @pytest.mark.asyncio
    async def test_publish_sets_metadata(self, client, db_session):
        await client.post("/v1/branding/publish")

        from ai_trust_persistence.models.branding import Branding
        row = await db_session.get(Branding, "_published_by")
        assert row.published == "test-user"
        row_at = await db_session.get(Branding, "_published_at")
        assert row_at.published is not None


# ---------------------------------------------------------------------------
# POST /v1/branding/discard
# ---------------------------------------------------------------------------


class TestDiscardBranding:
    """POST /v1/branding/discard — clear draft, keep published."""

    @pytest.mark.asyncio
    async def test_discards_draft_values(self, client, db_session):
        # Set up draft and published values
        await db_session.execute(
            text("INSERT INTO branding (key, published, draft) VALUES ('primary_color', '#0000FF', '#FF0000')")
        )
        await db_session.commit()

        resp = await client.post("/v1/branding/discard")
        assert resp.status_code == 200
        data = resp.json()
        # Returns published values (draft cleared)
        assert data["primary_color"] == "#0000FF"

        # Verify draft cleared in DB
        from ai_trust_persistence.models.branding import Branding
        row = await db_session.get(Branding, "primary_color")
        assert row.draft is None
        assert row.published == "#0000FF"  # Published unchanged


# ---------------------------------------------------------------------------
# POST /v1/branding/reset
# ---------------------------------------------------------------------------


class TestResetBranding:
    """POST /v1/branding/reset — clear all branding to defaults."""

    @pytest.mark.asyncio
    async def test_resets_all_branding(self, client, db_session):
        # Set up published values
        await db_session.execute(
            text("INSERT INTO branding (key, published, draft) VALUES ('primary_color', '#1147E9', NULL)")
        )
        await db_session.execute(
            text("INSERT INTO branding (key, published, draft) VALUES ('logo_icon', 'branding/logo_icon/icon.svg', NULL)")
        )
        await db_session.commit()

        resp = await client.post("/v1/branding/reset")
        assert resp.status_code == 200
        data = resp.json()
        # All values reset to null/default
        assert data["primary_color"] is None
        assert data["logo_icon"] is None

        # Verify DB cleared (rows deleted, not just nulled)
        from ai_trust_persistence.models.branding import Branding
        row = await db_session.get(Branding, "primary_color")
        assert row is None  # Row deleted

        # But metadata preserved
        row_by = await db_session.get(Branding, "_published_by")
        assert row_by.published == "test-user"


# ---------------------------------------------------------------------------
# GET /v1/branding/status
# ---------------------------------------------------------------------------


class TestBrandingStatus:
    """GET /v1/branding/status — check for unpublished changes."""

    @pytest.mark.asyncio
    async def test_no_unpublished_changes(self, client):
        resp = await client.get("/v1/branding/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_unpublished_changes"] is False

    @pytest.mark.asyncio
    async def test_has_unpublished_changes(self, client, db_session):
        await db_session.execute(
            text("INSERT INTO branding (key, published, draft) VALUES ('primary_color', NULL, '#FF0000')")
        )
        await db_session.commit()

        resp = await client.get("/v1/branding/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_unpublished_changes"] is True

    @pytest.mark.asyncio
    async def test_draft_same_as_published_is_not_unpublished(self, client, db_session):
        # If draft equals published, it's not considered "unpublished"
        await db_session.execute(
            text("INSERT INTO branding (key, published, draft) VALUES ('primary_color', '#FF0000', '#FF0000')")
        )
        await db_session.commit()

        resp = await client.get("/v1/branding/status")
        assert resp.status_code == 200
        # When draft == published, there's no "change" to publish
        data = resp.json()
        assert data["has_unpublished_changes"] is False


# ---------------------------------------------------------------------------
# GET /v1/branding/public
# ---------------------------------------------------------------------------


class TestPublicBranding:
    """GET /v1/branding/public — no auth required."""

    @pytest.mark.asyncio
    async def test_returns_published_branding(self, client, db_session):
        await db_session.execute(
            text("INSERT INTO branding (key, published, draft) VALUES ('primary_color', '#1147E9', NULL)")
        )
        await db_session.commit()

        resp = await client.get("/v1/branding/public")
        assert resp.status_code == 200
        data = resp.json()
        assert data["primary_color"] == "#1147E9"

    @pytest.mark.asyncio
    async def test_does_not_return_draft_values(self, client, db_session):
        await db_session.execute(
            text("INSERT INTO branding (key, published, draft) VALUES ('primary_color', '#0000FF', '#FF0000')")
        )
        await db_session.commit()

        resp = await client.get("/v1/branding/public")
        assert resp.status_code == 200
        data = resp.json()
        # Only published, not draft
        assert data["primary_color"] == "#0000FF"


# ---------------------------------------------------------------------------
# GET /v1/branding/public/asset/{key}
# ---------------------------------------------------------------------------


class TestPublicAsset:
    """GET /v1/branding/public/asset/{key} — serve logo binary."""

    @pytest.mark.asyncio
    async def test_returns_asset(self, client):
        # MinIO get_file is mocked to return (b"<svg></svg>", "image/svg+xml")
        resp = await client.get("/v1/branding/public/asset/branding/logo_icon/icon.svg")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/svg+xml"
        assert b"<svg>" in resp.content or b"svg" in resp.content


# ---------------------------------------------------------------------------
# GET /v1/branding/asset/{key} (authenticated)
# ---------------------------------------------------------------------------


class TestAuthenticatedAsset:
    """GET /v1/branding/asset/{key} — requires iam:manage."""

    @pytest.mark.asyncio
    async def test_returns_asset_when_authorized(self, client):
        resp = await client.get("/v1/branding/asset/branding/logo_icon/icon.svg")
        assert resp.status_code == 200
        assert "cache-control" in resp.headers
