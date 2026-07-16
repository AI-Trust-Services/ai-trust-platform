from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models import (
    AISystem,
    Control,
    Obligation,
    control_obligations,
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


async def _load(session, control_id: str) -> Control:
    row = (await session.execute(
        select(Control).where(Control.id == control_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"Control {control_id} not found")
    return row


@router.get("/controls", response_model=list[ControlResponse])
async def list_controls(
    ai_system_id: str | None = Query(default=None),
    obligation_id: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[ControlResponse]:
    async with SessionLocal() as session:
        stmt = select(Control).order_by(Control.created_at.desc())
        if ai_system_id:
            # Include org-wide controls (null ai_system_id) in a system's view.
            stmt = stmt.where(or_(Control.ai_system_id == ai_system_id, Control.ai_system_id.is_(None)))
        if obligation_id:
            stmt = stmt.join(
                control_obligations, control_obligations.c.control_id == Control.id
            ).where(control_obligations.c.obligation_id == obligation_id)
        stmt = stmt.limit(limit).offset(offset)
        result = await session.execute(stmt)
        return [ControlResponse.model_validate(r) for r in result.scalars().all()]


@router.post("/controls", response_model=ControlResponse, status_code=201)
async def create_control(body: ControlCreate) -> ControlResponse:
    async with SessionLocal() as session:
        if body.ai_system_id and not (await session.execute(
            select(AISystem.id).where(AISystem.id == body.ai_system_id)
        )).scalar_one_or_none():
            raise HTTPException(404, f"AI system {body.ai_system_id} not found")
        row = Control(
            id=new_id("CTL"),
            ai_system_id=body.ai_system_id,
            title=body.title,
            description=body.description,
            category=body.category,
            owner=body.owner,
            due_date=body.due_date,
            status="not_started",
            effectiveness="medium",
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
    logger.info("control.created", extra={"control_id": row.id, "ai_system_id": row.ai_system_id})
    return ControlResponse.model_validate(row)


@router.get("/controls/{control_id}", response_model=ControlDetailResponse)
async def get_control(control_id: str) -> ControlDetailResponse:
    async with SessionLocal() as session:
        row = await _load(session, control_id)
        obligation_ids = (await session.execute(
            select(control_obligations.c.obligation_id)
            .where(control_obligations.c.control_id == control_id)
        )).scalars().all()
        evidence_count = (await session.execute(
            select(func.count()).select_from(evidence_controls)
            .where(evidence_controls.c.control_id == control_id)
        )).scalar_one()
        detail = ControlDetailResponse.model_validate(row)
        detail.obligation_ids = list(obligation_ids)
        detail.evidence_count = evidence_count
        return detail


@router.put("/controls/{control_id}", response_model=ControlResponse)
async def update_control(control_id: str, body: ControlUpdate) -> ControlResponse:
    updates = body.model_dump(exclude_none=True)
    async with SessionLocal() as session:
        row = await _load(session, control_id)
        for field, value in updates.items():
            setattr(row, field, value)
        row.updated_at = datetime.now(timezone.utc)
        await session.flush()
        # A status change may flip linked obligations (fulfilled/in_progress).
        if "status" in updates:
            await refresh_obligations_for_control(session, control_id)
        await session.commit()
        await session.refresh(row)
    logger.info("control.updated", extra={"control_id": control_id, "fields": sorted(updates.keys())})
    return ControlResponse.model_validate(row)


@router.delete("/controls/{control_id}")
async def delete_control(control_id: str) -> dict:
    async with SessionLocal() as session:
        row = await _load(session, control_id)
        # Capture linked obligations before the FK-cascade removes the links.
        obligation_ids = (await session.execute(
            select(control_obligations.c.obligation_id)
            .where(control_obligations.c.control_id == control_id)
        )).scalars().all()
        await session.delete(row)
        await session.flush()
        for oid in obligation_ids:
            await refresh_obligation(session, oid)
        await session.commit()
    logger.info("control.deleted", extra={"control_id": control_id})
    return {"status": "deleted", "id": control_id}


@router.post("/controls/{control_id}/link/{obligation_id}", response_model=ControlDetailResponse)
async def link_obligation(control_id: str, obligation_id: str) -> ControlDetailResponse:
    async with SessionLocal() as session:
        await _load(session, control_id)
        obligation = (await session.execute(
            select(Obligation).where(Obligation.id == obligation_id)
        )).scalar_one_or_none()
        if not obligation:
            raise HTTPException(404, f"Obligation {obligation_id} not found")

        # Idempotent insert — ignore if the link already exists.
        await session.execute(
            pg_insert(control_obligations)
            .values(control_id=control_id, obligation_id=obligation_id)
            .on_conflict_do_nothing()
        )
        await session.flush()
        await refresh_obligation(session, obligation_id)
        await session.commit()
    logger.info("control.linked", extra={"control_id": control_id, "obligation_id": obligation_id})
    return await get_control(control_id)


@router.delete("/controls/{control_id}/link/{obligation_id}", response_model=ControlDetailResponse)
async def unlink_obligation(control_id: str, obligation_id: str) -> ControlDetailResponse:
    async with SessionLocal() as session:
        await _load(session, control_id)
        await session.execute(
            control_obligations.delete()
            .where(control_obligations.c.control_id == control_id)
            .where(control_obligations.c.obligation_id == obligation_id)
        )
        await session.flush()
        await refresh_obligation(session, obligation_id)
        await session.commit()
    logger.info("control.unlinked", extra={"control_id": control_id, "obligation_id": obligation_id})
    return await get_control(control_id)
