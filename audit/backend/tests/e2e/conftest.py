"""
E2E test infrastructure for Audit backend.

Uses httpx.AsyncClient + ASGITransport — no running server needed.
Requires:
  - Docker Compose ClickHouse running on localhost:8123

Auto-skips if ClickHouse is not reachable.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

import clickhouse_connect
import httpx
import pytest
import pytest_asyncio

_CH_HOST = os.environ.get("CLICKHOUSE_HOST", "localhost")
_CH_PORT = int(os.environ.get("CLICKHOUSE_PORT", "8123"))
_CH_USER = os.environ.get("CLICKHOUSE_USER", "default")
_CH_PASSWORD = os.environ.get("CLICKHOUSE_PASSWORD", "")


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


def _ch_client():
    return clickhouse_connect.get_client(
        host=_CH_HOST, port=_CH_PORT,
        username=_CH_USER, password=_CH_PASSWORD,
        database="otel",
    )


def _ensure_table() -> None:
    # Create without TTL/storage policy so tests work without MinIO.
    _ch_client().command("""
        CREATE TABLE IF NOT EXISTS otel.audit_events
        (
            id               String,
            created_at       DateTime     DEFAULT now(),
            actor_username   String,
            action           String,
            resource_type    String,
            resource_id      String,
            ai_system_id     String       DEFAULT '',
            ai_system_name   String       DEFAULT '',
            changes          String       DEFAULT '{}',
            source           String       DEFAULT 'ui'
        ) ENGINE = MergeTree()
        PARTITION BY toYYYYMM(created_at)
        ORDER BY (created_at, ai_system_id, action)
    """)


def _truncate_ch() -> None:
    _ch_client().command("TRUNCATE TABLE IF EXISTS otel.audit_events")


def insert_event(
    *,
    id: str = "",
    actor_username: str = "test-user",
    action: str = "system.registered",
    resource_type: str = "ai_system",
    resource_id: str = "",
    ai_system_id: str = "SYS-TEST0001",
    ai_system_name: str = "Test System",
    changes: dict | None = None,
    source: str = "ui",
    created_at: datetime | None = None,
) -> str:
    event_id = id or uuid.uuid4().hex
    ts = created_at if created_at is not None else datetime.now(timezone.utc)
    _ch_client().insert(
        "otel.audit_events",
        [[
            event_id,
            ts.replace(tzinfo=None),
            actor_username,
            action,
            resource_type,
            resource_id or uuid.uuid4().hex,
            ai_system_id,
            ai_system_name,
            json.dumps(changes or {}),
            source,
        ]],
        column_names=[
            "id", "created_at", "actor_username", "action",
            "resource_type", "resource_id", "ai_system_id",
            "ai_system_name", "changes", "source",
        ],
    )
    return event_id


@pytest.fixture(scope="session", autouse=True)
def e2e_setup():
    if not _ch_reachable():
        pytest.skip("ClickHouse not reachable at localhost:8123 — start Docker Compose first")

    _ensure_table()
    _truncate_ch()

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
    _truncate_ch()


@pytest_asyncio.fixture
async def client():
    from app.main import app
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        timeout=10,
    ) as ac:
        yield ac
