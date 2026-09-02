from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.risk_management import ReassessmentTrigger
from app.ids import new_id
from app.schemas import ReassessmentTriggerOut

router = APIRouter(tags=["triggers"])


async def get_session():
    async with SessionLocal() as session:
        yield session


def _username(request: Request) -> str:
    return request.headers.get("X-Forwarded-Preferred-Username", "unknown")


@router.get("/systems/{system_id}/triggers", response_model=list[ReassessmentTriggerOut])
async def list_triggers(
    system_id: str,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(ReassessmentTrigger)
        .where(ReassessmentTrigger.ai_system_id == system_id)
        .order_by(ReassessmentTrigger.triggered_at.desc())
    )
    return [ReassessmentTriggerOut.model_validate(t) for t in result.scalars().all()]


@router.post("/systems/{system_id}/triggers", response_model=ReassessmentTriggerOut, status_code=201)
async def create_trigger(
    system_id: str,
    trigger_type: str,
    trigger_reason: str = "",
    session: AsyncSession = Depends(get_session),
):
    """Manually create a re-assessment trigger (e.g. after a documentation change)."""
    trigger = ReassessmentTrigger(
        id=new_id("RAT"),
        ai_system_id=system_id,
        trigger_type=trigger_type,
        trigger_reason=trigger_reason,
    )
    session.add(trigger)
    await session.commit()
    return ReassessmentTriggerOut.model_validate(trigger)


@router.post("/triggers/{trigger_id}/acknowledge", response_model=ReassessmentTriggerOut)
async def acknowledge_trigger(
    trigger_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(ReassessmentTrigger).where(ReassessmentTrigger.id == trigger_id)
    )
    trigger = result.scalar_one_or_none()
    if trigger is None:
        raise HTTPException(status_code=404, detail="Trigger not found")
    trigger.acknowledged = True
    trigger.acknowledged_by = _username(request)
    trigger.acknowledged_at = datetime.now(timezone.utc)
    session.add(trigger)
    await session.commit()
    return ReassessmentTriggerOut.model_validate(trigger)
