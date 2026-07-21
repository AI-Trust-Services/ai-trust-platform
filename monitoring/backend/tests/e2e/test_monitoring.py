"""E2E tests for Monitoring backend — in-process via ASGITransport against ai_trust_test.

Postgres holds the registry (ai_systems, model_cards); ClickHouse holds span
telemetry (otel.gen_ai_spans). The three endpoints join across both stores.
"""
from __future__ import annotations

import uuid

import httpx

from tests.e2e.conftest import insert_span

from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.model_card import ModelCard


def _sys(**kwargs) -> AISystem:
    defaults = dict(
        id=f"SYS-{uuid.uuid4().hex[:8].upper()}",
        name="Test System",
        tier="minimal",
        lifecycle="development",
        compliance=0.0,
    )
    return AISystem(**{**defaults, **kwargs})


def _model(**kwargs) -> ModelCard:
    defaults = dict(
        id=f"MDL-{uuid.uuid4().hex[:8].upper()}",
        name="Test Model",
        provider="Test Provider",
    )
    return ModelCard(**{**defaults, **kwargs})


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

async def test_health_returns_ok(client: httpx.AsyncClient):
    r = await client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"


# ---------------------------------------------------------------------------
# GET /monitoring/services
# ---------------------------------------------------------------------------

async def test_services_empty_when_no_spans(client: httpx.AsyncClient):
    r = await client.get("/api/v1/monitoring/services")
    assert r.status_code == 200
    assert r.json() == []


