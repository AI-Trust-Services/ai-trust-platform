"""
E2E test infrastructure.

Uses httpx.AsyncClient + ASGITransport — no running server needed.
The FastAPI app is loaded in-process with DATABASE_URL pointed at
`ai_trust_test` so dev data is never touched.

Requires:
  - Docker Compose Postgres running on localhost:5432
  - POSTGRES_USER / POSTGRES_PASSWORD env vars (defaults: postgres/postgres)

The suite auto-skips if Postgres is not reachable.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

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
            host=_PG_HOST, port=_PG_PORT,
            user=_PG_USER, password=_PG_PASSWORD,
            dbname="postgres", connect_timeout=3,
        )
        conn.close()
        return True
    except Exception:
        return False


def _ensure_test_db() -> None:
    conn = psycopg2.connect(
        host=_PG_HOST, port=_PG_PORT,
        user=_PG_USER, password=_PG_PASSWORD,
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
        host=_PG_HOST, port=_PG_PORT,
        user=_PG_USER, password=_PG_PASSWORD,
        dbname=_TEST_DB,
    )
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("TRUNCATE ai_systems, model_cards RESTART IDENTITY CASCADE")
    cur.close()
    conn.close()


@pytest.fixture(scope="session", autouse=True)
def e2e_setup():
    """Auto-skip if Postgres unreachable; otherwise create DB and run migrations."""
    if not _pg_reachable():
        pytest.skip("Postgres not reachable at localhost:5432 — start Docker Compose first")
    _ensure_test_db()
    _run_migrations()
    os.environ["DATABASE_URL"] = _TEST_DATABASE_URL
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3001")


@pytest.fixture(autouse=True)
def truncate_tables():
    yield
    _truncate()
    # Dispose the connection pool so the next test gets a fresh connection
    # without stale identity-map cache from the previous test
    from ai_trust_persistence.database import engine
    import asyncio
    asyncio.get_event_loop().run_until_complete(engine.dispose())


@pytest_asyncio.fixture
async def client():
    from app.main import app
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        timeout=10,
    ) as ac:
        yield ac
