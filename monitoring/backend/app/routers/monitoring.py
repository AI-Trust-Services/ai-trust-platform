from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import MONITORING_READ
from ai_trust_clickhouse import ch_query
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.model_card import ModelCard

router = APIRouter(tags=["monitoring"])
logger = get_logger(__name__)

@router.get("/services", dependencies=[Depends(require_permission(MONITORING_READ))])
async def get_services() -> list[dict]:
    # Step 1: get distinct service names + stats from ClickHouse. Isolation is by
    # per-tenant database (the connection already points at tenant_<org>), so no in-row
    # tenant filter is needed.
    ch_rows = await ch_query("""
        SELECT
            service_name,
            count() AS total_spans,
            toString(max(received_at)) AS last_seen
        FROM gen_ai_spans
        GROUP BY service_name
        ORDER BY total_spans DESC
    """)

    if not ch_rows:
        return []

    # Step 2: resolve service names (which are system IDs) to registered AI systems
    service_names = [r["service_name"] for r in ch_rows]
    async with SessionLocal() as session:
        result = await session.execute(
            select(AISystem.id, AISystem.name)
            .where(AISystem.id.in_(service_names))
        )
        system_map = {row.id: row.name for row in result}

    # Step 3: merge — only return services that match a registered system
    rows = []
    for r in ch_rows:
        display_name = system_map.get(r["service_name"])
        if display_name:
            rows.append({
                "service_name": r["service_name"],
                "system_id": r["service_name"],
                "display_name": display_name,
                "total_spans": r["total_spans"],
                "last_seen": r["last_seen"],
            })
        else:
            logger.warning("monitoring.unregistered_service", extra={"service_name": r["service_name"]})

    logger.info("monitoring.services_fetched", extra={"count": len(rows)})
    return rows


@router.get("/signals", dependencies=[Depends(require_permission(MONITORING_READ))])
async def get_signals(
    service: str = Query(default="", description="Filter by system_id"),
    window: str = Query(default="1h", description="Time window: 15m, 1h, 6h, 24h"),
) -> dict:
    window_map = {"15m": "15 MINUTE", "1h": "1 HOUR", "6h": "6 HOUR", "24h": "24 HOUR"}
    interval = window_map.get(window, "1 HOUR")
    bucket = (
        "toStartOfMinute"      if window in ("15m", "1h") else
        "toStartOfFiveMinutes" if window == "6h"          else
        "toStartOfTenMinutes"
    )

    # Resolve system_id to display name
    display_name = service
    if service:
        async with SessionLocal() as session:
            result = await session.execute(
                select(AISystem.name).where(AISystem.id == service)
            )
            row = result.scalar_one_or_none()
            if row:
                display_name = row

    if service:
        # Specific system selected — filter to that system's spans.
        service_filter = "AND service_name = {service:String}"
        params = {"service": service}
    else:
        # "All Systems" means all *registered* systems — never orphan spans
        # from unregistered service names. Constrain to registered system IDs.
        async with SessionLocal() as session:
            registered_ids = (await session.execute(select(AISystem.id))).scalars().all()
        if not registered_ids:
            # No registered systems — nothing to show.
            return {
                "timeseries": [],
                "display_name": service,
                "kpis": {
                    "total_inferences": 0, "avg_latency_ms": 0.0,
                    "total_input_tokens": 0, "total_output_tokens": 0,
                },
            }
        service_filter = "AND service_name IN {ids:Array(String)}"
        params = {"ids": list(registered_ids)}

    # Isolation is by per-tenant database (the ch_query connection points at tenant_<org>),
    # so no in-row tenant filter is added here.
    timeseries, totals = await asyncio.gather(
        ch_query(f"""
            SELECT
                toString({bucket}(received_at)) AS time,
                count()                          AS inference_count,
                round(avg(duration_ms), 2)       AS avg_latency_ms,
                sum(input_tokens)                AS input_tokens,
                sum(output_tokens)               AS output_tokens
            FROM gen_ai_spans
            WHERE received_at >= now() - INTERVAL {interval}
            {service_filter}
            GROUP BY time
            ORDER BY time ASC
        """, params),
        ch_query(f"""
            SELECT
                count()                    AS total_inferences,
                round(avg(duration_ms), 2) AS avg_latency_ms,
                sum(input_tokens)          AS total_input_tokens,
                sum(output_tokens)         AS total_output_tokens
            FROM gen_ai_spans
            WHERE received_at >= now() - INTERVAL {interval}
            {service_filter}
        """, params),
    )

    kpis = totals[0] if totals else {}
    logger.info("monitoring.signals_fetched", extra={"service": service, "window": window})
    return {
        "timeseries": timeseries,
        "display_name": display_name,
        "kpis": {
            "total_inferences":    int(kpis.get("total_inferences", 0)),
            "avg_latency_ms":      float(kpis.get("avg_latency_ms", 0)),
            "total_input_tokens":  int(kpis.get("total_input_tokens", 0)),
            "total_output_tokens": int(kpis.get("total_output_tokens", 0)),
        },
    }



