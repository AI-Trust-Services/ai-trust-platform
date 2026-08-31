"""
E2E test infrastructure for the compliance backend.

Uses httpx.AsyncClient + ASGITransport — no running server needed.
The FastAPI app is loaded in-process with DATABASE_URL pointed at
`ai_trust_test` so dev data is never touched.

Requires:
  - Docker Compose Postgres running on localhost:5432
  - POSTGRES_USER / POSTGRES_PASSWORD env vars (defaults: postgres/postgres)

The suite auto-skips if Postgres is not reachable.

MinIO env vars are set at module level (before any import) so minio_client.py
module-level code does not crash. MinIO functions are patched to no-ops in
e2e_setup so no real MinIO instance is needed.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, patch

# Must be set before app.main is imported — minio_client reads these at import time.
os.environ.setdefault("MINIO_ENDPOINT", "localhost:9000")
os.environ.setdefault("MINIO_PUBLIC_ENDPOINT", "localhost:9000")
os.environ.setdefault("MINIO_ROOT_USER", "minioadmin")
os.environ.setdefault("MINIO_ROOT_PASSWORD", "minioadmin")
os.environ.setdefault("MINIO_SECURE", "false")
os.environ.setdefault("MINIO_REGION", "us-east-1")

# Set a placeholder DATABASE_URL at collection time so ai_trust_persistence can
# be imported during test collection. The real test DB URL is set in e2e_setup
# before any test runs (and before SessionLocal is first used).
_PG_USER = os.environ.get("POSTGRES_USER", "postgres")
_PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "postgres")
_PG_HOST = "localhost"
_PG_PORT = 5432
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

# Patch at both the database module and package level.
# Routers that do `from ai_trust_persistence import SessionLocal` bind the name
# at their own import time — they are imported lazily inside the `client` fixture
# (via `from app.main import app`) which happens AFTER this conftest runs, so the
# patched value is what they see.
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
    # frameworks is excluded — seeded by migration, never modified by tests.
    cur.execute(
        "TRUNCATE ai_systems, assessments, obligations, controls, evidence, "
        "control_obligations, evidence_controls, evidence_obligations, "
        "evidence_ai_systems, evidence_assessments, "
        "service_model_baselines RESTART IDENTITY CASCADE"
    )
    cur.close()
    conn.close()


@pytest.fixture(scope="session", autouse=True)
def e2e_setup():
    """Auto-skip if Postgres unreachable; patch MinIO to no-ops for all tests."""
    if not _pg_reachable():
        pytest.skip("Postgres not reachable at localhost:5432 — start Docker Compose first")
    _ensure_test_db()
    _run_migrations()
    os.environ["DATABASE_URL"] = _TEST_DATABASE_URL
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3006")
    os.environ.setdefault("OPENFGA_URL", "http://localhost:8080")
    os.environ.setdefault("OPENFGA_STORE_ID", "test-store-id")

    with (
        patch("app.minio_client.ensure_bucket", new_callable=AsyncMock),
        patch("app.minio_client.upload_file", new=AsyncMock(return_value="evidence/EVD-TEST/file.pdf")),
        patch("app.minio_client.get_presigned_url", new=AsyncMock(return_value="http://localhost:9000/evidence-files/evidence/EVD-TEST/file.pdf")),
        patch("app.minio_client.delete_file", new_callable=AsyncMock),
    ):
        # Bypass OpenFGA for e2e tests — no OpenFGA instance is available.
        import ai_trust_authorization.openfga_client as _fga
        from app.main import app
        from ai_trust_authorization.permissions import get_current_user

        async def _always_allowed(*_a, **_kw) -> bool:
            return True

        _fga.check = _always_allowed
        app.dependency_overrides[get_current_user] = lambda: "test-user"

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
    ) as ac:
        yield ac


@pytest_asyncio.fixture
async def db_session():
    """Bare AsyncSession for cascade tests. truncate_tables handles cleanup."""
    from sqlalchemy.ext.asyncio import AsyncSession
    session = AsyncSession(_test_engine)
    try:
        yield session
    finally:
        # Invalidate the underlying connection before closing so SQLAlchemy does not
        # warn about a non-checked-in connection if pg_terminate_backend killed it.
        try:
            conn = await session.connection()
            await conn.invalidate()
        except Exception:
            pass
        try:
            await session.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Shared helper functions
# ---------------------------------------------------------------------------

async def create_system(name: str = "Test System", tier: str = "minimal", **kwargs) -> dict:
    """Insert an AI system directly into the DB (compliance app has no intake endpoint).

    Defaults ``workflow_status`` to ``approved`` because assessments can only be created
    for approved systems — pass ``workflow_status=`` explicitly to test the guard.
    """
    from ai_trust_persistence.models import AISystem
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.ids import new_id

    kwargs.setdefault("workflow_status", "approved")
    async with AsyncSession(_test_engine) as session:
        row = AISystem(id=new_id("SYS"), name=name, tier=tier, **kwargs)
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return {"id": row.id, "name": row.name, "tier": row.tier, "lifecycle": row.lifecycle}


async def create_assessment(client: httpx.AsyncClient, system_id: str, **kwargs) -> dict:
    payload = {
        "ai_system_id": system_id,
        "framework_id": "FRM-EU-AI-ACT",
        "title": "Test Assessment",
        "type": "compliance",
        **kwargs,
    }
    r = await client.post("/v1/assessments", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


async def create_obligation(client: httpx.AsyncClient, assessment_id: str, **kwargs) -> dict:
    payload = {
        "assessment_id": assessment_id,
        "title": "Test Obligation",
        **kwargs,
    }
    r = await client.post("/v1/obligations", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


async def create_control(client: httpx.AsyncClient, system_id: str | None = None, **kwargs) -> dict:
    payload = {
        "title": "Test Control",
        "category": "general",
        **kwargs,
    }
    if system_id:
        payload["ai_system_id"] = system_id
    r = await client.post("/v1/controls", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


async def create_evidence(client: httpx.AsyncClient, **kwargs) -> dict:
    """Creates evidence without a file."""
    data = {"title": "Test Evidence", "evidence_type": "document", **kwargs}
    r = await client.post("/v1/evidence", data=data)
    assert r.status_code == 201, r.text
    return r.json()
