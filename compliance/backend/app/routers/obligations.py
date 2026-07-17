from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models import Assessment, Obligation, control_obligations
from app.cascade import refresh_assessment_score
from app.ids import new_id
from app.schemas import (
    ObligationCreate,
    ObligationDetailResponse,
    ObligationResponse,
    ObligationUpdate,
)

router = APIRouter(tags=["obligations"])
logger = get_logger(__name__)


async def _assessment_approved(session: AsyncSession, assessment_id: str) -> bool:
    status = (await session.execute(
        select(Assessment.status).where(Assessment.id == assessment_id)
    )).scalar_one_or_none()
    return status == "approved"


@router.get("/obligations", response_model=list[ObligationResponse])
async def list_obligations(
    assessment_id: str | None = Query(default=None),
    ai_system_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[ObligationResponse]:
    async with SessionLocal() as session:
        stmt = select(Obligation).order_by(Obligation.created_at.desc())
        if assessment_id:
            stmt = stmt.where(Obligation.assessment_id == assessment_id)
        if ai_system_id:
            stmt = stmt.where(Obligation.ai_system_id == ai_system_id)
        if status:
            stmt = stmt.where(Obligation.status == status)
        stmt = stmt.limit(limit).offset(offset)
        result = await session.execute(stmt)
        return [ObligationResponse.model_validate(r) for r in result.scalars().all()]


@router.post("/obligations", response_model=ObligationResponse, status_code=201)
async def create_obligation(body: ObligationCreate) -> ObligationResponse:
    async with SessionLocal() as session:
        assessment = (await session.execute(
            select(Assessment).where(Assessment.id == body.assessment_id)
        )).scalar_one_or_none()
        if not assessment:
            raise HTTPException(404, f"Assessment {body.assessment_id} not found")
        if assessment.status == "approved":
            raise HTTPException(409, "Approved assessments are immutable")

        row = Obligation(
            id=new_id("OBL"),
            assessment_id=assessment.id,
            ai_system_id=assessment.ai_system_id,
            framework_id=assessment.framework_id,
            title=body.title,
            article_ref=body.article_ref,
            description=body.description,
            due_date=body.due_date,
            owner=body.owner,
            status="applicable",
        )
        session.add(row)
        await session.flush()
        await refresh_assessment_score(session, assessment.id)
        await session.commit()
        await session.refresh(row)
    logger.info("obligation.created", extra={"obligation_id": row.id, "assessment_id": row.assessment_id})
    return ObligationResponse.model_validate(row)


@router.get("/obligations/{obligation_id}", response_model=ObligationDetailResponse)
async def get_obligation(obligation_id: str) -> ObligationDetailResponse:
    async with SessionLocal() as session:
        row = (await session.execute(
            select(Obligation).where(Obligation.id == obligation_id)
        )).scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Obligation {obligation_id} not found")
        control_ids = (await session.execute(
            select(control_obligations.c.control_id)
            .where(control_obligations.c.obligation_id == obligation_id)
        )).scalars().all()
        detail = ObligationDetailResponse.model_validate(row)
        detail.control_ids = list(control_ids)
        return detail


@router.put("/obligations/{obligation_id}", response_model=ObligationResponse)
async def update_obligation(obligation_id: str, body: ObligationUpdate) -> ObligationResponse:
    updates = body.model_dump(exclude_none=True)
    async with SessionLocal() as session:
        row = (await session.execute(
            select(Obligation).where(Obligation.id == obligation_id)
        )).scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Obligation {obligation_id} not found")
        if await _assessment_approved(session, row.assessment_id):
            raise HTTPException(409, "Approved assessments are immutable")

        for field, value in updates.items():
            setattr(row, field, value)
        row.updated_at = datetime.now(timezone.utc)
        await session.flush()
        # A manual status change (e.g. mark fulfilled / not_applicable) affects score.
        if "status" in updates:
            await refresh_assessment_score(session, row.assessment_id)
        await session.commit()
        await session.refresh(row)
    logger.info("obligation.updated", extra={"obligation_id": obligation_id, "fields": sorted(updates.keys())})
    return ObligationResponse.model_validate(row)


@router.delete("/obligations/{obligation_id}")
async def delete_obligation(obligation_id: str) -> dict:
    async with SessionLocal() as session:
        row = (await session.execute(
            select(Obligation).where(Obligation.id == obligation_id)
        )).scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Obligation {obligation_id} not found")
        if await _assessment_approved(session, row.assessment_id):
            raise HTTPException(409, "Approved assessments are immutable")
        assessment_id = row.assessment_id
        await session.delete(row)
        await session.flush()
        await refresh_assessment_score(session, assessment_id)
        await session.commit()
    logger.info("obligation.deleted", extra={"obligation_id": obligation_id})
    return {"status": "deleted", "id": obligation_id}
