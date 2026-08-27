"""Workflow endpoints — submit, approve, reject, history, questionnaire section transitions."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import select

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ, SYSTEMS_WRITE, SYSTEMS_APPROVE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.system_workflow_step import SystemWorkflowStep
from app.classifier import classify
from app.ids import new_id
from app.schemas import (
    WorkflowStepResponse,
    WorkflowSubmitRequest,
    WorkflowApproveRequest,
    WorkflowRejectRequest,
    WorkflowAssignRequest,
    WorkflowSubmitSectionRequest,
)
from app import email_sender

router = APIRouter(tags=["workflow"])
logger = get_logger(__name__)


def _current_user(request: Request) -> str:
    return request.headers.get("x-forwarded-preferred-username", "unknown")


async def _get_steps(session, system_id: str) -> list[WorkflowStepResponse]:
    steps = await session.execute(
        select(SystemWorkflowStep)
        .where(SystemWorkflowStep.system_id == system_id)
        .order_by(SystemWorkflowStep.created_at)
    )
    return [WorkflowStepResponse.model_validate(s) for s in steps.scalars().all()]


@router.get("/systems/{system_id}/workflow", response_model=list[WorkflowStepResponse])
async def get_workflow(system_id: str, _: str = Depends(require_permission(SYSTEMS_READ))):
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        if not result.scalar_one_or_none():
            raise HTTPException(404, f"System {system_id} not found")
        return await _get_steps(session, system_id)


@router.post("/systems/{system_id}/workflow/assign", response_model=list[WorkflowStepResponse])
async def assign_sections(
    system_id: str,
    body: WorkflowAssignRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.workflow_status != "draft":
            raise HTTPException(422, f"Cannot assign from status '{row.workflow_status}'")

        # Only the original creator may assign.
        owner_result = await session.execute(
            select(SystemWorkflowStep)
            .where(SystemWorkflowStep.system_id == system_id, SystemWorkflowStep.step == "registered")
            .limit(1)
        )
        owner_step = owner_result.scalar_one_or_none()
        if owner_step and owner_step.actor_username != current_user:
            raise HTTPException(403, "Only the system creator may assign sections")

        row.business_assignee_username = body.business_assignee_username
        row.technical_assignee_username = body.technical_assignee_username
        row.compliance_officer_username = body.compliance_officer_username
        row.assignee_username = body.business_assignee_username
        row.workflow_status = "business_pending"

        step = SystemWorkflowStep(
            id=new_id("SWS"),
            system_id=system_id,
            step="section_assigned",
            actor_username=current_user,
            assignee_username=body.business_assignee_username,
            note=body.note,
        )
        session.add(step)
        system_name = row.name
        await session.commit()
        result_steps = await _get_steps(session, system_id)

    logger.info("system.sections_assigned", extra={
        "system_id": system_id,
        "business_assignee": body.business_assignee_username,
        "technical_assignee": body.technical_assignee_username,
        "co": body.compliance_officer_username,
    })

    background_tasks.add_task(
        email_sender.notify,
        to_username=body.business_assignee_username,
        subject=f"[AI Trust] Action required: fill Use Case & Context for '{system_name}'",
        body=(
            f"Hi,\n\n"
            f"You have been assigned to complete the 'Use Case & Context' section for the AI system "
            f"'{system_name}' ({system_id}).\n\n"
            f"Please log in and open the system to fill in the required information.\n\n"
            f"AI Trust Platform: {email_sender.REGISTRY_URL}"
        ),
    )

    return result_steps


@router.post("/systems/{system_id}/workflow/submit-business", response_model=list[WorkflowStepResponse])
async def submit_business_section(
    system_id: str,
    body: WorkflowSubmitSectionRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.workflow_status != "business_pending":
            raise HTTPException(422, f"Cannot submit business section from status '{row.workflow_status}'")
        if row.business_assignee_username and current_user != row.business_assignee_username:
            raise HTTPException(403, "Only the business section assignee may submit this section")

        row.workflow_status = "technical_pending"
        row.assignee_username = row.technical_assignee_username

        step = SystemWorkflowStep(
            id=new_id("SWS"),
            system_id=system_id,
            step="business_submitted",
            actor_username=current_user,
            assignee_username=row.technical_assignee_username,
            note=body.note,
        )
        session.add(step)
        system_name = row.name
        technical_assignee = row.technical_assignee_username
        await session.commit()
        result_steps = await _get_steps(session, system_id)

    logger.info("system.business_section_submitted", extra={"system_id": system_id, "by": current_user})

    if technical_assignee:
        background_tasks.add_task(
            email_sender.notify,
            to_username=technical_assignee,
            subject=f"[AI Trust] Action required: fill AI Risk Classification for '{system_name}'",
            body=(
                f"Hi,\n\n"
                f"You have been assigned to complete the 'AI Risk Classification' section for the AI system "
                f"'{system_name}' ({system_id}).\n\n"
                f"Please log in and open the system to fill in the required information.\n\n"
                f"AI Trust Platform: {email_sender.REGISTRY_URL}"
            ),
        )

    return result_steps


@router.post("/systems/{system_id}/workflow/submit-technical", response_model=list[WorkflowStepResponse])
async def submit_technical_section(
    system_id: str,
    body: WorkflowSubmitSectionRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.workflow_status != "technical_pending":
            raise HTTPException(422, f"Cannot submit technical section from status '{row.workflow_status}'")
        if row.technical_assignee_username and current_user != row.technical_assignee_username:
            raise HTTPException(403, "Only the technical section assignee may submit this section")

        # Run classification now that all flags are set.
        classification = classify(row)
        row.tier = classification.tier
        row.basis = classification.basis
        row.annex_iii_area = classification.annex_iii_area

        row.workflow_status = "pending_review"
        row.assignee_username = row.compliance_officer_username

        step = SystemWorkflowStep(
            id=new_id("SWS"),
            system_id=system_id,
            step="technical_submitted",
            actor_username=current_user,
            assignee_username=row.compliance_officer_username,
            note=body.note,
        )
        session.add(step)
        system_name = row.name
        co_username = row.compliance_officer_username
        await session.commit()
        result_steps = await _get_steps(session, system_id)

    logger.info("system.technical_section_submitted", extra={
        "system_id": system_id, "by": current_user, "tier": classification.tier,
    })

    if co_username:
        background_tasks.add_task(
            email_sender.notify,
            to_username=co_username,
            subject=f"[AI Trust] System '{system_name}' ready for compliance review",
            body=(
                f"Hi,\n\n"
                f"The AI system '{system_name}' ({system_id}) has completed both questionnaire sections "
                f"and is now ready for your compliance review.\n\n"
                f"Classified tier: {classification.tier}\n\n"
                f"AI Trust Platform: {email_sender.REGISTRY_URL}"
            ),
        )

    return result_steps


@router.post("/systems/{system_id}/workflow/submit", response_model=list[WorkflowStepResponse])
async def submit_for_review(
    system_id: str,
    body: WorkflowSubmitRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.assignee_username and current_user != row.assignee_username:
            raise HTTPException(403, "Only the assigned engineer may submit this system for review")
        if row.workflow_status not in ("draft", "rejected"):
            raise HTTPException(422, f"Cannot submit from status '{row.workflow_status}'")

        step = SystemWorkflowStep(
            id=new_id("SWS"),
            system_id=system_id,
            step="details_submitted",
            actor_username=current_user,
            assignee_username=body.assignee_username,
            note=body.note,
        )
        row.workflow_status = "pending_review"
        row.assignee_username = body.assignee_username
        row.compliance_officer_username = body.assignee_username
        session.add(step)
        system_name = row.name
        await session.commit()
        result_steps = await _get_steps(session, system_id)

    logger.info("system.submitted_for_review", extra={"system_id": system_id, "assignee": body.assignee_username})

    background_tasks.add_task(
        email_sender.notify,
        to_username=body.assignee_username,
        subject=f"[AI Trust] System '{system_name}' ready for your review",
        body=(
            f"Hi,\n\n"
            f"The AI system '{system_name}' ({system_id}) has been submitted for compliance review "
            f"and is waiting for your approval.\n\n"
            f"AI Trust Platform: {email_sender.REGISTRY_URL}"
        ),
    )

    return result_steps


@router.post("/systems/{system_id}/workflow/approve", response_model=list[WorkflowStepResponse])
async def approve_system(
    system_id: str,
    body: WorkflowApproveRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_APPROVE)),
):
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.assignee_username and current_user != row.assignee_username:
            raise HTTPException(403, "Only the assigned compliance officer may approve this system")
        if row.workflow_status != "pending_review":
            raise HTTPException(422, f"Cannot approve from status '{row.workflow_status}'")

        owner_result = await session.execute(
            select(SystemWorkflowStep)
            .where(SystemWorkflowStep.system_id == system_id, SystemWorkflowStep.step == "registered")
            .order_by(SystemWorkflowStep.created_at)
            .limit(1)
        )
        owner_step = owner_result.scalar_one_or_none()
        owner_username = owner_step.actor_username if owner_step else None

        step = SystemWorkflowStep(
            id=new_id("SWS"),
            system_id=system_id,
            step="approved",
            actor_username=current_user,
            note=body.note,
        )
        row.workflow_status = "approved"
        row.assignee_username = None
        session.add(step)
        system_name = row.name
        await session.commit()
        result_steps = await _get_steps(session, system_id)

    logger.info("system.approved", extra={"system_id": system_id, "approved_by": current_user})

    if owner_username:
        background_tasks.add_task(
            email_sender.notify,
            to_username=owner_username,
            subject=f"[AI Trust] System '{system_name}' has been approved",
            body=(
                f"Hi,\n\n"
                f"The AI system '{system_name}' ({system_id}) you registered has been approved "
                f"by the compliance team.\n\n"
                f"AI Trust Platform: {email_sender.REGISTRY_URL}"
            ),
        )

    return result_steps


@router.post("/systems/{system_id}/workflow/reject", response_model=list[WorkflowStepResponse])
async def reject_system(
    system_id: str,
    body: WorkflowRejectRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_APPROVE)),
):
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.assignee_username and current_user != row.assignee_username:
            raise HTTPException(403, "Only the assigned compliance officer may reject this system")
        if row.workflow_status != "pending_review":
            raise HTTPException(422, f"Cannot reject from status '{row.workflow_status}'")

        if body.send_to == "business":
            new_status = "business_pending"
            target_assignee = row.business_assignee_username or body.assignee_username
            section_label = "Use Case & Context"
        else:
            new_status = "technical_pending"
            target_assignee = row.technical_assignee_username or body.assignee_username
            section_label = "AI Risk Classification"

        step = SystemWorkflowStep(
            id=new_id("SWS"),
            system_id=system_id,
            step="rejected",
            actor_username=current_user,
            assignee_username=target_assignee,
            note=body.note,
        )
        row.workflow_status = new_status
        row.assignee_username = target_assignee
        session.add(step)
        system_name = row.name
        await session.commit()
        result_steps = await _get_steps(session, system_id)

    logger.info("system.rejected", extra={
        "system_id": system_id, "rejected_by": current_user,
        "send_to": body.send_to, "target_assignee": target_assignee,
    })

    if target_assignee:
        background_tasks.add_task(
            email_sender.notify,
            to_username=target_assignee,
            subject=f"[AI Trust] System '{system_name}' returned — revision needed",
            body=(
                f"Hi,\n\n"
                f"The AI system '{system_name}' ({system_id}) has been returned for revision "
                f"of the '{section_label}' section.\n\n"
                f"Rejection note: {body.note}\n\n"
                f"Please review the feedback, update the section, and resubmit.\n\n"
                f"AI Trust Platform: {email_sender.REGISTRY_URL}"
            ),
        )

    return result_steps
