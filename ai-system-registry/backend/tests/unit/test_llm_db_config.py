"""Unit tests for load_llm_config_from_db() in the LLM client."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _make_row(provider: str, key: str, value: str | None, is_secret: bool = False):
    r = MagicMock()
    r.provider = provider
    r.key = key
    r.value = value
    r.is_secret = is_secret
    return r


def _ollama_rows():
    return [
        _make_row("active", "provider", "ollama"),
        _make_row("ollama", "llm_base_url", "http://myollama:11434/v1"),
        _make_row("ollama", "llm_model", "mistral"),
        _make_row("ollama", "llm_vision_model", "llava"),
        _make_row("ollama", "llm_api_key", "mykey", is_secret=True),
    ]


def _external_rows():
    return [
        _make_row("active", "provider", "external"),
        _make_row("external", "ai_client_id", "sb-test"),
        _make_row("external", "ai_client_secret", "secret123", is_secret=True),
        _make_row("external", "ai_auth_url", "https://auth.example.com/token"),
        _make_row("external", "ai_api_url", "https://api.example.com"),
        _make_row("external", "ai_resource_group", "prod"),
        _make_row("external", "ai_deployment_id", "dep-abc"),
        _make_row("external", "ai_api_version", "bedrock-2023-05-31"),
    ]


def _make_db_session(rows):
    scalars_mock = MagicMock()
    scalars_mock.all = MagicMock(return_value=rows)
    result_mock = MagicMock()
    result_mock.scalars = MagicMock(return_value=scalars_mock)
    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    session.execute = AsyncMock(return_value=result_mock)
    return session


@pytest.mark.asyncio
async def test_load_config_sets_ollama_globals():
    """load_llm_config_from_db() overwrites module globals for ollama provider."""
    import importlib
    import app.llm.client as client_mod
    importlib.reload(client_mod)

    session = _make_db_session(_ollama_rows())
    with patch("app.llm.client.SessionLocal", return_value=session):
        await client_mod.load_llm_config_from_db()

    assert client_mod.LLM_PROVIDER == "ollama"
    assert client_mod.LLM_BASE_URL == "http://myollama:11434/v1"
    assert client_mod.LLM_MODEL == "mistral"
    assert client_mod.LLM_VISION_MODEL == "llava"
    assert client_mod.LLM_API_KEY == "mykey"


@pytest.mark.asyncio
async def test_load_config_sets_external_globals():
    """load_llm_config_from_db() overwrites module globals for external provider."""
    import importlib
    import app.llm.client as client_mod
    importlib.reload(client_mod)

    session = _make_db_session(_external_rows())
    with patch("app.llm.client.SessionLocal", return_value=session):
        await client_mod.load_llm_config_from_db()

    assert client_mod.LLM_PROVIDER == "external"
    assert client_mod.AI_CLIENT_ID == "sb-test"
    assert client_mod.AI_CLIENT_SECRET == "secret123"
    assert client_mod.AI_AUTH_URL == "https://auth.example.com/token"
    assert client_mod.AI_API_URL == "https://api.example.com"
    assert client_mod.AI_RESOURCE_GROUP == "prod"
    assert client_mod.AI_DEPLOYMENT_ID == "dep-abc"


@pytest.mark.asyncio
async def test_load_config_no_rows_keeps_env_defaults():
    """load_llm_config_from_db() with empty DB leaves module globals unchanged."""
    import importlib
    import app.llm.client as client_mod
    importlib.reload(client_mod)

    original_provider = client_mod.LLM_PROVIDER
    session = _make_db_session([])
    with patch("app.llm.client.SessionLocal", return_value=session):
        await client_mod.load_llm_config_from_db()

    assert client_mod.LLM_PROVIDER == original_provider


@pytest.mark.asyncio
async def test_load_config_db_failure_falls_back_silently():
    """load_llm_config_from_db() catches DB errors and keeps env defaults."""
    import importlib
    import app.llm.client as client_mod
    importlib.reload(client_mod)

    original_provider = client_mod.LLM_PROVIDER

    session = AsyncMock()
    session.__aenter__ = AsyncMock(side_effect=Exception("DB unavailable"))
    session.__aexit__ = AsyncMock(return_value=False)

    with patch("app.llm.client.SessionLocal", return_value=session):
        # Should not raise
        await client_mod.load_llm_config_from_db()

    assert client_mod.LLM_PROVIDER == original_provider


@pytest.mark.asyncio
async def test_load_config_resets_openai_client_singleton_for_ollama():
    """load_llm_config_from_db() resets _openai_client so it picks up new base_url."""
    import importlib
    import app.llm.client as client_mod
    importlib.reload(client_mod)

    # Simulate a pre-existing client singleton
    client_mod._openai_client = MagicMock()

    session = _make_db_session(_ollama_rows())
    with patch("app.llm.client.SessionLocal", return_value=session):
        await client_mod.load_llm_config_from_db()

    assert client_mod._openai_client is None


@pytest.mark.asyncio
async def test_load_config_active_stub_keeps_stub_provider():
    """Active provider = 'stub' in DB → LLM_PROVIDER stays 'stub'."""
    import importlib
    import app.llm.client as client_mod
    importlib.reload(client_mod)

    rows = [_make_row("active", "provider", "stub")]
    session = _make_db_session(rows)
    with patch("app.llm.client.SessionLocal", return_value=session):
        await client_mod.load_llm_config_from_db()

    assert client_mod.LLM_PROVIDER == "stub"
