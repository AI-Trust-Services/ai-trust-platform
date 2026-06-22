"""E2E tests for Alerts backend."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import httpx

from tests.e2e.conftest import insert_event

from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.alert_rule import AlertRule


def _rule(**kwargs) -> AlertRule:
    defaults = dict(
        id=f"rule-{uuid.uuid4().hex[:8]}",
        name="Test Rule",
        category="risk",
        severity="error",
        description="Test description",
        condition_type="prohibited_exists",
        alert_type="event",
        enabled=True,
        source="AI System Registry",
    )
    return AlertRule(**{**defaults, **kwargs})


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

async def test_health_returns_ok(client: httpx.AsyncClient):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["db"] == "ok"


# ---------------------------------------------------------------------------
# GET /alerts/active
# ---------------------------------------------------------------------------

async def test_active_alerts_empty(client: httpx.AsyncClient):
    r = await client.get("/api/v1/alerts/active")
    assert r.status_code == 200
    assert r.json() == []


async def test_active_alerts_returns_unresolved_events(client: httpx.AsyncClient):
    insert_event("rule-1", rule_name="Prohibited System", severity="error")
    insert_event("rule-2", rule_name="High Latency", severity="warning")

    r = await client.get("/api/v1/alerts/active")
    assert r.status_code == 200
    events = r.json()
    assert len(events) == 2
    names = {e["rule_name"] for e in events}
    assert names == {"Prohibited System", "High Latency"}


async def test_active_alerts_excludes_resolved(client: httpx.AsyncClient):
    now = datetime.now(timezone.utc)
    insert_event("rule-1", rule_name="Active")
    insert_event("rule-2", rule_name="Resolved", resolved_at=now)

    r = await client.get("/api/v1/alerts/active")
    events = r.json()
    assert len(events) == 1
    assert events[0]["rule_name"] == "Active"


async def test_active_alerts_excludes_handled(client: httpx.AsyncClient):
    now = datetime.now(timezone.utc)
    insert_event("rule-1", rule_name="Active")
    insert_event("rule-2", rule_name="Handled", handled_at=now)

    r = await client.get("/api/v1/alerts/active")
    events = r.json()
    assert len(events) == 1
    assert events[0]["rule_name"] == "Active"


async def test_active_alerts_sorted_by_severity(client: httpx.AsyncClient):
    # Severity ordering is deterministic regardless of insertion timing because
    # the two events have different severities (the secondary sort never applies).
    insert_event("rule-1", rule_name="Warning Alert", severity="warning")
    insert_event("rule-2", rule_name="Error Alert", severity="error")

    r = await client.get("/api/v1/alerts/active")
    events = r.json()
    assert events[0]["severity"] == "error"
    assert events[1]["severity"] == "warning"


async def test_active_alerts_sorted_by_time_within_same_severity(client: httpx.AsyncClient):
    # Within the same severity the secondary sort is triggered_at DESC. We
    # control insertion timing by passing explicit triggered_at values so the
    # ordering is deterministic even if both events land in the same wall-clock second.
    from datetime import timedelta
    older = datetime.now(timezone.utc) - timedelta(minutes=5)
    newer = datetime.now(timezone.utc)
    insert_event("rule-1", rule_name="Older", severity="error", triggered_at=older)
    insert_event("rule-2", rule_name="Newer", severity="error", triggered_at=newer)

    r = await client.get("/api/v1/alerts/active")
    events = r.json()
    assert events[0]["rule_name"] == "Newer"
    assert events[1]["rule_name"] == "Older"


async def test_active_alerts_response_fields(client: httpx.AsyncClient):
    insert_event("rule-1")
    r = await client.get("/api/v1/alerts/active")
    event = r.json()[0]
    for field in ["id", "rule_id", "rule_name", "category", "severity",
                  "alert_type", "description", "value_at_trigger", "triggered_at"]:
        assert field in event


# ---------------------------------------------------------------------------
# GET /alerts/history
# ---------------------------------------------------------------------------

async def test_history_empty(client: httpx.AsyncClient):
    r = await client.get("/api/v1/alerts/history")
    assert r.status_code == 200
    assert r.json() == []


async def test_history_returns_resolved_events(client: httpx.AsyncClient):
    now = datetime.now(timezone.utc)
    insert_event("rule-1", rule_name="Resolved", resolved_at=now)
    insert_event("rule-2", rule_name="Active")  # should not appear

    r = await client.get("/api/v1/alerts/history")
    events = r.json()
    assert len(events) == 1
    assert events[0]["rule_name"] == "Resolved"


async def test_history_returns_handled_events(client: httpx.AsyncClient):
    now = datetime.now(timezone.utc)
    insert_event("rule-1", rule_name="Handled", handled_at=now)

    r = await client.get("/api/v1/alerts/history")
    events = r.json()
    assert len(events) == 1
    assert events[0]["rule_name"] == "Handled"


async def test_history_response_fields(client: httpx.AsyncClient):
    now = datetime.now(timezone.utc)
    insert_event("rule-1", resolved_at=now)
    r = await client.get("/api/v1/alerts/history")
    event = r.json()[0]
    for field in ["id", "rule_id", "rule_name", "category", "severity",
                  "alert_type", "description", "value_at_trigger",
                  "triggered_at", "resolved_at", "handled_at"]:
        assert field in event


async def test_history_capped_at_100(client: httpx.AsyncClient):
    now = datetime.now(timezone.utc)
    for _ in range(110):
        insert_event("rule-1", resolved_at=now)

    r = await client.get("/api/v1/alerts/history")
    assert len(r.json()) == 100


# ---------------------------------------------------------------------------
# GET /alerts/count
# ---------------------------------------------------------------------------

async def test_count_zero_when_empty(client: httpx.AsyncClient):
    r = await client.get("/api/v1/alerts/count")
    assert r.status_code == 200
    assert r.json() == {"count": 0}


async def test_count_returns_active_only(client: httpx.AsyncClient):
    now = datetime.now(timezone.utc)
    insert_event("rule-1")
    insert_event("rule-2")
    insert_event("rule-3", resolved_at=now)  # resolved — not counted

    r = await client.get("/api/v1/alerts/count")
    assert r.json()["count"] == 2


# ---------------------------------------------------------------------------
# GET /alerts/rules
# ---------------------------------------------------------------------------

async def test_rules_empty(client: httpx.AsyncClient):
    r = await client.get("/api/v1/alerts/rules")
    assert r.status_code == 200
    assert r.json() == []


async def test_rules_returns_seeded_rules(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _rule(name="Rule A", category="risk"),
            _rule(name="Rule B", category="compliance"),
        ])
        await session.commit()

    r = await client.get("/api/v1/alerts/rules")
    rules = r.json()
    assert len(rules) == 2
    names = {ru["name"] for ru in rules}
    assert names == {"Rule A", "Rule B"}


async def test_rules_response_fields(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add(_rule())
        await session.commit()

    r = await client.get("/api/v1/alerts/rules")
    rule = r.json()[0]
    for field in ["id", "name", "category", "severity", "description",
                  "condition_type", "threshold", "source", "alert_type", "enabled"]:
        assert field in rule


async def test_rules_ordered_by_category_then_name(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _rule(name="Z Rule", category="compliance"),
            _rule(name="A Rule", category="compliance"),
            _rule(name="M Rule", category="risk"),
        ])
        await session.commit()

    r = await client.get("/api/v1/alerts/rules")
    rules = r.json()
    assert rules[0]["name"] == "A Rule"
    assert rules[1]["name"] == "Z Rule"
    assert rules[2]["name"] == "M Rule"


# ---------------------------------------------------------------------------
# POST /alerts/events/{id}/handle
# ---------------------------------------------------------------------------

async def test_handle_event_returns_handled_status(client: httpx.AsyncClient):
    event_id = insert_event("rule-1")

    r = await client.post(f"/api/v1/alerts/events/{event_id}/handle")
    assert r.status_code == 200
    assert r.json()["status"] == "handled"
    assert r.json()["event_id"] == event_id


async def test_handle_event_moves_to_history(client: httpx.AsyncClient):
    event_id = insert_event("rule-1")

    await client.post(f"/api/v1/alerts/events/{event_id}/handle")

    active = await client.get("/api/v1/alerts/active")
    history = await client.get("/api/v1/alerts/history")

    active_ids = {e["id"] for e in active.json()}
    history_ids = {e["id"] for e in history.json()}

    assert event_id not in active_ids
    assert event_id in history_ids


async def test_handle_event_is_idempotent(client: httpx.AsyncClient):
    event_id = insert_event("rule-1")

    r1 = await client.post(f"/api/v1/alerts/events/{event_id}/handle")
    r2 = await client.post(f"/api/v1/alerts/events/{event_id}/handle")

    assert r1.status_code == 200
    assert r2.status_code == 200
    # Event should still be in history exactly once after a second handle.
    history = await client.get("/api/v1/alerts/history")
    matching = [e for e in history.json() if e["id"] == event_id]
    assert len(matching) == 1
    assert matching[0]["handled_at"] is not None


# ---------------------------------------------------------------------------
# POST /alerts/rules/{id}/toggle
# ---------------------------------------------------------------------------

async def test_toggle_rule_disables_enabled_rule(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        rule = _rule(enabled=True)
        session.add(rule)
        await session.commit()
        rule_id = rule.id

    r = await client.post(f"/api/v1/alerts/rules/{rule_id}/toggle")
    assert r.status_code == 200
    assert r.json()["enabled"] is False


async def test_toggle_rule_enables_disabled_rule(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        rule = _rule(enabled=False)
        session.add(rule)
        await session.commit()
        rule_id = rule.id

    r = await client.post(f"/api/v1/alerts/rules/{rule_id}/toggle")
    assert r.status_code == 200
    assert r.json()["enabled"] is True


async def test_toggle_rule_returns_404_for_unknown_id(client: httpx.AsyncClient):
    r = await client.post("/api/v1/alerts/rules/nonexistent-id/toggle")
    assert r.status_code == 404
