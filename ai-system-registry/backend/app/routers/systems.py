from __future__ import annotations

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ, SYSTEMS_WRITE
from ai_trust_logging import get_logger
from app.classifier import classify
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.model_card import ModelCard
from ai_trust_persistence.models.ai_system_model_card import ai_system_model_cards
from app.schemas import (
    AISystemCreate,
    AISystemResponse,
    AISystemUpdate,
    IntakeResponse,
    SystemModelLinkBody,
    SystemModelResponse,
    VALID_LIFECYCLES,
    VALID_ROLES,
)

router = APIRouter(tags=["systems"])
logger = get_logger(__name__)

_IMMUTABLE_FIELDS = frozenset({"tier", "basis", "annex_iii_area"})


@router.get("/systems", response_model=list[AISystemResponse], dependencies=[Depends(require_permission(SYSTEMS_READ))])
async def list_systems(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[AISystemResponse]:
    async with SessionLocal() as session:
        result = await session.execute(
            select(AISystem).order_by(AISystem.created_at.desc()).limit(limit).offset(offset)
        )
        return [AISystemResponse.model_validate(r) for r in result.scalars().all()]


@router.get("/systems/{system_id}", response_model=AISystemResponse, dependencies=[Depends(require_permission(SYSTEMS_READ))])
async def get_system(system_id: str) -> AISystemResponse:
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        return AISystemResponse.model_validate(row)


@router.put("/systems/{system_id}", response_model=AISystemResponse, dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def update_system(system_id: str, body: AISystemUpdate) -> AISystemResponse:
    updates = body.model_dump(exclude_none=True)

    immutable_attempted = _IMMUTABLE_FIELDS & updates.keys()
    if immutable_attempted:
        raise HTTPException(422, f"Fields are immutable (use /reclassify): {sorted(immutable_attempted)}")

    if body.lifecycle and body.lifecycle not in VALID_LIFECYCLES:
        raise HTTPException(422, f"Invalid lifecycle '{body.lifecycle}'")
    if body.org_role and body.org_role not in VALID_ROLES:
        raise HTTPException(422, f"Invalid org_role '{body.org_role}'")

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")

        for field, value in updates.items():
            setattr(row, field, value)
        row.updated_at = datetime.now(timezone.utc)

        await session.commit()
        await session.refresh(row)

    logger.info("system.updated", extra={"system_id": system_id, "fields": sorted(updates.keys())})
    return AISystemResponse.model_validate(row)


@router.delete("/systems/{system_id}", dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def delete_system(system_id: str) -> dict:
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")
        name = row.name
        await session.delete(row)
        await session.commit()
    logger.info("system.deleted", extra={"system_id": system_id, "system_name": name})
    return {"status": "deleted", "id": system_id, "name": name}


@router.post("/systems/{system_id}/reclassify", response_model=IntakeResponse, dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def reclassify_system(system_id: str) -> IntakeResponse:
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"System {system_id} not found")

        old_tier = row.tier
        body = AISystemCreate.model_validate(row, from_attributes=True)
        classification = classify(body)

        row.tier = classification.tier
        row.basis = classification.basis
        row.annex_iii_area = classification.annex_iii_area
        row.updated_at = datetime.now(timezone.utc)

        await session.commit()
        await session.refresh(row)

    logger.info("system.reclassified", extra={
        "system_id": system_id,
        "old_tier": old_tier,
        "new_tier": classification.tier,
        "basis": classification.basis,
    })

    return IntakeResponse(
        system=AISystemResponse.model_validate(row),
        classification=classification,
    )


@router.get("/systems/{system_id}/models", response_model=list[SystemModelResponse], dependencies=[Depends(require_permission(SYSTEMS_READ))])
async def list_system_models(system_id: str) -> list[SystemModelResponse]:
    async with SessionLocal() as session:
        sys_result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        if not sys_result.scalar_one_or_none():
            raise HTTPException(404, f"System {system_id} not found")

        result = await session.execute(
            select(ModelCard, ai_system_model_cards.c.role)
            .join(ai_system_model_cards, ModelCard.id == ai_system_model_cards.c.model_card_id)
            .where(ai_system_model_cards.c.system_id == system_id)
            .order_by(ModelCard.name)
        )
        return [
            SystemModelResponse.from_card(card, role)
            for card, role in result.all()
        ]


@router.post("/systems/{system_id}/models", response_model=SystemModelResponse, dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def add_system_model(system_id: str, body: SystemModelLinkBody) -> SystemModelResponse:
    async with SessionLocal() as session:
        sys_result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        if not sys_result.scalar_one_or_none():
            raise HTTPException(404, f"System {system_id} not found")

        mdl_result = await session.execute(select(ModelCard).where(ModelCard.id == body.model_card_id))
        card = mdl_result.scalar_one_or_none()
        if not card:
            raise HTTPException(404, f"Model card {body.model_card_id} not found")

        await session.execute(
            pg_insert(ai_system_model_cards)
            .values(system_id=system_id, model_card_id=body.model_card_id, role=body.role)
            .on_conflict_do_update(
                index_elements=["system_id", "model_card_id"],
                set_={"role": body.role},
            )
        )
        await session.commit()

    logger.info("system.model_linked", extra={"system_id": system_id, "model_card_id": body.model_card_id, "role": body.role})
    return SystemModelResponse.from_card(card, body.role)


@router.delete("/systems/{system_id}/models/{model_card_id}", dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def remove_system_model(system_id: str, model_card_id: str) -> dict:
    async with SessionLocal() as session:
        result = await session.execute(
            delete(ai_system_model_cards)
            .where(ai_system_model_cards.c.system_id == system_id)
            .where(ai_system_model_cards.c.model_card_id == model_card_id)
            .returning(ai_system_model_cards.c.model_card_id)
        )
        if not result.fetchone():
            raise HTTPException(404, f"Link between {system_id} and {model_card_id} not found")
        await session.commit()

    logger.info("system.model_unlinked", extra={"system_id": system_id, "model_card_id": model_card_id})
    return {"status": "unlinked", "system_id": system_id, "model_card_id": model_card_id}
