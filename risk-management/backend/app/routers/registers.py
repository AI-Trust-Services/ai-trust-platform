from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.risk_management import (
    RiskRegister,
    RiskEntry,
    MisuseScenario,
    MitigationMeasure,
    ReassessmentTrigger,
)
from app.ids import new_id
from app.schemas import (
    RiskRegisterIn,
    RiskRegisterOut,
    RiskRegisterPatch,
    ApproveRegisterIn,
    SystemRiskSummary,
)

logger = get_logger(__name__)
router = APIRouter(tags=["registers"])

STALE_MONTHS = 6


async def get_session():
    async with SessionLocal() as session:
        yield session


def _username(request: Request) -> str:
    return request.headers.get("X-Forwarded-Preferred-Username", "unknown")


def _is_stale(last_completed: datetime | None) -> bool:
    if last_completed is None:
        return True
    cutoff = datetime.now(timezone.utc) - timedelta(days=STALE_MONTHS * 30)
    if last_completed.tzinfo is None:
        last_completed = last_completed.replace(tzinfo=timezone.utc)
    return last_completed < cutoff


async def _load_register_full(session: AsyncSession, register_id: str) -> RiskRegister | None:
    result = await session.execute(select(RiskRegister).where(RiskRegister.id == register_id))
    register = result.scalar_one_or_none()
    if register is None:
        return None
    # Load risks with their children
    risks_result = await session.execute(
        select(RiskEntry).where(RiskEntry.register_id == register_id)
    )
    risks = list(risks_result.scalars().all())
    for risk in risks:
        ms_result = await session.execute(
            select(MisuseScenario).where(MisuseScenario.risk_id == risk.id)
        )
        risk.misuse_scenarios = list(ms_result.scalars().all())
        mit_result = await session.execute(
            select(MitigationMeasure).where(MitigationMeasure.risk_id == risk.id)
        )
        risk.mitigations = list(mit_result.scalars().all())
    register.risks = risks
    return register


@router.get("/systems", response_model=list[SystemRiskSummary])
async def list_systems(session: AsyncSession = Depends(get_session)):
    """List all AI systems with their risk assessment status.

    High-risk systems (tier='high') and systems with stale assessments are
    flagged for re-assessment in the UI.
    """
    systems_result = await session.execute(select(AISystem).order_by(AISystem.name))
    systems = list(systems_result.scalars().all())

    summaries = []
    for sys in systems:
        # Get active register (most recent non-archived)
        reg_result = await session.execute(
            select(RiskRegister)
            .where(RiskRegister.ai_system_id == sys.id)
            .where(RiskRegister.status != "archived")
            .order_by(RiskRegister.created_at.desc())
            .limit(1)
        )
        active_register = reg_result.scalar_one_or_none()

        # Count unacknowledged triggers
        trigger_count_result = await session.execute(
            select(func.count(ReassessmentTrigger.id))
            .where(ReassessmentTrigger.ai_system_id == sys.id)
            .where(ReassessmentTrigger.acknowledged == False)  # noqa: E712
        )
        unacknowledged = trigger_count_result.scalar_one() or 0

        last_completed = active_register.last_assessment_completed_at if active_register else None
        stale = _is_stale(last_completed)
        reassessment_needed = stale or unacknowledged > 0

        summaries.append(SystemRiskSummary(
            system_id=sys.id,
            system_name=sys.name,
            system_tier=sys.tier,
            system_lifecycle=sys.lifecycle,
            active_register_id=active_register.id if active_register else None,
            active_register_status=active_register.status if active_register else None,
            last_assessment_completed_at=last_completed,
            unacknowledged_triggers=unacknowledged,
            reassessment_needed=reassessment_needed,
        ))

    return summaries


