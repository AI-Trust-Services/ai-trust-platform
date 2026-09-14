"""E2E tests for Audit backend — in-process via ASGITransport against a real ClickHouse."""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import httpx

from tests.e2e.conftest import insert_event


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

async def test_health_ok(client: httpx.AsyncClient):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# GET /v1/events — empty / basic
# ---------------------------------------------------------------------------

async def test_list_events_empty(client: httpx.AsyncClient):
    r = await client.get("/v1/events")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 0
    assert body["items"] == []


async def test_list_events_returns_inserted_row(client: httpx.AsyncClient):
    insert_event(
        actor_username="alice",
        action="system.registered",
        resource_type="ai_system",
        ai_system_id="SYS-AAA00001",
        ai_system_name="Alpha",
    )

    r = await client.get("/v1/events")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["actor_username"] == "alice"
    assert item["action"] == "system.registered"
    assert item["resource_type"] == "ai_system"
    assert item["ai_system_id"] == "SYS-AAA00001"
    assert item["ai_system_name"] == "Alpha"
    assert item["source"] == "ui"


# ---------------------------------------------------------------------------
# GET /v1/events — pagination
# ---------------------------------------------------------------------------

async def test_list_events_pagination(client: httpx.AsyncClient):
    for _ in range(5):
        insert_event()

    r = await client.get("/v1/events?limit=2&offset=0")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 5
    assert len(body["items"]) == 2


async def test_list_events_pagination_offset(client: httpx.AsyncClient):
    for _ in range(4):
        insert_event()

    r = await client.get("/v1/events?limit=2&offset=2")
    body = r.json()
    assert body["total"] == 4
    assert len(body["items"]) == 2


# ---------------------------------------------------------------------------
# GET /v1/events — filters
# ---------------------------------------------------------------------------

async def test_list_events_filter_by_ai_system_id(client: httpx.AsyncClient):
    insert_event(ai_system_id="SYS-FILTER01", ai_system_name="System A")
    insert_event(ai_system_id="SYS-FILTER02", ai_system_name="System B")

    r = await client.get("/v1/events?ai_system_id=SYS-FILTER01")
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["ai_system_id"] == "SYS-FILTER01"


async def test_list_events_filter_by_action(client: httpx.AsyncClient):
    insert_event(action="system.registered")
    insert_event(action="system.deleted")

    r = await client.get("/v1/events?action=system.registered")
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["action"] == "system.registered"


async def test_list_events_filter_by_actor(client: httpx.AsyncClient):
    insert_event(actor_username="alice")
    insert_event(actor_username="bob")

    r = await client.get("/v1/events?actor=alice")
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["actor_username"] == "alice"


async def test_list_events_filter_by_resource_type(client: httpx.AsyncClient):
    insert_event(resource_type="ai_system")
    insert_event(resource_type="assessment")

    r = await client.get("/v1/events?resource_type=ai_system")
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["resource_type"] == "ai_system"


# ---------------------------------------------------------------------------
# GET /v1/events — search
# ---------------------------------------------------------------------------

async def test_list_events_search_by_actor(client: httpx.AsyncClient):
    insert_event(actor_username="charlie-search")
    insert_event(actor_username="dave")

    r = await client.get("/v1/events?search=charlie")
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["actor_username"] == "charlie-search"


async def test_list_events_search_no_match(client: httpx.AsyncClient):
    insert_event(actor_username="alice")

    r = await client.get("/v1/events?search=zzznomatch")
    body = r.json()
    assert body["total"] == 0


async def test_list_events_search_by_ai_system_name(client: httpx.AsyncClient):
    insert_event(ai_system_name="WeatherBot Pro")
    insert_event(ai_system_name="OtherSystem")

    r = await client.get("/v1/events?search=weatherbot")
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["ai_system_name"] == "WeatherBot Pro"


# ---------------------------------------------------------------------------
# GET /v1/events — sort
# ---------------------------------------------------------------------------

async def test_list_events_sort_desc(client: httpx.AsyncClient):
    now = datetime.now(timezone.utc)
    insert_event(id="sort-old", created_at=now - timedelta(seconds=10))
    time.sleep(0.1)  # ensure ClickHouse flushes both rows before querying
    insert_event(id="sort-new", created_at=now)

    r = await client.get("/v1/events?sort=desc")
    items = r.json()["items"]
    assert len(items) == 2
    assert items[0]["id"] == "sort-new"
    assert items[1]["id"] == "sort-old"


async def test_list_events_sort_asc(client: httpx.AsyncClient):
    now = datetime.now(timezone.utc)
    insert_event(id="asc-old", created_at=now - timedelta(seconds=10))
    insert_event(id="asc-new", created_at=now)

    r = await client.get("/v1/events?sort=asc")
    items = r.json()["items"]
    assert len(items) == 2
    assert items[0]["id"] == "asc-old"
    assert items[1]["id"] == "asc-new"


