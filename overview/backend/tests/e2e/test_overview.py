"""E2E tests for Overview backend — in-process via ASGITransport against ai_trust_test DB."""
from __future__ import annotations

import uuid
from datetime import date, timedelta

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.assessment import Assessment
from ai_trust_persistence.models.evidence import Evidence, evidence_obligations
from ai_trust_persistence.models.framework import Framework
from ai_trust_persistence.models.model_card import ModelCard
from ai_trust_persistence.models.ai_system_model_card import AISystemModelCard
from ai_trust_persistence.models.obligation import Obligation


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
    r = await client.get("/v1/stats")
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

    r = await client.get("/v1/stats")
    assert r.json()["total_systems"] == 3


async def test_avg_compliance(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(compliance=40.0),
            _sys(compliance=80.0),
        ])
        await session.commit()

    r = await client.get("/v1/stats")
    assert r.json()["avg_compliance"] == 60.0


async def test_fully_compliant_count(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(compliance=100.0),
            _sys(compliance=100.0),
            _sys(compliance=99.9),
        ])
        await session.commit()

    r = await client.get("/v1/stats")
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

    r = await client.get("/v1/stats")
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

    r = await client.get("/v1/stats")
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

    r = await client.get("/v1/stats")
    assert r.json()["by_tier"] == {"minimal": 2, "high": 1}


async def test_by_lifecycle(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(lifecycle="development"),
            _sys(lifecycle="market"),
            _sys(lifecycle="market"),
        ])
        await session.commit()

    r = await client.get("/v1/stats")
    assert r.json()["by_lifecycle"] == {"development": 1, "market": 2}


async def test_by_type(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(system_type="application"),
            _sys(system_type="application"),
            _sys(system_type="model"),
        ])
        await session.commit()

    r = await client.get("/v1/stats")
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

    r = await client.get("/v1/stats")
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

    r = await client.get("/v1/stats")
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

    r = await client.get("/v1/stats")
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

    r = await client.get("/v1/stats")
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

    r = await client.get("/v1/stats")
    attention = r.json()["attention"]
    assert len(attention) == 1
    item = attention[0]
    assert item["name"] == "Bad Bot"
    assert item["reason"] == "Prohibited system"
    assert {"id", "tier", "lifecycle", "compliance"} <= item.keys()


