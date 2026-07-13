"""E2E smoke test for the /traces/{id}/summary endpoint.

Hits the FastAPI app in-process via ASGITransport with a mocked ClickHouse
client — no Docker, no DB. The point is to verify wiring (routing, JSON
serialisation, Pydantic enum encoding), not to retest the summary logic
that unit tests already cover.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest
import pytest_asyncio


# --- App setup --------------------------------------------------------------

os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3005")


@pytest_asyncio.fixture
async def client():
    from app.main import app
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        timeout=10,
    ) as ac:
        yield ac


# --- Fake ClickHouse client --------------------------------------------------

def _fake_row(span_id: str, parent: str, started: datetime, *, duration_ms: float,
              op: str, span_name: str, status_code: int = 0,
              input_msgs: str = "", output_msgs: str = "",
              request_model: str = "", attributes: dict[str, Any] | None = None) -> tuple:
    """Mirror the column order of the SELECT in routers/traces._load_spans()."""
    return (
        span_id, parent, started, duration_ms, op, span_name,
        1,                       # span_kind INTERNAL
        status_code, "",         # status_code, status_message
        "client-agent", "openai",
        request_model, request_model,
        0, 0,                    # input_tokens, output_tokens
        "stop",                  # finish_reasons
        input_msgs, output_msgs,
        attributes or {},
    )


def _make_fake_ch_with_rows(rows: list[tuple]) -> MagicMock:
    ch = MagicMock()
    result = MagicMock()
    result.result_rows = rows
    ch.query.return_value = result
    return ch


# --- Tests ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_summary_endpoint_returns_decision_record(client):
    """Happy path — LLM span with prompt+reply yields outcome=answered."""
    started = datetime(2026, 6, 29, 12, 0, 0, tzinfo=timezone.utc)
    rows = [_fake_row(
        span_id="root", parent="", started=started,
        duration_ms=200.0, op="chat", span_name="chat gpt-4o-mini",
        input_msgs=json.dumps([{"role": "user", "content": "hello"}]),
        output_msgs=json.dumps([{"role": "assistant", "content": "world"}]),
        request_model="gpt-4o-mini",
    )]

    with patch("app.routers.traces.get_client",
               return_value=_make_fake_ch_with_rows(rows)):
        resp = await client.get("/api/v1/traces/abc123/summary")

    assert resp.status_code == 200
    body = resp.json()
    assert body["outcome"] == "answered"
    assert body["goal"] == "hello"
    assert body["final_answer"] == "world"
    assert body["outcome_reason_heuristic"] is False
    assert body["models_used"] == ["gpt-4o-mini"]
    assert "metrics" in body
    assert body["metrics"]["span_count"] == 1


@pytest.mark.asyncio
async def test_summary_endpoint_404_when_no_spans(client):
    """No spans for the trace id → 404, not an empty record."""
    with patch("app.routers.traces.get_client",
               return_value=_make_fake_ch_with_rows([])):
        resp = await client.get("/api/v1/traces/unknown-id/summary")

    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_summary_endpoint_errored_outcome(client):
    """Status code 2 on the root span propagates to outcome=errored."""
    started = datetime(2026, 6, 29, 12, 0, 0, tzinfo=timezone.utc)
    rows = [_fake_row(
        span_id="root", parent="", started=started,
        duration_ms=10.0, op="chat", span_name="chat",
        status_code=2,
        input_msgs=json.dumps([{"role": "user", "content": "hi"}]),
    )]

    with patch("app.routers.traces.get_client",
               return_value=_make_fake_ch_with_rows(rows)):
        resp = await client.get("/api/v1/traces/err-trace/summary")

    assert resp.status_code == 200
    assert resp.json()["outcome"] == "errored"


@pytest.mark.asyncio
async def test_summary_endpoint_503_when_clickhouse_unavailable(client):
    """A ClickHouse driver error surfaces as 503, not a raw 500 with internals."""
    ch = MagicMock()
    ch.query.side_effect = RuntimeError("connection refused")

    with patch("app.routers.traces.get_client", return_value=ch):
        resp = await client.get("/api/v1/traces/any-id/summary")

    assert resp.status_code == 503
    assert resp.json()["detail"] == "Data store unavailable"


@pytest.mark.asyncio
async def test_list_traces_503_when_clickhouse_unavailable(client):
    """The list endpoint wraps ClickHouse failures the same way."""
    ch = MagicMock()
    ch.query.side_effect = RuntimeError("connection refused")

    with patch("app.routers.traces.get_client", return_value=ch):
        resp = await client.get("/api/v1/traces")

    assert resp.status_code == 503
    assert resp.json()["detail"] == "Data store unavailable"
