from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models import Framework
from app.schemas import FrameworkResponse, FrameworkUpdate

router = APIRouter(tags=["frameworks"])
logger = get_logger(__name__)


@router.get("/frameworks", response_model=list[FrameworkResponse])
async def list_frameworks() -> list[FrameworkResponse]:
    async with SessionLocal() as session:
        result = await session.execute(select(Framework).order_by(Framework.name))
        return [FrameworkResponse.model_validate(r) for r in result.scalars().all()]


@router.get("/frameworks/{framework_id}", response_model=FrameworkResponse)
async def get_framework(framework_id: str) -> FrameworkResponse:
    async with SessionLocal() as session:
        result = await session.execute(select(Framework).where(Framework.id == framework_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Framework {framework_id} not found")
        return FrameworkResponse.model_validate(row)


@router.patch("/frameworks/{framework_id}", response_model=FrameworkResponse)
async def update_framework(framework_id: str, body: FrameworkUpdate) -> FrameworkResponse:
    async with SessionLocal() as session:
        result = await session.execute(select(Framework).where(Framework.id == framework_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Framework {framework_id} not found")
        if body.enabled is not None:
            row.enabled = body.enabled
        await session.commit()
        await session.refresh(row)
    logger.info("framework.updated", extra={"framework_id": framework_id, "enabled": row.enabled})
    return FrameworkResponse.model_validate(row)
