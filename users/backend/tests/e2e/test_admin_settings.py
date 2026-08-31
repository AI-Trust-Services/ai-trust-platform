"""E2E tests for admin settings CRUD — /admin/settings/*."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx


def _setting_stub(
    key: str = "mail.host",
    value: str | None = "smtp.example.com",
    category: str = "mail",
    label: str = "SMTP Host",
    description: str = "SMTP server hostname",
    value_type: str = "string",
    is_secret: bool = False,
    updated_at=None,
    updated_by: str | None = None,
) -> MagicMock:
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


def _patch_session(scalars_list=None, scalar_one=None):
    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.flush = AsyncMock()
    session.refresh = AsyncMock()

    result = MagicMock()
    result.scalars.return_value.all.return_value = scalars_list or []
    result.scalar_one_or_none.return_value = scalar_one
    session.execute = AsyncMock(return_value=result)

    return patch("app.routers.settings.SessionLocal", return_value=session), session


# ---------------------------------------------------------------------------
# GET /admin/settings — list all
# ---------------------------------------------------------------------------

async def test_list_settings_returns_grouped_by_category(client: httpx.AsyncClient):
    settings = [
        _setting_stub("mail.host", category="mail"),
        _setting_stub("mail.port", value="587", category="mail"),
        _setting_stub("ai.provider", value="stub", category="ai"),
    ]
    ctx, _ = _patch_session(scalars_list=settings)
    with ctx:
        r = await client.get("/v1/admin/settings")

    assert r.status_code == 200
    groups = r.json()
    categories = [g["category"] for g in groups]
    assert "mail" in categories
    assert "ai" in categories


async def test_list_settings_masks_secrets(client: httpx.AsyncClient):
    secret = _setting_stub("mail.password", value="s3cr3t", is_secret=True, category="mail")
    ctx, _ = _patch_session(scalars_list=[secret])
    with ctx:
        r = await client.get("/v1/admin/settings")

    groups = r.json()
    mail_group = next(g for g in groups if g["category"] == "mail")
    pw_setting = next(s for s in mail_group["settings"] if s["key"] == "mail.password")
    assert pw_setting["value"] == "••••••••"


# ---------------------------------------------------------------------------
# GET /admin/settings/{key} — single
# ---------------------------------------------------------------------------

async def test_get_setting_by_key(client: httpx.AsyncClient):
    s = _setting_stub("mail.host", value="smtp.example.com")
    ctx, _ = _patch_session(scalar_one=s)
    with ctx:
        r = await client.get("/v1/admin/settings/mail.host")

    assert r.status_code == 200
    assert r.json()["key"] == "mail.host"
    assert r.json()["value"] == "smtp.example.com"


async def test_get_setting_not_found(client: httpx.AsyncClient):
    ctx, _ = _patch_session(scalar_one=None)
    with ctx:
        r = await client.get("/v1/admin/settings/nonexistent.key")

    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /admin/settings/{key} — update
# ---------------------------------------------------------------------------

async def test_update_setting(client: httpx.AsyncClient):
    s = _setting_stub("mail.host", value="old.host.com")
    ctx, session = _patch_session(scalar_one=s)

    def _refresh_side_effect(obj):
        # simulate set_setting updating the value
        obj.value = "new.host.com"

    session.refresh.side_effect = _refresh_side_effect

    with ctx:
        with patch(
            "app.routers.settings.set_setting",
            return_value=_setting_stub("mail.host", value="new.host.com"),
        ):
            r = await client.put(
                "/v1/admin/settings/mail.host",
                json={"value": "new.host.com"},
                headers={"x-forwarded-preferred-username": "admin"},
            )

    assert r.status_code == 200
    assert r.json()["key"] == "mail.host"


async def test_update_setting_not_found(client: httpx.AsyncClient):
    ctx, _ = _patch_session(scalar_one=None)
    with ctx:
        r = await client.put(
            "/v1/admin/settings/nonexistent.key",
            json={"value": "x"},
        )

    assert r.status_code == 404


# ---------------------------------------------------------------------------
# POST /admin/settings/bulk
# ---------------------------------------------------------------------------

async def test_bulk_update_settings(client: httpx.AsyncClient):
    updated = [
        _setting_stub("mail.host", value="smtp.new.com"),
        _setting_stub("mail.port", value="465"),
    ]
    ctx, _ = _patch_session()
    with ctx:
        with patch("app.routers.settings.bulk_set_settings", return_value=updated):
            r = await client.post(
                "/v1/admin/settings/bulk",
                json={"settings": {"mail.host": "smtp.new.com", "mail.port": "465"}},
            )

    assert r.status_code == 200
    keys = [s["key"] for s in r.json()]
    assert "mail.host" in keys
    assert "mail.port" in keys


# ---------------------------------------------------------------------------
# POST /admin/settings/test-smtp — not configured path
# ---------------------------------------------------------------------------

async def test_smtp_test_returns_failure_when_not_configured(client: httpx.AsyncClient):
    ctx, _ = _patch_session()
    with ctx:
        with patch("app.routers.settings.get_smtp_config", return_value={}):
            r = await client.post(
                "/v1/admin/settings/test-smtp",
                json={"recipient_email": "test@example.com"},
            )

    assert r.status_code == 200
    body = r.json()
    assert body["success"] is False
    assert "not configured" in body["message"].lower()
