"""Unit tests for the Thalamus LLM client."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.llm.client import _chat_completions, chat


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


@pytest.mark.asyncio
async def test_chat_completions_maps_openai_response():
    """A well-formed OpenAI-compatible response maps to the uniform dict."""
    mock_resp = _mock_completion("Hello!", 10, 5, "stop")
    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(return_value=mock_resp)

    with patch("app.llm.client._thalamus_client", fake_client):
        result = await _chat_completions(
            [{"role": "user", "content": "hi"}], "model-a", 100, False
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

    with patch("app.llm.client._thalamus_client", fake_client):
        result = await _chat_completions(
            [{"role": "user", "content": "hi"}], "model-a", 100, False
        )

    assert result["input_tokens"] == 0
    assert result["output_tokens"] == 0


@pytest.mark.asyncio
async def test_chat_uses_stub_in_stub_mode():
    """With stub mode active, chat() dispatches to the deterministic stub."""
    with patch("app.llm.client._STUB_MODE", True):
        result = await chat([{"role": "user", "content": "hi"}], task="chat")

    assert "text" in result
    assert "input_tokens" in result
    assert "output_tokens" in result
