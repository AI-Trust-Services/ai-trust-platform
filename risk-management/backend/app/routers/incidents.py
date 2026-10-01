from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from ai_trust_authorization import get_current_user
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.risk_management import Incident, RiskEntry, RiskRegister
from app.ids import new_id
from app.owner_auth import authorize_owner_action, authorize_owner_or_reviewer_action
from app.schemas import IncidentIn, IncidentOut, IncidentPatch
from app.routers.registers import _reopen_if_approved
from sqlalchemy import select

router = APIRouter(tags=["incidents"])


async def _register_id_for_incident(session, incident_id: str) -> str | None:
    result = await session.execute(select(Incident.register_id).where(Incident.id == incident_id))
    return result.scalar_one_or_none()


async def _owner_for_incident(session, incident: Incident) -> str | None:
    """The linked risk's risk_owner takes precedence; falls back to
    assigned_to when the incident isn't linked to a risk (or that risk has no
    owner set)."""
    if incident.risk_id:
        risk = await session.get(RiskEntry, incident.risk_id)
        if risk and risk.risk_owner:
            return risk.risk_owner
    return incident.assigned_to



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
        if not body.title or not body.title.strip():
            raise HTTPException(status_code=422, detail="Incident title is required.")
        # If the register was approved, this clones it to a new draft and
        # archives the original — the new incident must be created under the
        # new draft, not the (now-archived) register_id the caller passed in.
        register_id = await _reopen_if_approved(session, register_id)
        incident = Incident(
            id=new_id("INC"),
            register_id=register_id,
            risk_id=body.risk_id,
            title=body.title,
            description=body.description,
            status=body.status,
            reported_by=body.reported_by,
            assigned_to=body.assigned_to,
            occurred_at=body.occurred_at,
            attachments=body.attachments,
        )
        session.add(incident)
        await session.commit()
        await session.refresh(incident)
        return incident


@router.patch("/incidents/{incident_id}", response_model=IncidentOut)
async def patch_incident(incident_id: str, body: IncidentPatch, request: Request):
    async with SessionLocal() as session:
        incident = await session.get(Incident, incident_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        register_id = await _register_id_for_incident(session, incident_id)
        if register_id:
            await _reopen_if_approved(session, register_id)
        patch_data = body.model_dump(exclude_unset=True)
        if "title" in patch_data and not (patch_data["title"] or "").strip():
            raise HTTPException(status_code=422, detail="Incident title cannot be empty.")
        if "approved" in patch_data and patch_data["approved"] != incident.approved:
            owner = await _owner_for_incident(session, incident)
            approver = await authorize_owner_action(request, owner)
            incident.approved = patch_data["approved"]
            incident.approved_by = approver if patch_data["approved"] else None
            incident.approved_at = datetime.now(timezone.utc) if patch_data["approved"] else None
        patch_data.pop("approved", None)
        # Two-step delete: any user may propose (pending_delete=True); only the
        # risk owner or the register's reviewer may cancel (pending_delete=False).
        if "pending_delete" in patch_data and patch_data["pending_delete"] != incident.pending_delete:
            if patch_data["pending_delete"]:
                incident.pending_delete = True
                incident.pending_delete_by = get_current_user(request)
                incident.pending_delete_at = datetime.now(timezone.utc)
            else:
                owner = await _owner_for_incident(session, incident)
                register = await session.get(RiskRegister, incident.register_id)
                await authorize_owner_or_reviewer_action(
                    request, owner, register.reviewer_username if register else None
                )
                incident.pending_delete = False
                incident.pending_delete_by = None
                incident.pending_delete_at = None
        patch_data.pop("pending_delete", None)
        for field, value in patch_data.items():
            setattr(incident, field, value)
        session.add(incident)
        await session.commit()
        await session.refresh(incident)
        return incident


@router.delete("/incidents/{incident_id}", status_code=204)
async def delete_incident(incident_id: str, request: Request):
    async with SessionLocal() as session:
        incident = await session.get(Incident, incident_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        # An incident that has been marked for deletion may only actually be
        # deleted by the risk owner or the register's reviewer; an unmarked
        # incident (e.g. direct delete on a draft register) is deleted
        # immediately, as before.
        if incident.pending_delete:
            owner = await _owner_for_incident(session, incident)
            register = await session.get(RiskRegister, incident.register_id)
            await authorize_owner_or_reviewer_action(
                request, owner, register.reviewer_username if register else None
            )
        register_id = await _register_id_for_incident(session, incident_id)
        if register_id:
            await _reopen_if_approved(session, register_id)
        await session.delete(incident)
        await session.commit()
