"""E2E test infrastructure for cognee-eval backend.

Uses httpx.AsyncClient + ASGITransport — no running server needed.
The database is in-memory SQLite (aiosqlite), so no Postgres or Docker is required.

All cognee calls (recall, answer_question, ingest_pdf, get_ingest_status,
ingest_feedback, get_graph_stats, search_entities) are mocked — they require
a running AI gateway and the full cognee pipeline which is not available in CI.
"""

from __future__ import annotations

import asyncio
import os
import sys
import types
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
import httpx

os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3001")
os.environ.setdefault("COGNEE_DATA_PATH", "/tmp/cognee_test")

# Stub out the `cognee` package and its submodules before any app import.
# cognee_client.py does `import cognee` and
# `from cognee.modules.search.types.SearchType import SearchType`
# at module level — these fail in CI where cognee is not installed.
# graph.py also imports `kuzu` at module level.
def _stub_cognee_modules() -> None:
    cognee_stub = types.ModuleType("cognee")
    cognee_stub.config = MagicMock()
    cognee_stub.remember = AsyncMock()
    cognee_stub.recall = AsyncMock(return_value=[])
    cognee_stub.search = AsyncMock(return_value=[])
    cognee_stub.datasets = MagicMock(return_value=MagicMock(list_datasets=AsyncMock(return_value=[])))

    search_type_mod = types.ModuleType("cognee.modules.search.types.SearchType")
    search_type_mod.SearchType = MagicMock()

    for name in [
        "cognee",
        "cognee.modules",
        "cognee.modules.search",
        "cognee.modules.search.types",
        "cognee.modules.search.types.SearchType",
    ]:
        sys.modules.setdefault(name, types.ModuleType(name))
    sys.modules["cognee"] = cognee_stub
    sys.modules["cognee.modules.search.types.SearchType"] = search_type_mod

    # kuzu is imported at module level in graph.py
    sys.modules.setdefault("kuzu", types.ModuleType("kuzu"))


_stub_cognee_modules()

_MOCK_PASSAGES = [
    {
        "text": "Article 6 defines high-risk AI systems.",
        "node_id": "node-001",
        "score": 0.92,
    },
    {
        "text": "Annex III lists high-risk use cases.",
        "node_id": "node-002",
        "score": 0.85,
    },
]
_MOCK_ANSWER = "High-risk AI systems are defined in Article 6 of the EU AI Act."


def _patch_db():
    from sqlalchemy.ext.asyncio import (
        AsyncSession,
        async_sessionmaker,
        create_async_engine,
    )
    import app.database as _db

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    _db._engine = engine
    _db.SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    return engine


def _patch_cognee():
    import app.cognee_client as _cc

    _cc.setup_cognee = lambda: None
    _cc.recall = AsyncMock(return_value=_MOCK_PASSAGES)
    _cc.answer_question = AsyncMock(return_value=_MOCK_ANSWER)
    _cc.ingest_pdf = AsyncMock(
        return_value={"dataset": "eu_ai_act_v1", "source": "/tmp/test.pdf"}
    )
    _cc.get_ingest_status = AsyncMock(
        return_value={
            "dataset": "eu_ai_act_v1",
            "ingested": True,
            "all_datasets": ["eu_ai_act_v1"],
        }
    )
    _cc.ingest_feedback = AsyncMock(return_value=None)
    _cc.get_graph_stats = AsyncMock(return_value={"summary": ["Article nodes: 100"]})
    _cc.search_entities = AsyncMock(
        return_value=[{"text": "Article 6", "node_id": "node-001"}]
    )


async def _create_tables(engine) -> None:
    import app.database as _db
    from app.models import evaluation, feedback  # noqa: F401 — registers models

    async with engine.begin() as conn:
        await conn.run_sync(_db.Base.metadata.create_all)


@pytest.fixture(scope="session", autouse=True)
def e2e_setup():
    engine = _patch_db()
    _patch_cognee()
    asyncio.run(_create_tables(engine))
    yield


@pytest.fixture(autouse=True)
async def truncate_tables(e2e_setup):
    """Clear evaluation and feedback rows between tests."""
    yield
    from sqlalchemy import text
    import app.database as _db

    async with _db.SessionLocal() as session:
        await session.execute(text("DELETE FROM feedback"))
        await session.execute(text("DELETE FROM evaluations"))
        await session.commit()


@pytest_asyncio.fixture
async def client():
    from app.main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        timeout=10,
    ) as ac:
        yield ac
