"""POST /api/v1/intake — classify and register an AI system."""
from __future__ import annotations

import uuid

from fastapi import APIRouter

from ai_trust_logging import get_logger
from app.classifier import classify
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from app.schemas import AISystemCreate, AISystemResponse, IntakeResponse

router = APIRouter(tags=["intake"])
logger = get_logger(__name__)


@router.post("/intake", response_model=IntakeResponse, status_code=201)
async def intake_system(body: AISystemCreate) -> IntakeResponse:
    classification = classify(body)

    row = AISystem(
        id=f"SYS-{str(uuid.uuid4())[:8].upper()}",
        tier=classification.tier,
        basis=classification.basis,
        annex_iii_area=classification.annex_iii_area,
        compliance=0.0,
        **body.model_dump(),
    )

    async with SessionLocal() as session:
        session.add(row)
        await session.commit()
        await session.refresh(row)

    logger.info("system.registered", extra={
        "system_id": row.id,
        "system_name": row.name,
        "tier": classification.tier,
        "basis": classification.basis,
        "annex_iii_area": classification.annex_iii_area,
    })

    return IntakeResponse(
        system=AISystemResponse.model_validate(row),
        classification=classification,
    )

