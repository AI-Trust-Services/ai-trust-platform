"""POST /api/v1/intake — register an AI system (owner stub or AI-assisted)."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_WRITE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.system_workflow_step import SystemWorkflowStep
from app.classifier import CLASSIFIER_INPUTS, classify
from app.ids import new_id
from app.schemas import AISystemCreate, AISystemResponse, IntakeResponse, ClassificationResult, VALID_TIERS
from app import email_sender

router = APIRouter(tags=["intake"])
logger = get_logger(__name__)

# Descriptive (non-classifier) fields the AI-assisted flow may supply.
_DESCRIPTIVE_FIELDS = (
    "intended_purpose", "department", "use_case", "people_affected",
    "decision_context", "autonomy_level",
)

# New questionnaire-specific fields.
_QUESTIONNAIRE_FIELDS = (
    "business_assignee_username", "technical_assignee_username", "questionnaire_answers",
)


@router.post("/intake", response_model=IntakeResponse, status_code=201, dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def intake_system(body: AISystemCreate, request: Request, background_tasks: BackgroundTasks) -> IntakeResponse:
    current_user = request.headers.get("x-forwarded-preferred-username", "unknown")

    # Full-manual override: validate up front so a bad tier / missing CO fails fast (422)
    # before we allocate IDs or write anything.
    if body.registration_mode == "full_manual":
        if not body.tier or body.tier not in VALID_TIERS:
            raise HTTPException(422, f"A valid tier is required for full-manual registration (got '{body.tier}')")
        if not body.compliance_officer_username:
            raise HTTPException(422, "A compliance officer is required for full-manual registration")

    system_id = new_id("SYS")
    step_id = new_id("SWS")

    row = AISystem(
        id=system_id,
        name=body.name,
        description=body.description,
        tier="minimal",
        basis="pending",
        annex_iii_area=None,
        compliance=0.0,
        workflow_status="draft",
        registration_mode=body.registration_mode,
        assignee_username=body.assignee_username,
        compliance_officer_username=body.compliance_officer_username,
    )

    # Persist any descriptive fields the AI-assisted flow collected.
    for field in _DESCRIPTIVE_FIELDS:
        value = getattr(body, field, None)
        if value is not None:
            setattr(row, field, value)

    # Persist questionnaire-specific fields (new workflow).
    for field in _QUESTIONNAIRE_FIELDS:
        value = getattr(body, field, None)
        if value is not None:
            setattr(row, field, value)

    if body.registration_mode == "full_manual":
        # Creator picked the tier by hand; skip the classifier entirely and route the
        # system straight to the named compliance officer for review. Supporting
        # documents (if any) are uploaded via the separate documents endpoint.
        row.tier = body.tier
        row.basis = f"Tier '{body.tier}' set manually by {current_user} (full-manual registration)."
        row.annex_iii_area = None
        row.workflow_status = "pending_review"
        row.assignee_username = body.compliance_officer_username
        registered_assignee = body.compliance_officer_username
        classification = ClassificationResult(tier=body.tier, basis=row.basis, obligations=[], annex_iii_area=None)
    else:
        registered_assignee = body.assignee_username
        # If the AI-assisted flow inferred classifier flags, apply them and run the
        # deterministic classifier now (owner manual mode leaves them all None → stub).
        supplied_flags = {
            name: getattr(body, name)
            for name in CLASSIFIER_INPUTS
            if getattr(body, name, None) is not None
        }
        if supplied_flags:
            for name, value in supplied_flags.items():
                setattr(row, name, value)
            classification = classify(row)
            row.tier = classification.tier
            row.basis = classification.basis
            row.annex_iii_area = classification.annex_iii_area
            if body.classification_rationale is not None:
                # Two accepted shapes: legacy bare list[RationaleItem] (AI-assisted intake)
                # and the extended ClassificationRationale object (questionnaire workflow).
                cr = body.classification_rationale
                if isinstance(cr, list):
                    row.classification_rationale = [r.model_dump() for r in cr]
                else:
                    row.classification_rationale = cr.model_dump()
        else:
            classification = ClassificationResult(tier="minimal", basis="pending", obligations=[], annex_iii_area=None)

    step = SystemWorkflowStep(
        id=step_id,
        system_id=system_id,
        step="registered",
        actor_username=current_user,
        assignee_username=registered_assignee,
    )

    async with SessionLocal() as session:
        session.add(row)
        session.add(step)
        await session.commit()
        await session.refresh(row)

    logger.info(
        "system.registered",
        extra={
            "system_id": row.id,
            "system_name": row.name,
            "registration_mode": row.registration_mode,
            "assignee": registered_assignee,
            "tier": row.tier,
        },
    )

    if body.registration_mode == "full_manual":
        background_tasks.add_task(
            email_sender.notify,
            to_username=body.compliance_officer_username,
            subject=f"[AI Trust] System '{row.name}' ready for compliance review",
            body=(
                f"Hi,\n\n"
                f"The AI system '{row.name}' ({row.id}) has been registered via full-manual override "
                f"and is ready for your compliance review.\n\n"
                f"Declared tier: {row.tier}\n\n"
                f"AI Trust Platform: {email_sender.REGISTRY_URL}"
            ),
        )
    elif registered_assignee:
        background_tasks.add_task(
            email_sender.notify,
            to_username=registered_assignee,
            subject=f"[AI Trust] System '{row.name}' assigned to you for details",
            body=(
                f"Hi,\n\n"
                f"You have been assigned to complete the technical details for the AI system '{row.name}' ({row.id}).\n\n"
                f"Please log in to the AI Trust Platform and open the system to fill in the required information.\n\n"
                f"AI Trust Platform: {email_sender.REGISTRY_URL}"
            ),
        )

    return IntakeResponse(system=AISystemResponse.model_validate(row), classification=classification)
