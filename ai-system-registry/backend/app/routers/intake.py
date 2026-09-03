"""POST /api/v1/intake — register an AI system (name + description only)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_WRITE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.system_workflow_step import SystemWorkflowStep
from app.classifier import ClassificationResult
from app.ids import new_id
from app.schemas import AISystemCreate, AISystemResponse, IntakeResponse

router = APIRouter(tags=["intake"])
logger = get_logger(__name__)


@router.post("/intake", response_model=IntakeResponse, status_code=201, dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def intake_system(body: AISystemCreate, request: Request) -> IntakeResponse:
    current_user = request.headers.get("x-forwarded-preferred-username", "unknown")

    system_id = new_id("SYS")
    step_id = new_id("SWS")

    row = AISystem(
        id=system_id,
        name=body.name,
        description=body.description,
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
        await session.commit()
        await session.refresh(row)

    logger.info("system.registered", extra={"system_id": row.id, "system_name": row.name})

    classification = ClassificationResult(
        tier="pending",
        basis="Pending risk classification",
        obligations=[],
        annex_iii_area=None,
    )
    return IntakeResponse(system=AISystemResponse.model_validate(row), classification=classification)
