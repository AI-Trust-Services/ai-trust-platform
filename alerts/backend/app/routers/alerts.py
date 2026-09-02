from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text, select

from ai_trust_authorization import require_permission, get_current_user
from ai_trust_authorization.constants import ALERTS_READ, ALERTS_HANDLE, ALERTS_MANAGE_RULES
from ai_trust_authorization import openfga_client
from ai_trust_clickhouse import ch_command, ch_query
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.alert_rule import AlertRule

router = APIRouter(tags=["alerts"])
logger = get_logger(__name__)

# Roles that see all alerts without restriction.
_UNRESTRICTED_ROLES = {"platform_administrator", "auditor"}

# condition_types visible per restricted built-in role.
_ROLE_CONDITION_TYPES: dict[str, list[str]] = {
    "ai_compliance_officer": [
        "prohibited_exists",
        "avg_compliance_below",
        "high_risk_on_market_low_compliance",
        "market_system_no_model_card",
        "gpai_no_compliance",
        "evidence_expired",
        "evidence_expiring_30d",
        "evidence_expiring_7d",
    ],
    "business_owner": [
        "prohibited_exists",
        "high_risk_on_market_low_compliance",
        "market_system_no_model_card",
        "gpai_no_compliance",
        "model_diverged",
        "evidence_expired",
        "evidence_expiring_30d",
        "evidence_expiring_7d",
    ],
    "ai_engineer": [
        "no_signals",
        "high_latency",
        "model_diverged",
        "evidence_expired",
        "evidence_expiring_30d",
        "evidence_expiring_7d",
    ],
}


async def _allowed_rule_ids(username: str) -> list[str] | None:
    """Return the set of rule IDs the user may see, or None for unrestricted access.

    Custom rules are always included for any authenticated user.
    Any unrecognised / custom role is treated as unrestricted.
    On OpenFGA failure we fail open (return None) so the page stays usable.
    """
    try:
        role_objects = await openfga_client.read_user_roles(f"user:{username}")
    except Exception:
        logger.warning("alerts.role_lookup_failed", extra={"username": username})
        return None

    roles = {r.removeprefix("role:") for r in role_objects}

    # Any unrestricted or unrecognised (custom) role → no filter.
    if roles & _UNRESTRICTED_ROLES:
        return None
    known_restricted = set(_ROLE_CONDITION_TYPES)
    if not roles or not (roles <= known_restricted):
        return None

    visible_types: set[str] = set()
    for role in roles:
        visible_types.update(_ROLE_CONDITION_TYPES.get(role, []))

    async with SessionLocal() as session:
        result = await session.execute(
            select(AlertRule.id).where(
                (AlertRule.condition_type.in_(visible_types)) | (AlertRule.is_custom.is_(True))
            )
        )
        return [row.id for row in result]


async def _resolve_display_names(entity_ids: list[str]) -> dict[str, str]:
    """Map system IDs to display names via Postgres. Falls back to the ID itself."""
    if not entity_ids:
        return {}
    unique_ids = list({e for e in entity_ids if e})
    async with SessionLocal() as session:
        result = await session.execute(
            select(AISystem.id, AISystem.name).where(AISystem.id.in_(unique_ids))
        )
        return {row.id: row.name for row in result}


def _enrich(rows: list[dict], name_map: dict[str, str]) -> list[dict]:
    for row in rows:
        row["entity_display_name"] = name_map.get(row.get("entity_id", ""), row.get("entity_id", ""))
    return rows


@router.get("/active", dependencies=[Depends(require_permission(ALERTS_READ))])
async def get_active_alerts(username: str = Depends(get_current_user)) -> list[dict]:
    rule_ids = await _allowed_rule_ids(username)
    if rule_ids is not None and not rule_ids:
        return []
    if rule_ids is not None:
        rows = await ch_query(
            "SELECT id, rule_id, rule_name, category, severity, alert_type, description,"
            " value_at_trigger, toString(triggered_at) AS triggered_at,"
            " handled_at, entity_id, entity_type, entity_model"
            " FROM alert_events"
            " WHERE resolved_at IS NULL AND handled_at IS NULL"
            " AND rule_id IN {ids:Array(String)}"
            " ORDER BY multiIf(severity='error', 0, severity='warning', 1, 2) ASC, triggered_at DESC",
            {"ids": rule_ids},
        )
    else:
        rows = await ch_query("""
            SELECT
                id, rule_id, rule_name, category, severity, alert_type, description,
                value_at_trigger, toString(triggered_at) AS triggered_at,
                handled_at, entity_id, entity_type, entity_model
            FROM alert_events
            WHERE resolved_at IS NULL AND handled_at IS NULL
            ORDER BY
                multiIf(severity='error', 0, severity='warning', 1, 2) ASC,
                triggered_at DESC
        """)
    entity_ids = [r.get("entity_id", "") for r in rows if r.get("entity_type") == "ai_system"]
    name_map = await _resolve_display_names(entity_ids)
    logger.info("alerts.active_fetched", extra={"count": len(rows)})
    return _enrich(rows, name_map)


