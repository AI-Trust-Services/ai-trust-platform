"""Unit tests for AI provider startup seed logic."""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _make_session(platform_row=None, ai_count=0):
    """Return a mock async session for startup seeding tests.

    scalar() returns platform_row for the PlatformSettings query,
    then ai_count for the COUNT query.
    """
    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    session.scalar = AsyncMock(side_effect=[platform_row, ai_count])
    session.add = MagicMock()
    session.add_all = MagicMock()
    session.commit = AsyncMock()
    return session


async def test_ai_provider_seed_inserts_rows_when_none_exist():
    """When ai_provider_settings is empty, seed inserts rows from env vars."""
    existing_platform = MagicMock()  # platform row already exists
    session = _make_session(platform_row=existing_platform, ai_count=0)

    with patch("app.startup.SessionLocal", return_value=session):
        import importlib
        import app.startup as startup_mod
        importlib.reload(startup_mod)
        await startup_mod.seed_settings_from_env()

    session.add_all.assert_called_once()
    rows = session.add_all.call_args[0][0]
    assert len(rows) > 0

    # active row is always first
    active = next(r for r in rows if r.provider == "active" and r.key == "provider")
    assert active is not None


async def test_ai_provider_seed_skips_when_rows_already_exist():
    """When ai_provider_settings already has rows, seed does not insert more."""
    existing_platform = MagicMock()
    session = _make_session(platform_row=existing_platform, ai_count=5)

    with patch("app.startup.SessionLocal", return_value=session):
        import importlib
        import app.startup as startup_mod
        importlib.reload(startup_mod)
        await startup_mod.seed_settings_from_env()

    session.add_all.assert_not_called()


async def test_ai_provider_seed_reads_active_provider_from_env(monkeypatch):
    """Active provider row value comes from LLM_PROVIDER env var."""
    monkeypatch.setenv("LLM_PROVIDER", "ollama")

    existing_platform = MagicMock()
    session = _make_session(platform_row=existing_platform, ai_count=0)

    with patch("app.startup.SessionLocal", return_value=session):
        import importlib
        import app.startup as startup_mod
        importlib.reload(startup_mod)
        await startup_mod.seed_settings_from_env()

    rows = session.add_all.call_args[0][0]
    active = next(r for r in rows if r.provider == "active" and r.key == "provider")
    assert active.value == "ollama"


async def test_ai_provider_seed_reads_ollama_env_vars(monkeypatch):
    """Ollama rows pick up LLM_BASE_URL, LLM_MODEL, LLM_VISION_MODEL, LLM_API_KEY."""
    monkeypatch.setenv("LLM_BASE_URL", "http://myollama:11434/v1")
    monkeypatch.setenv("LLM_MODEL", "mistral")
    monkeypatch.setenv("LLM_VISION_MODEL", "llava")
    monkeypatch.setenv("LLM_API_KEY", "mykey")

    existing_platform = MagicMock()
    session = _make_session(platform_row=existing_platform, ai_count=0)

    with patch("app.startup.SessionLocal", return_value=session):
        import importlib
        import app.startup as startup_mod
        importlib.reload(startup_mod)
        await startup_mod.seed_settings_from_env()

    rows = session.add_all.call_args[0][0]
    by_key = {(r.provider, r.key): r for r in rows}

    assert by_key[("ollama", "llm_base_url")].value == "http://myollama:11434/v1"
    assert by_key[("ollama", "llm_model")].value == "mistral"
    assert by_key[("ollama", "llm_vision_model")].value == "llava"
    assert by_key[("ollama", "llm_api_key")].value == "mykey"
    assert by_key[("ollama", "llm_api_key")].is_secret is True


async def test_ai_provider_seed_reads_external_env_vars(monkeypatch):
    """External rows pick up AI_CLIENT_ID, AI_CLIENT_SECRET, AI_AUTH_URL, etc."""
    monkeypatch.setenv("AI_CLIENT_ID", "my-client-id")
    monkeypatch.setenv("AI_CLIENT_SECRET", "my-secret")
    monkeypatch.setenv("AI_AUTH_URL", "https://auth.example.com/token")
    monkeypatch.setenv("AI_API_URL", "https://api.example.com")
    monkeypatch.setenv("AI_DEPLOYMENT_ID", "dep-abc")
    monkeypatch.setenv("AI_RESOURCE_GROUP", "prod")

    existing_platform = MagicMock()
    session = _make_session(platform_row=existing_platform, ai_count=0)

    with patch("app.startup.SessionLocal", return_value=session):
        import importlib
        import app.startup as startup_mod
        importlib.reload(startup_mod)
        await startup_mod.seed_settings_from_env()

    rows = session.add_all.call_args[0][0]
    by_key = {(r.provider, r.key): r for r in rows}

    assert by_key[("external", "ai_client_id")].value == "my-client-id"
    assert by_key[("external", "ai_client_secret")].value == "my-secret"
    assert by_key[("external", "ai_client_secret")].is_secret is True
    assert by_key[("external", "ai_auth_url")].value == "https://auth.example.com/token"
    assert by_key[("external", "ai_deployment_id")].value == "dep-abc"
    assert by_key[("external", "ai_resource_group")].value == "prod"


async def test_ai_provider_seed_defaults_active_to_stub_when_env_unset(monkeypatch):
    """LLM_PROVIDER defaults to 'stub' when env var is not set."""
    monkeypatch.delenv("LLM_PROVIDER", raising=False)

    existing_platform = MagicMock()
    session = _make_session(platform_row=existing_platform, ai_count=0)

    with patch("app.startup.SessionLocal", return_value=session):
        import importlib
        import app.startup as startup_mod
        importlib.reload(startup_mod)
        await startup_mod.seed_settings_from_env()

    rows = session.add_all.call_args[0][0]
    active = next(r for r in rows if r.provider == "active" and r.key == "provider")
    assert active.value == "stub"
