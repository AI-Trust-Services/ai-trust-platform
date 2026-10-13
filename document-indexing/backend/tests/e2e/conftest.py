"""E2E test infrastructure for document-indexing backend.

Uses httpx.AsyncClient + ASGITransport — no running server needed.
The FastAPI app is loaded in-process with DATABASE_URL pointed at
`ai_trust_test` so dev data is never touched.

Requires:
  - Postgres running on localhost:5432
  - POSTGRES_USER / POSTGRES_PASSWORD env vars (defaults: postgres/postgres)

The suite auto-skips if Postgres is not reachable.

MinIO env vars are set at module level (before any import) so minio_client.py
module-level code does not crash. MinIO functions are patched to no-ops in
e2e_setup so no real MinIO instance is needed.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

# Must be set before app.main is imported — minio_client reads these at import time.
os.environ.setdefault("MINIO_ENDPOINT", "localhost:9000")
os.environ.setdefault("MINIO_PUBLIC_ENDPOINT", "localhost:9000")
os.environ.setdefault("MINIO_ROOT_USER", "minioadmin")
os.environ.setdefault("MINIO_ROOT_PASSWORD", "minioadmin")
os.environ.setdefault("MINIO_SECURE", "false")
os.environ.setdefault("MINIO_REGION", "us-east-1")
os.environ.setdefault("INDEXING_BUCKET", "indexing-docs")

_PG_USER = os.environ.get("POSTGRES_USER", "postgres")
_PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "postgres")
_PG_HOST = os.environ.get("POSTGRES_HOST", "localhost")
_PG_PORT = int(os.environ.get("POSTGRES_PORT", "5432"))
_TEST_DB = "ai_trust_test"
_TEST_DATABASE_URL = (
    f"postgresql+asyncpg://{_PG_USER}:{_PG_PASSWORD}@{_PG_HOST}:{_PG_PORT}/{_TEST_DB}"
)
os.environ.setdefault("DATABASE_URL", _TEST_DATABASE_URL)

# Override the engine with NullPool so SQLAlchemy opens/closes a fresh DB
# connection per request — no idle pool connections to conflict with table cleanup.
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool
import ai_trust_persistence.database as _db
import ai_trust_persistence as _persistence_pkg

_test_engine = create_async_engine(_TEST_DATABASE_URL, poolclass=NullPool)
_test_session_factory = async_sessionmaker(_test_engine, expire_on_commit=False)

_db.engine = _test_engine
_db.SessionLocal = _test_session_factory
_persistence_pkg.engine = _test_engine
_persistence_pkg.SessionLocal = _test_session_factory

import psycopg2
import pytest
import pytest_asyncio
import httpx

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
        host=_PG_HOST, port=_PG_PORT, user=_PG_USER, password=_PG_PASSWORD, dbname="postgres"
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
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _truncate() -> None:
    conn = psycopg2.connect(
        host=_PG_HOST, port=_PG_PORT, user=_PG_USER, password=_PG_PASSWORD, dbname=_TEST_DB
    )
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        "TRUNCATE document_chunks, document_versions, documents, ai_systems RESTART IDENTITY CASCADE"
    )
    cur.close()
    conn.close()


_MINIO_UPLOAD_KEY = "documents/DOC-TESTTEST/DOCV-TESTTEST/test.pdf"


@pytest.fixture(scope="session", autouse=True)
def e2e_setup():
    if not _pg_reachable():
        pytest.skip(
            f"Postgres not reachable at {_PG_HOST}:{_PG_PORT} — start Docker Compose first"
        )
    _ensure_test_db()
    _run_migrations()
    os.environ["DATABASE_URL"] = _TEST_DATABASE_URL
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3011")
    os.environ.setdefault("OPENFGA_URL", "http://localhost:8080")
    os.environ.setdefault("OPENFGA_STORE_ID", "test-store-id")

    with (
        patch("app.minio_client.ensure_bucket", new_callable=AsyncMock),
        patch(
            "app.minio_client.upload_file",
            new=AsyncMock(return_value=_MINIO_UPLOAD_KEY),
        ),
        patch(
            "app.minio_client.get_presigned_url",
            new=AsyncMock(return_value="http://localhost:9000/indexing-docs/test.pdf"),
        ),
        patch("app.minio_client.delete_file", new_callable=AsyncMock),
    ):
        import ai_trust_authorization.openfga_client as _fga
        from app.main import app
        from ai_trust_authorization.permissions import get_current_user

        async def _always_allowed(*_a, **_kw) -> bool:
            return True

        _fga.check = _always_allowed
        app.dependency_overrides[get_current_user] = lambda: "test-user"

        yield


@pytest_asyncio.fixture(autouse=True)
async def truncate_tables(e2e_setup):
    yield
    _truncate()


@pytest_asyncio.fixture
async def client():
    from app.main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        timeout=10,
    ) as ac:
        yield ac


@pytest_asyncio.fixture
async def system_id(client):
    """Create an AI system row and return its ID for use in document tests."""
    from ai_trust_persistence import SessionLocal
    from ai_trust_persistence.models import AISystem

    sys_id = "SYS-TESTTEST"
    async with SessionLocal() as session:
        session.add(
            AISystem(
                id=sys_id,
                name="Test System for Document Indexing",
                version="1.0.0",
                provider="Test Provider",
            )
        )
        await session.commit()
    return sys_id
