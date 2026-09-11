from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import ASSESSMENTS_READ, ASSESSMENTS_WRITE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models import (
    Assessment,
    Control,
    Obligation,
    evidence_controls,
)
from app.cascade import refresh_obligation, refresh_obligations_for_control
from app.ids import new_id
from app.schemas import (
    ControlCreate,
    ControlDetailResponse,
    ControlResponse,
    ControlUpdate,
)

router = APIRouter(tags=["controls"])
logger = get_logger(__name__)


async def _load(session: AsyncSession, control_id: str) -> Control:
    row = (await session.execute(
        select(Control).where(Control.id == control_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"Control {control_id} not found")
    return row


async def _assessment_title(session: AsyncSession, assessment_id: str) -> str | None:
    return (await session.execute(
        select(Assessment.title).where(Assessment.id == assessment_id)
    )).scalar_one_or_none()


async def _to_response(session: AsyncSession, row: Control) -> ControlResponse:
    resp = ControlResponse.model_validate(row)
    resp.assessment_title = await _assessment_title(session, row.assessment_id)
    return resp


@router.get("/controls", response_model=list[ControlResponse], dependencies=[Depends(require_permission(ASSESSMENTS_READ))])
async def list_controls(
    ai_system_id: str | None = Query(default=None),
    obligation_id: str | None = Query(default=None),
    evidence_id: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[ControlResponse]:
    async with SessionLocal() as session:
        stmt = select(Control).order_by(Control.created_at.desc())
        if ai_system_id:
            stmt = stmt.where(Control.ai_system_id == ai_system_id)
        if obligation_id:
            stmt = stmt.where(Control.obligation_id == obligation_id)
        if evidence_id:
            stmt = stmt.join(
                evidence_controls, evidence_controls.c.control_id == Control.id
            ).where(evidence_controls.c.evidence_id == evidence_id)
        stmt = stmt.limit(limit).offset(offset)
        controls = (await session.execute(stmt)).scalars().all()

        assessment_ids = {c.assessment_id for c in controls}
        titles: dict[str, str] = {}
        if assessment_ids:
            titles = dict((await session.execute(
                select(Assessment.id, Assessment.title).where(Assessment.id.in_(assessment_ids))
            )).all())

        responses = []
        for c in controls:
            r = ControlResponse.model_validate(c)
            r.assessment_title = titles.get(c.assessment_id)
            responses.append(r)
        return responses


@router.post("/controls", response_model=ControlResponse, status_code=201, dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
async def create_control(body: ControlCreate) -> ControlResponse:
    async with SessionLocal() as session:
        obligation = (await session.execute(
            select(Obligation).where(Obligation.id == body.obligation_id)
        )).scalar_one_or_none()
        if not obligation:
            raise HTTPException(404, f"Obligation {body.obligation_id} not found")

        row = Control(
            id=new_id("CTL"),
            obligation_id=obligation.id,
            assessment_id=obligation.assessment_id,
            ai_system_id=obligation.ai_system_id,
            title=body.title,
            description=body.description,
            category=body.category,
            owner=body.owner,
            due_date=body.due_date,
            status="open",
            effectiveness="medium",
        )
        session.add(row)
        await session.flush()
        await refresh_obligation(session, obligation.id)
        await session.commit()
        await session.refresh(row)
        resp = await _to_response(session, row)
    logger.info("control.created", extra={"control_id": row.id, "obligation_id": row.obligation_id})
    return resp


@router.get("/controls/{control_id}", response_model=ControlDetailResponse, dependencies=[Depends(require_permission(ASSESSMENTS_READ))])
async def get_control(control_id: str) -> ControlDetailResponse:
    async with SessionLocal() as session:
        row = await _load(session, control_id)
        evidence_count = (await session.execute(
            select(func.count()).select_from(evidence_controls)
            .where(evidence_controls.c.control_id == control_id)
        )).scalar_one()
        detail = ControlDetailResponse.model_validate(row)
        detail.assessment_title = await _assessment_title(session, row.assessment_id)
        detail.evidence_count = evidence_count
        return detail


@router.put("/controls/{control_id}", response_model=ControlResponse, dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
async def update_control(control_id: str, body: ControlUpdate) -> ControlResponse:
    updates = body.model_dump(exclude_none=True)
    async with SessionLocal() as session:
        row = await _load(session, control_id)

        if "obligation_id" in updates:
            obligation = (await session.execute(
                select(Obligation).where(Obligation.id == updates.pop("obligation_id"))
            )).scalar_one_or_none()
            if not obligation:
                raise HTTPException(404, f"Obligation {body.obligation_id} not found")
            row.obligation_id = obligation.id
            row.assessment_id = obligation.assessment_id
            row.ai_system_id = obligation.ai_system_id

        for field, value in updates.items():
            setattr(row, field, value)
        row.updated_at = datetime.now(timezone.utc)
        await session.flush()
        if "status" in updates:
            await refresh_obligations_for_control(session, control_id)
        await session.commit()
        await session.refresh(row)
        resp = await _to_response(session, row)
    logger.info("control.updated", extra={"control_id": control_id, "fields": sorted(updates.keys())})
    return resp


@router.delete("/controls/{control_id}", dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
async def delete_control(control_id: str) -> dict:
    async with SessionLocal() as session:
        row = await _load(session, control_id)
        obligation_id = row.obligation_id
        await session.delete(row)
        await session.flush()
        await refresh_obligation(session, obligation_id)
        await session.commit()
    logger.info("control.deleted", extra={"control_id": control_id})
    return {"status": "deleted", "id": control_id}
