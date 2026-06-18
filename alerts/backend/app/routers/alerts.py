from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from ai_trust_clickhouse import ch_command, ch_query
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.alert_rule import AlertRule

router = APIRouter(tags=["alerts"])
logger = get_logger(__name__)


@router.get("/alerts/active")
async def get_active_alerts() -> list[dict]:
    rows = await ch_query("""
        SELECT
            id, rule_id, rule_name, category, severity, alert_type, description,
            value_at_trigger, toString(triggered_at) AS triggered_at,
            handled_at
        FROM otel.alert_events
        WHERE resolved_at IS NULL AND handled_at IS NULL
        ORDER BY
            multiIf(severity='error', 0, severity='warning', 1, 2) ASC,
            triggered_at DESC
    """)
    logger.info("alerts.active_fetched", extra={"count": len(rows)})
    return rows


@router.get("/alerts/history")
async def get_alert_history() -> list[dict]:
    rows = await ch_query("""
        SELECT
            id, rule_id, rule_name, category, severity, alert_type, description,
            value_at_trigger,
            toString(triggered_at) AS triggered_at,
            toString(resolved_at)  AS resolved_at,
            toString(handled_at)   AS handled_at
        FROM otel.alert_events
        WHERE resolved_at IS NOT NULL OR handled_at IS NOT NULL
        ORDER BY triggered_at DESC
        LIMIT 100
    """)
    logger.info("alerts.history_fetched", extra={"count": len(rows)})
    return rows


@router.get("/alerts/rules")
async def get_alert_rules() -> list[dict]:
    async with SessionLocal() as session:
        rules = (await session.execute(
            select(AlertRule).order_by(AlertRule.category, AlertRule.name)
        )).scalars().all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "category": r.category,
            "severity": r.severity,
            "description": r.description,
            "condition_type": r.condition_type,
            "threshold": r.threshold,
            "source": r.source,
            "alert_type": r.alert_type,
            "enabled": r.enabled,
        }
        for r in rules
    ]


@router.get("/alerts/count")
async def get_alert_count() -> dict:
    """Fast endpoint for bell badge — returns count of active unhandled alerts."""
    rows = await ch_query("""
        SELECT count() AS n
        FROM otel.alert_events
        WHERE resolved_at IS NULL AND handled_at IS NULL
    """)
    count = int(rows[0]["n"]) if rows else 0
    logger.info("alerts.count_fetched", extra={"count": count})
    return {"count": count}


@router.post("/alerts/events/{event_id}/handle")
async def handle_alert_event(event_id: str) -> dict:
    """Mark an event-based alert as handled — moves to history permanently."""
    now = datetime.now(timezone.utc)
    await ch_command(
        "ALTER TABLE otel.alert_events UPDATE handled_at = {ts:DateTime}, resolved_at = {ts:DateTime} "
        "WHERE id = {id:String} AND handled_at IS NULL "
        "SETTINGS mutations_sync = 1",
        params={"ts": now, "id": event_id},
    )
    logger.info("alerts.event_handled", extra={"event_id": event_id})
    return {"status": "handled", "event_id": event_id}


@router.post("/alerts/rules/{rule_id}/toggle")
async def toggle_alert_rule(rule_id: str) -> dict:
    """Enable or disable an alert rule."""
    async with SessionLocal() as session:
        result = await session.execute(select(AlertRule).where(AlertRule.id == rule_id))
        rule = result.scalar_one_or_none()
        if not rule:
            raise HTTPException(404, f"Rule {rule_id} not found")
        rule.enabled = not rule.enabled
        await session.commit()
        await session.refresh(rule)
    logger.info("alerts.rule_toggled", extra={"rule_id": rule_id, "enabled": rule.enabled})
    return {"rule_id": rule_id, "enabled": rule.enabled}
