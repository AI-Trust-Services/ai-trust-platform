"""E2E tests for POST /v1/langfuse/test-trace.

Langfuse is not configured in CI/local e2e, so the default path returns 503
(disabled). The "sent" path is exercised with a fake Langfuse client monkeypatched
in, asserting the endpoint builds a trace and flushes without any real network I/O.
"""

from __future__ import annotations

from contextlib import contextmanager

import httpx

from app import langfuse_client

_HDR = {"x-forwarded-preferred-username": "test-user"}


async def test_test_trace_disabled_returns_503(client: httpx.AsyncClient):
    # Langfuse env vars are unset in e2e → is_enabled() is False.
    r = await client.post("/v1/langfuse/test-trace", headers=_HDR)
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "disabled"


class _FakeSpan:
    def __init__(self):
        self.updated = False

    def update(self, *_a, **_kw):
        self.updated = True

    def update_trace(self, *_a, **_kw):
        self.updated = True


class _FakeClient:
    def __init__(self):
        self.flushed = False

    @contextmanager
    def start_as_current_observation(self, *_a, **_kw):
        yield _FakeSpan()

    def get_current_trace_id(self):
        return "trace-abc123"

    def flush(self):
        self.flushed = True


async def test_test_trace_sent_path(client: httpx.AsyncClient, monkeypatch) -> None:
    fake = _FakeClient()
    monkeypatch.setattr(langfuse_client, "is_enabled", lambda: True)
    monkeypatch.setattr(langfuse_client, "get_langfuse", lambda: fake)
    monkeypatch.setattr(langfuse_client, "tracing_environment", lambda: "test-user")
    monkeypatch.setattr(langfuse_client, "host", lambda: "http://langfuse:3000")

    r = await client.post("/v1/langfuse/test-trace", headers=_HDR)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "sent"
    assert body["environment"] == "test-user"
    assert body["host"] == "http://langfuse:3000"
    assert body["trace_id"] == "trace-abc123"
    assert fake.flushed is True
