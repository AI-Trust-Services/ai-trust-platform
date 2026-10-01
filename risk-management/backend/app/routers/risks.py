from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_authorization import check_permission, get_current_user
from ai_trust_authorization.constants import RISKS_CONFIRM_ENGINEER, RISKS_CONFIRM_OFFICER
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.risk_management import (
    RiskEntry,
    MisuseScenario,
    MitigationMeasure,
    RiskRegister,
)
from app.ids import new_id
from app.owner_auth import authorize_owner_or_reviewer_action
from app.schemas import (
    RiskEntryIn,
    RiskEntryOut,
    RiskEntryPatch,
    MisuseScenarioIn,
    MisuseScenarioOut,
    MitigationMeasureIn,
    MitigationMeasureOut,
)
from app.routers.registers import _reopen_if_approved

router = APIRouter(tags=["risks"])

VALID_HIERARCHY = {"eliminate", "reduce", "mitigate", "inform"}

# Editing any of these on a risk means both roles must re-review it — see the
# confirmation-reset block in patch_risk().
_EVAL_RESET_FIELDS = (
    "title", "description", "category", "severity", "likelihood", "impact",
    "risk_owner", "responsible_role", "deadline", "affects_vulnerable_groups",
    "vulnerable_groups", "ai_lifecycle_phase",
)


def _role_required(responsible_role: str | None, role_key: str) -> bool:
    """Mirrors the frontend's roleRequired(): is `role_key` listed in responsible_role?"""
    return role_key in [r.strip() for r in (responsible_role or "").split(",") if r.strip()]


async def get_session():
    async with SessionLocal() as session:
        yield session


async def _load_risk_full(session, risk_id: str) -> RiskEntry | None:
    result = await session.execute(select(RiskEntry).where(RiskEntry.id == risk_id))
    risk = result.scalar_one_or_none()
    if risk is None:
        return None
    ms_result = await session.execute(
        select(MisuseScenario).where(MisuseScenario.risk_id == risk_id)
    )
    risk.misuse_scenarios = list(ms_result.scalars().all())
    mit_result = await session.execute(
        select(MitigationMeasure).where(MitigationMeasure.risk_id == risk_id)
    )
    risk.mitigations = list(mit_result.scalars().all())
    return risk


async def _register_id_for_risk(session: AsyncSession, risk_id: str) -> str | None:
    result = await session.execute(select(RiskEntry.register_id).where(RiskEntry.id == risk_id))
    row = result.scalar_one_or_none()
    return row


async def _register_id_for_mitigation(session: AsyncSession, mitigation_id: str) -> str | None:
    result = await session.execute(
        select(RiskEntry.register_id)
        .join(MitigationMeasure, MitigationMeasure.risk_id == RiskEntry.id)
        .where(MitigationMeasure.id == mitigation_id)
    )
    row = result.scalar_one_or_none()
    return row


async def _register_id_for_misuse(session: AsyncSession, scenario_id: str) -> str | None:
    result = await session.execute(
        select(RiskEntry.register_id)
        .join(MisuseScenario, MisuseScenario.risk_id == RiskEntry.id)
        .where(MisuseScenario.id == scenario_id)
    )
    row = result.scalar_one_or_none()
    return row