@router.get("/stats", dependencies=[Depends(require_permission(MONITORING_READ))])
async def get_monitoring_stats(lifecycle: str = Query(default="")) -> dict:
    async with SessionLocal() as session:
        lc_filter = AISystem.lifecycle == lifecycle if lifecycle else True
        total = (await session.execute(
            select(func.count()).select_from(AISystem).where(lc_filter)
        )).scalar_one()

        tier_rows = (await session.execute(
            select(AISystem.tier, func.count().label("n")).where(lc_filter).group_by(AISystem.tier)
        )).all()
        by_tier = {r.tier: r.n for r in tier_rows}

        lifecycle_rows = (await session.execute(
            select(AISystem.lifecycle, func.count().label("n")).group_by(AISystem.lifecycle)
        )).all()
        by_lifecycle = {r.lifecycle: r.n for r in lifecycle_rows}

        type_rows = (await session.execute(
            select(AISystem.system_type, func.count().label("n")).where(lc_filter).group_by(AISystem.system_type)
        )).all()
        by_type = {r.system_type: r.n for r in type_rows}

        autonomy_rows = (await session.execute(
            select(AISystem.autonomy_level, func.count().label("n")).where(lc_filter).group_by(AISystem.autonomy_level)
        )).all()
        by_autonomy = {r.autonomy_level: r.n for r in autonomy_rows}

        avg_compliance = (await session.execute(
            select(func.avg(AISystem.compliance)).where(lc_filter)
        )).scalar_one() or 0.0

        compliance_by_tier_rows = (await session.execute(
            select(AISystem.tier, func.avg(AISystem.compliance).label("avg_c")).where(lc_filter).group_by(AISystem.tier)
        )).all()
        compliance_by_tier = {r.tier: round(float(r.avg_c), 1) for r in compliance_by_tier_rows}

        below_50 = (await session.execute(
            select(func.count()).select_from(AISystem).where(lc_filter, AISystem.compliance < 50)
        )).scalar_one()

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

        open_weights_count = (await session.execute(
            select(func.count()).select_from(ModelCard).where(ModelCard.open_weights.is_(True))
        )).scalar_one()

        buckets = {"0–20": 0, "20–40": 0, "40–60": 0, "60–80": 0, "80–100": 0}
        compliance_rows = (await session.execute(
            select(AISystem.compliance).where(lc_filter)
        )).scalars().all()
        for val in compliance_rows:
            v = float(val or 0)
            if v < 20:      buckets["0–20"]   += 1
            elif v < 40:    buckets["20–40"]  += 1
            elif v < 60:    buckets["40–60"]  += 1
            elif v < 80:    buckets["60–80"]  += 1
            else:           buckets["80–100"] += 1

        recent_rows = (await session.execute(
            select(AISystem).where(lc_filter).order_by(AISystem.created_at.desc()).limit(10)
        )).scalars().all()
        recent = [
            {
                "id": r.id,
                "name": r.name,
                "tier": r.tier,
                "lifecycle": r.lifecycle,
                "compliance": r.compliance,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in recent_rows
        ]

    logger.info("monitoring.stats_fetched", extra={"total": total})
    return {
        "total_systems": total,
        "avg_compliance": round(float(avg_compliance), 1),
        "prohibited_count": by_tier.get("prohibited", 0),
        "high_count": by_tier.get("high", 0),
        "below_50_compliance": below_50,
        "total_models": total_models,
        "open_weights_count": open_weights_count,
        "by_tier": by_tier,
        "by_lifecycle": by_lifecycle,
        "by_type": by_type,
        "by_autonomy": by_autonomy,
        "compliance_by_tier": compliance_by_tier,
        "by_model_type": by_model_type,
        "by_model_provider": by_model_provider,
        "compliance_histogram": buckets,
        "recent": recent,
    }
