"""Workflow endpoints — submit, approve, reject, history."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import select

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ, SYSTEMS_WRITE, SYSTEMS_APPROVE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.system_workflow_step import SystemWorkflowStep
from app.ids import new_id
from app.schemas import WorkflowStepResponse, WorkflowSubmitRequest, WorkflowApproveRequest, WorkflowRejectRequest
from app import email_sender

router = APIRouter(tags=["workflow"])
logger = get_logger(__name__)


def _current_user(request: Request) -> str:
    return request.headers.get("x-forwarded-preferred-username", "unknown")


@router.get("/systems/{system_id}/workflow", response_model=list[WorkflowStepResponse])
async def get_workflow(system_id: str, request: Request, _: str = Depends(require_permission(SYSTEMS_READ))):
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        if not result.scalar_one_or_none():
            raise HTTPException(404, f"System {system_id} not found")
        steps = await session.execute(
            select(SystemWorkflowStep)
            .where(SystemWorkflowStep.system_id == system_id)
            .order_by(SystemWorkflowStep.created_at)
        )
        return [WorkflowStepResponse.model_validate(s) for s in steps.scalars().all()]


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
        system_name = row.name  # capture before commit expires ORM attributes
        await session.commit()

        steps = await session.execute(
            select(SystemWorkflowStep)
            .where(SystemWorkflowStep.system_id == system_id)
            .order_by(SystemWorkflowStep.created_at)
        )
        result_steps = [WorkflowStepResponse.model_validate(s) for s in steps.scalars().all()]

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

        # Find the original owner (actor of the "registered" step)
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
        system_name = row.name  # capture before commit expires ORM attributes
        await session.commit()

        steps = await session.execute(
            select(SystemWorkflowStep)
            .where(SystemWorkflowStep.system_id == system_id)
            .order_by(SystemWorkflowStep.created_at)
        )
        result_steps = [WorkflowStepResponse.model_validate(s) for s in steps.scalars().all()]

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

        step = SystemWorkflowStep(
            id=new_id("SWS"),
            system_id=system_id,
            step="rejected",
            actor_username=current_user,
            assignee_username=body.assignee_username,
            note=body.note,
        )
        row.workflow_status = "rejected"
        row.assignee_username = body.assignee_username
        session.add(step)
        system_name = row.name  # capture before commit expires ORM attributes
        await session.commit()

        steps = await session.execute(
            select(SystemWorkflowStep)
            .where(SystemWorkflowStep.system_id == system_id)
            .order_by(SystemWorkflowStep.created_at)
        )
        result_steps = [WorkflowStepResponse.model_validate(s) for s in steps.scalars().all()]

    logger.info("system.rejected", extra={"system_id": system_id, "rejected_by": current_user, "reassigned_to": body.assignee_username})

    background_tasks.add_task(
        email_sender.notify,
        to_username=body.assignee_username,
        subject=f"[AI Trust] System '{system_name}' rejected — action required",
        body=(
            f"Hi,\n\n"
            f"The AI system '{system_name}' ({system_id}) has been rejected by the compliance team.\n\n"
            f"Rejection note: {body.note}\n\n"
            f"Please review the feedback, make the necessary changes, and resubmit.\n\n"
            f"AI Trust Platform: {email_sender.REGISTRY_URL}"
        ),
    )

    return result_steps
