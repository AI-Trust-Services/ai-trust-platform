"""Unit tests for the LLM client (BYO provider resolution + OpenAI mapping)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.llm.client import (
    RuntimeConfig,
    _chat_completions,
    chat,
    resolve_runtime_config,
)


def _mock_completion(
    text: str, prompt_tokens: int, completion_tokens: int, finish: str
):
    """Build a mock mirroring the openai SDK ChatCompletion shape."""
    message = MagicMock()
    message.content = text
    choice = MagicMock()
    choice.message = message
    choice.finish_reason = finish
    usage = MagicMock()
    usage.prompt_tokens = prompt_tokens
    usage.completion_tokens = completion_tokens
    response = MagicMock()
    response.choices = [choice]
    response.usage = usage
    return response


def _live_cfg(source: str = "thalamus") -> RuntimeConfig:
    return RuntimeConfig(
        base_url="https://gw.example.com/v1",
        api_token="tok",
        model="model-a",
        source=source,
    )


@pytest.mark.asyncio
async def test_chat_completions_maps_openai_response():
    """A well-formed OpenAI-compatible response maps to the uniform dict."""
    mock_resp = _mock_completion("Hello!", 10, 5, "stop")
    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(return_value=mock_resp)

    with patch("app.llm.client._get_client", return_value=fake_client):
        result = await _chat_completions(
            _live_cfg(), [{"role": "user", "content": "hi"}], "model-a", 100, False
        )

    assert result["text"] == "Hello!"
    assert result["input_tokens"] == 10
    assert result["output_tokens"] == 5
    assert result["finish_reason"] == "stop"


@pytest.mark.asyncio
async def test_chat_completions_handles_missing_usage():
    """When usage is absent the token counts default to 0."""
    mock_resp = _mock_completion("hi", 0, 0, "stop")
    mock_resp.usage = None
    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(return_value=mock_resp)

    with patch("app.llm.client._get_client", return_value=fake_client):
        result = await _chat_completions(
            _live_cfg(), [{"role": "user", "content": "hi"}], "model-a", 100, False
        )

    assert result["input_tokens"] == 0
    assert result["output_tokens"] == 0


@pytest.mark.asyncio
async def test_chat_uses_stub_when_resolved_config_is_stub():
    """When the resolved provider selects stub mode, chat() uses the stub."""
    stub_cfg = RuntimeConfig(
        base_url="stub", api_token="", model="m", source="thalamus"
    )
    with patch(
        "app.llm.client.resolve_runtime_config", AsyncMock(return_value=stub_cfg)
    ):
        result = await chat([{"role": "user", "content": "hi"}], task="chat")

    assert "text" in result
    assert "input_tokens" in result
    assert "output_tokens" in result


@pytest.mark.asyncio
async def test_chat_pins_passed_config_without_resolving():
    """A pre-resolved config (pipeline pin) is used verbatim — no re-resolution."""
    stub_cfg = RuntimeConfig(base_url="stub", api_token="", model="m", source="byo")
    resolver = AsyncMock()
    with patch("app.llm.client.resolve_runtime_config", resolver):
        result = await chat(
            [{"role": "user", "content": "hi"}], task="chat", config=stub_cfg
        )

    resolver.assert_not_awaited()  # pinned config means no per-call resolution
    assert "text" in result


def _fake_sessionlocal():
    """A SessionLocal() stand-in supporting `async with ... as session`."""
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=MagicMock())
    cm.__aexit__ = AsyncMock(return_value=False)
    factory = MagicMock(return_value=cm)
    return factory


@pytest.mark.asyncio
async def test_resolve_runtime_config_prefers_active_byo():
    """An active BYO row overrides the Thalamus env default."""
    from ai_trust_persistence.llm_config import LLMConfig

    byo = LLMConfig(base_url="https://byo.example.com/v1", api_token="t", model="m-byo")
    with (
        patch("app.llm.client.resolve_llm_config", AsyncMock(return_value=byo)),
        patch("app.llm.client.validate_endpoint_url", return_value=None),
        patch("app.llm.client.SessionLocal", _fake_sessionlocal()),
    ):
        cfg = await resolve_runtime_config()

    assert cfg.source == "byo"
    assert cfg.base_url == "https://byo.example.com/v1"
    assert cfg.model == "m-byo"


@pytest.mark.asyncio
async def test_resolve_runtime_config_falls_back_to_thalamus():
    """No active BYO row → the Thalamus env default is used."""
    with (
        patch("app.llm.client.resolve_llm_config", AsyncMock(return_value=None)),
        patch("app.llm.client.SessionLocal", _fake_sessionlocal()),
    ):
        cfg = await resolve_runtime_config()

    assert cfg.source == "thalamus"


@pytest.mark.asyncio
async def test_resolve_runtime_config_rejects_unsafe_byo_url():
    """A BYO row whose URL fails SSRF validation raises — no silent fallback."""
    from ai_trust_persistence.llm_config import LLMConfig

    byo = LLMConfig(base_url="http://169.254.169.254/v1", api_token="t", model="m")
    with (
        patch("app.llm.client.resolve_llm_config", AsyncMock(return_value=byo)),
        patch(
            "app.llm.client.validate_endpoint_url",
            return_value="internal address not allowed",
        ),
        patch("app.llm.client.SessionLocal", _fake_sessionlocal()),
    ):
        with pytest.raises(RuntimeError, match="not allowed"):
            await resolve_runtime_config()
