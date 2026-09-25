from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text

from ai_trust_authorization import openfga_client as fga, require_permission
from ai_trust_authorization.constants import ALERTS_READ, ALERTS_HANDLE, ALERTS_MANAGE_RULES
from ai_trust_clickhouse import ch_command, ch_query
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.alert_rule import AlertRule
from ai_trust_persistence.models.custom_role import CustomRole

router = APIRouter(tags=["alerts"])
logger = get_logger(__name__)

ROLE_ALERT_CATEGORIES: dict[str, list[str] | None] = {
    "platform_administrator": None,
    "auditor": None,
    "ai_compliance_officer": ["compliance"],
    "ai_engineer": ["observability"],
    "business_owner": ["risk", "compliance"],
    "executive": ["risk"],
}
_BUILT_IN_ROLES = frozenset(ROLE_ALERT_CATEGORIES.keys())


async def _allowed_categories(username: str) -> list[str] | None:
    role_objects = await fga.read_user_roles(f"user:{username}")

    cats: set[str] = set()
    custom_slugs: list[str] = []

    for obj in role_objects:
        slug = obj[5:] if obj.startswith("role:") else obj
        if slug in _BUILT_IN_ROLES:
            builtin_cats = ROLE_ALERT_CATEGORIES[slug]
            if builtin_cats is None:
                return None
            cats.update(builtin_cats)
        else:
            custom_slugs.append(slug)

    if custom_slugs:
        async with SessionLocal() as session:
            rows = (await session.execute(select(CustomRole))).scalars().all()
        slug_to_cats = {
            row.name.lower().replace(" ", "_"): row.alert_categories
            for row in rows
        }
        for slug in custom_slugs:
            if slug not in slug_to_cats:
                continue
            role_cats = slug_to_cats[slug]
            if role_cats is None:
                return None
            cats.update(role_cats)

    return None if not cats else list(cats)


async def _resolve_display_names(entity_ids: list[str]) -> dict[str, str]:
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


@router.get("/active")
async def get_active_alerts(username: str = Depends(require_permission(ALERTS_READ))) -> list[dict]:
    cats = await _allowed_categories(username)
    if cats is not None and len(cats) == 0:
        return []
    sql = (
        "SELECT id, rule_id, rule_name, category, severity, alert_type, description,"
        " value_at_trigger, toString(triggered_at) AS triggered_at,"
        " handled_at, entity_id, entity_type, entity_model"
        " FROM alert_events"
        " WHERE resolved_at IS NULL AND handled_at IS NULL"
    )
    params: dict | None = None
    if cats is not None:
        sql += " AND category IN {cats:Array(String)}"
        params = {"cats": cats}
    sql += " ORDER BY multiIf(severity='error', 0, severity='warning', 1, 2) ASC, triggered_at DESC"
    rows = await ch_query(sql, params)
    entity_ids = [r.get("entity_id", "") for r in rows if r.get("entity_type") == "ai_system"]
    name_map = await _resolve_display_names(entity_ids)
    logger.info("alerts.active_fetched", extra={"count": len(rows)})
    return _enrich(rows, name_map)


@router.get("/history")
async def get_alert_history(username: str = Depends(require_permission(ALERTS_READ))) -> list[dict]:
    cats = await _allowed_categories(username)
    if cats is not None and len(cats) == 0:
        return []
    sql = (
        "SELECT id, rule_id, rule_name, category, severity, alert_type, description,"
        " value_at_trigger,"
        " toString(triggered_at) AS triggered_at,"
        " toString(resolved_at)  AS resolved_at,"
        " toString(handled_at)   AS handled_at,"
        " entity_id, entity_type, entity_model"
        " FROM alert_events"
        " WHERE (resolved_at IS NOT NULL OR handled_at IS NOT NULL)"
    )
    params: dict | None = None
    if cats is not None:
        sql += " AND category IN {cats:Array(String)}"
        params = {"cats": cats}
    sql += " ORDER BY triggered_at DESC LIMIT 100"
    rows = await ch_query(sql, params)
    entity_ids = [r.get("entity_id", "") for r in rows if r.get("entity_type") == "ai_system"]
    name_map = await _resolve_display_names(entity_ids)
    logger.info("alerts.history_fetched", extra={"count": len(rows)})
    return _enrich(rows, name_map)


@router.get("/rules")
async def get_alert_rules(username: str = Depends(require_permission(ALERTS_READ))) -> list[dict]:
    cats = await _allowed_categories(username)
    if cats is not None and len(cats) == 0:
        return []
    async with SessionLocal() as session:
        stmt = select(AlertRule).order_by(AlertRule.category, AlertRule.name)
        if cats is not None:
            stmt = select(AlertRule).where(AlertRule.category.in_(cats)).order_by(AlertRule.category, AlertRule.name)
        rules = (await session.execute(stmt)).scalars().all()
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


@router.get("/count")
async def get_alert_count(username: str = Depends(require_permission(ALERTS_READ))) -> dict:
    cats = await _allowed_categories(username)
    if cats is not None and len(cats) == 0:
        return {"count": 0}
    if cats is not None:
        rows = await ch_query(
            "SELECT count() AS n FROM alert_events"
            " WHERE resolved_at IS NULL AND handled_at IS NULL AND category IN {cats:Array(String)}",
            {"cats": cats},
        )
    else:
        rows = await ch_query(
            "SELECT count() AS n FROM alert_events WHERE resolved_at IS NULL AND handled_at IS NULL"
        )
    count = int(rows[0]["n"]) if rows else 0
    logger.info("alerts.count_fetched", extra={"count": count})
    return {"count": count}


@router.post("/events/{event_id}/handle", dependencies=[Depends(require_permission(ALERTS_HANDLE))])
async def handle_alert_event(event_id: str) -> dict:
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
    now = datetime.now(timezone.utc)
    await ch_command(
        "ALTER TABLE alert_events UPDATE handled_at = {ts:DateTime}, resolved_at = {ts:DateTime} "
        "WHERE id = {id:String} AND handled_at IS NULL "
        "SETTINGS mutations_sync = 1",
        params={"ts": now, "id": event_id},
    )
    logger.info("alerts.model_rejected", extra={"event_id": event_id})
    return {"status": "rejected", "event_id": event_id}
