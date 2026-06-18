from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import and_, func, or_, select

from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.model_card import ModelCard

router = APIRouter(tags=["overview"])
logger = get_logger(__name__)


@router.get("/overview/stats")
async def get_overview_stats() -> dict:
    async with SessionLocal() as session:
        total = (await session.execute(
            select(func.count()).select_from(AISystem)
        )).scalar_one()

        avg_compliance = float((await session.execute(
            select(func.avg(AISystem.compliance))
        )).scalar_one() or 0.0)

        tier_rows = (await session.execute(
            select(AISystem.tier, func.count().label("n")).group_by(AISystem.tier)
        )).all()
        by_tier = {r.tier: r.n for r in tier_rows}

        lifecycle_rows = (await session.execute(
            select(AISystem.lifecycle, func.count().label("n")).group_by(AISystem.lifecycle)
        )).all()
        by_lifecycle = {r.lifecycle: r.n for r in lifecycle_rows}

        # Fully compliant = compliance >= 100
        fully_compliant = (await session.execute(
            select(func.count()).select_from(AISystem).where(AISystem.compliance >= 100)
        )).scalar_one()

        # High risk = high tier on market or post-market
        high_risk_on_market = (await session.execute(
            select(func.count()).select_from(AISystem).where(
                AISystem.tier == "high",
                AISystem.lifecycle.in_(["market", "post-market"])
            )
        )).scalar_one()

        compliance_by_tier_rows = (await session.execute(
            select(AISystem.tier, func.avg(AISystem.compliance).label("avg_c")).group_by(AISystem.tier)
        )).all()
        compliance_by_tier = {r.tier: round(float(r.avg_c), 1) for r in compliance_by_tier_rows}

        type_rows = (await session.execute(
            select(AISystem.system_type, func.count().label("n")).group_by(AISystem.system_type)
        )).all()
        by_type = {r.system_type: r.n for r in type_rows}

        total_models = (await session.execute(
            select(func.count()).select_from(ModelCard)
        )).scalar_one()

        model_type_rows = (await session.execute(
            select(ModelCard.model_type, func.count().label("n")).group_by(ModelCard.model_type)
        )).all()
        by_model_type = {r.model_type: r.n for r in model_type_rows}

        model_provider_rows = (await session.execute(
            select(ModelCard.provider, func.count().label("n")).group_by(ModelCard.provider)
        )).all()
        by_model_provider = {r.provider: r.n for r in model_provider_rows}

        buckets = {"0–20": 0, "20–40": 0, "40–60": 0, "60–80": 0, "80–100": 0}
        compliance_vals = (await session.execute(select(AISystem.compliance))).scalars().all()
        for val in compliance_vals:
            v = float(val or 0)
            if v < 20:   buckets["0–20"]   += 1
            elif v < 40: buckets["20–40"]  += 1
            elif v < 60: buckets["40–60"]  += 1
            elif v < 80: buckets["60–80"]  += 1
            else:        buckets["80–100"] += 1

        recent_rows = (await session.execute(
            select(AISystem).order_by(AISystem.created_at.desc()).limit(10)
        )).scalars().all()
        recent = [
            {
                "id": r.id, "name": r.name, "tier": r.tier,
                "lifecycle": r.lifecycle, "compliance": r.compliance,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in recent_rows
        ]

        # Systems needing attention
        attention_rows = (await session.execute(
            select(AISystem).where(
                or_(
                    AISystem.tier == "prohibited",
                    and_(
                        AISystem.tier == "high",
                        AISystem.lifecycle.in_(["market", "post-market"]),
                        AISystem.compliance < 50,
                    ),
                    and_(
                        AISystem.lifecycle.in_(["market", "post-market"]),
                        AISystem.model_id.is_(None),
                    ),
                )
            ).order_by(AISystem.compliance.asc()).limit(20)
        )).scalars().all()
        attention = [
            {
                "id": r.id,
                "name": r.name,
                "tier": r.tier,
                "lifecycle": r.lifecycle,
                "compliance": r.compliance,
                "model_id": r.model_id,
                "reason": (
                    "Prohibited system" if r.tier == "prohibited"
                    else "High-risk on market with low compliance" if r.tier == "high" and r.compliance < 50
                    else "On market without model card"
                ),
            }
            for r in attention_rows
        ]

    logger.info("overview.stats_fetched", extra={"total": total})
    return {
        "total_systems":       total,
        "avg_compliance":      round(avg_compliance, 1),
        "fully_compliant":     fully_compliant,
        "high_risk_on_market": high_risk_on_market,
        "prohibited_count":    by_tier.get("prohibited", 0),
        "high_count":          by_tier.get("high", 0),
        "total_models":        total_models,
        "by_tier":             by_tier,
        "by_lifecycle":        by_lifecycle,
        "by_type":             by_type,
        "compliance_by_tier":  compliance_by_tier,
        "compliance_histogram": buckets,
        "by_model_type":       by_model_type,
        "by_model_provider":   by_model_provider,
        "recent":              recent,
        "attention":           attention,
    }
