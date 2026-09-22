"""Unit tests for audit-flush-worker flush_once().

No Docker needed — both ClickHouse client and SQLAlchemy session are mocked.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ai_trust_persistence.models.audit_event import AuditEvent


def _make_event(**kwargs) -> AuditEvent:
    defaults = dict(
        id="EVT-00000001",
        created_at=datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
        actor_username="alice",
        action="system.registered",
        resource_type="ai_system",
        resource_id="SYS-00000001",
        ai_system_id="SYS-00000001",
        ai_system_name="Test System",
        changes={"tier": {"before": None, "after": "minimal"}},
        source="ui",
    )
    return AuditEvent(**{**defaults, **kwargs})


def _mock_session(rows: list) -> AsyncMock:
    """Build an AsyncMock session whose execute().scalars().all() returns rows."""
    execute_result = MagicMock()
    execute_result.scalars.return_value.all.return_value = rows

    session = AsyncMock()
    session.execute = AsyncMock(return_value=execute_result)
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


# ---------------------------------------------------------------------------
# flush_once — no rows
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_flush_once_no_rows_returns_zero():
    session = _mock_session([])
    ch = MagicMock()

    with patch("main.SessionLocal", MagicMock(return_value=session)):
        from main import flush_once
        result = await flush_once(ch)

    assert result == 0
    ch.insert.assert_not_called()
    session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# flush_once — inserts into ClickHouse and deletes from Postgres
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_flush_once_inserts_into_clickhouse():
    session = _mock_session([_make_event()])
    ch = MagicMock()

    with patch("main.SessionLocal", MagicMock(return_value=session)):
        from main import flush_once
        result = await flush_once(ch)

    assert result == 1
    ch.insert.assert_called_once()
    args = ch.insert.call_args
    table_name = args[0][0]
    rows = args[0][1]
    columns = args[1].get("column_names") or args[0][2]

    assert table_name == "audit_events"
    assert len(rows) == 1
    row = rows[0]
    assert row[0] == "EVT-00000001"       # id
    assert row[2] == "alice"              # actor_username
    assert row[3] == "system.registered"  # action
    assert row[4] == "ai_system"          # resource_type
    assert row[6] == "SYS-00000001"       # ai_system_id
    assert row[7] == "Test System"        # ai_system_name
    assert json.loads(row[8]) == {"tier": {"before": None, "after": "minimal"}}
    assert row[9] == "ui"                 # source
    assert "id" in columns


@pytest.mark.asyncio
async def test_flush_once_deletes_rows_from_postgres():
    session = _mock_session([_make_event(id="EVT-DEL00001")])
    ch = MagicMock()

    with patch("main.SessionLocal", MagicMock(return_value=session)):
        from main import flush_once
        await flush_once(ch)

    # execute called twice: SELECT then DELETE
    assert session.execute.call_count == 2
    session.commit.assert_called_once()


@pytest.mark.asyncio
async def test_flush_once_commits_after_delete():
    session = _mock_session([_make_event()])
    ch = MagicMock()

    with patch("main.SessionLocal", MagicMock(return_value=session)):
        from main import flush_once
        await flush_once(ch)

    session.commit.assert_called_once()


# ---------------------------------------------------------------------------
# flush_once — ClickHouse failure leaves Postgres untouched
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_flush_once_clickhouse_failure_does_not_delete():
    session = _mock_session([_make_event()])
    ch = MagicMock()
    ch.insert.side_effect = RuntimeError("ClickHouse unavailable")

    with patch("main.SessionLocal", MagicMock(return_value=session)):
        from main import flush_once
        with pytest.raises(RuntimeError, match="ClickHouse unavailable"):
            await flush_once(ch)

    # DELETE must NOT have been called — rows stay in Postgres for retry
    assert session.execute.call_count == 1  # only the SELECT
    session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# flush_once — correct row shape
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_flush_once_strips_timezone_from_created_at():
    event = _make_event(created_at=datetime(2026, 6, 15, 10, 30, 0, tzinfo=timezone.utc))
    session = _mock_session([event])
    ch = MagicMock()

    with patch("main.SessionLocal", MagicMock(return_value=session)):
        from main import flush_once
        await flush_once(ch)

    row = ch.insert.call_args[0][1][0]
    assert row[1].tzinfo is None  # ClickHouse expects naive UTC


@pytest.mark.asyncio
async def test_flush_once_null_fields_become_empty_strings():
    event = _make_event(ai_system_id=None, ai_system_name=None, changes=None, source=None)
    session = _mock_session([event])
    ch = MagicMock()

    with patch("main.SessionLocal", MagicMock(return_value=session)):
        from main import flush_once
        await flush_once(ch)

    row = ch.insert.call_args[0][1][0]
    assert row[6] == ""    # ai_system_id
    assert row[7] == ""    # ai_system_name
    assert row[8] == "{}"  # changes
    assert row[9] == "ui"  # source
