from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.risk_management import (
    RiskEntry,
    MisuseScenario,
    MitigationMeasure,
    RiskRegister,
)
from app.ids import new_id
from app.schemas import (
    RiskEntryIn,
    RiskEntryOut,
    RiskEntryPatch,
    MisuseScenarioIn,
    MisuseScenarioOut,
    MitigationMeasureIn,
    MitigationMeasureOut,
)

router = APIRouter(tags=["risks"])

VALID_HIERARCHY = {"eliminate", "reduce", "mitigate", "inform"}


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


@router.post("/registers/{register_id}/risks", response_model=RiskEntryOut, status_code=201)
async def create_risk(
    register_id: str,
    body: RiskEntryIn,
    session: AsyncSession = Depends(get_session),
):
    reg_result = await session.execute(select(RiskRegister).where(RiskRegister.id == register_id))
    if reg_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Register not found")

    risk = RiskEntry(
        id=new_id("RSK"),
        register_id=register_id,
        title=body.title,
        description=body.description,
        category=body.category,
        article_9_step=body.article_9_step,
        risk_type=body.risk_type,
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
        date_of_assessment=body.date_of_assessment,
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
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(RiskEntry).where(RiskEntry.id == risk_id))
    risk = result.scalar_one_or_none()
    if risk is None:
        raise HTTPException(status_code=404, detail="Risk not found")

    for field in ("title", "description", "category", "article_9_step", "risk_type",
                  "severity", "likelihood", "status", "review_notes", "affects_vulnerable_groups",
                  "vulnerable_groups", "closure_justification", "source", "taxonomy_mappings",
                  "risk_owner", "ai_lifecycle_phase", "impact", "risk_level_autocalculated",
                  "residual_likelihood", "residual_severity", "final_risk_level", "date_of_assessment"):
        val = getattr(body, field, None)
        if val is not None:
            setattr(risk, field, val)

    session.add(risk)
    await session.commit()
    return RiskEntryOut.model_validate(await _load_risk_full(session, risk_id))


@router.delete("/risks/{risk_id}", status_code=204)
async def delete_risk(risk_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(RiskEntry).where(RiskEntry.id == risk_id))
    risk = result.scalar_one_or_none()
    if risk is None:
        raise HTTPException(status_code=404, detail="Risk not found")
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
    await session.delete(ms)
    await session.commit()


# ── Mitigation measures ───────────────────────────────────────────────────────

@router.post("/risks/{risk_id}/mitigations", response_model=MitigationMeasureOut, status_code=201)
async def add_mitigation(
    risk_id: str,
    body: MitigationMeasureIn,
    session: AsyncSession = Depends(get_session),
):
    if body.hierarchy_level not in VALID_HIERARCHY:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid hierarchy_level. Must be one of: {sorted(VALID_HIERARCHY)}",
        )
    result = await session.execute(select(RiskEntry).where(RiskEntry.id == risk_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Risk not found")
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
    await session.delete(mit)
    await session.commit()
