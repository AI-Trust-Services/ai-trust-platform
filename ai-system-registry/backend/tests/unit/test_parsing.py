"""Unit tests for JSON repair path in parsing.py and document truncation in documents.py."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.documents import MAX_TEXT_LENGTH, parse_document
from app.llm.parsing import LLMParseError, parse_json_response, parse_with_retry


# ---------------------------------------------------------------------------
# JSON repair path — parse_json_response
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_repair_succeeds_when_first_parse_fails():
    """Malformed text triggers the repair call; stub returns '{}' which parses cleanly."""
    # The stub's repair handler returns "{}" for any repair task (stub.py line 113).
    result = await parse_json_response("this is not json at all", task="test")
    assert isinstance(result, dict)


@pytest.mark.asyncio
async def test_repair_raises_llm_parse_error_when_repair_also_malformed():
    """If the repair call itself returns garbage, LLMParseError is raised."""
    with patch(
        "app.llm.parsing.chat",
        new=AsyncMock(
            return_value={
                "text": "still not json !!!",
                "input_tokens": 0,
                "output_tokens": 0,
            }
        ),
    ):
        with pytest.raises(LLMParseError):
            await parse_json_response("also not json", task="test")


@pytest.mark.asyncio
async def test_valid_json_does_not_trigger_repair():
    """Well-formed JSON is returned immediately without calling chat."""
    with patch("app.llm.parsing.chat", new=AsyncMock()) as mock_chat:
        result = await parse_json_response('{"key": "value"}', task="test")
    assert result == {"key": "value"}
    mock_chat.assert_not_called()


@pytest.mark.asyncio
async def test_repair_succeeds_on_fenced_json():
    """Code-fenced JSON is unwrapped by _extract_json without needing a repair call."""
    with patch("app.llm.parsing.chat", new=AsyncMock()) as mock_chat:
        result = await parse_json_response('```json\n{"foo": 1}\n```', task="test")
    assert result == {"foo": 1}
    mock_chat.assert_not_called()


# ---------------------------------------------------------------------------
# Document truncation — parse_document
# ---------------------------------------------------------------------------


def test_text_document_truncated_at_max_length():
    """A text file exceeding MAX_TEXT_LENGTH is truncated with a marker appended."""
    content = ("x" * (MAX_TEXT_LENGTH + 500)).encode("utf-8")
    doc = parse_document("big.txt", content)
    assert doc.text is not None
    assert len(doc.text) <= MAX_TEXT_LENGTH + 100  # truncated text + marker
    assert "[Document truncated" in doc.text


def test_text_document_not_truncated_when_within_limit():
    """A text file within MAX_TEXT_LENGTH is returned unchanged."""
    content = ("hello world " * 10).encode("utf-8")
    doc = parse_document("small.txt", content)
    assert doc.text is not None
    assert "[Document truncated" not in doc.text
    assert len(doc.text) == len(content)


def test_truncated_document_extract_still_returns_content():
    """After truncation the returned text still starts with the original content."""
    content = ("A" * MAX_TEXT_LENGTH + "B" * 500).encode("utf-8")
    doc = parse_document("long.txt", content)
    assert doc.text is not None
    assert doc.text.startswith("A" * MAX_TEXT_LENGTH)


# ---------------------------------------------------------------------------
# parse_with_retry
# ---------------------------------------------------------------------------

_VALID_RESPONSE = '{"ok": true}'
_VALID_PARSED = {"ok": True}

_REPAIR_RESPONSE = {"text": _VALID_RESPONSE, "input_tokens": 0, "output_tokens": 0}


def _identity_validator(raw: dict) -> dict:
    """Validator that always passes."""
    return raw


def _rejecting_validator(raw: dict) -> dict:
    """Validator that always fails."""
    raise LLMParseError("schema not satisfied")


@pytest.mark.asyncio
async def test_parse_with_retry_succeeds_on_first_attempt():
    """Valid JSON + passing validator returns on attempt 1 without any chat call."""
    mock_chat = AsyncMock()
    result = await parse_with_retry(
        _VALID_RESPONSE,
        task="test",
        validator=_identity_validator,
        chat_fn=mock_chat,
        messages=[],
    )
    assert result == _VALID_PARSED
    mock_chat.assert_not_called()


@pytest.mark.asyncio
async def test_parse_with_retry_succeeds_on_attempt_2():
    """Bad initial text triggers retry; second attempt (repair call) returns valid JSON."""
    call_count = 0

    async def _chat_fn(messages, task, json_mode):
        nonlocal call_count
        call_count += 1
        return _REPAIR_RESPONSE

    result = await parse_with_retry(
        "not json at all",
        task="test",
        validator=_identity_validator,
        chat_fn=_chat_fn,
        messages=[],
    )
    assert result == _VALID_PARSED
    assert call_count == 1


@pytest.mark.asyncio
async def test_parse_with_retry_succeeds_on_attempt_3():
    """First two attempts fail; third attempt succeeds."""
    call_count = 0

    async def _chat_fn(messages, task, json_mode):
        nonlocal call_count
        call_count += 1
        if call_count < 2:
            return {"text": "still bad", "input_tokens": 0, "output_tokens": 0}
        return _REPAIR_RESPONSE

    result = await parse_with_retry(
        "not json",
        task="test",
        validator=_identity_validator,
        chat_fn=_chat_fn,
        messages=[],
    )
    assert result == _VALID_PARSED
    assert call_count == 2


@pytest.mark.asyncio
async def test_parse_with_retry_raises_after_max_attempts():
    """All attempts fail — LLMParseError raised after max_attempts."""
    mock_chat = AsyncMock(
        return_value={"text": "bad json", "input_tokens": 0, "output_tokens": 0}
    )
    with pytest.raises(LLMParseError, match="3 attempts"):
        await parse_with_retry(
            "bad json",
            task="test",
            validator=_identity_validator,
            chat_fn=mock_chat,
            messages=[],
            max_attempts=3,
        )
    assert mock_chat.call_count == 2  # attempts 2 and 3 each call chat once


@pytest.mark.asyncio
async def test_parse_with_retry_validator_error_triggers_retry():
    """Valid JSON but failing validator also triggers a retry (not an immediate raise)."""
    call_count = 0

    async def _chat_fn(messages, task, json_mode):
        nonlocal call_count
        call_count += 1
        return _REPAIR_RESPONSE

    def _validator_on_second(raw: dict) -> dict:
        if call_count == 0:
            raise LLMParseError("first attempt bad structure")
        return raw

    result = await parse_with_retry(
        _VALID_RESPONSE,
        task="test",
        validator=_validator_on_second,
        chat_fn=_chat_fn,
        messages=[],
    )
    assert result == _VALID_PARSED
    assert call_count == 1
