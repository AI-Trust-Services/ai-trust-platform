"""Workflow endpoints — submit, approve, reject, history, questionnaire section transitions."""
from __future__ import annotations

from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import select, delete

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ, SYSTEMS_WRITE, SYSTEMS_APPROVE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.system_workflow_step import SystemWorkflowStep
from ai_trust_persistence.models.question_assignment import QuestionAssignment as QuestionAssignmentModel
from app.classifier import classify, classify_ai_questionnaire
from app.ids import new_id
from app.questionnaire_required import missing_for_approval
from app.llm import LLMParseError
from app.schemas import (
    WorkflowStepResponse,
    WorkflowSubmitRequest,
    WorkflowApproveRequest,
    WorkflowRejectRequest,
    WorkflowAssignRequest,
    WorkflowSubmitSectionRequest,
    WorkflowSubAssignRequest,
    WorkflowSubReclaimRequest,
    WorkflowRequestInfoRequest,
    QuestionAssignRequest,
    QuestionUnassignRequest,
    QuestionAnswerRequest,
    QuestionAssignmentResponse,
    ClassificationResult,
    VALID_TIERS,
    VALID_ROLES,
)
from app import email_sender
from app.obligation_lookup import obligations_for_tier

router = APIRouter(tags=["workflow"])
logger = get_logger(__name__)

_AI_UNAVAILABLE = "AI classification is unavailable. Please try again shortly."

# Sub-assignment step names encode the section they belong to (SystemWorkflowStep has
# no section column). _active_sub_assignment() derives the current edit-lock from them.
_SUB_STEPS = ("sub_assigned", "sub_completed", "sub_reclaimed")

# The pending status each section owns — a section may only be sub-assigned while it is
# the active step of the workflow.
_SECTION_STATUS = {"business": "business_pending", "technical": "technical_pending"}
_SECTION_LABEL = {"business": "Use Case & Context", "technical": "AI Risk Classification"}


def _section_owner(row: AISystem, section: str) -> str | None:
    """The assignee that owns ``section`` (the person a sub-assignment is delegated from
    and returns to)."""
    return row.business_assignee_username if section == "business" else row.technical_assignee_username



def _current_user(request: Request) -> str:
    return request.headers.get("x-forwarded-preferred-username", "unknown")


async def _get_steps(session, system_id: str) -> list[WorkflowStepResponse]:
    steps = await session.execute(
        select(SystemWorkflowStep)
        .where(SystemWorkflowStep.system_id == system_id)
        .order_by(SystemWorkflowStep.created_at)
    )
    return [WorkflowStepResponse.model_validate(s) for s in steps.scalars().all()]


async def _creator_username(session, system_id: str) -> str | None:
    """The username of whoever created the system (the `registered` step actor)."""
    result = await session.execute(
        select(SystemWorkflowStep)
        .where(SystemWorkflowStep.system_id == system_id, SystemWorkflowStep.step == "registered")
        .order_by(SystemWorkflowStep.created_at)
        .limit(1)
    )
    step = result.scalar_one_or_none()
    return step.actor_username if step else None


async def _reclassify(row: AISystem) -> ClassificationResult:
    """Mode-aware (re)classification, applied to ``row`` in place.

    - ``ai``: the LLM infers the hidden flags from the questionnaire answers, then
      the deterministic classifier runs; the extended rationale is stored on the row.
      This is an *await* that may raise — callers MUST invoke it BEFORE mutating
      ``workflow_status`` so a failure leaves the row in its current state.
    - ``manual_questionnaire`` / anything else: deterministic ``classify(row)`` over
      the boolean flag columns (which the technical section filled directly).

    ``full_manual`` never reaches this path — its tier is set manually at intake.
    """
    if row.registration_mode == "ai":
        classification, rationale = await classify_ai_questionnaire(row)
        row.classification_rationale = rationale
        inferred_role = rationale.get("org_role")
        if inferred_role and inferred_role in VALID_ROLES:
            row.org_role = inferred_role
    else:
        classification = classify(row)
    row.tier = classification.tier
    row.basis = classification.basis
    row.annex_iii_area = classification.annex_iii_area
    return classification


