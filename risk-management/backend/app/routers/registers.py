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
    PlanTask,
    TestReport,
    Incident,
    ReassessmentTrigger,
)
from app.ids import new_id
from app.schemas import (
    RiskRegisterIn,
    RiskRegisterOut,
    RiskRegisterPatch,
    ApproveRegisterIn,
    SystemRiskSummary,
    RegisterDiff,
    RegisterDiffEntry,
    RiskFieldChange,
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


def _traffic_light(
    tier: str | None,
    active_register: RiskRegister | None,
    risks: list[RiskEntry],
    unacknowledged: int,
    last_completed: datetime | None,
) -> str:
    if not tier or tier == "pending":
        return "orange"

    if tier == "prohibited":
        return "red"

    if tier == "high":
        if not active_register:
            return "red"
        if active_register.status != "approved":
            return "orange"
        if unacknowledged > 0 or _is_stale(last_completed):
            return "red"
        if not risks:
            return "red"
        all_confirmed = all(r.engineer_confirmed and r.officer_confirmed for r in risks)
        return "green" if all_confirmed else "orange"

    # non-high (limited, minimal, gpai-standard, gpai-systemic)
    if not active_register:
        return "green"
    if active_register.status != "approved":
        return "orange"
    if risks:
        all_confirmed = all(r.engineer_confirmed and r.officer_confirmed for r in risks)
        return "green" if all_confirmed else "orange"
    return "green"


def _risk_fully_confirmed(risk: RiskEntry) -> bool:
    """Mirrors the frontend's canFullyConfirm(): only roles actually listed in
    responsible_role must confirm (or decline) before a risk counts as resolved.
    """
    roles = {r.strip() for r in (risk.responsible_role or "").split(",") if r.strip()}
    engineer_required = "ai_engineer" in roles
    officer_required = "ai_compliance_officer" in roles
    if not engineer_required and not officer_required:
        return True
    engineer_ok = not engineer_required or risk.engineer_confirmed or risk.engineer_declined
    officer_ok = not officer_required or risk.officer_confirmed or risk.officer_declined
    return engineer_ok and officer_ok


async def _clone_if_approved(session: AsyncSession, register_id: str) -> str:
    """If the register is approved, archive it and clone it to a new draft register.

    The new register inherits all content (risks, mitigations, misuse scenarios,
    plan tasks, test reports, incidents) and selected header fields.
    Returns the new register_id (or the original if it was already a draft).
    The caller is responsible for committing the session.
    """
    result = await session.execute(select(RiskRegister).where(RiskRegister.id == register_id))
    register = result.scalar_one_or_none()
    if register is None or register.status != "approved":
        return register_id

    # Archive the current approved register
    register.status = "archived"
    session.add(register)
    await session.flush()

    # Create new draft register inheriting header fields
    new_reg = RiskRegister(
        id=new_id("RRM"),
        ai_system_id=register.ai_system_id,
        status="draft",
        assessment_scope=register.assessment_scope,
        reviewer_username=register.reviewer_username,
        residual_risk_argument=register.residual_risk_argument,
        next_review_date=register.next_review_date,
        notes=register.notes,
        created_by=register.created_by,
        registry_snapshot=register.registry_snapshot,
        last_assessment_completed_at=register.last_assessment_completed_at,
    )
    session.add(new_reg)
    await session.flush()

    # Clone risks + their children
    risks_result = await session.execute(
        select(RiskEntry).where(RiskEntry.register_id == register_id)
    )
    old_risks = list(risks_result.scalars().all())

    # old_risk_id -> new_risk_id mapping (needed for child FK remapping)
    risk_id_map: dict[str, str] = {}
    # old_mit_id -> new_mit_id mapping (needed for plan_task FK remapping)
    mit_id_map: dict[str, str] = {}

    for old_risk in old_risks:
        new_risk_id = new_id("RSK")
        risk_id_map[old_risk.id] = new_risk_id
        new_risk = RiskEntry(
            id=new_risk_id,
            register_id=new_reg.id,
            title=old_risk.title,
            description=old_risk.description,
            category=old_risk.category,
            article_9_step=old_risk.article_9_step,

            severity=old_risk.severity,
            likelihood=old_risk.likelihood,
            status=old_risk.status,
            review_notes=old_risk.review_notes,
            affects_vulnerable_groups=old_risk.affects_vulnerable_groups,
            vulnerable_groups=old_risk.vulnerable_groups,
            closure_justification=old_risk.closure_justification,
            source=old_risk.source,
            taxonomy_mappings=old_risk.taxonomy_mappings,
            risk_owner=old_risk.risk_owner,
            ai_lifecycle_phase=old_risk.ai_lifecycle_phase,
            impact=old_risk.impact,
            risk_level_autocalculated=old_risk.risk_level_autocalculated,
            residual_likelihood=old_risk.residual_likelihood,
            residual_severity=old_risk.residual_severity,
            final_risk_level=old_risk.final_risk_level,
            date_of_assessment=old_risk.date_of_assessment,
            responsible_role=old_risk.responsible_role,
            deadline=old_risk.deadline,
            engineer_confirmed=old_risk.engineer_confirmed,
            officer_confirmed=old_risk.officer_confirmed,
        )
        session.add(new_risk)
        await session.flush()

        # Clone misuse scenarios
        ms_result = await session.execute(
            select(MisuseScenario).where(MisuseScenario.risk_id == old_risk.id)
        )
        for ms in ms_result.scalars().all():
            session.add(MisuseScenario(
                id=new_id("MIS"),
                risk_id=new_risk_id,
                actor=ms.actor,
                description=ms.description,
                likelihood=ms.likelihood,
                consequence=ms.consequence,
                vulnerable_group=ms.vulnerable_group,
            ))

        # Clone mitigations
        mit_result = await session.execute(
            select(MitigationMeasure).where(MitigationMeasure.risk_id == old_risk.id)
        )
        for mit in mit_result.scalars().all():
            new_mit_id = new_id("MIT")
            mit_id_map[mit.id] = new_mit_id
            session.add(MitigationMeasure(
                id=new_mit_id,
                risk_id=new_risk_id,
                title=mit.title,
                description=mit.description,
                hierarchy_level=mit.hierarchy_level,
                implementation_guidance=mit.implementation_guidance,
                status=mit.status,
                assigned_to=mit.assigned_to,
                due_date=mit.due_date,
                override_notes=mit.override_notes,
            ))

        # Clone test reports
        tr_result = await session.execute(
            select(TestReport).where(TestReport.risk_id == old_risk.id)
        )
        for tr in tr_result.scalars().all():
            session.add(TestReport(
                id=new_id("TRP"),
                risk_id=new_risk_id,
                mitigation_id=None,  # remapped below after mit flush
                title=tr.title,
                summary=tr.summary,
                findings=tr.findings,
                result=tr.result,
                author=tr.author,
                attachments=tr.attachments,
            ))

    await session.flush()

    # Clone plan tasks (with remapped risk_id and mitigation_id)
    tasks_result = await session.execute(
        select(PlanTask).where(PlanTask.register_id == register_id)
    )
    for task in tasks_result.scalars().all():
        session.add(PlanTask(
            id=new_id("PTK"),
            register_id=new_reg.id,
            risk_id=risk_id_map.get(task.risk_id) if task.risk_id else None,
            mitigation_id=mit_id_map.get(task.mitigation_id) if task.mitigation_id else None,
            title=task.title,
            description=task.description,
            assigned_to=task.assigned_to,
            due_date=task.due_date,
            status=task.status,
        ))

    # Clone incidents (with remapped risk_id)
    inc_result = await session.execute(
        select(Incident).where(Incident.register_id == register_id)
    )
    for inc in inc_result.scalars().all():
        session.add(Incident(
            id=new_id("INC"),
            register_id=new_reg.id,
            risk_id=risk_id_map.get(inc.risk_id) if inc.risk_id else None,
            title=inc.title,
            description=inc.description,
            status=inc.status,
            reported_by=inc.reported_by,
            occurred_at=inc.occurred_at,
            attachments=inc.attachments,
        ))

    logger.info(
        "risk_register.cloned_on_edit",
        extra={"old_register_id": register_id, "new_register_id": new_reg.id},
    )
    return new_reg.id


# Keep _reopen_if_approved as an alias so existing imports in other routers
# continue to work — approved registers are now cloned instead of reopened,
# but the calling convention (session, register_id) is unchanged.
# NOTE: callers that check the return value (bool) will now get str instead —
# they do not use the return value, so this is safe.
_reopen_if_approved = _clone_if_approved


@router.get("/systems", response_model=list[SystemRiskSummary])
async def list_systems(session: AsyncSession = Depends(get_session)):
    """List all AI systems with their risk assessment status."""
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

        # Load risks for traffic light calculation
        risks: list[RiskEntry] = []
        if active_register:
            risks_result = await session.execute(
                select(RiskEntry).where(RiskEntry.register_id == active_register.id)
            )
            risks = list(risks_result.scalars().all())

        # Count unacknowledged triggers (all types, for traffic light / reassessment_needed)
        trigger_count_result = await session.execute(
            select(func.count(ReassessmentTrigger.id))
            .where(ReassessmentTrigger.ai_system_id == sys.id)
            .where(ReassessmentTrigger.acknowledged == False)  # noqa: E712
            .where(ReassessmentTrigger.triggered_at <= datetime.now(timezone.utc))
        )
        unacknowledged = trigger_count_result.scalar_one() or 0

        # Count only registry_changed triggers (for "Changes pending review" label)
        registry_changed_count_result = await session.execute(
            select(func.count(ReassessmentTrigger.id))
            .where(ReassessmentTrigger.ai_system_id == sys.id)
            .where(ReassessmentTrigger.trigger_type == "registry_changed")
            .where(ReassessmentTrigger.acknowledged == False)  # noqa: E712
            .where(ReassessmentTrigger.triggered_at <= datetime.now(timezone.utc))
        )
        registry_changed = (registry_changed_count_result.scalar_one() or 0) > 0

        last_completed = active_register.last_assessment_completed_at if active_register else None
        stale = _is_stale(last_completed)
        reassessment_needed = stale or unacknowledged > 0

        valid_since = active_register.approved_at if active_register else None
        valid_until = active_register.next_review_date if active_register else None

        tl = _traffic_light(sys.tier, active_register, risks, unacknowledged, last_completed)

        confirmed_statuses = {"confirmed", "dismissed"}
        unconfirmed_risks = sum(
            1 for r in risks
            if r.status in confirmed_statuses and not _risk_fully_confirmed(r)
        )
        total_risks = len(risks)
        open_risks = sum(1 for r in risks if r.status == "open")

        summaries.append(SystemRiskSummary(
            system_id=sys.id,
            system_name=sys.name,
            system_tier=sys.tier,
            system_lifecycle=sys.lifecycle,
            system_org_role=sys.org_role,
            active_register_id=active_register.id if active_register else None,
            active_register_status=active_register.status if active_register else None,
            last_assessment_completed_at=last_completed,
            valid_since=valid_since,
            valid_until=valid_until,
            unacknowledged_triggers=unacknowledged,
            reassessment_needed=reassessment_needed,
            registry_changed=registry_changed,
            unconfirmed_risks=unconfirmed_risks,
            total_risks=total_risks,
            open_risks=open_risks,
            traffic_light=tl,
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

    If the current active register is approved, clones it (archiving the old one)
    and returns the new register — no blank slate.
    If there is no active register, or it's already a draft, creates fresh.
    """
    sys_result = await session.execute(select(AISystem).where(AISystem.id == system_id))
    system = sys_result.scalar_one_or_none()
    if system is None:
        raise HTTPException(status_code=404, detail="AI system not found")

    # Find existing active (non-archived) register
    existing_result = await session.execute(
        select(RiskRegister)
        .where(RiskRegister.ai_system_id == system_id)
        .where(RiskRegister.status != "archived")
        .order_by(RiskRegister.created_at.desc())
        .limit(1)
    )
    active = existing_result.scalar_one_or_none()

    if active and active.status == "approved":
        # Clone the approved register — this archives old and returns new id
        new_register_id = await _clone_if_approved(session, active.id)
    elif active and active.status == "draft":
        # Already a draft — return it as-is (idempotent)
        new_register_id = active.id
    else:
        # No active register — create fresh
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
        new_register_id = register.id

    # Acknowledge pending triggers
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
        trigger.new_register_id = new_register_id
        session.add(trigger)

    await session.commit()

    full = await _load_register_full(session, new_register_id)
    logger.info("risk_register.created", extra={"register_id": new_register_id, "system_id": system_id})
    return RiskRegisterOut.model_validate(full)


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


@router.post("/registers/{register_id}/clone", status_code=201)
async def clone_register(
    register_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Clone an approved register into a new draft, archiving the current one.

    Used by the frontend when the user initiates a 'Review' cycle or edits an
    approved register. Returns {new_register_id: str}.
    Idempotent for draft registers — returns the same register_id unchanged.
    """
    result = await session.execute(select(RiskRegister).where(RiskRegister.id == register_id))
    register = result.scalar_one_or_none()
    if register is None:
        raise HTTPException(status_code=404, detail="Register not found")

    if register.status != "approved":
        # Already a draft or archived — nothing to clone
        return {"new_register_id": register_id}

    new_id_val = await _clone_if_approved(session, register_id)

    # Acknowledge pending triggers
    triggers_result = await session.execute(
        select(ReassessmentTrigger)
        .where(ReassessmentTrigger.ai_system_id == register.ai_system_id)
        .where(ReassessmentTrigger.acknowledged == False)  # noqa: E712
    )
    actor = _username(request)
    for trigger in triggers_result.scalars().all():
        trigger.acknowledged = True
        trigger.acknowledged_by = actor
        trigger.acknowledged_at = datetime.now(timezone.utc)
        trigger.new_register_id = new_id_val
        session.add(trigger)

    await session.commit()
    logger.info("risk_register.cloned", extra={"old_id": register_id, "new_id": new_id_val, "actor": actor})
    return {"new_register_id": new_id_val}


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
    if body.residual_severity is not None:
        register.residual_severity = body.residual_severity
    if body.residual_likelihood is not None:
        register.residual_likelihood = body.residual_likelihood
    if body.residual_final_risk_level is not None:
        register.residual_final_risk_level = body.residual_final_risk_level
    if body.residual_date_of_identification is not None:
        register.residual_date_of_identification = body.residual_date_of_identification
    if body.notes is not None:
        register.notes = body.notes
    if body.next_review_date is not None:
        register.next_review_date = body.next_review_date

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

    # Load system tier for approval checks
    sys_result = await session.execute(select(AISystem).where(AISystem.id == register.ai_system_id))
    system = sys_result.scalar_one_or_none()
    is_high = system and system.tier in ("high", "prohibited")

    # Check 1: at least one risk required
    all_risks_result = await session.execute(
        select(RiskEntry).where(RiskEntry.register_id == register_id)
    )
    all_risks = list(all_risks_result.scalars().all())
    if not all_risks:
        raise HTTPException(
            status_code=422,
            detail="Cannot approve: the register must contain at least one risk.",
        )

    # Check 2: for high/prohibited systems every risk must have at least one mitigation
    if is_high:
        missing_mit = []
        for risk in all_risks:
            mit_count_result = await session.execute(
                select(func.count(MitigationMeasure.id)).where(MitigationMeasure.risk_id == risk.id)
            )
            if (mit_count_result.scalar_one() or 0) == 0:
                missing_mit.append(risk.title)
        if missing_mit:
            raise HTTPException(
                status_code=422,
                detail=f"Cannot approve: high-risk system — every risk must have at least one mitigation measure. Missing for: {', '.join(missing_mit[:3])}{'…' if len(missing_mit) > 3 else ''}",
            )

    # Check 3a: risks with unacceptable residual must have at least one plan task (via risk_id)
    unacceptable_risks = [r for r in all_risks if r.residual_status == "unacceptable"]
    missing_tasks = []
    for risk in unacceptable_risks:
        task_count_result = await session.execute(
            select(func.count(PlanTask.id)).where(
                PlanTask.register_id == register_id,
                PlanTask.risk_id == risk.id,
            )
        )
        if (task_count_result.scalar_one() or 0) == 0:
            missing_tasks.append(risk.title)
    if missing_tasks:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot approve: risks with unacceptable residual status must have at least one plan task. Missing tasks for: {', '.join(missing_tasks[:3])}{'…' if len(missing_tasks) > 3 else ''}",
        )

    # Check 3b: for risks with acceptable residual, every mitigation must have a linked plan task
    acceptable_risks = [r for r in all_risks if r.residual_status == "acceptable"]
    acceptable_risk_ids = [r.id for r in acceptable_risks]
    if acceptable_risk_ids:
        acc_mits_result = await session.execute(
            select(MitigationMeasure).where(MitigationMeasure.risk_id.in_(acceptable_risk_ids))
        )
        acc_mits = list(acc_mits_result.scalars().all())
        missing_mit_tasks = []
        for mit in acc_mits:
            task_count_result = await session.execute(
                select(func.count(PlanTask.id)).where(PlanTask.mitigation_id == mit.id)
            )
            if (task_count_result.scalar_one() or 0) == 0:
                missing_mit_tasks.append(mit.title)
        if missing_mit_tasks:
            raise HTTPException(
                status_code=422,
                detail=f"Cannot approve: every mitigation on a risk with acceptable residual must have a plan task. Missing tasks for: {', '.join(missing_mit_tasks[:3])}{'…' if len(missing_mit_tasks) > 3 else ''}",
            )

    # Planning step completeness: review date must be set and within 6 months
    if not register.next_review_date:
        raise HTTPException(
            status_code=422,
            detail="Cannot approve: review date not set. Go to the Plan step and set a review date.",
        )
    max_review = datetime.now(timezone.utc) + timedelta(days=180)
    review_date = register.next_review_date
    if review_date.tzinfo is None:
        review_date = review_date.replace(tzinfo=timezone.utc)
    if review_date > max_review:
        raise HTTPException(
            status_code=422,
            detail="Cannot approve: review date must be within 6 months from today.",
        )

    register.status = "approved"
    register.residual_risk_acceptable = body.residual_risk_acceptable
    register.residual_risk_argument = body.residual_risk_argument
    register.approver_username = _username(request)
    register.approved_at = datetime.now(timezone.utc)
    register.last_assessment_completed_at = datetime.now(timezone.utc)
    # Save registry snapshot at approval time (for change detection)
    if body.registry_snapshot:
        register.registry_snapshot = body.registry_snapshot
    session.add(register)

    # Schedule next review on the date set in the Plan step
    trigger = ReassessmentTrigger(
        id=new_id("RAT"),
        ai_system_id=register.ai_system_id,
        trigger_type="scheduled_6_month",
        trigger_reason="Scheduled review cycle",
        triggered_at=review_date,
    )
    session.add(trigger)
    await session.commit()

    full = await _load_register_full(session, register_id)
    logger.info("risk_register.approved", extra={"register_id": register_id, "approver": _username(request)})
    return RiskRegisterOut.model_validate(full)


@router.post("/registers/{register_id}/check-registry-changes", status_code=200)
async def check_registry_changes(
    register_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Compare current registry data against the saved snapshot.

    If differences are found and register is approved, creates a ReassessmentTrigger
    of type 'registry_changed' (deduplicated — only one unacknowledged per register).
    Returns {changed: bool, fields: [...changed field names...]}.
    """
    import json as _json

    result = await session.execute(select(RiskRegister).where(RiskRegister.id == register_id))
    register = result.scalar_one_or_none()
    if register is None:
        raise HTTPException(status_code=404, detail="Register not found")

    if not register.registry_snapshot:
        return {"changed": False, "fields": []}

    try:
        snapshot = _json.loads(register.registry_snapshot)
    except Exception:
        return {"changed": False, "fields": []}

    body_bytes = await request.body()
    try:
        current = _json.loads(body_bytes) if body_bytes else {}
    except Exception:
        return {"changed": False, "fields": []}

    TRACKED = ["name", "description", "intended_purpose", "tier", "lifecycle", "org_role", "use_case", "department"]
    changed_fields = [f for f in TRACKED if str(snapshot.get(f) or "") != str(current.get(f) or "")]

    if changed_fields and register.status == "approved":
        existing_result = await session.execute(
            select(ReassessmentTrigger)
            .where(ReassessmentTrigger.ai_system_id == register.ai_system_id)
            .where(ReassessmentTrigger.trigger_type == "registry_changed")
            .where(ReassessmentTrigger.acknowledged == False)  # noqa: E712
        )
        if existing_result.scalar_one_or_none() is None:
            trigger = ReassessmentTrigger(
                id=new_id("RAT"),
                ai_system_id=register.ai_system_id,
                trigger_type="registry_changed",
                trigger_reason=f"Registry data changed since last approval: {', '.join(changed_fields)}",
                triggered_at=datetime.now(timezone.utc),
            )
            session.add(trigger)
            await session.commit()
            logger.info("risk_register.registry_changed", extra={"register_id": register_id, "fields": changed_fields})

    return {"changed": bool(changed_fields), "fields": changed_fields}


@router.get("/registers/{register_id}/diff", response_model=RegisterDiff)
async def get_register_diff(
    register_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Compare this register's risks against the previous register for the same system."""
    result = await session.execute(select(RiskRegister).where(RiskRegister.id == register_id))
    register = result.scalar_one_or_none()
    if register is None:
        raise HTTPException(status_code=404, detail="Register not found")

    # Load current register risks
    curr_risks_result = await session.execute(
        select(RiskEntry).where(RiskEntry.register_id == register_id)
    )
    curr_risks = list(curr_risks_result.scalars().all())

    # Find the previous register for the same system (archived, created before this one)
    prev_result = await session.execute(
        select(RiskRegister)
        .where(RiskRegister.ai_system_id == register.ai_system_id)
        .where(RiskRegister.id != register_id)
        .where(RiskRegister.status == "archived")
        .where(RiskRegister.created_at < register.created_at)
        .order_by(RiskRegister.created_at.desc())
        .limit(1)
    )
    prev_register = prev_result.scalar_one_or_none()

    if prev_register is None:
        return RegisterDiff(added=[r.title for r in curr_risks])

    prev_risks_result = await session.execute(
        select(RiskEntry).where(RiskEntry.register_id == prev_register.id)
    )
    prev_risks = list(prev_risks_result.scalars().all())

    # Load mitigations for both registers
    all_risk_ids = [r.id for r in curr_risks] + [r.id for r in prev_risks]
    mit_result = await session.execute(
        select(MitigationMeasure).where(MitigationMeasure.risk_id.in_(all_risk_ids))
    )
    all_mits = list(mit_result.scalars().all())
    mits_by_risk: dict[str, list[MitigationMeasure]] = {}
    for m in all_mits:
        mits_by_risk.setdefault(m.risk_id, []).append(m)

    TRACKED_FIELDS = [
        ("severity", "Severity"),
        ("likelihood", "Likelihood"),
        ("category", "Category"),

        ("impact", "Impact"),
        ("description", "Description"),
        ("affects_vulnerable_groups", "Affects vulnerable groups"),
        ("vulnerable_groups", "Vulnerable groups"),
        ("ai_lifecycle_phase", "AI lifecycle phase"),
        ("risk_owner", "Risk owner"),
        ("residual_likelihood", "Residual likelihood"),
        ("residual_severity", "Residual severity"),
        ("final_risk_level", "Residual level"),
        ("review_notes", "Residual justification"),
        ("closure_justification", "Closure justification"),
        ("status", "Status"),
    ]

    def _str(val) -> str:
        if val is None:
            return ""
        return str(val).strip()

    prev_map = {r.title: r for r in prev_risks}
    curr_map = {r.title: r for r in curr_risks}

    added = [t for t in curr_map if t not in prev_map]
    removed = [t for t in prev_map if t not in curr_map]

    changed: list[RegisterDiffEntry] = []
    for title in curr_map:
        if title not in prev_map:
            continue
        prev_r = prev_map[title]
        curr_r = curr_map[title]

        field_changes: list[RiskFieldChange] = []
        for attr, label in TRACKED_FIELDS:
            pv = _str(getattr(prev_r, attr, None))
            cv = _str(getattr(curr_r, attr, None))
            if pv != cv:
                field_changes.append(RiskFieldChange(field=label, from_value=pv or "—", to_value=cv or "—"))

        # Compare mitigations by title
        prev_mit_titles = {m.title for m in mits_by_risk.get(prev_r.id, [])}
        curr_mit_titles = {m.title for m in mits_by_risk.get(curr_r.id, [])}
        mit_added = sorted(curr_mit_titles - prev_mit_titles)
        mit_removed = sorted(prev_mit_titles - curr_mit_titles)

        if field_changes or mit_added or mit_removed:
            changed.append(RegisterDiffEntry(
                title=title,
                fields=field_changes,
                mitigations_added=mit_added,
                mitigations_removed=mit_removed,
            ))

    curr_mit = sum(len(mits_by_risk.get(r.id, [])) for r in curr_risks)
    prev_mit = sum(len(mits_by_risk.get(r.id, [])) for r in prev_risks)

    return RegisterDiff(
        added=added,
        removed=removed,
        changed=changed,
        mitigations_delta=curr_mit - prev_mit,
    )
