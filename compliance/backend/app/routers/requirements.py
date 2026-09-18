from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import ASSESSMENTS_READ, ASSESSMENTS_WRITE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models import (
    AISystem,
    Obligation,
    Requirement,
    evidence_requirements,
    requirement_obligations,
)
from app.cascade import refresh_obligation, refresh_obligations_for_requirement
from app.ids import new_id
from app.schemas import (
    RequirementCreate,
    RequirementDetailResponse,
    RequirementResponse,
    RequirementUpdate,
)

router = APIRouter(tags=["requirements"])
logger = get_logger(__name__)


async def _load(session: AsyncSession, requirement_id: str) -> Requirement:
    row = (await session.execute(
        select(Requirement).where(Requirement.id == requirement_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"Requirement {requirement_id} not found")
    return row


@router.get("/requirements", response_model=list[RequirementResponse], dependencies=[Depends(require_permission(ASSESSMENTS_READ))])
async def list_requirements(
    ai_system_id: str | None = Query(default=None),
    obligation_id: str | None = Query(default=None),
    evidence_id: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[RequirementResponse]:
    async with SessionLocal() as session:
        stmt = select(Requirement).order_by(Requirement.created_at.desc())
        if ai_system_id:
            stmt = stmt.where(or_(Requirement.ai_system_id == ai_system_id, Requirement.ai_system_id.is_(None)))
        if obligation_id:
            stmt = stmt.join(
                requirement_obligations, requirement_obligations.c.requirement_id == Requirement.id
            ).where(requirement_obligations.c.obligation_id == obligation_id)
        if evidence_id:
            stmt = stmt.join(
                evidence_requirements, evidence_requirements.c.requirement_id == Requirement.id
            ).where(evidence_requirements.c.evidence_id == evidence_id)
        stmt = stmt.limit(limit).offset(offset)
        result = await session.execute(stmt)
        return [RequirementResponse.model_validate(r) for r in result.scalars().all()]


@router.post("/requirements", response_model=RequirementResponse, status_code=201, dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
async def create_requirement(body: RequirementCreate) -> RequirementResponse:
    async with SessionLocal() as session:
        if body.ai_system_id and not (await session.execute(
            select(AISystem.id).where(AISystem.id == body.ai_system_id)
        )).scalar_one_or_none():
            raise HTTPException(404, f"AI system {body.ai_system_id} not found")
        row = Requirement(
            id=new_id("REQ"),
            ai_system_id=body.ai_system_id,
            title=body.title,
            description=body.description,
            category=body.category,
            owner=body.owner,
            due_date=body.due_date,
            status="open",
            effectiveness="medium",
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
    logger.info("requirement.created", extra={"requirement_id": row.id, "ai_system_id": row.ai_system_id})
    return RequirementResponse.model_validate(row)


@router.get("/requirements/{requirement_id}", response_model=RequirementDetailResponse, dependencies=[Depends(require_permission(ASSESSMENTS_READ))])
async def get_requirement(requirement_id: str) -> RequirementDetailResponse:
    async with SessionLocal() as session:
        row = await _load(session, requirement_id)
        obligation_ids = (await session.execute(
            select(requirement_obligations.c.obligation_id)
            .where(requirement_obligations.c.requirement_id == requirement_id)
        )).scalars().all()
        evidence_count = (await session.execute(
            select(func.count()).select_from(evidence_requirements)
            .where(evidence_requirements.c.requirement_id == requirement_id)
        )).scalar_one()
        detail = RequirementDetailResponse.model_validate(row)
        detail.obligation_ids = list(obligation_ids)
        detail.evidence_count = evidence_count
        return detail


@router.put("/requirements/{requirement_id}", response_model=RequirementResponse, dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
async def update_requirement(requirement_id: str, body: RequirementUpdate) -> RequirementResponse:
    updates = body.model_dump(exclude_none=True)
    async with SessionLocal() as session:
        row = await _load(session, requirement_id)
        for field, value in updates.items():
            setattr(row, field, value)
        row.updated_at = datetime.now(timezone.utc)
        await session.flush()
        if "status" in updates:
            await refresh_obligations_for_requirement(session, requirement_id)
        await session.commit()
        await session.refresh(row)
    logger.info("requirement.updated", extra={"requirement_id": requirement_id, "fields": sorted(updates.keys())})
    return RequirementResponse.model_validate(row)


@router.delete("/requirements/{requirement_id}", dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
async def delete_requirement(requirement_id: str) -> dict:
    async with SessionLocal() as session:
        row = await _load(session, requirement_id)
        obligation_ids = (await session.execute(
            select(requirement_obligations.c.obligation_id)
            .where(requirement_obligations.c.requirement_id == requirement_id)
        )).scalars().all()
        await session.delete(row)
        await session.flush()
        for oid in obligation_ids:
            await refresh_obligation(session, oid)
        await session.commit()
    logger.info("requirement.deleted", extra={"requirement_id": requirement_id})
    return {"status": "deleted", "id": requirement_id}


@router.post("/requirements/{requirement_id}/link/{obligation_id}", response_model=RequirementDetailResponse, dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
async def link_obligation(requirement_id: str, obligation_id: str) -> RequirementDetailResponse:
    async with SessionLocal() as session:
        await _load(session, requirement_id)
        obligation = (await session.execute(
            select(Obligation).where(Obligation.id == obligation_id)
        )).scalar_one_or_none()
        if not obligation:
            raise HTTPException(404, f"Obligation {obligation_id} not found")

        await session.execute(
            pg_insert(requirement_obligations)
            .values(requirement_id=requirement_id, obligation_id=obligation_id)
            .on_conflict_do_nothing()
        )
        await session.flush()
        await refresh_obligation(session, obligation_id)
        await session.commit()
    logger.info("requirement.linked", extra={"requirement_id": requirement_id, "obligation_id": obligation_id})
    return await get_requirement(requirement_id)


@router.delete("/requirements/{requirement_id}/link/{obligation_id}", response_model=RequirementDetailResponse, dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
async def unlink_obligation(requirement_id: str, obligation_id: str) -> RequirementDetailResponse:
    async with SessionLocal() as session:
        await _load(session, requirement_id)
        await session.execute(
            requirement_obligations.delete()
            .where(requirement_obligations.c.requirement_id == requirement_id)
            .where(requirement_obligations.c.obligation_id == obligation_id)
        )
        await session.flush()
        await refresh_obligation(session, obligation_id)
        await session.commit()
    logger.info("requirement.unlinked", extra={"requirement_id": requirement_id, "obligation_id": obligation_id})
    return await get_requirement(requirement_id)