def _apply_tier_override(row: AISystem, tier: str, actor: str) -> None:
    """Apply a compliance-officer tier override coherently.

    Sets ``basis`` to an override note and clears ``annex_iii_area`` unless the tier
    remains ``high`` (in which case the prior area, if any, is kept — we cannot infer
    an Annex III area from a bare tier choice)."""
    row.tier = tier
    row.basis = f"Tier set to '{tier}' by compliance officer {actor} (manual override)."
    if tier != "high":
        row.annex_iii_area = None


def _active_sub_assignment(steps: list[WorkflowStepResponse], section: str) -> str | None:
    """Return the contributor holding the edit token for ``section`` via an active
    sub-assignment, or ``None``.

    Derived purely from step ordering: among the sub-assignment steps for this section
    (``sub_assigned_{section}`` / ``sub_completed_{section}`` / ``sub_reclaimed_{section}``),
    if the most recent one is a ``sub_assigned`` the contributor still holds the token."""
    suffix = f"_{section}"
    relevant = [s for s in steps if s.step.endswith(suffix) and s.step[: -len(suffix)] in _SUB_STEPS]
    if not relevant:
        return None
    latest = relevant[-1]  # steps arrive ordered by created_at
    if latest.step == f"sub_assigned{suffix}":
        return latest.assignee_username
    return None


@router.get("/systems/{system_id}/workflow", response_model=list[WorkflowStepResponse])
async def get_workflow(system_id: str, _: str = Depends(require_permission(SYSTEMS_READ))):
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
    """Reset system workflow to draft so a new questionnaire can be started."""
    current_user = _current_user(request)
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.workflow_status in ("approved", "rejected"):
            raise HTTPException(422, f"Cannot reset workflow from terminal status '{row.workflow_status}'")
        row.workflow_status = "draft"
        row.business_assignee_username = None
        row.technical_assignee_username = None
        row.assignee_username = None
        await session.commit()
        logger.info("system.workflow_reset", extra={"system_id": system_id, "by": current_user})
        return {"status": "reset"}


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
        if row.workflow_status not in ("technical_pending", "pending_review"):
            raise HTTPException(422, f"Cannot submit technical section from status '{row.workflow_status}'")
        if row.technical_assignee_username and current_user != row.technical_assignee_username:
            raise HTTPException(403, "Only the technical section assignee may submit this section")

        # Mode-aware classification. For AI mode this makes an LLM call, which we run
        # BEFORE any status mutation so a 502 leaves the row at technical_pending.
        try:
            classification = await _reclassify(row)
        except HTTPException:
            raise
        except (LLMParseError, Exception) as exc:  # noqa: BLE001
            logger.error("system.reclassify_failed", extra={"system_id": system_id, "error": str(exc)})
            raise HTTPException(status_code=502, detail=_AI_UNAVAILABLE) from exc

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

        # The compliance officer is the last person and must ensure everything is filled —
        # the business/technical assignees may submit partial sections, but approval is gated.
        # missing = missing_for_approval(row)
        # if missing:
        #     raise HTTPException(
        #         422,
        #         f"Cannot approve — required questions are unanswered: {', '.join(missing)}. "
        #         "Use 'Request Info' to have a contributor complete them.",
        #     )

        # Optional CO tier override, applied before finalising.
        if body.tier is not None and body.tier != row.tier:
            if body.tier not in VALID_TIERS:
                raise HTTPException(422, f"Invalid tier '{body.tier}'")
            _apply_tier_override(row, body.tier, current_user)
            logger.info("system.tier_overridden", extra={
                "system_id": system_id, "tier": body.tier, "by": current_user,
            })

        # Optional CO org_role override.
        if body.org_role is not None and body.org_role != row.org_role:
            if body.org_role not in VALID_ROLES:
                raise HTTPException(422, f"Invalid org_role '{body.org_role}'")
            row.org_role = body.org_role
            logger.info("system.org_role_overridden", extra={
                "system_id": system_id, "org_role": body.org_role, "by": current_user,
            })

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

        if row.registration_mode == "full_manual":
            # Full-manual systems have no questionnaire sections — a rejection sends the
            # whole registration back to its creator as a draft to correct and resubmit.
            new_status = "draft"
            target_assignee = await _creator_username(session, system_id)
            section_label = "registration"
        elif body.send_to == "business":
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