async def test_services_returns_registered_system(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add(_sys(id="SYS-AAAA1111", name="Weather Bot"))
        await session.commit()

    insert_span("SYS-AAAA1111")
    insert_span("SYS-AAAA1111")

    r = await client.get("/api/v1/monitoring/services")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["service_name"] == "SYS-AAAA1111"
    assert row["system_id"] == "SYS-AAAA1111"
    assert row["display_name"] == "Weather Bot"
    assert row["total_spans"] == 2
    assert row["last_seen"]  # non-empty timestamp string


async def test_services_drops_unregistered_service_names(client: httpx.AsyncClient):
    # Span whose service_name matches no registered system → must be dropped.
    insert_span("unregistered-service")

    r = await client.get("/api/v1/monitoring/services")
    assert r.status_code == 200
    assert r.json() == []


async def test_services_returns_only_registered_and_orders_by_span_count(
    client: httpx.AsyncClient,
):
    async with SessionLocal() as session:
        session.add_all([
            _sys(id="SYS-REG10001", name="Busy System"),
            _sys(id="SYS-REG20002", name="Quiet System"),
        ])
        await session.commit()

    # Busy has more spans than Quiet; an orphan should never appear.
    for _ in range(3):
        insert_span("SYS-REG10001")
    insert_span("SYS-REG20002")
    insert_span("orphan-service")

    r = await client.get("/api/v1/monitoring/services")
    rows = r.json()
    assert [row["system_id"] for row in rows] == ["SYS-REG10001", "SYS-REG20002"]
    assert rows[0]["total_spans"] == 3
    assert rows[1]["total_spans"] == 1


# ---------------------------------------------------------------------------
# GET /monitoring/signals
# ---------------------------------------------------------------------------

async def test_signals_empty_registry_returns_zeroed_shape(client: httpx.AsyncClient):
    # No registered systems at all → early return with zeroed KPIs.
    insert_span("orphan-service")  # present in CH but no registry rows

    r = await client.get("/api/v1/monitoring/signals")
    assert r.status_code == 200
    body = r.json()
    assert body["timeseries"] == []
    assert body["kpis"] == {
        "total_inferences": 0,
        "avg_latency_ms": 0.0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
    }


async def test_signals_specific_service_aggregates_kpis(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add(_sys(id="SYS-SIG10001", name="Signal System"))
        await session.commit()

    insert_span("SYS-SIG10001", duration_ms=100.0, input_tokens=50, output_tokens=30)
    insert_span("SYS-SIG10001", duration_ms=200.0, input_tokens=10, output_tokens=20)

    r = await client.get("/api/v1/monitoring/signals?service=SYS-SIG10001")
    assert r.status_code == 200
    body = r.json()
    assert body["display_name"] == "Signal System"
    kpis = body["kpis"]
    assert kpis["total_inferences"] == 2
    assert kpis["avg_latency_ms"] == 150.0
    assert kpis["total_input_tokens"] == 60
    assert kpis["total_output_tokens"] == 50
    # Timeseries buckets present and ascending by time.
    times = [pt["time"] for pt in body["timeseries"]]
    assert times == sorted(times)


async def test_signals_all_systems_excludes_orphan_spans(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add(_sys(id="SYS-SIG20002", name="Registered"))
        await session.commit()

    insert_span("SYS-SIG20002", input_tokens=5, output_tokens=5)
    insert_span("orphan-service", input_tokens=999, output_tokens=999)

    # "All Systems" (no service param) → registered IDs only, orphan excluded.
    r = await client.get("/api/v1/monitoring/signals")
    assert r.status_code == 200
    kpis = r.json()["kpis"]
    assert kpis["total_inferences"] == 1
    assert kpis["total_input_tokens"] == 5
    assert kpis["total_output_tokens"] == 5


async def test_signals_unknown_window_does_not_error(client: httpx.AsyncClient):
    # Unknown window falls back to the 1h interval — should still return 200.
    async with SessionLocal() as session:
        session.add(_sys(id="SYS-SIG30003", name="W"))
        await session.commit()
    insert_span("SYS-SIG30003")

    r = await client.get("/api/v1/monitoring/signals?service=SYS-SIG30003&window=bogus")
    assert r.status_code == 200
    assert r.json()["kpis"]["total_inferences"] == 1


async def test_signals_valid_windows_accepted(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add(_sys(id="SYS-SIG40004", name="W2"))
        await session.commit()
    insert_span("SYS-SIG40004")

    for window in ("15m", "1h", "6h", "24h"):
        r = await client.get(
            f"/api/v1/monitoring/signals?service=SYS-SIG40004&window={window}"
        )
        assert r.status_code == 200, window
        assert r.json()["kpis"]["total_inferences"] == 1, window


# ---------------------------------------------------------------------------
# GET /monitoring/stats — empty
# ---------------------------------------------------------------------------

async def test_stats_empty_db(client: httpx.AsyncClient):
    r = await client.get("/api/v1/monitoring/stats")
    assert r.status_code == 200
    body = r.json()
    assert body["total_systems"] == 0
    assert body["avg_compliance"] == 0.0
    assert body["prohibited_count"] == 0
    assert body["high_count"] == 0
    assert body["below_50_compliance"] == 0
    assert body["total_models"] == 0
    assert body["open_weights_count"] == 0
    assert body["by_tier"] == {}
    assert body["by_lifecycle"] == {}
    assert body["by_type"] == {}
    assert body["by_autonomy"] == {}
    assert body["compliance_by_tier"] == {}
    assert body["by_model_type"] == {}
    assert body["by_model_provider"] == {}
    assert body["compliance_histogram"] == {
        "0–20": 0, "20–40": 0, "40–60": 0, "60–80": 0, "80–100": 0
    }
    assert body["recent"] == []


# ---------------------------------------------------------------------------
# GET /monitoring/stats — KPI counts
# ---------------------------------------------------------------------------

async def test_stats_kpi_counts(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(tier="prohibited", compliance=10.0),
            _sys(tier="prohibited", compliance=90.0),
            _sys(tier="high", compliance=40.0),
            _sys(tier="minimal", compliance=80.0),
        ])
        await session.commit()

    r = await client.get("/api/v1/monitoring/stats")
    body = r.json()
    assert body["total_systems"] == 4
    assert body["avg_compliance"] == 55.0  # (10+90+40+80)/4
    assert body["prohibited_count"] == 2
    assert body["high_count"] == 1
    assert body["below_50_compliance"] == 2  # 10.0 and 40.0


# ---------------------------------------------------------------------------
# GET /monitoring/stats — distributions
# ---------------------------------------------------------------------------

async def test_stats_by_tier(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([_sys(tier="minimal"), _sys(tier="minimal"), _sys(tier="high")])
        await session.commit()

    r = await client.get("/api/v1/monitoring/stats")
    assert r.json()["by_tier"] == {"minimal": 2, "high": 1}


async def test_stats_by_type_and_autonomy(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(system_type="application", autonomy_level="decision_support"),
            _sys(system_type="application", autonomy_level="autonomous"),
            _sys(system_type="model", autonomy_level="autonomous"),
        ])
        await session.commit()

    r = await client.get("/api/v1/monitoring/stats")
    body = r.json()
    assert body["by_type"] == {"application": 2, "model": 1}
    assert body["by_autonomy"] == {"decision_support": 1, "autonomous": 2}


async def test_stats_compliance_histogram(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(compliance=10.0),   # 0–20
            _sys(compliance=25.0),   # 20–40
            _sys(compliance=50.0),   # 40–60
            _sys(compliance=70.0),   # 60–80
            _sys(compliance=90.0),   # 80–100
            _sys(compliance=100.0),  # 80–100
        ])
        await session.commit()

    r = await client.get("/api/v1/monitoring/stats")
    assert r.json()["compliance_histogram"] == {
        "0–20": 1, "20–40": 1, "40–60": 1, "60–80": 1, "80–100": 2
    }


async def test_stats_compliance_by_tier(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(tier="high", compliance=40.0),
            _sys(tier="high", compliance=60.0),
            _sys(tier="minimal", compliance=80.0),
        ])
        await session.commit()

    r = await client.get("/api/v1/monitoring/stats")
    cbt = r.json()["compliance_by_tier"]
    assert cbt["high"] == 50.0
    assert cbt["minimal"] == 80.0


# ---------------------------------------------------------------------------
# GET /monitoring/stats — model card stats
# ---------------------------------------------------------------------------

async def test_stats_model_card_distributions(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _model(model_type="llm", provider="OpenAI", open_weights=False),
            _model(model_type="llm", provider="Anthropic", open_weights=True),
            _model(model_type="vision", provider="OpenAI", open_weights=True),
        ])
        await session.commit()

    r = await client.get("/api/v1/monitoring/stats")
    body = r.json()
    assert body["total_models"] == 3
    assert body["by_model_type"] == {"llm": 2, "vision": 1}
    assert body["by_model_provider"] == {"OpenAI": 2, "Anthropic": 1}
    assert body["open_weights_count"] == 2


