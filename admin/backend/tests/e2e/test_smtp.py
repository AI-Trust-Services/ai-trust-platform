"""E2E tests for admin SMTP endpoints."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from tests.e2e.conftest import _default_settings, _make_session


# ---------------------------------------------------------------------------
# GET /v1/smtp
# ---------------------------------------------------------------------------

async def test_get_smtp_returns_settings(client: httpx.AsyncClient):
    session = _make_session()
    with patch("app.routers.smtp.SessionLocal", return_value=session):
        r = await client.get("/v1/smtp")
    assert r.status_code == 200
    body = r.json()
    assert body["smtp_host"] == "mailpit"
    assert body["smtp_port"] == 1025
    assert body["smtp_from"] == "noreply@ai-trust.local"
    assert body["smtp_ssl"] is False
    assert body["smtp_starttls"] is False


async def test_get_smtp_masks_password(client: httpx.AsyncClient):
    session = _make_session()
    with patch("app.routers.smtp.SessionLocal", return_value=session):
        r = await client.get("/v1/smtp")
    body = r.json()
    assert "smtp_password" not in body
    assert body["has_password"] is True


async def test_get_smtp_has_password_false_when_no_password(client: httpx.AsyncClient):
    row = _default_settings()
    row.smtp_password = None
    session = _make_session(row)
    with patch("app.routers.smtp.SessionLocal", return_value=session):
        r = await client.get("/v1/smtp")
    assert r.json()["has_password"] is False


async def test_get_smtp_503_when_no_settings_row(client: httpx.AsyncClient):
    session = _make_session(row=None)
    session.scalar = AsyncMock(return_value=None)
    with patch("app.routers.smtp.SessionLocal", return_value=session):
        r = await client.get("/v1/smtp")
    assert r.status_code == 503


# ---------------------------------------------------------------------------
# PUT /v1/smtp
# ---------------------------------------------------------------------------

async def test_put_smtp_updates_fields(client: httpx.AsyncClient):
    row = _default_settings()
    session = _make_session(row)
    session.refresh = AsyncMock(side_effect=lambda r: None)

    with patch("app.routers.smtp.SessionLocal", return_value=session):
        r = await client.put("/v1/smtp", json={
            "smtp_host": "smtp.new.com",
            "smtp_port": 465,
            "smtp_user": "user@new.com",
            "smtp_password": "newpassword",
            "smtp_from": "from@new.com",
            "smtp_from_name": "New Name",
            "smtp_ssl": True,
            "smtp_starttls": False,
        })

    assert r.status_code == 200
    assert row.smtp_host == "smtp.new.com"
    assert row.smtp_port == 465
    assert row.smtp_ssl is True
    assert row.smtp_password == "newpassword"
    session.commit.assert_awaited_once()


async def test_put_smtp_preserves_password_when_not_provided(client: httpx.AsyncClient):
    row = _default_settings()
    original_password = row.smtp_password
    session = _make_session(row)

    with patch("app.routers.smtp.SessionLocal", return_value=session):
        r = await client.put("/v1/smtp", json={
            "smtp_host": "smtp.example.com",
            "smtp_port": 587,
            "smtp_user": None,
            "smtp_from": "noreply@example.com",
            "smtp_from_name": None,
            "smtp_ssl": False,
            "smtp_starttls": True,
        })

    assert r.status_code == 200
    assert row.smtp_password == original_password


async def test_put_smtp_503_when_no_settings_row(client: httpx.AsyncClient):
    session = _make_session(row=None)
    session.scalar = AsyncMock(return_value=None)
    with patch("app.routers.smtp.SessionLocal", return_value=session):
        r = await client.put("/v1/smtp", json={
            "smtp_host": "x", "smtp_port": 587, "smtp_user": None,
            "smtp_from": None, "smtp_from_name": None,
            "smtp_ssl": False, "smtp_starttls": False,
        })
    assert r.status_code == 503


# ---------------------------------------------------------------------------
# POST /v1/smtp/test
# ---------------------------------------------------------------------------

async def test_smtp_test_returns_success(client: httpx.AsyncClient):
    session = _make_session()
    with (
        patch("app.routers.smtp.SessionLocal", return_value=session),
        patch("app.routers.smtp.aiosmtplib.send", new=AsyncMock()),
    ):
        r = await client.post("/v1/smtp/test", json={"to": "admin@local.dev"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert "admin@local.dev" in body["message"]


async def test_smtp_test_auth_error_returns_descriptive_message(client: httpx.AsyncClient):
    import aiosmtplib
    session = _make_session()
    with (
        patch("app.routers.smtp.SessionLocal", return_value=session),
        patch("app.routers.smtp.aiosmtplib.send",
              new=AsyncMock(side_effect=aiosmtplib.SMTPAuthenticationError(535, "Auth failed"))),
    ):
        r = await client.post("/v1/smtp/test", json={"to": "admin@local.dev"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is False
    assert "Authentication failed" in body["message"]


async def test_smtp_test_connect_error_returns_descriptive_message(client: httpx.AsyncClient):
    import aiosmtplib
    session = _make_session()
    with (
        patch("app.routers.smtp.SessionLocal", return_value=session),
        patch("app.routers.smtp.aiosmtplib.send",
              new=AsyncMock(side_effect=aiosmtplib.SMTPConnectError("refused"))),
    ):
        r = await client.post("/v1/smtp/test", json={"to": "admin@local.dev"})
    assert r.status_code == 200
    assert r.json()["success"] is False
    assert "Connection refused" in r.json()["message"]


async def test_smtp_test_no_host_configured_returns_error(client: httpx.AsyncClient):
    row = _default_settings()
    row.smtp_host = None
    session = _make_session(row)
    with patch("app.routers.smtp.SessionLocal", return_value=session):
        r = await client.post("/v1/smtp/test", json={"to": "admin@local.dev"})
    assert r.status_code == 200
    assert r.json()["success"] is False
    assert "SMTP host" in r.json()["message"]


async def test_smtp_test_invalid_email_rejected(client: httpx.AsyncClient):
    r = await client.post("/v1/smtp/test", json={"to": "not-an-email"})
    assert r.status_code == 422


async def test_smtp_test_timeout_returns_descriptive_message(client: httpx.AsyncClient):
    session = _make_session()
    with (
        patch("app.routers.smtp.SessionLocal", return_value=session),
        patch("app.routers.smtp.aiosmtplib.send",
              new=AsyncMock(side_effect=TimeoutError("timed out"))),
    ):
        r = await client.post("/v1/smtp/test", json={"to": "admin@local.dev"})
    assert r.status_code == 200
    assert r.json()["success"] is False
    assert "timed out" in r.json()["message"].lower() or "unreachable" in r.json()["message"].lower()