@router.post("/systems/{system_id}/workflow/request-info", response_model=list[WorkflowStepResponse])
async def request_info(
    system_id: str,
    body: WorkflowRequestInfoRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_APPROVE)),
):
    """CO sends a system in review back to a specific contributor for more information."""
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.assignee_username and current_user != row.assignee_username:
            raise HTTPException(403, "Only the assigned compliance officer may request information")
        if row.workflow_status != "pending_review":
            raise HTTPException(422, f"Cannot request info from status '{row.workflow_status}'")

        row.workflow_status = "info_requested"
        row.assignee_username = body.contributor_username

        step = SystemWorkflowStep(
            id=new_id("SWS"),
            system_id=system_id,
            step="info_requested",
            actor_username=current_user,
            assignee_username=body.contributor_username,
            note=body.note,
        )
        session.add(step)
        system_name = row.name
        await session.commit()
        result_steps = await _get_steps(session, system_id)

    logger.info("system.info_requested", extra={
        "system_id": system_id, "by": current_user, "contributor": body.contributor_username,
    })

    background_tasks.add_task(
        email_sender.notify,
        to_username=body.contributor_username,
        subject=f"[AI Trust] More information needed for '{system_name}'",
        body=(
            f"Hi,\n\n"
            f"The compliance officer has requested additional information for the AI system "
            f"'{system_name}' ({system_id}) before it can be approved.\n\n"
            f"Request note: {body.note}\n\n"
            f"Please log in, add the requested information, and resubmit.\n\n"
            f"AI Trust Platform: {email_sender.REGISTRY_URL}"
        ),
    )

    return result_steps


