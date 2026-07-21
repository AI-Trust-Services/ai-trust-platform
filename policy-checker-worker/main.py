"""
Alert Worker — evaluates alert rules every 60 seconds.

For each enabled rule in Postgres:
  - Evaluates the condition against current data (Postgres + ClickHouse)
  - If condition is true and no active event exists → creates a new event in ClickHouse
  - If condition is false and an active event exists → resolves it in ClickHouse

Evaluators return either:
  - tuple[bool, float] for aggregate rules (single event per rule)
  - list[EvalResult] for entity-scoped rules (one event per entity)
"""

import asyncio
import json
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from ai_trust_clickhouse import ch_command, ch_query, get_client
from ai_trust_logging import get_logger
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.alert_rule import AlertRule

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = get_logger(__name__)

DATABASE_URL   = os.environ["DATABASE_URL"]
POLL_INTERVAL  = int(os.environ.get("ALERT_POLL_INTERVAL", "60"))

engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

WINDOW_MAP = {"15m": "15 MINUTE", "1h": "1 HOUR", "6h": "6 HOUR", "24h": "24 HOUR"}


@dataclass
class EvalResult:
    triggered: bool
    value: float
    description: str = ""
    entity_id: str = ""
    entity_type: str = ""
    entity_model: str = ""


# ── Condition evaluators ──────────────────────────────────────────────────────

async def eval_prohibited_exists(rule: AlertRule, ch) -> list[EvalResult]:
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(AISystem.id, AISystem.name).where(AISystem.tier == "prohibited")
        )).all()
    return [
        EvalResult(
            triggered=True,
            value=1.0,
            description=f"Prohibited AI system registered: {name} ({sid})",
            entity_id=sid,
            entity_type="ai_system",
        )
        for sid, name in rows
    ]


async def eval_avg_compliance_below(rule: AlertRule, ch) -> tuple[bool, float]:
    async with SessionLocal() as session:
        avg = (await session.execute(
            select(func.avg(AISystem.compliance))
        )).scalar_one()
    if avg is None:
        return False, 0.0
    avg = float(avg)
    return avg < rule.threshold, avg


async def eval_high_risk_on_market_low_compliance(rule: AlertRule, ch) -> list[EvalResult]:
    # Candidate set = all high-risk systems on market. Triggered when compliance
    # is below threshold; non-triggered results let cleared alerts auto-resolve.
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(AISystem.id, AISystem.name, AISystem.compliance).where(
                AISystem.tier == "high",
                AISystem.lifecycle.in_(["market", "post-market"]),
            )
        )).all()
    results: list[EvalResult] = []
    for sid, name, compliance in rows:
        low = float(compliance) < rule.threshold
        results.append(EvalResult(
            triggered=low,
            value=float(compliance),
            description=(
                f"High-risk system on market with low compliance: "
                f"{name} ({sid}) at {float(compliance):.0f}%"
            ) if low else "",
            entity_id=sid,
            entity_type="ai_system",
        ))
    return results


async def eval_no_signals(rule: AlertRule, ch) -> list[EvalResult]:
    # Per-system: a market/post-market system that has sent no spans in the
    # window has gone silent. Systems in earlier lifecycle stages legitimately
    # have no traffic, so they are not checked.
    async with SessionLocal() as session:
        systems = (await session.execute(
            select(AISystem.id, AISystem.name).where(
                AISystem.lifecycle.in_(["market", "post-market"]),
            )
        )).all()
    if not systems:
        return []

    rows = await ch_query(
        "SELECT service_name, count() AS n FROM otel.gen_ai_spans "
        "WHERE received_at >= now() - INTERVAL {minutes:UInt32} MINUTE "
        "GROUP BY service_name",
        {"minutes": int(rule.threshold)},
    )
    counts = {r["service_name"]: int(r["n"]) for r in rows}

    results: list[EvalResult] = []
    for sid, name in systems:
        n = counts.get(sid, 0)
        silent = n == 0
        results.append(EvalResult(
            triggered=silent,
            value=float(n),
            description=(
                f"No inference signals from {name} ({sid}) "
                f"in the last {int(rule.threshold)} min"
            ) if silent else "",
            entity_id=sid,
            entity_type="ai_system",
        ))
    return results


