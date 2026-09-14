from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import AUDIT_READ
from ai_trust_clickhouse import AUDIT_EVENTS, AUDIT_EVENTS_COLUMNS, current_tenant, get_client_for_tenant
from ai_trust_logging import get_logger

router = APIRouter(tags=["audit"])
logger = get_logger(__name__)

# Category → resource_type mapping for KPI stats
_CATEGORIES: dict[str, list[str]] = {
    "system_events":         ["ai_system"],
    "risk_and_compliance":   ["assessment", "evidence", "control", "obligation"],
}


# ── Schemas ──────────────────────────────────────────────────────────────────

class AuditSystem(BaseModel):
    id: str
    name: str


class AuditEventSummary(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    created_at: datetime
    actor_username: str
    action: str
    resource_type: str
    resource_id: str
    ai_system_id: str
    ai_system_name: str
    source: str


class AuditEventDetail(AuditEventSummary):
    changes: dict


class AuditEventListResponse(BaseModel):
    total: int
    items: list[AuditEventSummary]


class CategoryStat(BaseModel):
    count: int
    trend_pct: float | None


class AuditStatsResponse(BaseModel):
    total: CategoryStat
    system_events: CategoryStat
    risk_and_compliance: CategoryStat


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_summary(row) -> AuditEventSummary:
    r = dict(zip(AUDIT_EVENTS_COLUMNS, row))
    return AuditEventSummary(**{k: r[k] for k in AuditEventSummary.model_fields})


def _row_to_detail(row) -> AuditEventDetail:
    r = dict(zip(AUDIT_EVENTS_COLUMNS, row))
    try:
        r["changes"] = json.loads(r["changes"]) if r["changes"] else {}
    except (json.JSONDecodeError, TypeError):
        r["changes"] = {}
    return AuditEventDetail(**{k: r[k] for k in AuditEventDetail.model_fields})


def _trend(current: int, previous: int) -> float | None:
    if previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/events", response_model=AuditEventListResponse, dependencies=[Depends(require_permission(AUDIT_READ))])
def list_events(
    ai_system_id: str | None = Query(default=None),
    action: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    resource_type: str | None = Query(default=None),
    from_dt: datetime | None = Query(default=None, alias="from"),
    to_dt: datetime | None = Query(default=None, alias="to"),
    search: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    sort: str = Query(default="desc", pattern="^(asc|desc)$"),
) -> AuditEventListResponse:
    ch = get_client_for_tenant(current_tenant())

    conditions = ["1=1"]
    params: dict = {}

    if ai_system_id:
        conditions.append("ai_system_id = {ai_system_id:String}")
        params["ai_system_id"] = ai_system_id
    if action:
        conditions.append("action = {action:String}")
        params["action"] = action
    if actor:
        conditions.append("actor_username = {actor:String}")
        params["actor"] = actor
    if resource_type:
        conditions.append("resource_type = {resource_type:String}")
        params["resource_type"] = resource_type
    if from_dt:
        conditions.append("created_at >= {from_dt:DateTime}")
        params["from_dt"] = from_dt.replace(tzinfo=None)
    if to_dt:
        conditions.append("created_at <= {to_dt:DateTime}")
        params["to_dt"] = to_dt.replace(tzinfo=None)
    if search:
        conditions.append(
            "(positionCaseInsensitive(action, {search:String}) > 0 "
            "OR positionCaseInsensitive(actor_username, {search:String}) > 0 "
            "OR positionCaseInsensitive(ai_system_name, {search:String}) > 0)"
        )
        params["search"] = search

    where = " AND ".join(conditions)
    order = "DESC" if sort == "desc" else "ASC"

    total_result = ch.query(
        f"SELECT count() FROM {AUDIT_EVENTS} FINAL WHERE {where}",
        parameters=params,
    )
    total = total_result.result_rows[0][0] if total_result.result_rows else 0

    _cols = ", ".join(AUDIT_EVENTS_COLUMNS)
    rows_result = ch.query(
        f"SELECT {_cols} FROM {AUDIT_EVENTS} FINAL WHERE {where} "
        f"ORDER BY created_at {order} "
        f"LIMIT {{limit:UInt32}} OFFSET {{offset:UInt32}}",
        parameters={**params, "limit": limit, "offset": offset},
    )

    items = [_row_to_summary(r) for r in rows_result.result_rows]
    return AuditEventListResponse(total=total, items=items)


@router.get("/events/{event_id}", response_model=AuditEventDetail, dependencies=[Depends(require_permission(AUDIT_READ))])
def get_event(event_id: str) -> AuditEventDetail:
    ch = get_client_for_tenant(current_tenant())
    _cols = ", ".join(AUDIT_EVENTS_COLUMNS)
    result = ch.query(
        f"SELECT {_cols} FROM {AUDIT_EVENTS} FINAL WHERE id = {{event_id:String}} LIMIT 1",
        parameters={"event_id": event_id},
    )
    if not result.result_rows:
        raise HTTPException(404, f"Audit event {event_id} not found")
    return _row_to_detail(result.result_rows[0])


@router.get("/systems", response_model=list[AuditSystem], dependencies=[Depends(require_permission(AUDIT_READ))])
def list_systems(
    action: str | None = Query(default=None),
    resource_type: str | None = Query(default=None),
    from_dt: datetime | None = Query(default=None, alias="from"),
    to_dt: datetime | None = Query(default=None, alias="to"),
    search: str | None = Query(default=None),
) -> list[AuditSystem]:
    ch = get_client_for_tenant(current_tenant())

    conditions = ["ai_system_id != ''"]
    params: dict = {}

    if action:
        conditions.append("action = {action:String}")
        params["action"] = action
    if resource_type:
        conditions.append("resource_type = {resource_type:String}")
        params["resource_type"] = resource_type
    if from_dt:
        conditions.append("created_at >= {from_dt:DateTime}")
        params["from_dt"] = from_dt.replace(tzinfo=None)
    if to_dt:
        conditions.append("created_at <= {to_dt:DateTime}")
        params["to_dt"] = to_dt.replace(tzinfo=None)
    if search:
        conditions.append(
            "(positionCaseInsensitive(action, {search:String}) > 0 "
            "OR positionCaseInsensitive(actor_username, {search:String}) > 0 "
            "OR positionCaseInsensitive(ai_system_name, {search:String}) > 0)"
        )
        params["search"] = search

    where = " AND ".join(conditions)
    result = ch.query(
        f"SELECT ai_system_id, argMax(ai_system_name, created_at) "
        f"FROM {AUDIT_EVENTS} FINAL "
        f"WHERE {where} GROUP BY ai_system_id ORDER BY ai_system_id",
        parameters=params,
    )
    return [AuditSystem(id=r[0], name=r[1]) for r in result.result_rows]


@router.get("/stats", response_model=AuditStatsResponse, dependencies=[Depends(require_permission(AUDIT_READ))])
def get_stats(
    from_dt: datetime | None = Query(default=None, alias="from"),
    to_dt: datetime | None = Query(default=None, alias="to"),
) -> AuditStatsResponse:
    ch = get_client_for_tenant(current_tenant())
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # Default to last 7 days if no range supplied
    if not from_dt:
        from_dt = datetime.fromtimestamp(now.timestamp() - 7 * 86400)
    if not to_dt:
        to_dt = now

    from_ts = from_dt.replace(tzinfo=None) if from_dt.tzinfo else from_dt
    to_ts = to_dt.replace(tzinfo=None) if to_dt.tzinfo else to_dt
    window_secs = max((to_ts - from_ts).total_seconds(), 1)
    prev_from = datetime.fromtimestamp(from_ts.timestamp() - window_secs)
    prev_to = from_ts

    sys_types = _CATEGORIES["system_events"]
    rac_types = _CATEGORIES["risk_and_compliance"]
    sys_ph = ", ".join(f"{{sys{i}:String}}" for i in range(len(sys_types)))
    rac_ph = ", ".join(f"{{rac{i}:String}}" for i in range(len(rac_types)))

    params: dict = {
        "cf": from_ts, "ct": to_ts,
        "pf": prev_from, "pt": prev_to,
    }
    for i, v in enumerate(sys_types):
        params[f"sys{i}"] = v
    for i, v in enumerate(rac_types):
        params[f"rac{i}"] = v

    sql = f"""
        SELECT
            countIf(created_at >= {{cf:DateTime}} AND created_at <= {{ct:DateTime}}) AS cur_total,
            countIf(created_at >= {{pf:DateTime}} AND created_at <= {{pt:DateTime}}) AS prev_total,
            countIf(created_at >= {{cf:DateTime}} AND created_at <= {{ct:DateTime}} AND resource_type IN ({sys_ph})) AS cur_sys,
            countIf(created_at >= {{pf:DateTime}} AND created_at <= {{pt:DateTime}} AND resource_type IN ({sys_ph})) AS prev_sys,
            countIf(created_at >= {{cf:DateTime}} AND created_at <= {{ct:DateTime}} AND resource_type IN ({rac_ph})) AS cur_rac,
            countIf(created_at >= {{pf:DateTime}} AND created_at <= {{pt:DateTime}} AND resource_type IN ({rac_ph})) AS prev_rac
        FROM {AUDIT_EVENTS} FINAL
    """
    r = ch.query(sql, parameters=params)
    row = r.result_rows[0] if r.result_rows else (0, 0, 0, 0, 0, 0)
    cur_total, prev_total, cur_sys, prev_sys, cur_rac, prev_rac = row

    return AuditStatsResponse(
        total=CategoryStat(count=cur_total, trend_pct=_trend(cur_total, prev_total)),
        system_events=CategoryStat(count=cur_sys, trend_pct=_trend(cur_sys, prev_sys)),
        risk_and_compliance=CategoryStat(count=cur_rac, trend_pct=_trend(cur_rac, prev_rac)),
    )
