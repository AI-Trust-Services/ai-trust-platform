"""Unit tests for the LLM client response validation."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.llm.client import LLMConfig, LLMResponseError, _chat_external


def _make_external_config() -> LLMConfig:
    """Create a minimal LLMConfig for external provider tests."""
    return LLMConfig(
        provider="external",
        base_url="",
        api_key="",
        model="test-model",
        vision_model="test-vision",
        client_id="test-client",
        client_secret="test-secret",
        auth_url="https://auth.example.com/token",
        api_url="https://api.example.com",
        resource_group="default",
        deployment_id="test-deployment",
        api_version="bedrock-2023-05-31",
    )


@pytest.mark.asyncio
async def test_chat_external_raises_on_missing_content_key():
    """Provider returns 200 but JSON has no 'content' key → LLMResponseError."""
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {"error": "quota exceeded"}

    config = _make_external_config()

    with patch("app.llm.client._get_token", return_value="tok"), \
         patch("httpx.AsyncClient") as mock_client_cls:
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
            post=AsyncMock(return_value=mock_resp)
        ))
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        with pytest.raises(LLMResponseError, match="unexpected shape"):
            await _chat_external([{"role": "user", "content": "hi"}], "model", 100, config)


@pytest.mark.asyncio
async def test_chat_external_raises_on_empty_content_list():
    """Provider returns 200 with content=[] → LLMResponseError."""
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {"content": [], "stop_reason": "end_turn"}

    config = _make_external_config()

    with patch("app.llm.client._get_token", return_value="tok"), \
         patch("httpx.AsyncClient") as mock_client_cls:
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
            post=AsyncMock(return_value=mock_resp)
        ))
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        with pytest.raises(LLMResponseError, match="unexpected shape"):
            await _chat_external([{"role": "user", "content": "hi"}], "model", 100, config)


@pytest.mark.asyncio
async def test_chat_external_succeeds_with_valid_response():
    """Well-formed provider response returns the expected dict."""
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "content": [{"type": "text", "text": "Hello!"}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 10, "output_tokens": 5},
    }

    config = _make_external_config()

    with patch("app.llm.client._get_token", return_value="tok"), \
         patch("httpx.AsyncClient") as mock_client_cls:
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
            post=AsyncMock(return_value=mock_resp)
        ))
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await _chat_external([{"role": "user", "content": "hi"}], "model", 100, config)

    assert result["text"] == "Hello!"
    assert result["input_tokens"] == 10
    assert result["output_tokens"] == 5
    assert result["finish_reason"] == "end_turn"