async def eval_high_latency(rule: AlertRule, ch) -> list[EvalResult]:
    # Per-system average latency over the last hour. Only registered systems
    # are considered; spans from unregistered service names are ignored.
    rows = await ch_query(
        "SELECT service_name, round(avg(duration_ms), 2) AS avg_ms "
        "FROM otel.gen_ai_spans "
        "WHERE received_at >= now() - INTERVAL 1 HOUR "
        "GROUP BY service_name"
    )
    if not rows:
        return []

    service_names = [r["service_name"] for r in rows]
    async with SessionLocal() as session:
        sys_result = await session.execute(
            select(AISystem.id, AISystem.name).where(AISystem.id.in_(service_names))
        )
        system_map = {row.id: row.name for row in sys_result}

    results: list[EvalResult] = []
    for r in rows:
        service = r["service_name"]
        if service not in system_map:
            log.warning("alert_worker.unregistered_service", extra={"service_name": service})
            continue
        avg_ms = float(r["avg_ms"]) if r["avg_ms"] is not None else 0.0
        high = avg_ms > rule.threshold
        results.append(EvalResult(
            triggered=high,
            value=avg_ms,
            description=(
                f"High average latency for {system_map[service]} ({service}): "
                f"{avg_ms}ms (> {rule.threshold}ms)"
            ) if high else "",
            entity_id=service,
            entity_type="ai_system",
        ))
    return results


async def eval_market_system_no_model_card(rule: AlertRule, ch) -> list[EvalResult]:
    # Candidate set = all market/post-market systems. Triggered when no model
    # card is linked; non-triggered results let cleared alerts auto-resolve.
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(AISystem.id, AISystem.name, AISystem.model_id).where(
                AISystem.lifecycle.in_(["market", "post-market"]),
            )
        )).all()
    results: list[EvalResult] = []
    for sid, name, model_id in rows:
        missing = model_id is None
        results.append(EvalResult(
            triggered=missing,
            value=1.0 if missing else 0.0,
            description=f"System on market without a model card: {name} ({sid})" if missing else "",
            entity_id=sid,
            entity_type="ai_system",
        ))
    return results


async def eval_gpai_no_compliance(rule: AlertRule, ch) -> list[EvalResult]:
    # Candidate set = all GPAI systems. Triggered when compliance score is 0;
    # non-triggered results let cleared alerts auto-resolve.
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(AISystem.id, AISystem.name, AISystem.compliance).where(
                AISystem.is_gpai.is_(True),
            )
        )).all()
    results: list[EvalResult] = []
    for sid, name, compliance in rows:
        no_score = float(compliance) == 0
        results.append(EvalResult(
            triggered=no_score,
            value=float(compliance),
            description=f"GPAI system with no compliance score: {name} ({sid})" if no_score else "",
            entity_id=sid,
            entity_type="ai_system",
        ))
    return results