@router.post("/registers/{register_id}/risks", response_model=RiskEntryOut, status_code=201)
async def create_risk(
    register_id: str,
    body: RiskEntryIn,
    session: AsyncSession = Depends(get_session),
):
    reg_result = await session.execute(select(RiskRegister).where(RiskRegister.id == register_id))
    if reg_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Register not found")
    if not body.title or not body.title.strip():
        raise HTTPException(status_code=422, detail="Risk title is required.")
    # If the register was approved, this clones it to a new draft and archives
    # the original — the new risk must be created under the new draft, not the
    # (now-archived) register_id the caller originally passed in.
    register_id = await _reopen_if_approved(session, register_id)

    risk = RiskEntry(
        id=new_id("RSK"),
        register_id=register_id,
        title=body.title,
        description=body.description,
        category=body.category,
        article_9_step=body.article_9_step,
        severity=body.severity,
        likelihood=body.likelihood,
        status=body.status,
        review_notes=body.review_notes,
        affects_vulnerable_groups=body.affects_vulnerable_groups,
        vulnerable_groups=body.vulnerable_groups,
        closure_justification=body.closure_justification,
        source=body.source,
        taxonomy_mappings=body.taxonomy_mappings,
        risk_owner=body.risk_owner,
        ai_lifecycle_phase=body.ai_lifecycle_phase,
        impact=body.impact,
        risk_level_autocalculated=body.risk_level_autocalculated,
        residual_likelihood=body.residual_likelihood,
        residual_severity=body.residual_severity,
        final_risk_level=body.final_risk_level,
        residual_status=body.residual_status,
        date_of_assessment=date.fromisoformat(body.date_of_assessment[:10]) if body.date_of_assessment else None,
        responsible_role=body.responsible_role,
        deadline=body.deadline,
        engineer_email=body.engineer_email,
        officer_email=body.officer_email,
        library_risk_id=body.library_risk_id,
    )
    session.add(risk)
    await session.flush()

    misuse_scenarios = []
    for ms_in in body.misuse_scenarios:
        ms = MisuseScenario(
            id=new_id("MIS"),
            risk_id=risk.id,
            actor=ms_in.actor,
            description=ms_in.description,
            likelihood=ms_in.likelihood,
            consequence=ms_in.consequence,
            vulnerable_group=ms_in.vulnerable_group,
        )
        session.add(ms)
        misuse_scenarios.append(ms)

    mitigations = []
    for mit_in in body.mitigations:
        if mit_in.hierarchy_level not in VALID_HIERARCHY:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid hierarchy_level '{mit_in.hierarchy_level}'. Must be one of: {sorted(VALID_HIERARCHY)}",
            )
        mit = MitigationMeasure(
            id=new_id("MIT"),
            risk_id=risk.id,
            title=mit_in.title,
            description=mit_in.description,
            hierarchy_level=mit_in.hierarchy_level,
            implementation_guidance=mit_in.implementation_guidance,
            status=mit_in.status,
            assigned_to=mit_in.assigned_to,
            due_date=mit_in.due_date,
            override_notes=mit_in.override_notes,
        )
        session.add(mit)
        mitigations.append(mit)

    await session.commit()
    risk.misuse_scenarios = misuse_scenarios
    risk.mitigations = mitigations
    return RiskEntryOut.model_validate(risk)


@router.get("/registers/{register_id}/risks", response_model=list[RiskEntryOut])
async def list_risks(register_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(RiskEntry).where(RiskEntry.register_id == register_id)
    )
    risks = list(result.scalars().all())
    out = []
    for r in risks:
        full = await _load_risk_full(session, r.id)
        if full:
            out.append(RiskEntryOut.model_validate(full))
    return out


@router.get("/risks/{risk_id}", response_model=RiskEntryOut)
async def get_risk(risk_id: str, session: AsyncSession = Depends(get_session)):
    risk = await _load_risk_full(session, risk_id)
    if risk is None:
        raise HTTPException(status_code=404, detail="Risk not found")
    return RiskEntryOut.model_validate(risk)