@router.get("/history", dependencies=[Depends(require_permission(ALERTS_READ))])
async def get_alert_history(username: str = Depends(get_current_user)) -> list[dict]:
    rule_ids = await _allowed_rule_ids(username)
    if rule_ids is not None and not rule_ids:
        return []
    if rule_ids is not None:
        rows = await ch_query(
            "SELECT id, rule_id, rule_name, category, severity, alert_type, description,"
            " value_at_trigger,"
            " toString(triggered_at) AS triggered_at,"
            " toString(resolved_at)  AS resolved_at,"
            " toString(handled_at)   AS handled_at,"
            " entity_id, entity_type, entity_model"
            " FROM alert_events"
            " WHERE (resolved_at IS NOT NULL OR handled_at IS NOT NULL)"
            " AND rule_id IN {ids:Array(String)}"
            " ORDER BY triggered_at DESC LIMIT 100",
            {"ids": rule_ids},
        )
    else:
        rows = await ch_query("""
            SELECT
                id, rule_id, rule_name, category, severity, alert_type, description,
                value_at_trigger,
                toString(triggered_at) AS triggered_at,
                toString(resolved_at)  AS resolved_at,
                toString(handled_at)   AS handled_at,
                entity_id, entity_type, entity_model
            FROM alert_events
            WHERE (resolved_at IS NOT NULL OR handled_at IS NOT NULL)
            ORDER BY triggered_at DESC
            LIMIT 100
        """)
    entity_ids = [r.get("entity_id", "") for r in rows if r.get("entity_type") == "ai_system"]
    name_map = await _resolve_display_names(entity_ids)
    logger.info("alerts.history_fetched", extra={"count": len(rows)})
    return _enrich(rows, name_map)


@router.get("/rules", dependencies=[Depends(require_permission(ALERTS_READ))])
async def get_alert_rules(username: str = Depends(get_current_user)) -> list[dict]:
    rule_ids = await _allowed_rule_ids(username)
    async with SessionLocal() as session:
        query = select(AlertRule).order_by(AlertRule.category, AlertRule.name)
        if rule_ids is not None:
            query = query.where(AlertRule.id.in_(rule_ids))
        rules = (await session.execute(query)).scalars().all()
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
            "parameters": r.parameters,
            "is_custom": r.is_custom,
        }
        for r in rules
    ]


@router.get("/count", dependencies=[Depends(require_permission(ALERTS_READ))])
async def get_alert_count(username: str = Depends(get_current_user)) -> dict:
    """Fast endpoint for bell badge — returns count of active unhandled alerts."""
    rule_ids = await _allowed_rule_ids(username)
    if rule_ids is not None and not rule_ids:
        return {"count": 0}
    if rule_ids is not None:
        rows = await ch_query(
            "SELECT count() AS n FROM alert_events"
            " WHERE resolved_at IS NULL AND handled_at IS NULL"
            " AND rule_id IN {ids:Array(String)}",
            {"ids": rule_ids},
        )
    else:
        rows = await ch_query("""
            SELECT count() AS n
            FROM alert_events
            WHERE resolved_at IS NULL AND handled_at IS NULL
        """)
    count = int(rows[0]["n"]) if rows else 0
    logger.info("alerts.count_fetched", extra={"count": count})
    return {"count": count}


@router.post("/events/{event_id}/handle", dependencies=[Depends(require_permission(ALERTS_HANDLE))])
async def handle_alert_event(event_id: str) -> dict:
    """Mark an event-based alert as handled — moves to history permanently."""
    now = datetime.now(timezone.utc)
    await ch_command(
        "ALTER TABLE alert_events UPDATE handled_at = {ts:DateTime}, resolved_at = {ts:DateTime} "
        "WHERE id = {id:String} AND handled_at IS NULL "
        "SETTINGS mutations_sync = 1",
        params={"ts": now, "id": event_id},
    )
    logger.info("alerts.event_handled", extra={"event_id": event_id})
    return {"status": "handled", "event_id": event_id}


@router.post("/rules/{rule_id}/toggle", dependencies=[Depends(require_permission(ALERTS_MANAGE_RULES))])
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


@router.post("/events/{event_id}/approve-model", dependencies=[Depends(require_permission(ALERTS_HANDLE))])
async def approve_model_change(event_id: str) -> dict:
    """Approve a model change — marks event as handled and updates the service baseline."""
    rows = await ch_query(
        "SELECT entity_id, entity_model FROM alert_events WHERE id = {id:String}",
        {"id": event_id},
    )
    if not rows:
        raise HTTPException(404, "Event not found")

    service_name = rows[0]["entity_id"]
    new_model = rows[0]["entity_model"]

    if not new_model:
        raise HTTPException(422, "Event has no entity_model — cannot approve")

    now = datetime.now(timezone.utc)
    await ch_command(
        "ALTER TABLE alert_events UPDATE handled_at = {ts:DateTime}, resolved_at = {ts:DateTime} "
        "WHERE id = {id:String} AND handled_at IS NULL "
        "SETTINGS mutations_sync = 1",
        params={"ts": now, "id": event_id},
    )
    async with SessionLocal() as session:
        result = await session.execute(
            text("""
                UPDATE service_model_baselines
                SET model_name = :model, last_seen_at = :ts
                WHERE service_name = :svc
            """),
            {"model": new_model, "ts": now, "svc": service_name},
        )
        if result.rowcount == 0:
            raise HTTPException(404, f"No baseline found for service '{service_name}'")
        await session.commit()
    logger.info("alerts.model_approved", extra={"event_id": event_id, "service": service_name, "new_model": new_model})
    return {"status": "approved", "event_id": event_id, "new_model": new_model}


@router.post("/events/{event_id}/reject-model", dependencies=[Depends(require_permission(ALERTS_HANDLE))])
async def reject_model_change(event_id: str) -> dict:
    """Reject a model change — marks event as handled, baseline unchanged."""
    now = datetime.now(timezone.utc)
    await ch_command(
        "ALTER TABLE alert_events UPDATE handled_at = {ts:DateTime}, resolved_at = {ts:DateTime} "
        "WHERE id = {id:String} AND handled_at IS NULL "
        "SETTINGS mutations_sync = 1",
        params={"ts": now, "id": event_id},
    )
    logger.info("alerts.model_rejected", extra={"event_id": event_id})
    return {"status": "rejected", "event_id": event_id}