@router.post("/systems/{system_id}/registers", response_model=RiskRegisterOut, status_code=201)
async def create_register(
    system_id: str,
    body: RiskRegisterIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Start a new risk assessment register for an AI system.

    Archives any existing active register before creating the new one.
    Creates a ReassessmentTrigger of type 'manual' if prior register exists.
    """
    sys_result = await session.execute(select(AISystem).where(AISystem.id == system_id))
    system = sys_result.scalar_one_or_none()
    if system is None:
        raise HTTPException(status_code=404, detail="AI system not found")

    # Archive existing active registers
    existing_result = await session.execute(
        select(RiskRegister)
        .where(RiskRegister.ai_system_id == system_id)
        .where(RiskRegister.status != "archived")
    )
    for old_reg in existing_result.scalars().all():
        old_reg.status = "archived"
        session.add(old_reg)

    register = RiskRegister(
        id=new_id("RRM"),
        ai_system_id=system_id,
        status="draft",
        assessment_scope=body.assessment_scope,
        notes=body.notes,
        created_by=_username(request),
    )
    session.add(register)
    await session.flush()

    # Acknowledge pending triggers (new register started)
    triggers_result = await session.execute(
        select(ReassessmentTrigger)
        .where(ReassessmentTrigger.ai_system_id == system_id)
        .where(ReassessmentTrigger.acknowledged == False)  # noqa: E712
    )
    actor = _username(request)
    for trigger in triggers_result.scalars().all():
        trigger.acknowledged = True
        trigger.acknowledged_by = actor
        trigger.acknowledged_at = datetime.now(timezone.utc)
        trigger.new_register_id = register.id
        session.add(trigger)

    await session.commit()

    register.risks = []
    logger.info("risk_register.created", extra={"register_id": register.id, "system_id": system_id})
    return RiskRegisterOut.model_validate(register)


@router.get("/systems/{system_id}/registers", response_model=list[RiskRegisterOut])
async def list_registers(
    system_id: str,
    session: AsyncSession = Depends(get_session),
):
    """List all registers for a system, newest first."""
    result = await session.execute(
        select(RiskRegister)
        .where(RiskRegister.ai_system_id == system_id)
        .order_by(RiskRegister.created_at.desc())
    )
    registers = list(result.scalars().all())
    out = []
    for reg in registers:
        full = await _load_register_full(session, reg.id)
        if full:
            out.append(RiskRegisterOut.model_validate(full))
    return out


@router.get("/registers/{register_id}", response_model=RiskRegisterOut)
async def get_register(register_id: str, session: AsyncSession = Depends(get_session)):
    register = await _load_register_full(session, register_id)
    if register is None:
        raise HTTPException(status_code=404, detail="Register not found")
    return RiskRegisterOut.model_validate(register)


@router.patch("/registers/{register_id}", response_model=RiskRegisterOut)
async def patch_register(
    register_id: str,
    body: RiskRegisterPatch,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(RiskRegister).where(RiskRegister.id == register_id))
    register = result.scalar_one_or_none()
    if register is None:
        raise HTTPException(status_code=404, detail="Register not found")

    if body.status is not None:
        register.status = body.status
    if body.assessment_scope is not None:
        register.assessment_scope = body.assessment_scope
    if body.residual_risk_acceptable is not None:
        register.residual_risk_acceptable = body.residual_risk_acceptable
    if body.residual_risk_argument is not None:
        register.residual_risk_argument = body.residual_risk_argument
    if body.notes is not None:
        register.notes = body.notes

    session.add(register)
    await session.commit()

    full = await _load_register_full(session, register_id)
    return RiskRegisterOut.model_validate(full)


@router.post("/registers/{register_id}/approve", response_model=RiskRegisterOut)
async def approve_register(
    register_id: str,
    body: ApproveRegisterIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Art. 9(5): expert sign-off with named approver.

    Completeness check: all confirmed risks must have at least one mitigation
    or a documented closure_justification.
    """
    result = await session.execute(select(RiskRegister).where(RiskRegister.id == register_id))
    register = result.scalar_one_or_none()
    if register is None:
        raise HTTPException(status_code=404, detail="Register not found")

    # Completeness check
    risks_result = await session.execute(
        select(RiskEntry)
        .where(RiskEntry.register_id == register_id)
        .where(RiskEntry.status == "confirmed")
    )
    confirmed_risks = list(risks_result.scalars().all())
    incomplete = []
    for risk in confirmed_risks:
        mit_result = await session.execute(
            select(func.count(MitigationMeasure.id)).where(MitigationMeasure.risk_id == risk.id)
        )
        count = mit_result.scalar_one() or 0
        if count == 0 and not risk.closure_justification.strip():
            incomplete.append(risk.title)
    if incomplete:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot approve: {len(incomplete)} risk(s) have no mitigation and no closure justification: {', '.join(incomplete[:3])}{'…' if len(incomplete) > 3 else ''}",
        )

    register.status = "approved"
    register.residual_risk_acceptable = body.residual_risk_acceptable
    register.residual_risk_argument = body.residual_risk_argument
    register.approver_username = _username(request)
    register.approved_at = datetime.now(timezone.utc)
    register.last_assessment_completed_at = datetime.now(timezone.utc)
    session.add(register)

    # Schedule next re-assessment in 6 months
    trigger = ReassessmentTrigger(
        id=new_id("RAT"),
        ai_system_id=register.ai_system_id,
        trigger_type="scheduled_6_month",
        trigger_reason="Automatic 6-month re-assessment cycle (Art. 9(1))",
        triggered_at=datetime.now(timezone.utc) + timedelta(days=180),
    )
    session.add(trigger)
    await session.commit()

    full = await _load_register_full(session, register_id)
    logger.info("risk_register.approved", extra={"register_id": register_id, "approver": _username(request)})
    return RiskRegisterOut.model_validate(full)
