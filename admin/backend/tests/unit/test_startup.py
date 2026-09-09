"""Unit tests for the startup seed logic."""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


async def test_seed_inserts_row_when_none_exists():
    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    session.scalar = AsyncMock(return_value=None)
    session.add = MagicMock()
    session.commit = AsyncMock()

    with patch("app.startup.SessionLocal", return_value=session):
        from app.startup import seed_settings_from_env
        await seed_settings_from_env()

    session.add.assert_called_once()
    session.commit.assert_awaited_once()
    inserted = session.add.call_args[0][0]
    assert inserted.id == 1


async def test_seed_skips_when_row_already_exists():
    existing = MagicMock()
    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    session.scalar = AsyncMock(return_value=existing)
    session.add = MagicMock()
    session.commit = AsyncMock()

    with patch("app.startup.SessionLocal", return_value=session):
        from app.startup import seed_settings_from_env
        await seed_settings_from_env()

    session.add.assert_not_called()
    session.commit.assert_not_awaited()


async def test_seed_reads_smtp_env_vars(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.test.com")
    monkeypatch.setenv("SMTP_PORT", "465")
    monkeypatch.setenv("SMTP_FROM", "from@test.com")
    monkeypatch.setenv("SMTP_SSL", "true")
    monkeypatch.setenv("SMTP_STARTTLS", "false")

    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    session.scalar = AsyncMock(return_value=None)
    session.add = MagicMock()
    session.commit = AsyncMock()

    import importlib
    import app.startup as startup_mod
    importlib.reload(startup_mod)

    with patch("app.startup.SessionLocal", return_value=session):
        await startup_mod.seed_settings_from_env()

    inserted = session.add.call_args[0][0]
    assert inserted.smtp_host == "smtp.test.com"
    assert inserted.smtp_port == 465
    assert inserted.smtp_from == "from@test.com"
    assert inserted.smtp_ssl is True
    assert inserted.smtp_starttls is False


async def test_seed_handles_missing_smtp_port_gracefully(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.test.com")
    monkeypatch.setenv("SMTP_PORT", "")

    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    session.scalar = AsyncMock(return_value=None)
    session.add = MagicMock()
    session.commit = AsyncMock()

    import importlib
    import app.startup as startup_mod
    importlib.reload(startup_mod)

    with patch("app.startup.SessionLocal", return_value=session):
        await startup_mod.seed_settings_from_env()

    inserted = session.add.call_args[0][0]
    assert inserted.smtp_port is None
