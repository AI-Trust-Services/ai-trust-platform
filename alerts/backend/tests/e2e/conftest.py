"""
E2E test infrastructure for Alerts backend.

Uses httpx.AsyncClient + ASGITransport — no running server needed.
Requires:
  - Docker Compose Postgres running on localhost:5432
  - Docker Compose ClickHouse running on localhost:8123

Auto-skips if either is not reachable.
"""
from __future__ import annotations

import os
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
import pytest
import pytest_asyncio
import httpx
import clickhouse_connect

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

_CH_HOST = os.environ.get("CLICKHOUSE_HOST", "localhost")
_CH_PORT = int(os.environ.get("CLICKHOUSE_PORT", "8123"))
_CH_USER = os.environ.get("CLICKHOUSE_USER", "default")
_CH_PASSWORD = os.environ.get("CLICKHOUSE_PASSWORD", "")


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


def _ch_reachable() -> bool:
    try:
        client = clickhouse_connect.get_client(
            host=_CH_HOST, port=_CH_PORT,
            username=_CH_USER, password=_CH_PASSWORD,
        )
        client.command("SELECT 1")
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


def _truncate_pg() -> None:
    conn = psycopg2.connect(
        host=_PG_HOST, port=_PG_PORT,
        user=_PG_USER, password=_PG_PASSWORD,
        dbname=_TEST_DB,
    )
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("TRUNCATE alert_rules RESTART IDENTITY CASCADE")
    cur.execute("TRUNCATE service_model_baselines")
    cur.execute("TRUNCATE ai_systems CASCADE")
    cur.close()
    conn.close()


def _truncate_ch() -> None:
    client = clickhouse_connect.get_client(
        host=_CH_HOST, port=_CH_PORT,
        username=_CH_USER, password=_CH_PASSWORD,
    )
    client.command("TRUNCATE TABLE IF EXISTS otel.alert_events")


def _ch_client():
    return clickhouse_connect.get_client(
        host=_CH_HOST, port=_CH_PORT,
        username=_CH_USER, password=_CH_PASSWORD,
    )


def insert_event(
    rule_id: str,
    rule_name: str = "Test Rule",
    category: str = "risk",
    severity: str = "error",
    alert_type: str = "event",
    description: str = "Test description",
    value: float = 1.0,
    triggered_at=None,
    resolved_at=None,
    handled_at=None,
    entity_id: str = "",
    entity_type: str = "",
    entity_model: str = "",
) -> str:
    event_id = str(uuid.uuid4())
    triggered = triggered_at if triggered_at is not None else datetime.now(timezone.utc)
    client = _ch_client()
    client.insert(
        "otel.alert_events",
        [[event_id, rule_id, rule_name, category, severity, alert_type,
          description, value, triggered, resolved_at, handled_at, entity_id, entity_type, entity_model]],
        column_names=["id", "rule_id", "rule_name", "category", "severity",
                      "alert_type", "description", "value_at_trigger",
                      "triggered_at", "resolved_at", "handled_at",
                      "entity_id", "entity_type", "entity_model"],
    )
    return event_id


@pytest.fixture(scope="session", autouse=True)
def e2e_setup():
    if not _pg_reachable():
        pytest.skip("Postgres not reachable at localhost:5432 — start Docker Compose first")
    if not _ch_reachable():
        pytest.skip("ClickHouse not reachable at localhost:8123 — start Docker Compose first")
    _ensure_test_db()
    _run_migrations()
    os.environ["DATABASE_URL"] = _TEST_DATABASE_URL
    os.environ.setdefault("OPENFGA_URL", "http://localhost:8080")
    os.environ.setdefault("OPENFGA_STORE_ID", "test-store-id")
    _truncate_pg()  # clear seeded alert_rules from migrations before tests begin
    _truncate_ch()

    # Bypass OpenFGA for e2e tests — no OpenFGA instance is available.
    import ai_trust_authorization.openfga_client as _fga
    from app.main import app
    from ai_trust_authorization.permissions import get_current_user

    async def _always_allowed(*_a, **_kw) -> bool:
        return True

    _fga.check = _always_allowed
    app.dependency_overrides[get_current_user] = lambda: "test-user"


@pytest.fixture(autouse=True)
def truncate_tables(e2e_setup):
    yield
    _truncate_pg()
    _truncate_ch()
    from ai_trust_persistence.database import engine
    import asyncio
    asyncio.run(engine.dispose())


@pytest_asyncio.fixture
async def client():
    from app.main import app
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        timeout=10,
    ) as ac:
        yield ac
