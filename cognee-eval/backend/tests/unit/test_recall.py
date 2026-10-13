"""Unit tests for POST /v1/recall — offline, no real cognee calls.

cognee is not a test dep, so we pre-mock it in sys.modules before the app
modules are imported.  This is standard for heavy optional dependencies that
only need to exist at module-import time.
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock

# ---------------------------------------------------------------------------
# Pre-mock cognee and its sub-packages so the import of app.cognee_client
# succeeds without cognee being installed in the test venv.
# ---------------------------------------------------------------------------
for _mod in [
    "cognee",
    "cognee.modules",
    "cognee.modules.search",
    "cognee.modules.search.types",
    "cognee.modules.search.types.SearchType",
]:
    sys.modules.setdefault(_mod, MagicMock())

import os

import httpx
import pytest

os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost")

from app import cognee_client
from app.routers import recall
from fastapi import FastAPI

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(recall.router, prefix="/v1")
    return app


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_recall_truncates_to_k(monkeypatch, test_app: FastAPI) -> None:
    """Handler must return at most k passages, first passage intact."""
    fixed_passages = [
        {"text": f"passage {i}", "node_id": f"node-{i}", "score": 0.9 - i * 0.05}
        for i in range(10)
    ]

    async def _mock_recall(query: str) -> list[dict]:
        return fixed_passages

    monkeypatch.setattr(cognee_client, "recall", _mock_recall)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        resp = await client.post(
            "/v1/recall",
            json={"question": "what is the AI Act?", "k": 3},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    assert data[0]["text"] == "passage 0"
    assert data[0]["node_id"] == "node-0"
    assert data[0]["score"] == pytest.approx(0.9)


@pytest.mark.asyncio
async def test_recall_default_k(monkeypatch, test_app: FastAPI) -> None:
    """Default k=5 is applied when k is omitted from the request."""
    fixed_passages = [
        {"text": f"p{i}", "node_id": f"n{i}", "score": None} for i in range(8)
    ]

    async def _mock_recall(query: str) -> list[dict]:
        return fixed_passages

    monkeypatch.setattr(cognee_client, "recall", _mock_recall)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        resp = await client.post(
            "/v1/recall",
            json={"question": "AI risk categories"},
        )

    assert resp.status_code == 200
    assert len(resp.json()) == 5


@pytest.mark.asyncio
async def test_recall_rejects_empty_question(monkeypatch, test_app: FastAPI) -> None:
    """Empty question string must be rejected with 422."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        resp = await client.post("/v1/recall", json={"question": "", "k": 5})

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_recall_rejects_k_out_of_range(monkeypatch, test_app: FastAPI) -> None:
    """k=0 and k=51 must be rejected with 422."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        r0 = await client.post("/v1/recall", json={"question": "test", "k": 0})
        r51 = await client.post("/v1/recall", json={"question": "test", "k": 51})

    assert r0.status_code == 422
    assert r51.status_code == 422
