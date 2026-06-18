"""
Alert Worker — evaluates alert rules every 60 seconds.

For each enabled rule in Postgres:
  - Evaluates the condition against current data (Postgres + ClickHouse)
  - If condition is true and no active event exists → creates a new event in ClickHouse
  - If condition is false and an active event exists → resolves it in ClickHouse
"""

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
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


# ── Condition evaluators ──────────────────────────────────────────────────────

async def eval_prohibited_exists(rule: AlertRule, ch) -> tuple[bool, float]:
    async with SessionLocal() as session:
        count = (await session.execute(
            select(func.count()).select_from(AISystem).where(AISystem.tier == "prohibited")
        )).scalar_one()
    return count > 0, float(count)


async def eval_avg_compliance_below(rule: AlertRule, ch) -> tuple[bool, float]:
    async with SessionLocal() as session:
        avg = (await session.execute(
            select(func.avg(AISystem.compliance))
        )).scalar_one() or 0.0
    avg = float(avg)
    return avg < rule.threshold, avg


async def eval_high_risk_on_market_low_compliance(rule: AlertRule, ch) -> tuple[bool, float]:
    async with SessionLocal() as session:
        count = (await session.execute(
            select(func.count()).select_from(AISystem).where(
                AISystem.tier == "high",
                AISystem.lifecycle.in_(["market", "post-market"]),
                AISystem.compliance < rule.threshold,
            )
        )).scalar_one()
    return count > 0, float(count)


async def eval_no_signals(rule: AlertRule, ch) -> tuple[bool, float]:
    rows = await ch_query(
        "SELECT count() AS n FROM otel.gen_ai_spans "
        "WHERE received_at >= now() - INTERVAL {minutes:UInt32} MINUTE",
        {"minutes": int(rule.threshold)},
    )
    count = int(rows[0]["n"]) if rows else 0
    return count == 0, float(count)


async def eval_high_latency(rule: AlertRule, ch) -> tuple[bool, float]:
    rows = await ch_query(
        "SELECT round(avg(duration_ms), 2) AS avg_ms FROM otel.gen_ai_spans "
        "WHERE received_at >= now() - INTERVAL 1 HOUR"
    )
    avg_ms = float(rows[0]["avg_ms"]) if rows and rows[0]["avg_ms"] is not None else 0.0
    return avg_ms > rule.threshold, avg_ms


async def eval_market_system_no_model_card(rule: AlertRule, ch) -> tuple[bool, float]:
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(AISystem).where(
                AISystem.lifecycle.in_(["market", "post-market"]),
                AISystem.model_id.is_(None),
            )
        )).scalars().all()
    count = len(rows)
    return count > 0, float(count)


async def eval_gpai_no_compliance(rule: AlertRule, ch) -> tuple[bool, float]:
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(AISystem).where(
                AISystem.is_gpai.is_(True),
                AISystem.compliance == 0,
            )
        )).scalars().all()
    count = len(rows)
    return count > 0, float(count)


EVALUATORS = {
    "prohibited_exists":                  eval_prohibited_exists,
    "avg_compliance_below":               eval_avg_compliance_below,
    "high_risk_on_market_low_compliance": eval_high_risk_on_market_low_compliance,
    "no_signals":                         eval_no_signals,
    "high_latency":                       eval_high_latency,
    "market_system_no_model_card":        eval_market_system_no_model_card,
    "gpai_no_compliance":                 eval_gpai_no_compliance,
}


# ── ClickHouse helpers ────────────────────────────────────────────────────────

async def get_active_event(rule_id: str) -> dict | None:
    rows = await ch_query(
        "SELECT id, rule_id FROM otel.alert_events "
        "WHERE rule_id = {rule_id:String} AND resolved_at IS NULL AND handled_at IS NULL "
        "ORDER BY triggered_at DESC LIMIT 1",
        {"rule_id": rule_id},
    )
    if rows:
        return {"id": rows[0]["id"], "rule_id": rows[0]["rule_id"]}
    return None


async def was_handled_recently(rule_id: str) -> bool:
    """Returns True if this rule was handled within the last 24 hours."""
    rows = await ch_query(
        "SELECT count() AS n FROM otel.alert_events "
        "WHERE rule_id = {rule_id:String} "
        "AND handled_at IS NOT NULL "
        "AND handled_at >= now() - INTERVAL 24 HOUR",
        {"rule_id": rule_id},
    )
    return bool(rows and rows[0]["n"] > 0)


async def create_event(rule: AlertRule, value: float) -> None:
    now = datetime.now(timezone.utc)
    def _insert():
        client = get_client()
        client.insert(
            "otel.alert_events",
            [[
                str(uuid.uuid4()),
                rule.id, rule.name, rule.category, rule.severity,
                rule.alert_type, rule.description, value, now, None, None,
            ]],
            column_names=["id", "rule_id", "rule_name", "category", "severity",
                          "alert_type", "description", "value_at_trigger",
                          "triggered_at", "resolved_at", "handled_at"],
        )
    await asyncio.get_running_loop().run_in_executor(None, _insert)
    log.info("alert.created", extra={"rule": rule.name, "value": value})


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


async def evaluate_once() -> None:
    # Clear pending resolves at start of each cycle — mutations from the
    # previous cycle have had POLL_INTERVAL seconds to land.

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
            triggered, value = await evaluator(rule, None)
        except Exception:
            log.exception("policy_checker_worker.eval_failed", extra={"rule": rule.name})
            continue

        active = await get_active_event(rule.id)

        if triggered and not active:
            # For event-type rules, skip if handled within the last 24 hours
            if rule.alert_type == "event" and await was_handled_recently(rule.id):
                continue
            await create_event(rule, value)
        elif not triggered and active:
            event_id = active["id"]
            if event_id not in _pending_resolves:
                _pending_resolves.add(event_id)
                await resolve_event(event_id, rule.name)

    # Prune resolved IDs that are no longer active (mutation landed)
    _pending_resolves.clear()


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
