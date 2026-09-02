"""Unit tests for JSON repair path in parsing.py and document truncation in documents.py."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.documents import MAX_TEXT_LENGTH, parse_document
from app.llm.parsing import LLMParseError, parse_json_response


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
        new=AsyncMock(return_value={"text": "still not json !!!", "input_tokens": 0, "output_tokens": 0}),
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