async def test_attention_includes_high_risk_low_compliance_on_market(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        mc = _model()
        session.add(mc)
        await session.flush()
        session.add(_sys(tier="high", lifecycle="market", compliance=30.0))
        # high on market but compliance >= 50 → not in attention
        session.add(_sys(tier="high", lifecycle="market", compliance=60.0))
        await session.commit()

    r = await client.get("/v1/stats")
    attention = r.json()["attention"]
    assert len(attention) == 1
    assert attention[0]["reason"] == "High-risk on market with low compliance"


async def test_attention_includes_on_market_without_model_card(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        # System on market with no model card → should appear in attention.
        session.add(_sys(tier="minimal", lifecycle="market"))
        # Same lifecycle but with a linked model card → should NOT appear.
        mc = _model()
        linked = _sys(tier="minimal", lifecycle="market")
        session.add(mc)
        session.add(linked)
        await session.flush()
        await session.execute(
            pg_insert(AISystemModelCard.__table__)
            .values(system_id=linked.id, model_card_id=mc.id)
            .on_conflict_do_nothing()
        )
        await session.commit()

    r = await client.get("/v1/stats")
    attention = r.json()["attention"]
    assert len(attention) == 1
    assert attention[0]["reason"] == "On market without model card"


async def test_attention_capped_at_20(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        for _ in range(25):
            session.add(_sys(tier="prohibited"))
        await session.commit()

    r = await client.get("/v1/stats")
    assert len(r.json()["attention"]) == 20


async def test_attention_excludes_clean_systems(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        # minimal, development, no model card — should NOT appear in attention
        session.add(_sys(tier="minimal", lifecycle="development"))
        await session.commit()

    r = await client.get("/v1/stats")
    assert r.json()["attention"] == []


# ---------------------------------------------------------------------------
# GET /overview/compliance-stats
# ---------------------------------------------------------------------------
#
# FK chain: Framework <- Assessment <- Obligation; Evidence links to Obligation
# via the evidence_obligations M2M table. Obligation.assessment_id is NOT NULL,
# so every obligation needs a parent assessment. `frameworks` is seeded by
# migrations and never truncated, so framework_compliance is never empty.

def _fw(**kwargs) -> Framework:
    defaults = dict(id=f"FRM-{uuid.uuid4().hex[:8].upper()}", name="Test Framework", enabled=True)
    return Framework(**{**defaults, **kwargs})


def _ass(sys_id: str, fw_id: str, **kwargs) -> Assessment:
    defaults = dict(
        id=f"ASS-{uuid.uuid4().hex[:8].upper()}",
        ai_system_id=sys_id,
        framework_id=fw_id,
        title="Test Assessment",
        status="draft",
    )
    return Assessment(**{**defaults, **kwargs})


def _obl(ass_id: str, sys_id: str, fw_id: str, status: str = "applicable", **kwargs) -> Obligation:
    defaults = dict(
        id=f"OBL-{uuid.uuid4().hex[:8].upper()}",
        assessment_id=ass_id,
        ai_system_id=sys_id,
        framework_id=fw_id,
        title="Test Obligation",
        status=status,
    )
    return Obligation(**{**defaults, **kwargs})


def _evd(sys_id: str, status: str = "approved", validity_until: date | None = None) -> Evidence:
    return Evidence(
        id=f"EVD-{uuid.uuid4().hex[:8].upper()}",
        ai_system_id=sys_id,
        title="Test Evidence",
        status=status,
        validity_until=validity_until,
    )


async def test_compliance_stats_response_shape(client: httpx.AsyncClient):
    r = await client.get("/v1/compliance-stats")
    assert r.status_code == 200
    body = r.json()
    assert {"obligation_status", "evidence_gap", "framework_compliance",
            "upcoming_deadlines", "risk_heatmap"} <= body.keys()
    assert {"expired", "expiring_soon", "missing"} <= body["evidence_gap"].keys()


async def test_compliance_stats_empty_db(client: httpx.AsyncClient):
    # No user data — but frameworks are seeded by migrations, so
    # framework_compliance carries a row per enabled framework (0 obligations each).
    r = await client.get("/v1/compliance-stats")
    assert r.status_code == 200
    body = r.json()
    assert body["obligation_status"] == {}
    assert body["evidence_gap"] == {"expired": 0, "expiring_soon": 0, "missing": 0}
    assert body["upcoming_deadlines"] == []
    assert body["risk_heatmap"] == []
    for fw in body["framework_compliance"]:
        assert {"framework_id", "framework_name", "total_obligations",
                "fulfilled", "score"} <= fw.keys()
        assert fw["total_obligations"] == 0
        assert fw["score"] is None  # no obligations -> null score, not 0%


async def test_obligation_status_counts(client: httpx.AsyncClient):
    sys_id = f"SYS-{uuid.uuid4().hex[:8].upper()}"
    async with SessionLocal() as session:
        session.add(_sys(id=sys_id))
        fw = _fw()
        session.add(fw)
        await session.flush()
        ass = _ass(sys_id, fw.id)
        session.add(ass)
        await session.flush()
        session.add_all([
            _obl(ass.id, sys_id, fw.id, status="applicable"),
            _obl(ass.id, sys_id, fw.id, status="fulfilled"),
            _obl(ass.id, sys_id, fw.id, status="fulfilled"),
        ])
        await session.commit()

    r = await client.get("/v1/compliance-stats")
    assert r.json()["obligation_status"] == {"applicable": 1, "fulfilled": 2}


async def test_window_days_filters_expiring_soon(client: httpx.AsyncClient):
    today = date.today()
    sys_id = f"SYS-{uuid.uuid4().hex[:8].upper()}"
    async with SessionLocal() as session:
        session.add(_sys(id=sys_id))
        await session.flush()
        # expires in 5 days — inside a 7-day window, outside a 3-day window
        session.add(_evd(sys_id, validity_until=today + timedelta(days=5)))
        await session.commit()

    r7 = await client.get("/v1/compliance-stats?window_days=7")
    r3 = await client.get("/v1/compliance-stats?window_days=3")
    assert r7.json()["evidence_gap"]["expiring_soon"] == 1
    assert r3.json()["evidence_gap"]["expiring_soon"] == 0
    # And it appears in upcoming_deadlines only when inside the window
    assert len(r7.json()["upcoming_deadlines"]) == 1
    assert r3.json()["upcoming_deadlines"] == []


async def test_expired_counts_only_approved(client: httpx.AsyncClient):
    today = date.today()
    sys_id = f"SYS-{uuid.uuid4().hex[:8].upper()}"
    async with SessionLocal() as session:
        session.add(_sys(id=sys_id))
        await session.flush()
        session.add(_evd(sys_id, status="approved", validity_until=today - timedelta(days=1)))
        session.add(_evd(sys_id, status="pending", validity_until=today - timedelta(days=1)))
        await session.commit()

    r = await client.get("/v1/compliance-stats")
    assert r.json()["evidence_gap"]["expired"] == 1  # pending one excluded


async def test_missing_count_excludes_fulfilled_and_na(client: httpx.AsyncClient):
    sys_id = f"SYS-{uuid.uuid4().hex[:8].upper()}"
    async with SessionLocal() as session:
        session.add(_sys(id=sys_id))
        fw = _fw()
        session.add(fw)
        await session.flush()
        ass = _ass(sys_id, fw.id)
        session.add(ass)
        await session.flush()
        session.add_all([
            _obl(ass.id, sys_id, fw.id, status="applicable"),       # missing
            _obl(ass.id, sys_id, fw.id, status="fulfilled"),        # excluded
            _obl(ass.id, sys_id, fw.id, status="not_applicable"),   # excluded
        ])
        await session.commit()

    r = await client.get("/v1/compliance-stats")
    assert r.json()["evidence_gap"]["missing"] == 1


async def test_missing_count_excludes_obligations_with_approved_evidence(client: httpx.AsyncClient):
    sys_id = f"SYS-{uuid.uuid4().hex[:8].upper()}"
    async with SessionLocal() as session:
        session.add(_sys(id=sys_id))
        fw = _fw()
        session.add(fw)
        await session.flush()
        ass = _ass(sys_id, fw.id)
        session.add(ass)
        await session.flush()
        obl = _obl(ass.id, sys_id, fw.id, status="in_progress")
        evd = _evd(sys_id, status="approved")
        session.add_all([obl, evd])
        await session.flush()
        await session.execute(
            pg_insert(evidence_obligations)
            .values(evidence_id=evd.id, obligation_id=obl.id)
            .on_conflict_do_nothing()
        )
        await session.commit()

    r = await client.get("/v1/compliance-stats")
    # in_progress but has approved evidence linked -> not counted as missing
    assert r.json()["evidence_gap"]["missing"] == 0


async def test_framework_compliance_score(client: httpx.AsyncClient):
    sys_id = f"SYS-{uuid.uuid4().hex[:8].upper()}"
    async with SessionLocal() as session:
        session.add(_sys(id=sys_id))
        fw = _fw(name="My Framework")
        session.add(fw)
        await session.flush()
        ass = _ass(sys_id, fw.id)
        session.add(ass)
        await session.flush()
        session.add_all([
            _obl(ass.id, sys_id, fw.id, status="fulfilled"),
            _obl(ass.id, sys_id, fw.id, status="fulfilled"),
            _obl(ass.id, sys_id, fw.id, status="in_progress"),
        ])
        await session.commit()

    r = await client.get("/v1/compliance-stats")
    entry = next(f for f in r.json()["framework_compliance"] if f["framework_id"] == fw.id)
    assert entry["total_obligations"] == 3
    assert entry["fulfilled"] == 2
    assert entry["score"] == round(2 / 3 * 100, 1)


async def test_risk_heatmap_groups_by_tier_and_compliance(client: httpx.AsyncClient):
    async with SessionLocal() as session:
        session.add_all([
            _sys(tier="high", compliance=10.0),      # tier_x=3, residual_y=90
            _sys(tier="high", compliance=10.0),      # same bucket
            _sys(tier="minimal", compliance=90.0),   # tier_x=1, residual_y=10
        ])
        await session.commit()

    r = await client.get("/v1/compliance-stats")
    heatmap = r.json()["risk_heatmap"]
    high_bad = next(c for c in heatmap if c["tier"] == "high" and c["residual_risk_y"] == 90)
    minimal_good = next(c for c in heatmap if c["tier"] == "minimal" and c["residual_risk_y"] == 10)
    assert high_bad["count"] == 2
    assert minimal_good["count"] == 1