@router.post("/systems/{system_id}/workflow/submit-info", response_model=list[WorkflowStepResponse])
async def submit_info(
    system_id: str,
    body: WorkflowSubmitSectionRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Contributor returns a system (after an info request) to the CO for re-review."""
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.workflow_status != "info_requested":
            raise HTTPException(422, f"Cannot submit info from status '{row.workflow_status}'")
        if row.assignee_username and current_user != row.assignee_username:
            raise HTTPException(403, "Only the requested contributor may submit this information")

        # The contributor may have changed questionnaire answers / flags — re-run the
        # mode-aware classification before handing back (full_manual keeps its manual tier).
        classification = None
        if row.registration_mode in ("ai", "manual_questionnaire"):
            try:
                classification = await _reclassify(row)
            except HTTPException:
                raise
            except (LLMParseError, Exception) as exc:  # noqa: BLE001
                logger.error("system.reclassify_failed", extra={"system_id": system_id, "error": str(exc)})
                raise HTTPException(status_code=502, detail=_AI_UNAVAILABLE) from exc

        row.workflow_status = "pending_review"
        row.assignee_username = row.compliance_officer_username

        step = SystemWorkflowStep(
            id=new_id("SWS"),
            system_id=system_id,
            step="info_submitted",
            actor_username=current_user,
            assignee_username=row.compliance_officer_username,
            note=body.note,
        )
        session.add(step)
        system_name = row.name
        co_username = row.compliance_officer_username
        await session.commit()
        result_steps = await _get_steps(session, system_id)

    logger.info("system.info_submitted", extra={
        "system_id": system_id, "by": current_user,
        "tier": classification.tier if classification else row.tier,
    })

    if co_username:
        background_tasks.add_task(
            email_sender.notify,
            to_username=co_username,
            subject=f"[AI Trust] System '{system_name}' updated and ready for re-review",
            body=(
                f"Hi,\n\n"
                f"The requested information for the AI system '{system_name}' ({system_id}) "
                f"has been provided. It is ready for your review again.\n\n"
                f"AI Trust Platform: {email_sender.REGISTRY_URL}"
            ),
        )

    return result_steps


@router.post("/systems/{system_id}/workflow/sub-assign", response_model=list[WorkflowStepResponse])
async def sub_assign_section(
    system_id: str,
    body: WorkflowSubAssignRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Section owner hands their pending section to a contributor to fill in."""
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.workflow_status != _SECTION_STATUS[body.section]:
            raise HTTPException(422, f"Cannot sub-assign '{body.section}' from status '{row.workflow_status}'")
        owner = _section_owner(row, body.section)
        if owner and current_user != owner:
            raise HTTPException(403, "Only the section owner may sub-assign this section")

        step = SystemWorkflowStep(
            id=new_id("SWS"),
            system_id=system_id,
            step=f"sub_assigned_{body.section}",
            actor_username=current_user,
            assignee_username=body.sub_assignee_username,
            note=body.note,
        )
        session.add(step)
        system_name = row.name
        await session.commit()
        result_steps = await _get_steps(session, system_id)

    logger.info("system.section_sub_assigned", extra={
        "system_id": system_id, "section": body.section,
        "by": current_user, "sub_assignee": body.sub_assignee_username,
    })

    background_tasks.add_task(
        email_sender.notify,
        to_username=body.sub_assignee_username,
        subject=f"[AI Trust] Help requested: '{_SECTION_LABEL[body.section]}' for '{system_name}'",
        body=(
            f"Hi,\n\n"
            f"You have been asked to help complete the '{_SECTION_LABEL[body.section]}' section for the "
            f"AI system '{system_name}' ({system_id}).\n\n"
            f"Please log in and open the system to fill in the requested information.\n\n"
            f"AI Trust Platform: {email_sender.REGISTRY_URL}"
        ),
    )

    return result_steps


@router.post("/systems/{system_id}/workflow/sub-complete", response_model=list[WorkflowStepResponse])
async def sub_complete_section(
    system_id: str,
    body: WorkflowSubReclaimRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Contributor returns a sub-assigned section to its owner (edit token goes back)."""
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.workflow_status != _SECTION_STATUS[body.section]:
            raise HTTPException(422, f"Cannot complete '{body.section}' from status '{row.workflow_status}'")

        steps = await _get_steps(session, system_id)
        active = _active_sub_assignment(steps, body.section)
        if active is None:
            raise HTTPException(422, f"No active sub-assignment for the '{body.section}' section")
        if current_user != active:
            raise HTTPException(403, "Only the active contributor may complete this sub-assignment")

        owner = _section_owner(row, body.section)
        step = SystemWorkflowStep(
            id=new_id("SWS"),
            system_id=system_id,
            step=f"sub_completed_{body.section}",
            actor_username=current_user,
            assignee_username=owner,
            note=body.note,
        )
        session.add(step)
        system_name = row.name
        await session.commit()
        result_steps = await _get_steps(session, system_id)

    logger.info("system.section_sub_completed", extra={
        "system_id": system_id, "section": body.section, "by": current_user,
    })

    if owner:
        background_tasks.add_task(
            email_sender.notify,
            to_username=owner,
            subject=f"[AI Trust] '{_SECTION_LABEL[body.section]}' input ready for '{system_name}'",
            body=(
                f"Hi,\n\n"
                f"{current_user} has completed the help you requested on the "
                f"'{_SECTION_LABEL[body.section]}' section for the AI system '{system_name}' ({system_id}).\n\n"
                f"You can now review and submit the section.\n\n"
                f"AI Trust Platform: {email_sender.REGISTRY_URL}"
            ),
        )

    return result_steps


@router.post("/systems/{system_id}/workflow/sub-reclaim", response_model=list[WorkflowStepResponse])
async def sub_reclaim_section(
    system_id: str,
    body: WorkflowSubReclaimRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Section owner cancels an active sub-assignment and takes editing back."""
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.workflow_status != _SECTION_STATUS[body.section]:
            raise HTTPException(422, f"Cannot reclaim '{body.section}' from status '{row.workflow_status}'")
        owner = _section_owner(row, body.section)
        if owner and current_user != owner:
            raise HTTPException(403, "Only the section owner may reclaim this section")

        steps = await _get_steps(session, system_id)
        active = _active_sub_assignment(steps, body.section)
        if active is None:
            raise HTTPException(422, f"No active sub-assignment for the '{body.section}' section")

        step = SystemWorkflowStep(
            id=new_id("SWS"),
            system_id=system_id,
            step=f"sub_reclaimed_{body.section}",
            actor_username=current_user,
            assignee_username=active,
            note=body.note,
        )
        session.add(step)
        system_name = row.name
        await session.commit()
        result_steps = await _get_steps(session, system_id)

    logger.info("system.section_sub_reclaimed", extra={
        "system_id": system_id, "section": body.section,
        "by": current_user, "former_sub_assignee": active,
    })

    if active:
        background_tasks.add_task(
            email_sender.notify,
            to_username=active,
            subject=f"[AI Trust] Sub-assignment cancelled for '{system_name}'",
            body=(
                f"Hi,\n\n"
                f"The section owner has cancelled the help request on the "
                f"'{_SECTION_LABEL[body.section]}' section for the AI system '{system_name}' ({system_id}). "
                f"No further action is needed from you.\n\n"
                f"AI Trust Platform: {email_sender.REGISTRY_URL}"
            ),
        )

    return result_steps


@router.get("/systems/{system_id}/workflow/rce-summary")
async def get_rce_summary(
    system_id: str,
    _: str = Depends(require_permission(SYSTEMS_READ)),
):
    """Return the full RCE output for the CO review panel.

    Includes tier, org_role, registration_mode, classification_rationale, and the
    list of applicable obligations derived from the system's tier and org_role.
    """
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")

    obligations = obligations_for_tier(row.tier or "minimal", row.org_role or "provider")
    return {
        "tier": row.tier,
        "org_role": row.org_role,
        "registration_mode": row.registration_mode,
        "classification_rationale": row.classification_rationale,
        "obligations": [
            {"title": o["title"], "article_ref": o["article_ref"], "description": o["description"]}
            for o in obligations
        ],
    }


async def _get_question_assignments(session, system_id: str) -> list[QuestionAssignmentResponse]:
    result = await session.execute(
        select(QuestionAssignmentModel)
        .where(QuestionAssignmentModel.system_id == system_id)
        .order_by(QuestionAssignmentModel.assigned_at)
    )
    return [QuestionAssignmentResponse.model_validate(row) for row in result.scalars().all()]


@router.get(
    "/systems/{system_id}/workflow/question-assignments",
    response_model=list[QuestionAssignmentResponse],
)
async def get_question_assignments(
    system_id: str,
    _: str = Depends(require_permission(SYSTEMS_READ)),
):
    """List all per-question assignments for a system."""
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        if not result.scalar_one_or_none():
            raise HTTPException(404, f"System {system_id} not found")
        return await _get_question_assignments(session, system_id)


@router.post(
    "/systems/{system_id}/workflow/question-assign",
    response_model=list[QuestionAssignmentResponse],
)
async def question_assign(
    system_id: str,
    body: QuestionAssignRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Section owner assigns a single questionnaire question to another user."""
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        if row.workflow_status != _SECTION_STATUS[body.section]:
            raise HTTPException(422, f"Cannot assign questions for '{body.section}' from status '{row.workflow_status}'")
        owner = _section_owner(row, body.section)
        if owner and current_user != owner:
            raise HTTPException(403, "Only the section owner may assign questions")

        # Disallow per-question assignment while a section-level sub-assignment is active —
        # the contributor holds the whole section already.
        steps = await _get_steps(session, system_id)
        if _active_sub_assignment(steps, body.section) is not None:
            raise HTTPException(422, "Cannot assign individual questions while the section is sub-assigned")

        # Upsert: if the same (system, section, question_key) already exists, update it.
        existing = await session.execute(
            select(QuestionAssignmentModel).where(
                QuestionAssignmentModel.system_id == system_id,
                QuestionAssignmentModel.section == body.section,
                QuestionAssignmentModel.question_key == body.question_key,
            )
        )
        qa_row = existing.scalar_one_or_none()
        if qa_row:
            qa_row.assignee_username = body.assignee_username
            qa_row.assigned_by_username = current_user
            qa_row.answered_at = None  # reset when re-assigning
        else:
            qa_row = QuestionAssignmentModel(
                id=new_id("QAS"),
                system_id=system_id,
                section=body.section,
                question_key=body.question_key,
                assignee_username=body.assignee_username,
                assigned_by_username=current_user,
            )
            session.add(qa_row)

        system_name = row.name
        await session.commit()
        assignments = await _get_question_assignments(session, system_id)

    logger.info("system.question_assigned", extra={
        "system_id": system_id, "section": body.section,
        "question_key": body.question_key, "assignee": body.assignee_username, "by": current_user,
    })

    background_tasks.add_task(
        email_sender.notify_question_assigned,
        assignee_username=body.assignee_username,
        system_name=system_name,
        system_id=system_id,
        question_label=body.question_key,
        assigned_by=current_user,
    )

    return assignments


@router.delete(
    "/systems/{system_id}/workflow/question-assign",
    response_model=list[QuestionAssignmentResponse],
)
async def question_unassign(
    system_id: str,
    body: QuestionUnassignRequest,
    request: Request,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Section owner removes a per-question assignment."""
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        owner = _section_owner(row, body.section)
        if owner and current_user != owner:
            raise HTTPException(403, "Only the section owner may remove question assignments")

        await session.execute(
            delete(QuestionAssignmentModel).where(
                QuestionAssignmentModel.system_id == system_id,
                QuestionAssignmentModel.section == body.section,
                QuestionAssignmentModel.question_key == body.question_key,
            )
        )
        await session.commit()
        assignments = await _get_question_assignments(session, system_id)

    logger.info("system.question_unassigned", extra={
        "system_id": system_id, "section": body.section,
        "question_key": body.question_key, "by": current_user,
    })

    return assignments


@router.post(
    "/systems/{system_id}/workflow/question-answer",
    response_model=list[QuestionAssignmentResponse],
)
async def question_answer(
    system_id: str,
    body: QuestionAnswerRequest,
    request: Request,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Assignee marks their assigned question as answered after saving the value."""
    current_user = _current_user(request)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        if not result.scalar_one_or_none():
            raise HTTPException(404, f"System {system_id} not found")

        qa_result = await session.execute(
            select(QuestionAssignmentModel).where(
                QuestionAssignmentModel.system_id == system_id,
                QuestionAssignmentModel.section == body.section,
                QuestionAssignmentModel.question_key == body.question_key,
            )
        )
        qa_row = qa_result.scalar_one_or_none()
        if not qa_row:
            raise HTTPException(404, f"No assignment found for question '{body.question_key}'")
        if qa_row.assignee_username != current_user:
            raise HTTPException(403, "Only the assigned user may mark this question as answered")

        qa_row.answered_at = datetime.now(timezone.utc)
        await session.commit()
        assignments = await _get_question_assignments(session, system_id)

    logger.info("system.question_answered", extra={
        "system_id": system_id, "section": body.section,
        "question_key": body.question_key, "by": current_user,
    })

    return assignments
