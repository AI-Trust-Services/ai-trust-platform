"""POST /api/v1/intake — register an AI system (name + description only)."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, Request

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_WRITE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.audit import log_audit_event
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.system_workflow_step import SystemWorkflowStep
from app.classifier import ClassificationResult
from app.ids import new_id
from app.schemas import AISystemCreate, AISystemResponse, IntakeResponse
from app import email_sender

router = APIRouter(tags=["intake"])
logger = get_logger(__name__)


@router.post("/intake", response_model=IntakeResponse, status_code=201, dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def intake_system(body: AISystemCreate, request: Request, background_tasks: BackgroundTasks) -> IntakeResponse:
    current_user = request.headers.get("x-forwarded-preferred-username", "unknown")

    system_id = new_id("SYS")
    step_id = new_id("SWS")

    row = AISystem(
        id=system_id,
        name=body.name,
        description=body.description,
        deployment_country=body.deployment_country,
        eu_output_usage=body.eu_output_usage,
        eu_market_placement=body.eu_market_placement,
        tier="pending",
        basis="Pending risk classification",
        annex_iii_area=None,
        compliance=0.0,
        workflow_status="draft",
        registration_mode="ai",
    )

    step = SystemWorkflowStep(
        id=step_id,
        system_id=system_id,
        step="registered",
        actor_username=current_user,
        assignee_username=None,
    )

    async with SessionLocal() as session:
        session.add(row)
        session.add(step)
        log_audit_event(
            session,
            actor=current_user,
            action="system.registered",
            resource_type="ai_system",
            resource_id=system_id,
            ai_system_id=system_id,
            ai_system_name=body.name,
        )
        await session.commit()
        await session.refresh(row)

    logger.info("system.registered", extra={"system_id": row.id, "system_name": row.name})

    if body.assignee_username:
        background_tasks.add_task(
            email_sender.notify,
            to_username=body.assignee_username,
            subject=f"[{{platform_name}}] System '{row.name}' assigned to you for details",
            body=(
                f"Hi,\n\n"
                f"You have been assigned to complete the technical details for the AI system '{row.name}' ({row.id}).\n\n"
                "Please log in to {platform_name} and open the system to fill in the required information.\n\n"
                "{platform_name}: {registry_url}"
            ),
        )

    classification = ClassificationResult(
        tier="pending",
        basis="Pending risk classification",
        obligations=[],
        annex_iii_area=None,
    )
    return IntakeResponse(system=AISystemResponse.model_validate(row), classification=classification)