async def eval_model_diverged(rule: AlertRule, ch) -> list[EvalResult]:
    """
    For each service with recent spans, resolve the registered AI system via
    system ID (service_name IS the system ID — OTEL_SERVICE_NAME = SYS-XXXXXXXX),
    then compare the current model against the baseline stored in
    service_model_baselines (keyed by system ID).
    Baseline is only updated by explicit human approval via the alerts UI.
    """
    params = json.loads(rule.parameters or "{}")
    interval = WINDOW_MAP.get(params.get("window", "1h"), "1 HOUR")
    service_filter = params.get("service", "")

    if service_filter:
        rows = await ch_query(
            f"SELECT service_name, argMax(request_model, received_at) AS current_model "
            f"FROM otel.gen_ai_spans "
            f"WHERE received_at >= now() - INTERVAL {interval} "
            f"AND service_name = {{svc:String}} "
            f"AND request_model != '' "
            f"GROUP BY service_name",
            {"svc": service_filter},
        )
    else:
        rows = await ch_query(
            f"SELECT service_name, argMax(request_model, received_at) AS current_model "
            f"FROM otel.gen_ai_spans "
            f"WHERE received_at >= now() - INTERVAL {interval} "
            f"AND request_model != '' "
            f"GROUP BY service_name"
        )

    if not rows:
        return []

    now = datetime.now(timezone.utc)
    results: list[EvalResult] = []

    # service_name in ClickHouse IS the system ID (OTEL_SERVICE_NAME = SYS-XXXXXXXX)
    service_names = [r["service_name"] for r in rows]
    async with SessionLocal() as session:
        sys_result = await session.execute(
            select(AISystem.id, AISystem.name)
            .where(AISystem.id.in_(service_names))
        )
        system_map = {row.id: row.name for row in sys_result}

        for row in rows:
            service = row["service_name"]
            current_model = row["current_model"]

            if service not in system_map:
                log.warning("alert_worker.unregistered_service", extra={"service_name": service})
                continue

            system_id = service  # service_name IS the system ID
            system_name = system_map[service]

            baseline_row = (await session.execute(
                text("SELECT model_name FROM service_model_baselines WHERE service_name = :svc"),
                {"svc": system_id},
            )).fetchone()

            if baseline_row is None:
                # First time seeing this system — store baseline, no alert
                await session.execute(
                    text("""
                        INSERT INTO service_model_baselines (service_name, model_name, last_seen_at)
                        VALUES (:svc, :model, :ts)
                        ON CONFLICT (service_name) DO NOTHING
                    """),
                    {"svc": system_id, "model": current_model, "ts": now},
                )
                results.append(EvalResult(triggered=False, value=0.0, entity_id=system_id, entity_type="ai_system"))
            elif baseline_row[0] == current_model:
                # Model unchanged — update last_seen_at
                await session.execute(
                    text("UPDATE service_model_baselines SET last_seen_at = :ts WHERE service_name = :svc"),
                    {"ts": now, "svc": system_id},
                )
                results.append(EvalResult(triggered=False, value=0.0, entity_id=system_id, entity_type="ai_system"))
            else:
                # Model changed — fire alert, leave baseline unchanged until human approves
                old_model = baseline_row[0]
                desc = f"Model changed for {system_name}: {old_model} → {current_model}"
                results.append(EvalResult(
                    triggered=True,
                    value=1.0,
                    description=desc,
                    entity_id=system_id,
                    entity_type="ai_system",
                    entity_model=current_model,
                ))

        await session.commit()

    return results


EVALUATORS = {
    "prohibited_exists":                  eval_prohibited_exists,
    "avg_compliance_below":               eval_avg_compliance_below,
    "high_risk_on_market_low_compliance": eval_high_risk_on_market_low_compliance,
    "no_signals":                         eval_no_signals,
    "high_latency":                       eval_high_latency,
    "market_system_no_model_card":        eval_market_system_no_model_card,
    "gpai_no_compliance":                 eval_gpai_no_compliance,
    "model_diverged":                     eval_model_diverged,
}


# ── ClickHouse helpers ────────────────────────────────────────────────────────

async def get_active_event(rule_id: str, entity_id: str = "") -> dict | None:
    rows = await ch_query(
        "SELECT id, rule_id FROM otel.alert_events "
        "WHERE rule_id = {rule_id:String} "
        "AND entity_id = {entity_id:String} "
        "AND resolved_at IS NULL AND handled_at IS NULL "
        "ORDER BY triggered_at DESC LIMIT 1",
        {"rule_id": rule_id, "entity_id": entity_id},
    )
    if rows:
        return {"id": rows[0]["id"], "rule_id": rows[0]["rule_id"]}
    return None


async def was_handled_recently(rule_id: str, entity_id: str = "") -> bool:
    """Returns True if this rule+entity was handled within the last 24 hours."""
    rows = await ch_query(
        "SELECT count() AS n FROM otel.alert_events "
        "WHERE rule_id = {rule_id:String} "
        "AND entity_id = {entity_id:String} "
        "AND handled_at IS NOT NULL "
        "AND handled_at >= now() - INTERVAL 24 HOUR",
        {"rule_id": rule_id, "entity_id": entity_id},
    )
    return bool(rows and rows[0]["n"] > 0)