@router.patch("/risks/{risk_id}", response_model=RiskEntryOut)
async def patch_risk(
    risk_id: str,
    body: RiskEntryPatch,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(RiskEntry).where(RiskEntry.id == risk_id))
    risk = result.scalar_one_or_none()
    if risk is None:
        raise HTTPException(status_code=404, detail="Risk not found")

    if body.title is not None and not body.title.strip():
        raise HTTPException(status_code=422, detail="Risk title cannot be empty.")

    # Fields the caller actually sent, distinguishing "explicitly set to null"
    # (clear this field) from "omitted" (leave unchanged) — a plain `is not
    # None` check on the model cannot tell these apart.
    provided = body.model_dump(exclude_unset=True)

    # Only the AI Engineer may confirm/decline the engineer sign-off, and only
    # the Compliance Officer may confirm/decline the officer sign-off — no
    # "general" approval that bypasses per-role confirmation.
    effective_responsible_role = provided.get("responsible_role", risk.responsible_role)
    touches_engineer = "engineer_confirmed" in provided or "engineer_declined" in provided
    touches_officer = "officer_confirmed" in provided or "officer_declined" in provided
    if touches_engineer or touches_officer:
        user = get_current_user(request)
        if touches_engineer:
            if not _role_required(effective_responsible_role, "ai_engineer"):
                raise HTTPException(status_code=422, detail="This risk does not require AI Engineer confirmation.")
            if not await check_permission(user, RISKS_CONFIRM_ENGINEER):
                raise HTTPException(status_code=403, detail="Only an AI Engineer can confirm or decline this approval.")
        if touches_officer:
            if not _role_required(effective_responsible_role, "ai_compliance_officer"):
                raise HTTPException(status_code=422, detail="This risk does not require Compliance Officer confirmation.")
            if not await check_permission(user, RISKS_CONFIRM_OFFICER):
                raise HTTPException(status_code=403, detail="Only a Compliance Officer can confirm or decline this approval.")

    # Dismissing (or restoring) a risk is itself a validation decision — it must
    # not let one party silently override the other's confirmation. Only a
    # required risk validator (AI Engineer or Compliance Officer) may do it, and
    # only if they hold the confirmation permission for this risk's role(s).
    if "status" in provided and provided["status"] != risk.status and "dismissed" in (provided["status"], risk.status):
        user = get_current_user(request)
        allowed = (
            _role_required(effective_responsible_role, "ai_engineer") and await check_permission(user, RISKS_CONFIRM_ENGINEER)
        ) or (
            _role_required(effective_responsible_role, "ai_compliance_officer") and await check_permission(user, RISKS_CONFIRM_OFFICER)
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Only a required risk validator (AI Engineer or Compliance Officer) can dismiss or restore this risk.")

    # Editing any evaluation field resets both confirmations — either role may
    # edit at any time, but a fresh review is required once the risk itself has
    # changed. Only fires for genuine content edits, never for the explicit
    # confirm/decline requests handled above.
    if not touches_engineer and not touches_officer:
        changed_eval_field = any(
            f in provided and provided[f] != getattr(risk, f)
            for f in _EVAL_RESET_FIELDS
        )
        if changed_eval_field and (
            risk.engineer_confirmed or risk.officer_confirmed
            or risk.engineer_declined or risk.officer_declined
        ):
            risk.engineer_confirmed = False
            risk.officer_confirmed = False
            risk.engineer_declined = False
            risk.officer_declined = False
            if "status" not in provided and risk.status == "confirmed":
                risk.status = "open"

    # Two-step delete: any user may propose (pending_delete=True); only the
    # risk owner or the register's reviewer may cancel (pending_delete=False).
    # Confirming the actual delete is gated the same way in delete_risk().
    if "pending_delete" in provided and provided["pending_delete"] != risk.pending_delete:
        if provided["pending_delete"]:
            risk.pending_delete = True
            risk.pending_delete_by = get_current_user(request)
            risk.pending_delete_at = datetime.now(timezone.utc)
        else:
            reg = await session.get(RiskRegister, risk.register_id)
            await authorize_owner_or_reviewer_action(
                request, risk.risk_owner, reg.reviewer_username if reg else None
            )
            risk.pending_delete = False
            risk.pending_delete_by = None
            risk.pending_delete_at = None

    await _reopen_if_approved(session, risk.register_id)

    for field in ("title", "description", "category", "article_9_step",
                  "severity", "likelihood", "status", "review_notes", "affects_vulnerable_groups",
                  "vulnerable_groups", "closure_justification", "source", "taxonomy_mappings",
                  "risk_owner", "ai_lifecycle_phase", "impact", "risk_level_autocalculated",
                  "residual_likelihood", "residual_severity", "final_risk_level", "residual_status",
                  "engineer_confirmed", "officer_confirmed", "responsible_role", "deadline",
                  "engineer_email", "officer_email", "engineer_declined", "officer_declined",
                  "library_risk_id"):
        if field in provided:
            setattr(risk, field, provided[field])
    if "date_of_assessment" in provided:
        raw = provided["date_of_assessment"]
        if isinstance(raw, str):
            risk.date_of_assessment = date.fromisoformat(raw[:10])
        else:
            risk.date_of_assessment = raw

    session.add(risk)
    await session.commit()
    return RiskEntryOut.model_validate(await _load_risk_full(session, risk_id))


@router.delete("/risks/{risk_id}", status_code=204)
async def delete_risk(risk_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(RiskEntry).where(RiskEntry.id == risk_id))
    risk = result.scalar_one_or_none()
    if risk is None:
        raise HTTPException(status_code=404, detail="Risk not found")
    # A risk that has been marked for deletion may only actually be deleted by
    # the risk owner or the register's reviewer. A risk that was never marked
    # (e.g. direct delete on a draft register) is deleted immediately, as before.
    if risk.pending_delete:
        reg = await session.get(RiskRegister, risk.register_id)
        await authorize_owner_or_reviewer_action(
            request, risk.risk_owner, reg.reviewer_username if reg else None
        )
    await _reopen_if_approved(session, risk.register_id)
    await session.delete(risk)
    await session.commit()


# ── Misuse scenarios ──────────────────────────────────────────────────────────

@router.post("/risks/{risk_id}/misuse-scenarios", response_model=MisuseScenarioOut, status_code=201)
async def add_misuse_scenario(
    risk_id: str,
    body: MisuseScenarioIn,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(RiskEntry).where(RiskEntry.id == risk_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Risk not found")
    if not body.actor or not body.actor.strip():
        raise HTTPException(status_code=422, detail="Misuse scenario actor is required.")
    await _reopen_if_approved(session, (await _register_id_for_risk(session, risk_id)) or "")
    ms = MisuseScenario(
        id=new_id("MIS"),
        risk_id=risk_id,
        actor=body.actor,
        description=body.description,
        likelihood=body.likelihood,
        consequence=body.consequence,
        vulnerable_group=body.vulnerable_group,
    )
    session.add(ms)
    await session.commit()
    return MisuseScenarioOut.model_validate(ms)


@router.delete("/misuse-scenarios/{scenario_id}", status_code=204)
async def delete_misuse_scenario(scenario_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(MisuseScenario).where(MisuseScenario.id == scenario_id))
    ms = result.scalar_one_or_none()
    if ms is None:
        raise HTTPException(status_code=404, detail="Misuse scenario not found")
    register_id = await _register_id_for_misuse(session, scenario_id)
    if register_id:
        await _reopen_if_approved(session, register_id)
    await session.delete(ms)
    await session.commit()


# ── Mitigation measures ───────────────────────────────────────────────────────

@router.post("/risks/{risk_id}/mitigations", response_model=MitigationMeasureOut, status_code=201)
async def add_mitigation(
    risk_id: str,
    body: MitigationMeasureIn,
    session: AsyncSession = Depends(get_session),
):
    if not body.title or not body.title.strip():
        raise HTTPException(status_code=422, detail="Mitigation title is required.")
    if body.hierarchy_level not in VALID_HIERARCHY:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid hierarchy_level. Must be one of: {sorted(VALID_HIERARCHY)}",
        )
    result = await session.execute(select(RiskEntry).where(RiskEntry.id == risk_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Risk not found")
    register_id = await _register_id_for_risk(session, risk_id)
    if register_id:
        new_register_id = await _reopen_if_approved(session, register_id)
        if new_register_id != register_id:
            # The risk's register was just approved and cloned into a new
            # draft; risk_id now only exists in the archived snapshot, and
            # there is no reliable way to redirect this create to its cloned
            # counterpart. Fail loudly instead of silently orphaning data.
            raise HTTPException(
                status_code=409,
                detail="This risk's register was just approved and cloned into a new draft. Reload the risk and retry.",
            )
    mit = MitigationMeasure(
        id=new_id("MIT"),
        risk_id=risk_id,
        title=body.title,
        description=body.description,
        hierarchy_level=body.hierarchy_level,
        implementation_guidance=body.implementation_guidance,
        status=body.status,
        assigned_to=body.assigned_to,
        due_date=body.due_date,
        override_notes=body.override_notes,
    )
    session.add(mit)
    await session.commit()
    return MitigationMeasureOut.model_validate(mit)


@router.patch("/mitigations/{mitigation_id}", response_model=MitigationMeasureOut)
async def patch_mitigation(
    mitigation_id: str,
    body: MitigationMeasureIn,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(MitigationMeasure).where(MitigationMeasure.id == mitigation_id))
    mit = result.scalar_one_or_none()
    if mit is None:
        raise HTTPException(status_code=404, detail="Mitigation not found")
    register_id = await _register_id_for_mitigation(session, mitigation_id)
    if register_id:
        await _reopen_if_approved(session, register_id)
    if not body.title or not body.title.strip():
        raise HTTPException(status_code=422, detail="Mitigation title cannot be empty.")
    if body.hierarchy_level not in VALID_HIERARCHY:
        raise HTTPException(status_code=422, detail=f"Invalid hierarchy_level. Must be one of: {sorted(VALID_HIERARCHY)}")
    for field in ("title", "description", "hierarchy_level", "implementation_guidance",
                  "status", "assigned_to", "due_date", "override_notes"):
        val = getattr(body, field, None)
        if val is not None:
            setattr(mit, field, val)
    session.add(mit)
    await session.commit()
    return MitigationMeasureOut.model_validate(mit)


@router.delete("/mitigations/{mitigation_id}", status_code=204)
async def delete_mitigation(mitigation_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(MitigationMeasure).where(MitigationMeasure.id == mitigation_id))
    mit = result.scalar_one_or_none()
    if mit is None:
        raise HTTPException(status_code=404, detail="Mitigation not found")
    register_id = await _register_id_for_mitigation(session, mitigation_id)
    if register_id:
        await _reopen_if_approved(session, register_id)
    await session.delete(mit)
    await session.commit()
