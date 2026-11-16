"""E2E tests for GET /v1/recent-systems — most-recently-registered systems org-wide."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import httpx

from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem

_NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _sys(created_at: datetime, **kwargs) -> AISystem:
    defaults = dict(
        id=f"SYS-{uuid.uuid4().hex[:8].upper()}",
        name="Test System",
        tier="minimal",
        lifecycle="development",
        compliance=0.0,
        created_at=created_at,
    )
    return AISystem(**{**defaults, **kwargs})


async def _add(*objs) -> None:
    async with SessionLocal() as session:
        for o in objs:
            session.add(o)
        await session.commit()


async def test_recent_systems_empty_db(client: httpx.AsyncClient):
    r = await client.get("/v1/recent-systems")
    assert r.status_code == 200
    assert r.json() == []


async def test_recent_systems_newest_first_and_limited(client: httpx.AsyncClient):
    await _add(
        _sys(_NOW - timedelta(days=3), id="SYS-OLD00001", name="Oldest"),
        _sys(_NOW - timedelta(days=1), id="SYS-MID00001", name="Middle"),
        _sys(_NOW, id="SYS-NEW00001", name="Newest", tier="high", is_chatbot=True),
    )
    r = await client.get("/v1/recent-systems?limit=2")
    assert r.status_code == 200
    rows = r.json()
    assert [row["id"] for row in rows] == ["SYS-NEW00001", "SYS-MID00001"]
    assert rows[0]["name"] == "Newest"
    assert rows[0]["tier"] == "high"
    assert rows[0]["is_chatbot"] is True
    assert rows[0]["created_at"] is not None


async def test_recent_systems_limit_bounds(client: httpx.AsyncClient):
    # limit is clamped to [1, 20]; out-of-range values are rejected (422).
    assert (await client.get("/v1/recent-systems?limit=0")).status_code == 422
    assert (await client.get("/v1/recent-systems?limit=21")).status_code == 422
