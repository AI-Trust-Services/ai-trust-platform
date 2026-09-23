from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import (
    ASSESSMENTS_APPROVE,
    ASSESSMENTS_READ,
    ASSESSMENTS_WRITE,
    SYSTEMS_WRITE,
)
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.audit import log_audit_event
from ai_trust_persistence.models import (
    AISystem,
    Assessment,
    Framework,
    Obligation,
    Requirement,
)
from app.cascade import refresh_assessment_score, refresh_obligation, sync_system_compliance
from app.requirement_templates import cluster_articles, requirements_for
from app.ids import new_id
from app.obligation_templates import obligations_for
from app.schemas import (
    AssessmentCreate,
    AssessmentDetailResponse,
    AssessmentResponse,
    AssessmentUpdate,
    RequirementResponse,
    GenerateRequirementsResponse,
    GenerateObligationsResponse,
    ObligationResponse,
)

router = APIRouter(tags=["assessments"])
logger = get_logger(__name__)


async def _load(session: AsyncSession, assessment_id: str) -> Assessment:
    row = (await session.execute(
        select(Assessment).where(Assessment.id == assessment_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"Assessment {assessment_id} not found")
    return row


@router.get("/assessments", response_model=list[AssessmentResponse], dependencies=[Depends(require_permission(ASSESSMENTS_READ))])
async def list_assessments(
    ai_system_id: str | None = Query(default=None),
    updated_after: date | None = Query(
        default=None,
        description="Only assessments updated on or after this date (e.g. for time-scoped trend charts).",
    ),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[AssessmentResponse]:
    async with SessionLocal() as session:
        stmt = select(Assessment).order_by(Assessment.created_at.desc())
        if ai_system_id:
            stmt = stmt.where(Assessment.ai_system_id == ai_system_id)
        if updated_after is not None:
            stmt = stmt.where(Assessment.updated_at >= updated_after)
        stmt = stmt.limit(limit).offset(offset)
        result = await session.execute(stmt)
        return [AssessmentResponse.model_validate(r) for r in result.scalars().all()]


@router.post("/assessments", response_model=AssessmentResponse, status_code=201, dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
async def create_assessment(body: AssessmentCreate, request: Request) -> AssessmentResponse:
    current_user = request.headers.get("x-forwarded-preferred-username", "unknown")
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

        # Systems with tier "pending" are awaiting questionnaire + classification.
        # Start in questionnaire_pending and defer obligation generation until after classification.
        if system.tier == "pending":
            existing_q = await session.execute(
                select(Assessment).where(
                    Assessment.ai_system_id == body.ai_system_id,
                    Assessment.status == "questionnaire_pending",
                )
            )
            if existing_q.scalar_one_or_none():
                raise HTTPException(409, "A questionnaire is already in progress for this system. Open the existing assessment to continue.")
            row = Assessment(
                id=new_id("ASS"),
                ai_system_id=body.ai_system_id,
                framework_id=body.framework_id,
                title=body.title,
                type=body.type,
                notes=body.notes,
                status="questionnaire_pending",
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            logger.info("assessment.created", extra={
                "assessment_id": row.id, "ai_system_id": row.ai_system_id,
                "framework_id": row.framework_id, "status": "questionnaire_pending",
            })
            return AssessmentResponse.model_validate(row)

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
        await session.flush()
        created, _ = await _generate_obligations_in_session(session, row, system)
        if not created:
            logger.warning("assessment.no_obligations", extra={
                "assessment_id": row.id, "framework": body.framework_id,
                "tier": system.tier, "org_role": system.org_role,
            })
        else:
            await _generate_requirements_in_session(session, created, system.tier, system.org_role)
        log_audit_event(
            session,
            actor=current_user,
            action="assessment.created",
            resource_type="assessment",
            resource_id=row.id,
            ai_system_id=body.ai_system_id,
            ai_system_name=system.name,
        )
        await session.commit()
        await session.refresh(row)

    logger.info("assessment.created", extra={
        "assessment_id": row.id, "ai_system_id": row.ai_system_id, "framework_id": row.framework_id,
    })
    return AssessmentResponse.model_validate(row)


async def _generate_obligations_in_session(
    session: AsyncSession, assessment: Assessment, system: AISystem
) -> tuple[list[Obligation], bool]:
    """Generate obligation rows within the caller's transaction.

    If this raises, the entire transaction (including the assessment row) is
    rolled back atomically — an assessment without obligations is never persisted.

    Returns (created_obligations, prior_prefilled) where prior_prefilled is True
    if any owner/not_applicable values were carried forward from a prior assessment.
    """
    org_role = getattr(system, "org_role", "provider") or "provider"
    templates = obligations_for(assessment.framework_id, system.tier, org_role)

    if (
        assessment.framework_id == "FRM-EU-AI-ACT"
        and system.tier in ("high", "limited")
        and org_role not in ("provider", "deployer")
    ):
        # Only provider/deployer obligation sets are defined for EU high/limited;
        # importer/distributor yield no obligations (templates is already []).
        logger.warning("assessment.unsupported_org_role", extra={
            "assessment_id": assessment.id, "framework": assessment.framework_id,
            "tier": system.tier, "org_role": org_role,
        })

    prior = (await session.execute(
        select(Assessment)
        .where(Assessment.ai_system_id == assessment.ai_system_id)
        .where(Assessment.framework_id == assessment.framework_id)
        .where(Assessment.status == "approved")
        .where(Assessment.id != assessment.id)
        .order_by(Assessment.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    prior_by_ref: dict[str, Obligation] = {}
    if prior is not None:
        prior_obs = (await session.execute(
            select(Obligation).where(Obligation.assessment_id == prior.id)
        )).scalars().all()
        for po in prior_obs:
            key = po.cluster_id or po.article_ref
            if key:
                prior_by_ref[key] = po

    created: list[Obligation] = []
    for idx, t in enumerate(templates):
        carried = prior_by_ref.get(t["cluster_id"])
        # Prefer the aggregate of the cluster's requirement articles (all articles
        # the obligation touches); fall back to the cluster's own display article
        # for retained sets (which carry no per-requirement articles).
        article_ref = cluster_articles(t["cluster_id"], system.tier, org_role) or t["article_ref"]
        obl = Obligation(
            id=new_id("OBL"),
            assessment_id=assessment.id,
            ai_system_id=assessment.ai_system_id,
            framework_id=assessment.framework_id,
            title=t["title"],
            article_ref=article_ref,
            cluster_id=t["cluster_id"],
            description=t.get("description", ""),
            status=("not_applicable" if carried and carried.status == "not_applicable" else "applicable"),
            owner=carried.owner if carried else "",
            sort_order=idx,
        )
        session.add(obl)
        created.append(obl)

    if created:
        await session.flush()
        await refresh_assessment_score(session, assessment.id)

    return created, bool(prior_by_ref)


async def _generate_requirements_in_session(
    session: AsyncSession, obligations: list[Obligation], tier: str, org_role: str = "provider"
) -> list[Requirement]:
    """Generate + link requirements for the given obligations within the caller's txn.

    For each obligation, `requirements_for(cluster_id, tier, org_role)` yields the
    tier- and role-scoped requirement templates; each becomes a Requirement row linked to
    the obligation via requirement_obligations. The requirement_ref is the template's
    explicit Requirement ID (EU CSV sets) or, for retained sets, the derived
    "{article_ref}:{slug}". Owner is carried forward from the most recent prior
    requirement with the same requirement_ref (see _prior_owners_by_ref).

    After linking, each touched obligation is refreshed so its status reflects the
    new requirements (applicable -> in_progress). If this raises, the whole transaction
    rolls back. Returns the created Requirement rows.
    """
    if not obligations:
        return []

    ai_system_id = obligations[0].ai_system_id
    prior_owner_by_ref = await _prior_owners_by_ref(session, ai_system_id)

    created: list[Requirement] = []
    for obl in obligations:
        templates = requirements_for(obl.cluster_id or obl.article_ref, tier, org_role)
        if not templates:
            logger.warning("assessment.requirement_template_missing", extra={
                "assessment_id": obl.assessment_id, "cluster_id": obl.cluster_id,
                "article_ref": obl.article_ref, "tier": tier, "org_role": org_role,
            })
            continue
        for j, t in enumerate(templates):
            requirement_ref = t.get("requirement_ref") or f"{obl.article_ref}:{t['slug']}"
            requirement = Requirement(
                id=new_id("REQ"),
                obligation_id=obl.id,
                assessment_id=obl.assessment_id,
                ai_system_id=ai_system_id,
                requirement_ref=requirement_ref,
                article_ref=t.get("article"),
                title=t["title"],
                description=t["description"],
                category=t.get("category", "general"),
                status="open",
                effectiveness="medium",
                owner=prior_owner_by_ref.get(requirement_ref, ""),
                # Order requirements after their obligation's position, then by template
                # order within the cluster (headroom of 100 requirements per cluster).
                sort_order=obl.sort_order * 100 + j,
            )
            session.add(requirement)
            created.append(requirement)
        await session.flush()
        await refresh_obligation(session, obl.id)

    return created


async def _prior_owners_by_ref(
    session: AsyncSession, ai_system_id: str
) -> dict[str, str]:
    """Map requirement_ref -> owner from the most recent prior requirements for this system."""
    rows = (await session.execute(
        select(Requirement.requirement_ref, Requirement.owner)
        .where(Requirement.ai_system_id == ai_system_id)
        .where(Requirement.requirement_ref.is_not(None))
        .where(Requirement.owner != "")
        .order_by(Requirement.created_at.asc())
    )).all()
    # asc() order means later rows overwrite earlier ones -> newest owner wins.
    return {ref: owner for ref, owner in rows}


@router.post("/assessments/{assessment_id}/advance-from-classification", response_model=AssessmentResponse, dependencies=[Depends(require_permission(SYSTEMS_WRITE))])
async def advance_from_classification(assessment_id: str) -> AssessmentResponse:
    """Called after risk classification sets the system tier.

    Generates obligations + requirements for the now-known tier, then advances
    the assessment from questionnaire_pending to pending_review.
    """
    async with SessionLocal() as session:
        row = await _load(session, assessment_id)
        if row.status != "questionnaire_pending":
            raise HTTPException(422, "Assessment is not in questionnaire_pending status")

        system = (await session.execute(
            select(AISystem).where(AISystem.id == row.ai_system_id)
        )).scalar_one_or_none()
        if not system:
            raise HTTPException(404, "AI system not found")
        if system.tier == "pending":
            raise HTTPException(422, "System tier is still pending — complete risk classification first")

        # Idempotent: only generate obligations/controls on the first advance. A
        # bounce-back (CO reject / request-info) reopens the assessment and re-runs
        # this endpoint on resubmit — regenerating here would duplicate every row.
        existing = (await session.execute(
            select(func.count()).select_from(Obligation)
            .where(Obligation.assessment_id == row.id)
        )).scalar_one()
        if existing == 0:
            created, _ = await _generate_obligations_in_session(session, row, system)
            if created:
                await _generate_requirements_in_session(
                    session, created, system.tier, getattr(system, "org_role", "provider") or "provider"
                )

        row.status = "pending_review"
        row.updated_at = datetime.now(timezone.utc)
        # Intentional cross-service write: both tables share the same DB and the
        # same session, so this stays atomic. An HTTP round-trip to the registry
        # would introduce a distributed-transaction gap where the two states could
        # diverge on failure.
        system.workflow_status = "pending_review"

        await session.commit()
        await session.refresh(row)

    logger.info("assessment.classification_advanced", extra={
        "assessment_id": row.id, "ai_system_id": row.ai_system_id, "tier": system.tier,
    })
    return AssessmentResponse.model_validate(row)


@router.post("/assessments/{assessment_id}/reopen", response_model=AssessmentResponse, dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
async def reopen_assessment(assessment_id: str) -> AssessmentResponse:
    """Revert a pending_review assessment back to questionnaire_pending.

    Called by the compliance officer's reject / request-info actions (via the
    frontend, after the registry workflow is already bounced back to a *_pending
    state). The row-click gate opens the editable questionnaire only for
    questionnaire_pending assessments, so this reopens the section for the owner
    to edit. Obligations/controls are left intact — advance-from-classification is
    idempotent, so the eventual resubmit reuses them rather than duplicating.

    Gated on ASSESSMENTS_WRITE (which the compliance officer holds) — SYSTEMS_WRITE
    would 403 the CO.
    """
    async with SessionLocal() as session:
        row = await _load(session, assessment_id)
        if row.status == "approved":
            raise HTTPException(409, "Approved assessments are immutable — create a new assessment to reassess")
        if row.status != "pending_review":
            raise HTTPException(422, "Only an assessment in pending_review can be reopened")

        row.status = "questionnaire_pending"
        row.updated_at = datetime.now(timezone.utc)

        await session.commit()
        await session.refresh(row)

    logger.info("assessment.reopened", extra={
        "assessment_id": row.id, "ai_system_id": row.ai_system_id,
    })
    return AssessmentResponse.model_validate(row)


@router.get("/assessments/{assessment_id}", response_model=AssessmentDetailResponse, dependencies=[Depends(require_permission(ASSESSMENTS_READ))])
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


@router.put("/assessments/{assessment_id}", response_model=AssessmentResponse, dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
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


@router.delete("/assessments/{assessment_id}", dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
async def delete_assessment(assessment_id: str, request: Request) -> dict:
    current_user = request.headers.get("x-forwarded-preferred-username", "unknown")
    async with SessionLocal() as session:
        row = await _load(session, assessment_id)
        ai_system_id = row.ai_system_id
        system = (await session.execute(
            select(AISystem).where(AISystem.id == ai_system_id)
        )).scalar_one_or_none()

        deleted_requirements = await _delete_generated_requirements(session, assessment_id)

        await session.delete(row)
        await session.flush()
        await sync_system_compliance(session, ai_system_id)
        log_audit_event(
            session,
            actor=current_user,
            action="assessment.deleted",
            resource_type="assessment",
            resource_id=assessment_id,
            ai_system_id=ai_system_id,
            ai_system_name=system.name if system else "",
        )
        await session.commit()
    logger.info("assessment.deleted", extra={
        "assessment_id": assessment_id, "requirements_deleted": deleted_requirements,
    })
    return {"status": "deleted", "id": assessment_id, "requirements_deleted": deleted_requirements}


async def _delete_generated_requirements(session: AsyncSession, assessment_id: str) -> int:
    """Delete auto-generated requirements for this assessment.

    Auto-generated = requirement_ref is not null. With 1:N, a requirement belongs to
    exactly one assessment, so no shared-requirement check is needed.
    """
    to_delete = (await session.execute(
        select(Requirement.id)
        .where(Requirement.assessment_id == assessment_id)
        .where(Requirement.requirement_ref.is_not(None))
    )).scalars().all()
    if not to_delete:
        return 0
    await session.execute(Requirement.__table__.delete().where(Requirement.id.in_(to_delete)))
    return len(to_delete)


@router.post("/assessments/{assessment_id}/generate-obligations", response_model=GenerateObligationsResponse, dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
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

        created, prefilled = await _generate_obligations_in_session(session, assessment, system)
        await session.commit()
        for r in created:
            await session.refresh(r)

        if not created:
            message = f"No obligations defined for framework {assessment.framework_id} at tier '{system.tier}'."
        else:
            message = f"Generated {len(created)} obligation(s) for tier '{system.tier}'."
            if prefilled:
                message += " Owner/not-applicable status pre-filled from prior approved assessment."

        logger.info("assessment.obligations_generated", extra={
            "assessment_id": assessment_id, "tier": system.tier, "count": len(created),
        })
        return GenerateObligationsResponse(
            created=[ObligationResponse.model_validate(r) for r in created],
            message=message,
        )


@router.post("/assessments/{assessment_id}/generate-requirements", response_model=GenerateRequirementsResponse, dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
async def generate_requirements(assessment_id: str) -> GenerateRequirementsResponse:
    async with SessionLocal() as session:
        assessment = await _load(session, assessment_id)
        if assessment.status == "approved":
            raise HTTPException(409, "Approved assessments are immutable")

        system = (await session.execute(
            select(AISystem).where(AISystem.id == assessment.ai_system_id)
        )).scalar_one_or_none()
        if not system:
            raise HTTPException(404, f"AI system {assessment.ai_system_id} not found")

        obligations = (await session.execute(
            select(Obligation).where(Obligation.assessment_id == assessment_id)
        )).scalars().all()
        if not obligations:
            raise HTTPException(422, "No obligations to generate requirements for — generate obligations first")

        # Idempotent: skip any obligation that already has >=1 linked requirement.
        linked_obl_ids = set((await session.execute(
            select(Requirement.obligation_id).where(
                Requirement.obligation_id.in_([o.id for o in obligations])
            )
        )).scalars().all())
        targets = [o for o in obligations if o.id not in linked_obl_ids]

        created = await _generate_requirements_in_session(session, targets, system.tier, system.org_role)
        await session.commit()
        for r in created:
            await session.refresh(r)

        skipped = len(obligations) - len(targets)
        if not created:
            message = "No new requirements generated — all obligations already have requirements or none are defined."
        else:
            message = f"Generated {len(created)} requirement(s) for tier '{system.tier}'."
            if skipped:
                message += f" Skipped {skipped} obligation(s) that already had requirements.."

        logger.info("assessment.requirements_generated", extra={
            "assessment_id": assessment_id, "tier": system.tier,
            "count": len(created), "skipped": skipped,
        })
        return GenerateRequirementsResponse(
            created=[RequirementResponse.model_validate(r) for r in created],
            message=message,
        )


@router.post("/assessments/{assessment_id}/submit", response_model=AssessmentResponse, dependencies=[Depends(require_permission(ASSESSMENTS_WRITE))])
async def submit_assessment(assessment_id: str, request: Request) -> AssessmentResponse:
    current_user = request.headers.get("x-forwarded-preferred-username", "unknown")
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
        system = (await session.execute(
            select(AISystem).where(AISystem.id == row.ai_system_id)
        )).scalar_one_or_none()
        before_status = row.status
        row.status = "submitted"
        row.updated_at = datetime.now(timezone.utc)
        log_audit_event(
            session,
            actor=current_user,
            action="assessment.submitted",
            resource_type="assessment",
            resource_id=assessment_id,
            ai_system_id=row.ai_system_id,
            ai_system_name=system.name if system else "",
            changes={"status": {"before": before_status, "after": "submitted"}},
        )
        await session.commit()
        await session.refresh(row)
    logger.info("assessment.submitted", extra={"assessment_id": assessment_id})
    return AssessmentResponse.model_validate(row)


@router.post("/assessments/{assessment_id}/approve", response_model=AssessmentResponse, dependencies=[Depends(require_permission(ASSESSMENTS_APPROVE))])
async def approve_assessment(assessment_id: str, request: Request) -> AssessmentResponse:
    current_user = request.headers.get("x-forwarded-preferred-username", "unknown")
    async with SessionLocal() as session:
        row = await _load(session, assessment_id)
        if row.status == "approved":
            raise HTTPException(409, "Assessment already approved")
        before_status = row.status
        row.status = "approved"
        row.updated_at = datetime.now(timezone.utc)
        # Also advance the system workflow status so the registry reflects approval.
        sys_row = await session.get(AISystem, row.ai_system_id)
        if sys_row and sys_row.workflow_status not in ("approved", "rejected"):
            sys_row.workflow_status = "approved"
        await refresh_assessment_score(session, assessment_id)
        system = (await session.execute(
            select(AISystem).where(AISystem.id == row.ai_system_id)
        )).scalar_one_or_none()
        log_audit_event(
            session,
            actor=current_user,
            action="assessment.approved",
            resource_type="assessment",
            resource_id=assessment_id,
            ai_system_id=row.ai_system_id,
            ai_system_name=system.name if system else "",
            changes={"status": {"before": before_status, "after": "approved"}},
        )
        await session.commit()
        await session.refresh(row)
    logger.info("assessment.approved", extra={"assessment_id": assessment_id, "score": row.score})
    return AssessmentResponse.model_validate(row)