async def create_event(
    rule: AlertRule,
    value: float,
    description: str = "",
    entity_id: str = "",
    entity_type: str = "",
    entity_model: str = "",
) -> None:
    now = datetime.now(timezone.utc)
    event_description = description or rule.description

    def _insert():
        client = get_client()
        client.insert(
            "otel.alert_events",
            [[
                str(uuid.uuid4()),
                rule.id, rule.name, rule.category, rule.severity,
                rule.alert_type, event_description, value, now, None, None,
                entity_id, entity_type, entity_model,
            ]],
            column_names=["id", "rule_id", "rule_name", "category", "severity",
                          "alert_type", "description", "value_at_trigger",
                          "triggered_at", "resolved_at", "handled_at",
                          "entity_id", "entity_type", "entity_model"],
        )
    await asyncio.get_running_loop().run_in_executor(None, _insert)
    log.info("alert.created", extra={"rule": rule.name, "value": value, "entity_id": entity_id})


async def resolve_event(event_id: str, rule_name: str) -> None:
    now = datetime.now(timezone.utc)
    await ch_command(
        "ALTER TABLE otel.alert_events UPDATE resolved_at = {ts:DateTime} "
        "WHERE id = {id:String} "
        "SETTINGS mutations_sync = 1",
        {"ts": now, "id": event_id},
    )
    log.info("alert.resolved", extra={"rule": rule_name, "event_id": event_id})


# ── Main evaluation loop ──────────────────────────────────────────────────────

# Track event IDs we've already queued a resolve mutation for.
# ClickHouse mutations are async and the row may still appear as active on the
# next poll cycle — without this guard, resolve_event fires every cycle until
# the mutation lands, flooding the mutation queue.
_pending_resolves: set[str] = set()


async def _process_single(rule: AlertRule, triggered: bool, value: float,
                           description: str = "", entity_id: str = "", entity_type: str = "",
                           entity_model: str = "") -> None:
    active = await get_active_event(rule.id, entity_id)
    if triggered and not active:
        # model_diverged uses baseline as deduplication — 24h suppression is redundant and blocks re-fires after approval
        if rule.alert_type == "event" and rule.condition_type != "model_diverged" and await was_handled_recently(rule.id, entity_id):
            return
        await create_event(rule, value, description, entity_id, entity_type, entity_model)
    elif not triggered and active:
        event_id = active["id"]
        if event_id not in _pending_resolves:
            _pending_resolves.add(event_id)
            await resolve_event(event_id, rule.name)


async def evaluate_once() -> None:
    # Clear resolve guard from the previous cycle — those mutations have had
    # POLL_INTERVAL seconds to land. Events that are still active will be
    # re-evaluated and re-queued only if the mutation truly didn't land.
    _pending_resolves.clear()

    async with SessionLocal() as session:
        rules = (await session.execute(
            select(AlertRule).where(AlertRule.enabled == True)
        )).scalars().all()

    log.info("policy_checker_worker.evaluating", extra={"rule_count": len(rules)})

    for rule in rules:
        evaluator = EVALUATORS.get(rule.condition_type)
        if not evaluator:
            log.warning("policy_checker_worker.unknown_condition", extra={"condition": rule.condition_type})
            continue

        try:
            result = await evaluator(rule, None)
        except Exception:
            log.exception("policy_checker_worker.eval_failed", extra={"rule": rule.name})
            continue

        if isinstance(result, list):
            for r in result:
                await _process_single(rule, r.triggered, r.value, r.description, r.entity_id, r.entity_type, r.entity_model)
        else:
            triggered, value = result
            await _process_single(rule, triggered, value)


async def main() -> None:
    log.info("policy_checker_worker.started", extra={"poll_interval": POLL_INTERVAL})
    while True:
        try:
            await evaluate_once()
        except Exception:
            log.exception("policy_checker_worker.cycle_failed")
        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
