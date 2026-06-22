"""E2E tests for Overview backend — in-process via ASGITransport against ai_trust_test DB."""
from __future__ import annotations

import uuid

import httpx

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
# Empty database
# ---------------------------------------------------------------------------

async def test_stats_empty_db(client: httpx.AsyncClient):
    r = await client.get("/api/v1/overview/stats")
    assert r.status_code == 200
    body = r.json()

    assert body["total_systems"] == 0
    assert body["avg_compliance"] == 0.0
    assert body["fully_compliant"] == 0
    assert body["high_risk_on_market"] == 0
    assert body["prohibited_count"] == 0
    assert body["high_count"] == 0
    assert body["total_models"] == 0
    assert body["by_tier"] == {}
    assert body["by_lifecycle"] == {}
    assert body["by_type"] == {}
    assert body["compliance_by_tier"] == {}
    assert body["compliance_histogram"] == {"0–20": 0, "20–40": 0, "40–60": 0, "60–80": 0, "80–100": 0}
    assert body["by_model_type"] == {}
    assert body["by_model_provider"] == {}
    assert body["recent"] == []
    assert body["attention"] == []


# ---------------------------------------------------------------------------
# KPI counts
# ---------------------------------------------------------------------------

async def test_total_systems(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([_sys(name="A"), _sys(name="B"), _sys(name="C")])
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    assert r.json()["total_systems"] == 3


async def test_avg_compliance(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(compliance=40.0),
            _sys(compliance=80.0),
        ])
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    assert r.json()["avg_compliance"] == 60.0


async def test_fully_compliant_count(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(compliance=100.0),
            _sys(compliance=100.0),
            _sys(compliance=99.9),
        ])
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    assert r.json()["fully_compliant"] == 2


async def test_high_risk_on_market(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(tier="high", lifecycle="market"),
            _sys(tier="high", lifecycle="post-market"),
            _sys(tier="high", lifecycle="development"),  # not on market
            _sys(tier="minimal", lifecycle="market"),    # not high
        ])
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    assert r.json()["high_risk_on_market"] == 2


async def test_prohibited_count_and_high_count(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(tier="prohibited"),
            _sys(tier="prohibited"),
            _sys(tier="high"),
            _sys(tier="minimal"),
        ])
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    body = r.json()
    assert body["prohibited_count"] == 2
    assert body["high_count"] == 1


# ---------------------------------------------------------------------------
# Distributions
# ---------------------------------------------------------------------------

async def test_by_tier(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(tier="minimal"),
            _sys(tier="minimal"),
            _sys(tier="high"),
        ])
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    assert r.json()["by_tier"] == {"minimal": 2, "high": 1}


async def test_by_lifecycle(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(lifecycle="development"),
            _sys(lifecycle="market"),
            _sys(lifecycle="market"),
        ])
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    assert r.json()["by_lifecycle"] == {"development": 1, "market": 2}


async def test_by_type(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(system_type="application"),
            _sys(system_type="application"),
            _sys(system_type="model"),
        ])
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    assert r.json()["by_type"] == {"application": 2, "model": 1}


async def test_compliance_histogram(client: httpx.AsyncClient):
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

    r = await client.get("/api/v1/overview/stats")
    hist = r.json()["compliance_histogram"]
    assert hist == {"0–20": 1, "20–40": 1, "40–60": 1, "60–80": 1, "80–100": 2}


async def test_compliance_by_tier(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(tier="high", compliance=40.0),
            _sys(tier="high", compliance=60.0),
            _sys(tier="minimal", compliance=80.0),
        ])
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    cbt = r.json()["compliance_by_tier"]
    assert cbt["high"] == 50.0
    assert cbt["minimal"] == 80.0


# ---------------------------------------------------------------------------
# Model card stats
# ---------------------------------------------------------------------------

async def test_total_models_and_distributions(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _model(model_type="llm", provider="OpenAI", open_weights=False),
            _model(model_type="llm", provider="Anthropic", open_weights=True),
            _model(model_type="vision", provider="OpenAI", open_weights=False),
        ])
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    body = r.json()
    assert body["total_models"] == 3
    assert body["by_model_type"] == {"llm": 2, "vision": 1}
    assert body["by_model_provider"] == {"OpenAI": 2, "Anthropic": 1}


# ---------------------------------------------------------------------------
# Recent systems
# ---------------------------------------------------------------------------

async def test_recent_returns_latest_10_ordered(client: httpx.AsyncClient):
    # Commit each row in its own transaction so server_default=now() yields
    # strictly increasing created_at timestamps (Postgres now() is the
    # transaction start time, not the row insert time).
    for i in range(12):
        async with SessionLocal() as session:
            session.add(_sys(name=f"System {i:02d}"))
            await session.commit()

    r = await client.get("/api/v1/overview/stats")
    recent = r.json()["recent"]
    assert len(recent) == 10
    # Latest first: System 11 is newest, System 02 is the 10th most recent.
    assert recent[0]["name"] == "System 11"
    assert recent[-1]["name"] == "System 02"
    for entry in recent:
        assert {"id", "name", "tier", "lifecycle", "compliance", "created_at"} <= entry.keys()


# ---------------------------------------------------------------------------
# Attention list
# ---------------------------------------------------------------------------

async def test_attention_includes_prohibited(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add(_sys(name="Bad Bot", tier="prohibited", lifecycle="market"))
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    attention = r.json()["attention"]
    assert len(attention) == 1
    item = attention[0]
    assert item["name"] == "Bad Bot"
    assert item["reason"] == "Prohibited system"
    assert {"id", "tier", "lifecycle", "compliance", "model_id"} <= item.keys()


async def test_attention_includes_high_risk_low_compliance_on_market(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        mc = _model()
        session.add(mc)
        await session.flush()
        session.add(_sys(tier="high", lifecycle="market", compliance=30.0, model_id=mc.id))
        # high on market but compliance >= 50 → not in attention
        session.add(_sys(tier="high", lifecycle="market", compliance=60.0, model_id=mc.id))
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    attention = r.json()["attention"]
    assert len(attention) == 1
    assert attention[0]["reason"] == "High-risk on market with low compliance"


async def test_attention_includes_on_market_without_model_card(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        # System on market with no model card → should appear in attention.
        session.add(_sys(tier="minimal", lifecycle="market", model_id=None))
        # Same lifecycle but with a linked model card → should NOT appear.
        mc = _model()
        session.add(mc)
        await session.flush()
        session.add(_sys(tier="minimal", lifecycle="market", model_id=mc.id))
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    attention = r.json()["attention"]
    assert len(attention) == 1
    assert attention[0]["reason"] == "On market without model card"


async def test_attention_capped_at_20(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        for _ in range(25):
            session.add(_sys(tier="prohibited"))
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    assert len(r.json()["attention"]) == 20


async def test_attention_excludes_clean_systems(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        # minimal, development, no model card — should NOT appear in attention
        session.add(_sys(tier="minimal", lifecycle="development", model_id=None))
        await session.commit()

    r = await client.get("/api/v1/overview/stats")
    assert r.json()["attention"] == []
