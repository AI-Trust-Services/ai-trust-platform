"""
E2E test infrastructure for the risk-management backend.

Uses httpx.AsyncClient + ASGITransport — no running server needed.
The FastAPI app is loaded in-process with DATABASE_URL pointed at
`ai_trust_test` so dev data is never touched.

Requires:
  - Postgres reachable on POSTGRES_HOST:POSTGRES_PORT (defaults: localhost:5432)
  - POSTGRES_USER / POSTGRES_PASSWORD env vars (defaults: postgres/postgres)

The suite auto-skips if Postgres is not reachable.

Modeled on compliance/backend/tests/e2e/conftest.py — see that file for the
rationale behind the NullPool engine override and the "patch before app.main
import" ordering.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

# Must be set before app.main is imported — it raises RuntimeError otherwise.
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3999")

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
# connection per request — no idle pool connections to conflict with TRUNCATE.
# Must be done before app.main (and its routers) are imported.
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


def _pg_reachable() -> bool:
    try:
        conn = psycopg2.connect(
            host=_PG_HOST, port=_PG_PORT, user=_PG_USER, password=_PG_PASSWORD,
            dbname="postgres", connect_timeout=3,
        )
        conn.close()
        return True
    except Exception:
        return False


def _ensure_test_db() -> None:
    conn = psycopg2.connect(
        host=_PG_HOST, port=_PG_PORT, user=_PG_USER, password=_PG_PASSWORD,
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
        [sys.executable, "-m", "alembic", "-c", str(_ALEMBIC_INI), "upgrade", "head"],
        env={**os.environ, "DATABASE_URL": _TEST_DATABASE_URL},
        check=True,
    )


def _truncate() -> None:
    conn = psycopg2.connect(
        host=_PG_HOST, port=_PG_PORT, user=_PG_USER, password=_PG_PASSWORD,
        dbname=_TEST_DB,
    )
    conn.autocommit = True
    cur = conn.cursor()
    # Terminate connections in ClientRead (sent query, waiting for next command) that
    # block TRUNCATE's ACCESS EXCLUSIVE lock. These are asyncpg connections whose
    # Python-side session has been closed but whose TCP connection hasn't been released.
    cur.execute(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
        "WHERE datname = %s AND pid <> pg_backend_pid() "
        "AND (state IN ('idle', 'idle in transaction') "
        "     OR (state = 'active' AND wait_event = 'ClientRead'))",
        (_TEST_DB,),
    )
    cur.execute(
        "TRUNCATE ai_systems, risk_registers, risk_entries, misuse_scenarios, "
        "mitigation_measures, reassessment_triggers, test_reports, plan_tasks, "
        "incidents, library_risks, library_incidents RESTART IDENTITY CASCADE"
    )
    cur.close()
    conn.close()


@pytest.fixture(scope="session", autouse=True)
def e2e_setup():
    """Auto-skip if Postgres unreachable; bypass OpenFGA for all tests."""
    if not _pg_reachable():
        pytest.skip(
            f"Postgres not reachable at {_PG_HOST}:{_PG_PORT} — start Postgres first"
        )
    _ensure_test_db()
    _run_migrations()
    os.environ["DATABASE_URL"] = _TEST_DATABASE_URL

    # Bypass OpenFGA for e2e tests — no OpenFGA instance is available.
    # risks.py calls check_permission(user, ...) directly (not via a FastAPI
    # Depends), so there is nothing to override on `app` — patching the
    # imported name in ai_trust_authorization.permissions (where risks.py's
    # `from ai_trust_authorization import check_permission` resolved it at
    # import time) is sufficient.
    import ai_trust_authorization.openfga_client as _fga

    async def _always_allowed(*_a, **_kw) -> bool:
        return True

    _fga.check = _always_allowed

    yield


@pytest_asyncio.fixture(autouse=True)
async def truncate_tables():
    yield
    _truncate()


@pytest_asyncio.fixture
async def client():
    from app.main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        timeout=10,
        headers={"X-Forwarded-Preferred-Username": "test_engineer"},
    ) as ac:
        yield ac


# ---------------------------------------------------------------------------
# Shared helper functions
# ---------------------------------------------------------------------------

ENGINEER = "test_engineer"
OFFICER = "test_officer"


async def create_system(name: str = "Test System", tier: str = "high", **kwargs) -> dict:
    """Insert an AI system directly into the DB (risk-management has no intake
    endpoint of its own — it reads/writes ai_systems owned by the registry)."""
    from ai_trust_persistence.models import AISystem
    from sqlalchemy.ext.asyncio import AsyncSession

    kwargs.setdefault("lifecycle", "development")
    async with AsyncSession(_test_engine) as session:
        row = AISystem(id=_new_sys_id(), name=name, tier=tier, **kwargs)
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return {"id": row.id, "name": row.name, "tier": row.tier}


_sys_counter = 0


def _new_sys_id() -> str:
    global _sys_counter
    _sys_counter += 1
    return f"SYS-TEST{_sys_counter:04d}"


async def create_register(client: httpx.AsyncClient, system_id: str | None = None, **kwargs) -> dict:
    if system_id is None:
        sys_row = await create_system()
        system_id = sys_row["id"]
    payload = {"assessment_scope": "Test scope", **kwargs}
    r = await client.post(f"/v1/systems/{system_id}/registers", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


async def create_risk(client: httpx.AsyncClient, register_id: str | None = None, **kwargs) -> dict:
    if register_id is None:
        reg = await create_register(client)
        register_id = reg["id"]
    payload = {
        "title": "Test risk",
        "responsible_role": "ai_engineer,ai_compliance_officer",
        **kwargs,
    }
    r = await client.post(f"/v1/registers/{register_id}/risks", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


async def approve_register(client: httpx.AsyncClient, register_id: str) -> dict:
    """Sets next_review_date and approves a register. Caller must have already
    ensured the approval preconditions are met (>=1 risk; for high/prohibited
    tier systems every risk needs a mitigation; unacceptable/acceptable
    residual risks need linked plan tasks)."""
    from datetime import datetime, timedelta, timezone

    next_review = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    r = await client.patch(f"/v1/registers/{register_id}", json={"next_review_date": next_review})
    assert r.status_code == 200, r.text
    r = await client.post(f"/v1/registers/{register_id}/approve", json={})
    assert r.status_code == 200, r.text
    return r.json()
