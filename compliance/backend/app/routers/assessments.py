from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select

from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models import AISystem, Assessment, Framework, Obligation
from app.cascade import refresh_assessment_score, sync_system_compliance
from app.ids import new_id
from app.obligation_templates import obligations_for
from app.schemas import (
    AssessmentCreate,
    AssessmentDetailResponse,
    AssessmentResponse,
    AssessmentUpdate,
    GenerateObligationsResponse,
    ObligationResponse,
)

router = APIRouter(tags=["assessments"])
logger = get_logger(__name__)

##todo - session: AsyncSession type annotation is missing at multiple places. Fix this.

async def _load(session, assessment_id: str) -> Assessment:
    row = (await session.execute(
        select(Assessment).where(Assessment.id == assessment_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"Assessment {assessment_id} not found")
    return row


@router.get("/assessments", response_model=list[AssessmentResponse])
async def list_assessments(
    ai_system_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[AssessmentResponse]:
    async with SessionLocal() as session:
        stmt = select(Assessment).order_by(Assessment.created_at.desc())
        if ai_system_id:
            stmt = stmt.where(Assessment.ai_system_id == ai_system_id)
        stmt = stmt.limit(limit).offset(offset)
        result = await session.execute(stmt)
        return [AssessmentResponse.model_validate(r) for r in result.scalars().all()]


@router.post("/assessments", response_model=AssessmentResponse, status_code=201)
async def create_assessment(body: AssessmentCreate) -> AssessmentResponse:
    async with SessionLocal() as session:
        system = (await session.execute(
            select(AISystem).where(AISystem.id == body.ai_system_id)
        )).scalar_one_or_none()
        if not system:
            raise HTTPException(404, f"AI system {body.ai_system_id} not found")
        if system.lifecycle == "decommissioned":
            raise HTTPException(422, "Cannot assess a decommissioned AI system")

        framework = (await session.execute(
            select(Framework).where(Framework.id == body.framework_id)
        )).scalar_one_or_none()
        if not framework:
            raise HTTPException(404, f"Framework {body.framework_id} not found")
        if not framework.enabled:
            raise HTTPException(422, f"Framework {body.framework_id} is disabled")

        row = Assessment(
            id=new_id("ASS"),
            ai_system_id=body.ai_system_id,
            framework_id=body.framework_id,
            title=body.title,
            type=body.type,
            notes=body.notes,
            status="draft",
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)

    logger.info("assessment.created", extra={
        "assessment_id": row.id, "ai_system_id": row.ai_system_id, "framework_id": row.framework_id,
    })
    return AssessmentResponse.model_validate(row)


@router.get("/assessments/{assessment_id}", response_model=AssessmentDetailResponse)
async def get_assessment(assessment_id: str) -> AssessmentDetailResponse:
    async with SessionLocal() as session:
        row = await _load(session, assessment_id)
        total = (await session.execute(
            select(func.count()).select_from(Obligation)
            .where(Obligation.assessment_id == assessment_id)
        )).scalar_one()
        fulfilled = (await session.execute(
            select(func.count()).select_from(Obligation)
            .where(Obligation.assessment_id == assessment_id)
            .where(Obligation.status == "fulfilled")
        )).scalar_one()
        detail = AssessmentDetailResponse.model_validate(row)
        detail.obligation_count = total
        detail.fulfilled_count = fulfilled
        return detail


@router.put("/assessments/{assessment_id}", response_model=AssessmentResponse)
async def update_assessment(assessment_id: str, body: AssessmentUpdate) -> AssessmentResponse:
    updates = body.model_dump(exclude_none=True)
    async with SessionLocal() as session:
        row = await _load(session, assessment_id)
        if row.status == "approved":
            raise HTTPException(409, "Approved assessments are immutable — create a new assessment to reassess")
        for field, value in updates.items():
            setattr(row, field, value)
        row.updated_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(row)
    logger.info("assessment.updated", extra={"assessment_id": assessment_id, "fields": sorted(updates.keys())})
    return AssessmentResponse.model_validate(row)


@router.delete("/assessments/{assessment_id}")
async def delete_assessment(assessment_id: str) -> dict:
    async with SessionLocal() as session:
        row = await _load(session, assessment_id)
        ai_system_id = row.ai_system_id
        await session.delete(row)
        await session.flush()
        await sync_system_compliance(session, ai_system_id)
        await session.commit()
    logger.info("assessment.deleted", extra={"assessment_id": assessment_id})
    return {"status": "deleted", "id": assessment_id}


@router.post("/assessments/{assessment_id}/generate-obligations", response_model=GenerateObligationsResponse)
async def generate_obligations(assessment_id: str) -> GenerateObligationsResponse:
    async with SessionLocal() as session:
        assessment = await _load(session, assessment_id)
        if assessment.status == "approved":
            raise HTTPException(409, "Approved assessments are immutable")

        existing = (await session.execute(
            select(func.count()).select_from(Obligation)
            .where(Obligation.assessment_id == assessment_id)
        )).scalar_one()
        if existing > 0:
            raise HTTPException(409, "Obligations already generated — create a new assessment to reassess")

        system = (await session.execute(
            select(AISystem).where(AISystem.id == assessment.ai_system_id)
        )).scalar_one_or_none()
        if not system:
            raise HTTPException(404, f"AI system {assessment.ai_system_id} not found")

        templates = obligations_for(assessment.framework_id, system.tier)

        # Pre-fill status/owner from the most recent *approved* prior assessment
        # for the same (system, framework), matched by article_ref (spec §8.9).
        prior = (await session.execute(
            select(Assessment)
            .where(Assessment.ai_system_id == assessment.ai_system_id)
            .where(Assessment.framework_id == assessment.framework_id)
            .where(Assessment.status == "approved")
            .where(Assessment.id != assessment_id)
            .order_by(Assessment.created_at.desc())
            .limit(1)
        )).scalar_one_or_none()
        prior_by_ref: dict[str, Obligation] = {}
        if prior is not None:
            prior_obs = (await session.execute(
                select(Obligation).where(Obligation.assessment_id == prior.id)
            )).scalars().all()
            for po in prior_obs:
                if po.article_ref:
                    prior_by_ref[po.article_ref] = po

        created: list[Obligation] = []
        for t in templates:
            carried = prior_by_ref.get(t["article_ref"])
            row = Obligation(
                id=new_id("OBL"),
                assessment_id=assessment_id,
                ai_system_id=assessment.ai_system_id,
                framework_id=assessment.framework_id,
                title=t["title"],
                article_ref=t["article_ref"],
                description=t["description"],
                # Never carry a terminal 'fulfilled' from a prior assessment —
                # fulfilment must be re-earned via controls/evidence this round.
                status=("not_applicable" if carried and carried.status == "not_applicable" else "applicable"),
                owner=carried.owner if carried else "",
            )
            session.add(row)
            created.append(row)

        await session.flush()
        await refresh_assessment_score(session, assessment_id)
        await session.commit()
        for r in created:
            await session.refresh(r)

        if not templates:
            message = f"No obligations defined for framework {assessment.framework_id} at tier '{system.tier}'."
        else:
            message = f"Generated {len(created)} obligation(s) for tier '{system.tier}'."
            if prior_by_ref:
                message += " Owner/not-applicable status pre-filled from prior approved assessment."

        logger.info("assessment.obligations_generated", extra={
            "assessment_id": assessment_id, "tier": system.tier, "count": len(created),
        })
        return GenerateObligationsResponse(
            created=[ObligationResponse.model_validate(r) for r in created],
            message=message,
        )


@router.post("/assessments/{assessment_id}/submit", response_model=AssessmentResponse)
async def submit_assessment(assessment_id: str) -> AssessmentResponse:
    async with SessionLocal() as session:
        row = await _load(session, assessment_id)
        if row.status == "approved":
            raise HTTPException(409, "Approved assessments are immutable")
        obligation_count = (await session.execute(
            select(func.count()).select_from(Obligation)
            .where(Obligation.assessment_id == assessment_id)
        )).scalar_one()
        if obligation_count == 0:
            raise HTTPException(422, "Cannot submit — generate or add at least one obligation first")
        row.status = "submitted"
        row.updated_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(row)
    logger.info("assessment.submitted", extra={"assessment_id": assessment_id})
    return AssessmentResponse.model_validate(row)


@router.post("/assessments/{assessment_id}/approve", response_model=AssessmentResponse)
async def approve_assessment(assessment_id: str) -> AssessmentResponse:
    async with SessionLocal() as session:
        row = await _load(session, assessment_id)
        if row.status == "approved":
            raise HTTPException(409, "Assessment already approved")
        row.status = "approved"
        row.updated_at = datetime.now(timezone.utc)
        await refresh_assessment_score(session, assessment_id)
        await session.commit()
        await session.refresh(row)
    logger.info("assessment.approved", extra={"assessment_id": assessment_id, "score": row.score})
    return AssessmentResponse.model_validate(row)
