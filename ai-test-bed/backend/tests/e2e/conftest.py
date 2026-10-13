"""E2E test infrastructure for ai-test-bed backend.

Uses httpx.AsyncClient + ASGITransport — no running server needed.
The registry's evaluate endpoint is mocked so no registry backend is required.

Requires:
  - Docker Compose Postgres running on localhost:5432
  - POSTGRES_USER / POSTGRES_PASSWORD env vars (defaults: postgres/postgres)

The suite auto-skips if Postgres is not reachable.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, patch

import psycopg2
import pytest
import pytest_asyncio
import httpx

_PG_USER = os.environ.get("POSTGRES_USER", "postgres")
_PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "postgres")
_PG_HOST = "localhost"
_PG_PORT = 5432
_TEST_DB = "ai_trust_test"
_TEST_DATABASE_URL = (
    f"postgresql+asyncpg://{_PG_USER}:{_PG_PASSWORD}@{_PG_HOST}:{_PG_PORT}/{_TEST_DB}"
)
_ALEMBIC_INI = Path(__file__).parents[4] / "libs" / "persistence" / "alembic.ini"
_ALEMBIC_BIN = Path(__file__).parents[2] / ".venv" / "bin" / "alembic"


def _pg_reachable() -> bool:
    try:
        conn = psycopg2.connect(
            host=_PG_HOST,
            port=_PG_PORT,
            user=_PG_USER,
            password=_PG_PASSWORD,
            dbname="postgres",
            connect_timeout=3,
        )
        conn.close()
        return True
    except Exception:
        return False


def _ensure_test_db() -> None:
    conn = psycopg2.connect(
        host=_PG_HOST,
        port=_PG_PORT,
        user=_PG_USER,
        password=_PG_PASSWORD,
        dbname="postgres",
    )
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (_TEST_DB,))
    if not cur.fetchone():
        cur.execute(f'CREATE DATABASE "{_TEST_DB}"')
    cur.close()
    conn.close()


def _run_migrations() -> None:
    subprocess.run(
        [str(_ALEMBIC_BIN), "-c", str(_ALEMBIC_INI), "upgrade", "head"],
        env={**os.environ, "DATABASE_URL": _TEST_DATABASE_URL},
        check=True,
    )


def _truncate() -> None:
    conn = psycopg2.connect(
        host=_PG_HOST,
        port=_PG_PORT,
        user=_PG_USER,
        password=_PG_PASSWORD,
        dbname=_TEST_DB,
    )
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("TRUNCATE test_bed_runs RESTART IDENTITY CASCADE")
    cur.close()
    conn.close()


# Canned registry evaluate response — mirrors the stub LLM output for a
# hiring/recruitment use case (high risk via is_employment_related).
_STUB_EVALUATE_RESPONSE = {
    "tier": "high",
    "basis": "High-risk under EU AI Act Annex III, Area 4: Employment, workers management & access to self-employment",
    "obligations": ["Art. 9 — Risk management system"],
    "confidence": 0.9,
    "rationale": {
        "flags": [
            {
                "flag": "is_employment_related",
                "value": True,
                "rationale": "The system screens job applicants.",
                "confidence": 0.9,
            }
        ],
        "confidence": 0.9,
        "reasoning": "The system screens job applicants, triggering Annex III Area 4.",
        "missing_info": [],
        "org_role": "provider",
        "org_role_rationale": "The organisation developed the system.",
    },
}


@pytest.fixture(scope="session", autouse=True)
def e2e_setup():
    """Auto-skip if Postgres unreachable; otherwise create DB and run migrations."""
    if not _pg_reachable():
        pytest.skip(
            "Postgres not reachable at localhost:5432 — start Docker Compose first"
        )
    _ensure_test_db()
    _run_migrations()
    os.environ["DATABASE_URL"] = _TEST_DATABASE_URL
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3001")
    os.environ.setdefault("MINIO_ENDPOINT", "localhost:9000")
    os.environ.setdefault("MINIO_ACCESS_KEY", "minioadmin")
    os.environ.setdefault("MINIO_SECRET_KEY", "minioadmin")
    os.environ.setdefault("MINIO_BUCKET", "indexing-docs")
    os.environ.setdefault("EMBEDDING_SERVICE_URL", "http://embedding-service:8012")

    import ai_trust_authorization.openfga_client as _fga
    from app.main import app
    from ai_trust_authorization.permissions import get_current_user

    async def _always_allowed(*_a, **_kw) -> bool:
        return True

    _fga.check = _always_allowed
    app.dependency_overrides[get_current_user] = lambda: "test-user"


@pytest.fixture(autouse=True)
def truncate_tables():
    yield
    try:
        _truncate()
    except Exception:
        pass
    from ai_trust_persistence.database import engine
    import asyncio

    asyncio.run(engine.dispose())


@pytest.fixture
def mock_registry_evaluate():
    """Patch the httpx call to the registry evaluate endpoint with a canned response."""
    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = _STUB_EVALUATE_RESPONSE

    async def _mock_post(*args, **kwargs):
        return mock_resp

    with patch("app.routers.testbed.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.post = _mock_post
        mock_client_cls.return_value = mock_client
        yield mock_resp


@pytest_asyncio.fixture
async def client():
    from app.main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        timeout=10,
    ) as ac:
        yield ac
