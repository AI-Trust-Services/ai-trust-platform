from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Query
from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.orm import aliased

from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.ai_system_model_card import AISystemModelCard
from ai_trust_persistence.models.evidence import Evidence, evidence_obligations
from ai_trust_persistence.models.framework import Framework
from ai_trust_persistence.models.model_card import ModelCard
from ai_trust_persistence.models.obligation import Obligation

router = APIRouter(tags=["overview"])
logger = get_logger(__name__)


@router.get("/stats")
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

        fully_compliant = (await session.execute(
            select(func.count()).select_from(AISystem).where(AISystem.compliance >= 100)
        )).scalar_one()

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

        # Compliance histogram — single aggregate query instead of loading all rows.
        hist_row = (await session.execute(
            select(
                func.sum(case((AISystem.compliance < 20, 1), else_=0)).label("b0"),
                func.sum(case((and_(AISystem.compliance >= 20, AISystem.compliance < 40), 1), else_=0)).label("b1"),
                func.sum(case((and_(AISystem.compliance >= 40, AISystem.compliance < 60), 1), else_=0)).label("b2"),
                func.sum(case((and_(AISystem.compliance >= 60, AISystem.compliance < 80), 1), else_=0)).label("b3"),
                func.sum(case((AISystem.compliance >= 80, 1), else_=0)).label("b4"),
            )
        )).one()
        buckets = {
            "0–20":   int(hist_row.b0 or 0),
            "20–40":  int(hist_row.b1 or 0),
            "40–60":  int(hist_row.b2 or 0),
            "60–80":  int(hist_row.b3 or 0),
            "80–100": int(hist_row.b4 or 0),
        }

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
                        # checks if there is one model registered
                        ~exists(
                            select(AISystemModelCard.__table__.c.system_id)
                            .where(AISystemModelCard.__table__.c.system_id == AISystem.id)
                        ).correlate(AISystem),
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
        "total_systems":        total,
        "avg_compliance":       round(avg_compliance, 1),
        "fully_compliant":      fully_compliant,
        "high_risk_on_market":  high_risk_on_market,
        "prohibited_count":     by_tier.get("prohibited", 0),
        "high_count":           by_tier.get("high", 0),
        "total_models":         total_models,
        "by_tier":              by_tier,
        "by_lifecycle":         by_lifecycle,
        "by_type":              by_type,
        "compliance_by_tier":   compliance_by_tier,
        "compliance_histogram": buckets,
        "by_model_type":        by_model_type,
        "by_model_provider":    by_model_provider,
        "recent":               recent,
        "attention":            attention,
    }


@router.get("/compliance-stats")
async def get_compliance_stats(
    window_days: int = Query(default=30, ge=1, le=365),
) -> dict:
    today = date.today()
    window_end = today + timedelta(days=window_days)

    async with SessionLocal() as session:
        # Obligation status counts
        obl_rows = (await session.execute(
            select(Obligation.status, func.count().label("n")).group_by(Obligation.status)
        )).all()
        obligation_status = {r.status: r.n for r in obl_rows}

        # Evidence gap
        expired_count = (await session.execute(
            select(func.count()).select_from(Evidence).where(
                Evidence.status == "approved",
                Evidence.validity_until < today,
            )
        )).scalar_one()

        expiring_count = (await session.execute(
            select(func.count()).select_from(Evidence).where(
                Evidence.status == "approved",
                Evidence.validity_until >= today,
                Evidence.validity_until < window_end,
            )
        )).scalar_one()

        # Obligations with no approved evidence linked — NOT EXISTS subquery
        missing_count = (await session.execute(
            select(func.count()).select_from(Obligation).where(
                Obligation.status.not_in(["fulfilled", "not_applicable"]),
                ~(
                    select(evidence_obligations.c.obligation_id)
                    .join(Evidence, Evidence.id == evidence_obligations.c.evidence_id)
                    .where(
                        evidence_obligations.c.obligation_id == Obligation.id,
                        Evidence.status == "approved",
                    )
                    .correlate(Obligation)
                    .exists()
                ),
            )
        )).scalar_one()

        # Framework compliance
        fw_rows = (await session.execute(
            select(
                Framework.id,
                Framework.name,
                func.count(Obligation.id).label("total"),
                func.sum(case((Obligation.status == "fulfilled", 1), else_=0)).label("fulfilled"),
            )
            .outerjoin(Obligation, Obligation.framework_id == Framework.id)
            .where(Framework.enabled == True)
            .group_by(Framework.id, Framework.name)
            .order_by(Framework.name)
        )).all()
        framework_compliance = [
            {
                "framework_id":      r.id,
                "framework_name":    r.name,
                "total_obligations": int(r.total or 0),
                "fulfilled":         int(r.fulfilled or 0),
                "score":             round(int(r.fulfilled or 0) / int(r.total) * 100, 1) if r.total else None,
            }
            for r in fw_rows
        ]

        # Expiring evidence — approved evidence with validity_until within the window,
        # soonest first. (Powers the "Evidence Expiring Soon" widget.)
        evd_sys = aliased(AISystem)
        evd_deadlines = (await session.execute(
            select(
                Evidence.id,
                Evidence.title,
                Evidence.validity_until.label("due_date"),
                Evidence.status,
                Evidence.ai_system_id,
                evd_sys.name.label("ai_system_name"),
            )
            .join(evd_sys, evd_sys.id == Evidence.ai_system_id)
            .where(
                Evidence.validity_until >= today,
                Evidence.validity_until < window_end,
                Evidence.status == "approved",
            )
            .order_by(Evidence.validity_until.asc())
            .limit(30)
        )).all()

        deadlines = [
            {
                "type":           "evidence",
                "id":             r.id,
                "title":          r.title,
                "due_date":       r.due_date.isoformat() if r.due_date else None,
                "status":         r.status,
                "ai_system_id":   r.ai_system_id,
                "ai_system_name": r.ai_system_name,
                "framework_id":   None,
            }
            for r in evd_deadlines
        ]

        # Risk heat map — GROUP BY tier x compliance bucket, max 20 rows
        tier_x = case(
            (AISystem.tier == "minimal",       1),
            (AISystem.tier == "limited",       2),
            (AISystem.tier == "gpai-standard", 2),
            (AISystem.tier == "high",          3),
            (AISystem.tier == "gpai-systemic", 3),
            (AISystem.tier == "prohibited",    4),
            else_=1,
        ).label("tier_x")

        residual_y = case(
            (AISystem.compliance >= 80, 10),
            (AISystem.compliance >= 60, 30),
            (AISystem.compliance >= 40, 50),
            (AISystem.compliance >= 20, 70),
            else_=90,
        ).label("residual_risk_y")

        heatmap_rows = (await session.execute(
            select(AISystem.tier, tier_x, residual_y, func.count().label("n"))
            .group_by(AISystem.tier, tier_x, residual_y)
        )).all()
        risk_heatmap = [
            {"tier": r.tier, "tier_x": r.tier_x, "residual_risk_y": r.residual_risk_y, "count": r.n}
            for r in heatmap_rows
        ]

    logger.info("overview.compliance_stats_fetched", extra={"window_days": window_days})
    return {
        "obligation_status":    obligation_status,
        "evidence_gap": {
            "expired":       int(expired_count),
            "expiring_soon": int(expiring_count),
            "missing":       int(missing_count),
        },
        "framework_compliance": framework_compliance,
        "upcoming_deadlines":   deadlines,
        "risk_heatmap":         risk_heatmap,
    }