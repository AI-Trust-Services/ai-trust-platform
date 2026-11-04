"""Workflow endpoints — the flow-agnostic remainder after the single-page
assessment redesign retired the section-based questionnaire / CO-review flow.

What remains:
- ``GET /workflow`` — step history (audit).
- ``POST /workflow/assign`` — record section assignees + intended purpose at
  assessment creation (used by the compliance "New Assessment" modal).
- ``POST /workflow/reset`` — reset a system's workflow state when an in-progress
  assessment is deleted.
- ``_get_steps`` / ``_active_sub_assignment`` — helpers imported by the live
  ``systems.py`` edit-lock logic.

The section-fill (``submit-business``/``submit-technical``/``submit``/``submit-info``/
``request-info``/``sub-*``/``question-*``) and CO-decision (``approve``/``reject``/
``rce-summary``) endpoints were removed; their replacements live in
``routers/assessment.py`` (the single-page assessment flow).
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import select

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ, SYSTEMS_WRITE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.system_workflow_step import SystemWorkflowStep
from app.ids import new_id
from app.schemas import WorkflowStepResponse, WorkflowAssignRequest
from app import email_sender

router = APIRouter(tags=["workflow"])
logger = get_logger(__name__)

# Sub-assignment step names encode the section they belong to (SystemWorkflowStep has
# no section column). _active_sub_assignment() derives the current edit-lock from them.
_SUB_STEPS = ("sub_assigned", "sub_completed", "sub_reclaimed")


def _current_user(request: Request) -> str:
    return request.headers.get("x-forwarded-preferred-username", "unknown")


async def _get_steps(session, system_id: str) -> list[WorkflowStepResponse]:
    steps = await session.execute(
        select(SystemWorkflowStep)
        .where(SystemWorkflowStep.system_id == system_id)
        .order_by(SystemWorkflowStep.created_at)
    )
    return [WorkflowStepResponse.model_validate(s) for s in steps.scalars().all()]


def _active_sub_assignment(
    steps: list[WorkflowStepResponse], section: str
) -> str | None:
    """Return the contributor holding the edit token for ``section`` via an active
    sub-assignment, or ``None``. Derived purely from step ordering."""
    valid = {f"{kind}_{section}" for kind in _SUB_STEPS}
    relevant = [s for s in steps if s.step in valid]
    if not relevant:
        return None
    latest = relevant[-1]  # steps arrive ordered by created_at
    if latest.step == f"sub_assigned_{section}":
        return latest.assignee_username
    return None


@router.get("/systems/{system_id}/workflow", response_model=list[WorkflowStepResponse])
async def get_workflow(
    system_id: str, _: str = Depends(require_permission(SYSTEMS_READ))
):
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        if not result.scalar_one_or_none():
            raise HTTPException(404, f"System {system_id} not found")
        return await _get_steps(session, system_id)


@router.post("/systems/{system_id}/workflow/reset")
async def reset_workflow(
    system_id: str,
    request: Request,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
) -> dict:
    """Reset system workflow to draft so a new assessment can be started."""
    current_user = _current_user(request)
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.workflow_status in ("approved", "rejected"):
            raise HTTPException(
                422,
                f"Cannot reset workflow from terminal status '{row.workflow_status}'",
            )
        row.workflow_status = "draft"
        row.business_assignee_username = None
        row.technical_assignee_username = None
        row.assignee_username = None
        await session.commit()
        logger.info(
            "system.workflow_reset", extra={"system_id": system_id, "by": current_user}
        )
        return {"status": "reset"}


@router.post(
    "/systems/{system_id}/workflow/assign", response_model=list[WorkflowStepResponse]
)
async def assign_sections(
    system_id: str,
    body: WorkflowAssignRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Record assignees + intended purpose at assessment creation. Called by the
    compliance 'New Assessment' modal while the system is a draft."""
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.workflow_status != "draft":
            raise HTTPException(
                422, f"Cannot assign from status '{row.workflow_status}'"
            )

        row.business_assignee_username = body.business_assignee_username
        row.technical_assignee_username = body.technical_assignee_username
        row.compliance_officer_username = body.compliance_officer_username
        row.assignee_username = body.business_assignee_username
        if body.intended_purpose is not None:
            row.intended_purpose = body.intended_purpose
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

    logger.info(
        "system.sections_assigned",
        extra={
            "system_id": system_id,
            "business_assignee": body.business_assignee_username,
            "technical_assignee": body.technical_assignee_username,
            "co": body.compliance_officer_username,
        },
    )

    if body.business_assignee_username:
        background_tasks.add_task(
            email_sender.notify,
            to_username=body.business_assignee_username,
            subject=f"[{{platform_name}}] Action required: complete assessment for '{system_name}'",
            body=(
                f"Hi,\n\n"
                f"You have been assigned to complete the EU AI Act assessment for the AI system "
                f"'{system_name}' ({system_id}).\n\n"
                f"Please log in and open the system to begin.\n\n"
                f"{{platform_name}}: {{registry_url}}"
            ),
        )

    return result_steps