# ---------------------------------------------------------------------------
# GET /monitoring/stats — recent
# ---------------------------------------------------------------------------

async def test_stats_recent_returns_latest_10_ordered(client: httpx.AsyncClient):
    # Commit each row in its own transaction so server_default=now() yields
    # strictly increasing created_at timestamps.
    for i in range(12):
        async with SessionLocal() as session:
            session.add(_sys(name=f"System {i:02d}"))
            await session.commit()

    r = await client.get("/api/v1/monitoring/stats")
    recent = r.json()["recent"]
    assert len(recent) == 10
    assert recent[0]["name"] == "System 11"
    assert recent[-1]["name"] == "System 02"
    for entry in recent:
        assert {"id", "name", "tier", "lifecycle", "compliance", "created_at"} <= entry.keys()


# ---------------------------------------------------------------------------
# GET /monitoring/stats — lifecycle filter
# ---------------------------------------------------------------------------

async def test_stats_lifecycle_filter_narrows_counts(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(lifecycle="market", tier="high"),
            _sys(lifecycle="market", tier="minimal"),
            _sys(lifecycle="development", tier="high"),
        ])
        await session.commit()

    r = await client.get("/api/v1/monitoring/stats?lifecycle=market")
    body = r.json()
    # total_systems and by_tier respect the filter...
    assert body["total_systems"] == 2
    assert body["by_tier"] == {"high": 1, "minimal": 1}
    # ...but by_lifecycle is intentionally computed unfiltered in the router:
    # it always reports the full lifecycle distribution for context.
    assert body["by_lifecycle"] == {"market": 2, "development": 1}
