from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.risk_library import LibraryRisk, LibraryIncident
from ai_trust_persistence.models.risk_management import RiskEntry, RiskRegister
from ai_trust_persistence.models.ai_system import AISystem
from app.ids import new_id
from app.schemas import LibraryRiskOut, LibraryRiskIn, LibraryRiskStats, LibraryRiskLinkedSystem, RiskCandidateOut

router = APIRouter(tags=["risk-library"])


async def _load_risk(session: AsyncSession, risk_id: str) -> LibraryRisk | None:
    result = await session.execute(select(LibraryRisk).where(LibraryRisk.id == risk_id))
    risk = result.scalar_one_or_none()
    if risk is None:
        return None
    incidents_result = await session.execute(
        select(LibraryIncident).where(LibraryIncident.risk_id == risk_id).order_by(LibraryIncident.occurred_at.desc())
    )
    risk.incidents = list(incidents_result.scalars().all())
    return risk


@router.get("/risk-library", response_model=list[LibraryRiskOut])
async def list_library_risks():
    async with SessionLocal() as session:
        result = await session.execute(select(LibraryRisk).order_by(LibraryRisk.created_at.desc()))
        risks = list(result.scalars().all())
        for risk in risks:
            incidents_result = await session.execute(
                select(LibraryIncident).where(LibraryIncident.risk_id == risk.id).order_by(LibraryIncident.occurred_at.desc())
            )
            risk.incidents = list(incidents_result.scalars().all())
        return [LibraryRiskOut.model_validate(r) for r in risks]


@router.post("/risk-library", response_model=LibraryRiskOut, status_code=201)
async def create_library_risk(body: LibraryRiskIn):
    async with SessionLocal() as session:
        risk = LibraryRisk(
            id=new_id("LRK"),
            title=body.title,
            description=body.description,
            category=body.category,
            affects_vulnerable_groups=body.affects_vulnerable_groups,
            affects_children=body.affects_children,
            severity=body.severity,
            likelihood=body.likelihood,
            suggested_mitigation=body.suggested_mitigation,
            source=body.source,
        )
        session.add(risk)
        await session.commit()
        loaded = await _load_risk(session, risk.id)
        return LibraryRiskOut.model_validate(loaded)


@router.get("/risk-library/candidates", response_model=list[RiskCandidateOut])
async def list_candidate_risks():
    async with SessionLocal() as session:
        result = await session.execute(
            select(RiskEntry, AISystem)
            .join(RiskRegister, RiskEntry.register_id == RiskRegister.id)
            .join(AISystem, RiskRegister.ai_system_id == AISystem.id)
            .where(RiskEntry.library_risk_id.is_(None))
            .order_by(RiskEntry.title)
        )
        rows = result.all()
        seen: set[str] = set()
        unique = []
        for r in rows:
            key = r.RiskEntry.title.strip().lower()
            if key in seen:
                continue
            seen.add(key)
            unique.append(r)
        return [
            RiskCandidateOut(
                risk_id=r.RiskEntry.id,
                title=r.RiskEntry.title,
                description=r.RiskEntry.description,
                category=r.RiskEntry.category,
                severity=r.RiskEntry.severity,
                likelihood=r.RiskEntry.likelihood,
                affects_vulnerable_groups=r.RiskEntry.affects_vulnerable_groups,
                suggested_mitigation=r.RiskEntry.impact,
                system_name=r.AISystem.name,
            )
            for r in unique
        ]


@router.get("/risk-library/{risk_id}", response_model=LibraryRiskOut)
async def get_library_risk(risk_id: str):
    async with SessionLocal() as session:
        risk = await _load_risk(session, risk_id)
        if risk is None:
            raise HTTPException(status_code=404, detail="Library risk not found")
        return LibraryRiskOut.model_validate(risk)


@router.get("/risk-library/{risk_id}/stats", response_model=LibraryRiskStats)
async def get_library_risk_stats(risk_id: str):
    async with SessionLocal() as session:
        entries_result = await session.execute(
            select(RiskEntry, RiskRegister, AISystem)
            .join(RiskRegister, RiskEntry.register_id == RiskRegister.id)
            .join(AISystem, RiskRegister.ai_system_id == AISystem.id)
            .where(RiskEntry.library_risk_id == risk_id)
            .where(RiskEntry.status != "dismissed")
        )
        rows = entries_result.all()

        severities = [r.RiskEntry.severity for r in rows if r.RiskEntry.severity]
        likelihoods = [r.RiskEntry.likelihood for r in rows if r.RiskEntry.likelihood]

        dominant_severity = Counter(severities).most_common(1)[0][0] if severities else None
        dominant_likelihood = Counter(likelihoods).most_common(1)[0][0] if likelihoods else None

        linked = [
            LibraryRiskLinkedSystem(
                system_id=r.AISystem.id,
                system_name=r.AISystem.name,
                risk_id=r.RiskEntry.id,
                severity=r.RiskEntry.severity,
                likelihood=r.RiskEntry.likelihood,
                status=r.RiskEntry.status,
            )
            for r in rows
        ]

        return LibraryRiskStats(
            dominant_severity=dominant_severity,
            dominant_likelihood=dominant_likelihood,
            linked_systems=linked,
        )
