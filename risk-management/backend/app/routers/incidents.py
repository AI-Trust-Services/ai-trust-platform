from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.risk_management import Incident, RiskRegister
from app.ids import new_id
from app.schemas import IncidentIn, IncidentOut, IncidentPatch
from sqlalchemy import select

router = APIRouter(tags=["incidents"])


@router.get("/registers/{register_id}/incidents", response_model=list[IncidentOut])
async def list_incidents(register_id: str):
    async with SessionLocal() as session:
        result = await session.execute(
            select(Incident)
            .where(Incident.register_id == register_id)
            .order_by(Incident.created_at.desc())
        )
        return result.scalars().all()


@router.post("/registers/{register_id}/incidents", response_model=IncidentOut, status_code=201)
async def create_incident(register_id: str, body: IncidentIn):
    async with SessionLocal() as session:
        register = await session.get(RiskRegister, register_id)
        if not register:
            raise HTTPException(status_code=404, detail="Register not found")
        incident = Incident(
            id=new_id("INC"),
            register_id=register_id,
            risk_id=body.risk_id,
            title=body.title,
            description=body.description,
            status=body.status,
            reported_by=body.reported_by,
            occurred_at=body.occurred_at,
            attachments=body.attachments,
        )
        session.add(incident)
        await session.commit()
        await session.refresh(incident)
        return incident


@router.patch("/incidents/{incident_id}", response_model=IncidentOut)
async def patch_incident(incident_id: str, body: IncidentPatch):
    async with SessionLocal() as session:
        incident = await session.get(Incident, incident_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(incident, field, value)
        session.add(incident)
        await session.commit()
        await session.refresh(incident)
        return incident


@router.delete("/incidents/{incident_id}", status_code=204)
async def delete_incident(incident_id: str):
    async with SessionLocal() as session:
        incident = await session.get(Incident, incident_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        await session.delete(incident)
        await session.commit()