# ---------------------------------------------------------------------------
# GET /v1/events/{id}
# ---------------------------------------------------------------------------

async def test_get_event_detail(client: httpx.AsyncClient):
    event_id = insert_event(
        id="detail-test-001",
        actor_username="eve",
        action="system.reclassified",
        resource_type="ai_system",
        ai_system_id="SYS-DET00001",
        changes={"tier": {"before": "minimal", "after": "high"}},
    )

    r = await client.get(f"/v1/events/{event_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == event_id
    assert body["actor_username"] == "eve"
    assert body["action"] == "system.reclassified"
    assert body["changes"] == {"tier": {"before": "minimal", "after": "high"}}


async def test_get_event_not_found(client: httpx.AsyncClient):
    r = await client.get("/v1/events/nonexistent-id-xyz")
    assert r.status_code == 404


async def test_get_event_detail_no_changes(client: httpx.AsyncClient):
    event_id = insert_event(id="no-changes-001", changes={})

    r = await client.get(f"/v1/events/{event_id}")
    assert r.status_code == 200
    assert r.json()["changes"] == {}


# ---------------------------------------------------------------------------
# GET /v1/systems
# ---------------------------------------------------------------------------

async def test_list_systems_empty(client: httpx.AsyncClient):
    r = await client.get("/v1/systems")
    assert r.status_code == 200
    assert r.json() == []


async def test_list_systems_returns_distinct(client: httpx.AsyncClient):
    insert_event(ai_system_id="SYS-DST00001", ai_system_name="Alpha")
    insert_event(ai_system_id="SYS-DST00001", ai_system_name="Alpha")
    insert_event(ai_system_id="SYS-DST00002", ai_system_name="Beta")

    r = await client.get("/v1/systems")
    assert r.status_code == 200
    systems = r.json()
    ids = {s["id"] for s in systems}
    assert ids == {"SYS-DST00001", "SYS-DST00002"}
    assert len(systems) == 2


async def test_list_systems_filtered_by_action(client: httpx.AsyncClient):
    insert_event(ai_system_id="SYS-FA000001", ai_system_name="Alpha", action="system.registered")
    insert_event(ai_system_id="SYS-FA000002", ai_system_name="Beta", action="system.deleted")

    r = await client.get("/v1/systems?action=system.registered")
    systems = r.json()
    assert len(systems) == 1
    assert systems[0]["id"] == "SYS-FA000001"


async def test_list_systems_excludes_empty_ai_system_id(client: httpx.AsyncClient):
    insert_event(ai_system_id="", ai_system_name="")
    insert_event(ai_system_id="SYS-NONEMPTY1", ai_system_name="Real System")

    r = await client.get("/v1/systems")
    systems = r.json()
    assert len(systems) == 1
    assert systems[0]["id"] == "SYS-NONEMPTY1"


# ---------------------------------------------------------------------------
# GET /v1/stats
# ---------------------------------------------------------------------------

async def test_stats_empty(client: httpx.AsyncClient):
    r = await client.get("/v1/stats")
    assert r.status_code == 200
    body = r.json()
    assert body["total"]["count"] == 0
    assert body["total"]["trend_pct"] is None
    assert body["system_events"]["count"] == 0
    assert body["risk_and_compliance"]["count"] == 0


async def test_stats_counts_by_category(client: httpx.AsyncClient):
    insert_event(resource_type="ai_system")
    insert_event(resource_type="ai_system")
    insert_event(resource_type="assessment")
    insert_event(resource_type="evidence")
    insert_event(resource_type="framework")  # no category — not counted in sub-cats

    r = await client.get("/v1/stats")
    body = r.json()
    assert body["total"]["count"] == 5
    assert body["system_events"]["count"] == 2
    assert body["risk_and_compliance"]["count"] == 2


async def test_stats_trend_increases(client: httpx.AsyncClient):
    now = datetime.now(timezone.utc)
    # 1 event in previous window (8–14 days ago), 3 in current window (last 7 days)
    insert_event(created_at=now - timedelta(days=10))
    insert_event(created_at=now - timedelta(days=1))
    insert_event(created_at=now - timedelta(days=2))
    insert_event(created_at=now - timedelta(days=3))

    r = await client.get("/v1/stats")
    body = r.json()
    # 3 current vs 1 previous → +200% trend
    assert body["total"]["count"] == 3
    assert body["total"]["trend_pct"] == 200.0


async def test_stats_trend_no_previous(client: httpx.AsyncClient):
    # Events only in current window, nothing before → trend_pct is None
    insert_event()

    r = await client.get("/v1/stats")
    body = r.json()
    assert body["total"]["count"] == 1
    assert body["total"]["trend_pct"] is None
