from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ, SYSTEMS_WRITE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.model_card import ModelCard
from app.schemas import ModelCardCreate, ModelCardResponse, ModelCardUpdate

router = APIRouter(tags=["model-cards"])
logger = get_logger(__name__)


def _new_id() -> str:
    return "MDL-" + uuid.uuid4().hex[:8].upper()


@router.get("/model-cards", response_model=list[ModelCardResponse], dependencies=[Depends(require_permission(SYSTEMS_READ))])
async def list_model_cards(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[ModelCardResponse]:
    async with SessionLocal() as session:
        result = await session.execute(
            select(ModelCard).order_by(ModelCard.name).limit(limit).offset(offset)
        )
        return [ModelCardResponse.model_validate(r) for r in result.scalars().all()]


@router.get("/model-cards/{model_id}", response_model=ModelCardResponse, dependencies=[Depends(require_permission(SYSTEMS_READ))])
async def get_model_card(model_id: str) -> ModelCardResponse:
    async with SessionLocal() as session:
        result = await session.execute(select(ModelCard).where(ModelCard.id == model_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Model card {model_id} not found")
        return ModelCardResponse.model_validate(row)


@router.post("/model-cards", response_model=ModelCardResponse, status_code=201, dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def create_model_card(body: ModelCardCreate) -> ModelCardResponse:
    async with SessionLocal() as session:
        row = ModelCard(id=_new_id(), **body.model_dump())
        session.add(row)
        await session.commit()
        await session.refresh(row)
    logger.info("model_card.created", extra={"model_id": row.id, "model_name": row.name})
    return ModelCardResponse.model_validate(row)


@router.put("/model-cards/{model_id}", response_model=ModelCardResponse, dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def update_model_card(model_id: str, body: ModelCardUpdate) -> ModelCardResponse:
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(422, "No fields provided to update")

    async with SessionLocal() as session:
        result = await session.execute(select(ModelCard).where(ModelCard.id == model_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Model card {model_id} not found")

        for field, value in updates.items():
            setattr(row, field, value)
        row.updated_at = datetime.now(timezone.utc)

        await session.commit()
        await session.refresh(row)

    logger.info("model_card.updated", extra={"model_id": model_id, "fields": sorted(updates.keys())})
    return ModelCardResponse.model_validate(row)


@router.delete("/model-cards/{model_id}", dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def delete_model_card(model_id: str) -> dict:
    async with SessionLocal() as session:
        result = await session.execute(select(ModelCard).where(ModelCard.id == model_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Model card {model_id} not found")
        name = row.name
        await session.delete(row)
        await session.commit()
    logger.info("model_card.deleted", extra={"model_id": model_id, "name": name})
    return {"status": "deleted", "id": model_id, "name": name}
