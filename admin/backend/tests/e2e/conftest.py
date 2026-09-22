"""
E2E test infrastructure for the admin backend.

Uses httpx.AsyncClient + ASGITransport — no running server needed.
The FastAPI app is loaded in-process with DATABASE_URL pointed at
`ai_trust_test` so dev data is never touched.

Requires:
  - Docker Compose Postgres running on localhost:5432
  - POSTGRES_USER / POSTGRES_PASSWORD env vars (defaults: postgres/postgres)

The suite auto-skips if Postgres is not reachable.

What is tested:
  - Route wiring and HTTP contract (status codes, response shapes)
  - Authorization enforcement (iam:manage gate on every endpoint)
  - Real Postgres persistence (platform_settings table)
  - Branding CRUD: update draft, publish, discard, reset
  - Upload validation (asset_type, content_type, size)
  - Color validation (hex pattern enforcement)
  - SVG sanitization
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

# Must be set before app.main is imported — branding_storage reads these at import time.
os.environ.setdefault("MINIO_ENDPOINT", "localhost:9000")
os.environ.setdefault("MINIO_PUBLIC_ENDPOINT", "localhost:9000")
os.environ.setdefault("MINIO_ROOT_USER", "minioadmin")
os.environ.setdefault("MINIO_ROOT_PASSWORD", "minioadmin")
os.environ.setdefault("MINIO_SECURE", "false")
os.environ.setdefault("MINIO_REGION", "us-east-1")

# Set a placeholder DATABASE_URL at collection time so ai_trust_persistence can
# be imported during test collection. The real test DB URL is set in e2e_setup
# before any test runs.
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

# Patch at both the database module and package level.
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
        [sys.executable, "-m", "alembic", "-c", str(_ALEMBIC_INI), "upgrade", "head"],
        env={**os.environ, "DATABASE_URL": _TEST_DATABASE_URL},
        check=True,
    )


def _reset_platform_settings() -> None:
    """Reset platform_settings to a clean state for branding tests.

    Instead of TRUNCATE (which would violate the startup seed assumption),
    we DELETE then INSERT a fresh row so the seed function sees it as existing.
    """
    conn = psycopg2.connect(
        host=_PG_HOST, port=_PG_PORT,
        user=_PG_USER, password=_PG_PASSWORD,
        dbname=_TEST_DB,
    )
    conn.autocommit = True
    cur = conn.cursor()
    # Terminate idle connections that might block DELETE
    cur.execute(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
        "WHERE datname = %s AND pid <> pg_backend_pid() "
        "AND (state IN ('idle', 'idle in transaction') "
        "     OR (state = 'active' AND wait_event = 'ClientRead'))",
        (_TEST_DB,),
    )
    # Delete and re-insert a clean row
    cur.execute("DELETE FROM platform_settings")
    cur.execute("""
        INSERT INTO platform_settings (id, platform_name, support_email, smtp_ssl, smtp_starttls, org_name)
        VALUES (1, 'AI Trust Platform', NULL, false, false, 'AI Trust')
    """)
    # Also truncate audit_events if it exists (for audit logging tests)
    cur.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_events') THEN
                TRUNCATE audit_events RESTART IDENTITY CASCADE;
            END IF;
        END $$;
    """)
    cur.close()
    conn.close()


@pytest.fixture(scope="session", autouse=True)
def e2e_setup():
    """Auto-skip if Postgres unreachable; patch MinIO and OpenFGA for all tests."""
    if not _pg_reachable():
        pytest.skip(f"Postgres not reachable at {_PG_HOST}:{_PG_PORT} — start Docker Compose first")
    _ensure_test_db()
    _run_migrations()
    os.environ["DATABASE_URL"] = _TEST_DATABASE_URL
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:8080")
    os.environ.setdefault("OPENFGA_URL", "http://localhost:8080")
    os.environ.setdefault("OPENFGA_STORE_ID", "test-store-id")
    os.environ.setdefault("USERS_BACKEND_URL", "http://users-backend:8008")
    # SMTP env vars for startup seed
    os.environ.setdefault("SMTP_HOST", "mailpit")
    os.environ.setdefault("SMTP_PORT", "1025")
    os.environ.setdefault("SMTP_FROM", "noreply@ai-trust.local")
    os.environ.setdefault("SMTP_FROM_NAME", "AI Trust Platform")
    os.environ.setdefault("SMTP_SSL", "false")
    os.environ.setdefault("SMTP_STARTTLS", "false")

    with (
        patch("app.branding_storage.ensure_bucket", new_callable=AsyncMock),
        patch("app.branding_storage.upload_file", new=AsyncMock(return_value="branding/logo_icon/draft/icon.svg")),
        patch("app.branding_storage.get_file", new=AsyncMock(return_value=(b"<svg></svg>", "image/svg+xml"))),
        patch("app.branding_storage.copy_draft_to_published", new=AsyncMock(return_value="branding/logo_icon/icon.svg")),
        patch("app.branding_storage.delete_file", new_callable=AsyncMock),
        # Prevent lifespan seed from running (we control platform_settings via _reset_platform_settings)
        patch("app.startup.seed_settings_from_env", new=AsyncMock()),
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
async def reset_settings():
    """Reset platform_settings before each test so tests are isolated."""
    _reset_platform_settings()
    yield


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
    """Bare AsyncSession for direct DB manipulation in tests."""
    from sqlalchemy.ext.asyncio import AsyncSession
    session = AsyncSession(_test_engine)
    try:
        yield session
    finally:
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
# Backward-compatible helpers for tests that still use mocked sessions
# (smtp, settings, stats tests). These can be migrated to real Postgres later.
# ---------------------------------------------------------------------------

from unittest.mock import AsyncMock, MagicMock


def _default_settings():
    """Return a MagicMock with default platform settings values."""
    row = MagicMock()
    row.id = 1
    row.platform_name = "AI Trust Platform"
    row.support_email = "support@example.com"
    row.smtp_host = "mailpit"
    row.smtp_port = 1025
    row.smtp_user = None
    row.smtp_password = "secret"
    row.smtp_from = "noreply@ai-trust.local"
    row.smtp_from_name = "AI Trust Platform"
    row.smtp_ssl = False
    row.smtp_starttls = False
    # Branding - published values
    row.org_name = "AI Trust"
    row.logo_horizontal_light = None
    row.logo_horizontal_dark = None
    row.logo_icon = None
    row.favicon = None
    row.primary_color = None
    row.secondary_color = None
    row.accent_color = None
    row.warning_color = None
    # Branding - draft values
    row.org_name_draft = None
    row.logo_horizontal_light_draft = None
    row.logo_horizontal_dark_draft = None
    row.logo_icon_draft = None
    row.favicon_draft = None
    row.primary_color_draft = None
    row.secondary_color_draft = None
    row.accent_color_draft = None
    row.warning_color_draft = None
    # Branding publish metadata
    row.branding_published_at = None
    row.branding_published_by = None
    return row


def _make_session(row=None):
    """Return a mock async context-manager session that returns `row` on scalar()."""
    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    session.scalar = AsyncMock(return_value=row if row is not None else _default_settings())
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session
