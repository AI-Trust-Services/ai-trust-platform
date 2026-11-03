"""Unit tests for the single-page assessment helpers (no DB, no network)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.routers import assessment


class _FakeClient:
    def __init__(self, resp):
        self._resp = resp

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    async def post(self, *_a, **_k):
        return self._resp


def _resp(json_value, status=200):
    r = MagicMock()
    r.status_code = status
    r.json = lambda: json_value
    return r


@pytest.mark.asyncio
async def test_retrieve_context_parses_bare_list():
    """/v1/retrieve returns a bare JSON array (list[RetrievedPassage]) — not an
    object. Regression guard for the 'list has no attribute get' 500."""
    payload = [
        {
            "passage": "EU market from March 2026.",
            "source": {"filename": "a.pdf", "page": 14},
        },
        {"passage": "Screens applicants.", "source": {"filename": "b.docx", "page": 3}},
    ]
    with patch.object(
        assessment.httpx, "AsyncClient", lambda **k: _FakeClient(_resp(payload))
    ):
        ctx, sources = await assessment._retrieve_context("SYS-X")
    assert "March 2026" in ctx
    assert [(s.name, s.page) for s in sources] == [("a.pdf", 14), ("b.docx", 3)]


@pytest.mark.asyncio
async def test_retrieve_context_tolerates_object_wrapper():
    payload = {
        "results": [{"passage": "x", "source": {"filename": "a.pdf", "page": None}}]
    }
    with patch.object(
        assessment.httpx, "AsyncClient", lambda **k: _FakeClient(_resp(payload))
    ):
        ctx, sources = await assessment._retrieve_context("SYS-X")
    assert sources and sources[0].name == "a.pdf"


@pytest.mark.asyncio
async def test_retrieve_context_fails_soft_on_error_status():
    with patch.object(
        assessment.httpx, "AsyncClient", lambda **k: _FakeClient(_resp([], status=502))
    ):
        ctx, sources = await assessment._retrieve_context("SYS-X")
    assert ctx == "" and sources == []


def test_status_label_maps_locked_and_returned():
    sys = MagicMock()
    sys.workflow_status = "pending_review"
    assert assessment._status_label(sys) == "locked"
    sys.workflow_status = "returned"
    assert assessment._status_label(sys) == "under_review"
    sys.workflow_status = "draft"
    assert assessment._status_label(sys) == "draft"


def test_is_editable():
    sys = MagicMock()
    for ws, expected in [
        ("draft", True),
        ("returned", True),
        ("pending_review", False),
        ("approved", False),
    ]:
        sys.workflow_status = ws
        assert assessment._is_editable(sys) is expected
