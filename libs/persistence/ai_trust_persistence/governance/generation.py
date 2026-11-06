"""Obligation + requirement generation for an assessment (shared governance logic).

Extracted from the compliance backend so both the compliance service (on
assessment create / advance-from-classification) and the registry service (on the
single-page CO issue-classification) can generate the governance chain in-process,
inside the caller's own transaction. All functions operate on a caller-provided
session and do NOT commit — the caller owns the transaction boundary, so generation
stays atomic with whatever status change triggered it.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_logging import get_logger
from ai_trust_persistence.governance.obligation_templates import obligations_for
from ai_trust_persistence.governance.requirement_templates import (
    cluster_articles,
    requirements_for,
)
from ai_trust_persistence.governance.cascade import (
    refresh_assessment_score,
    refresh_obligation,
)
from ai_trust_persistence.models import AISystem, Assessment, Obligation, Requirement

logger = get_logger(__name__)


def new_id(prefix: str) -> str:
    """Prefixed ID like ``OBL-3F2A1B4C`` — matches the per-service app.ids scheme."""
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


async def generate_obligations_in_session(
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
        logger.warning(
            "assessment.unsupported_org_role",
            extra={
                "assessment_id": assessment.id,
                "framework": assessment.framework_id,
                "tier": system.tier,
                "org_role": org_role,
            },
        )

    prior = (
        await session.execute(
            select(Assessment)
            .where(Assessment.ai_system_id == assessment.ai_system_id)
            .where(Assessment.framework_id == assessment.framework_id)
            .where(Assessment.status == "approved")
            .where(Assessment.id != assessment.id)
            .order_by(Assessment.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    prior_by_ref: dict[str, Obligation] = {}
    if prior is not None:
        prior_obs = (
            (
                await session.execute(
                    select(Obligation).where(Obligation.assessment_id == prior.id)
                )
            )
            .scalars()
            .all()
        )
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
        article_ref = (
            cluster_articles(
                t["cluster_id"], system.tier, org_role, assessment.framework_id
            )
            or t["article_ref"]
        )
        obl = Obligation(
            id=new_id("OBL"),
            assessment_id=assessment.id,
            ai_system_id=assessment.ai_system_id,
            framework_id=assessment.framework_id,
            title=t["title"],
            article_ref=article_ref,
            cluster_id=t["cluster_id"],
            description=t.get("description", ""),
            status=(
                "not_applicable"
                if carried and carried.status == "not_applicable"
                else "applicable"
            ),
            owner=carried.owner if carried else "",
            sort_order=idx,
        )
        session.add(obl)
        created.append(obl)

    if created:
        await session.flush()
        await refresh_assessment_score(session, assessment.id)

    return created, bool(prior_by_ref)


async def generate_requirements_in_session(
    session: AsyncSession,
    obligations: list[Obligation],
    tier: str,
    org_role: str = "provider",
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
            logger.warning(
                "assessment.requirement_template_missing",
                extra={
                    "assessment_id": obl.assessment_id,
                    "cluster_id": obl.cluster_id,
                    "article_ref": obl.article_ref,
                    "tier": tier,
                    "org_role": org_role,
                },
            )
            continue
        for j, t in enumerate(templates):
            requirement_ref = (
                t.get("requirement_ref") or f"{obl.article_ref}:{t['slug']}"
            )
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
    rows = (
        await session.execute(
            select(Requirement.requirement_ref, Requirement.owner)
            .where(Requirement.ai_system_id == ai_system_id)
            .where(Requirement.requirement_ref.is_not(None))
            .where(Requirement.owner != "")
            .order_by(Requirement.created_at.asc())
        )
    ).all()
    # asc() order means later rows overwrite earlier ones -> newest owner wins.
    return {ref: owner for ref, owner in rows}
