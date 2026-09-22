"""Status cascade + score recalculation.

The governance feedback loop, per spec OBL-FR-04 ("obligation status is
calculated automatically from the status of linked requirements and evidence") and
CTL-FR-05 ("requirement effectiveness is determined by evidence status"):

    approved evidence  -> linked requirement becomes 'fulfilled'
    all requirements on an obligation 'fulfilled' -> obligation 'fulfilled'
    >=1 requirement linked (not all fulfilled) -> obligation 'in_progress'
    assessment score = fulfilled obligations / total obligations * 100
    ai_systems.compliance = avg(score) across all approved assessments for that system

Every function operates on a caller-provided session and does NOT commit — the
caller owns the transaction boundary so a request stays atomic.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_persistence.models import (
    AISystem,
    Assessment,
    Obligation,
    Requirement,
    evidence_requirements,
)
from ai_trust_persistence.models.evidence import Evidence

# Statuses that a cascade must never overwrite — they represent explicit human
# or terminal decisions. 'overdue' and 'not_applicable' are deliberate human
# determinations; deactivated/ineffective are terminal requirement states.
_OBLIGATION_LOCKED = frozenset({"not_applicable", "overdue"})
_REQUIREMENT_LOCKED = frozenset({"deactivated", "ineffective"})


async def refresh_requirement_effectiveness(session: AsyncSession, requirement_id: str) -> None:
    """Sync a requirement's 'fulfilled' status to its approved-evidence backing.

    Spec Requirement Effectiveness Model, applied symmetrically:
    - >=1 approved evidence item        -> promote to 'fulfilled'
    - no approved evidence, currently
      'fulfilled' (auto-promoted before) -> demote back to 'planned'

    Only the fulfilled<->planned transition is auto-managed; other manual
    statuses (open / under_review) and locked statuses
    (deactivated / ineffective) are left untouched. Demoting only from
    'fulfilled' ensures we never clobber a manually-chosen non-fulfilled status.
    """
    requirement = (await session.execute(
        select(Requirement).where(Requirement.id == requirement_id)
    )).scalar_one_or_none()
    if requirement is None or requirement.status in _REQUIREMENT_LOCKED:
        return

    approved_count = (await session.execute(
        select(func.count())
        .select_from(evidence_requirements)
        .join(Evidence, Evidence.id == evidence_requirements.c.evidence_id)
        .where(evidence_requirements.c.requirement_id == requirement_id)
        .where(Evidence.status == "approved")
    )).scalar_one()

    if approved_count > 0:
        requirement.status = "fulfilled"
    elif requirement.status == "fulfilled":
        # Sole supporting evidence was rejected/removed — revert the
        # auto-promotion so obligations/scores can drop accordingly.
        # Use "planned" rather than "open": the requirement may have been
        # auto-promoted from any earlier state so "open" could be a
        # spurious downgrade past manual progress.
        requirement.status = "planned"


async def refresh_obligation(session: AsyncSession, obligation_id: str) -> None:
    """Recompute an obligation's status from its linked requirements, then rescore.

    - no requirements linked           -> revert to 'applicable' (unless locked)
    - >=1 linked, all 'fulfilled'  -> 'fulfilled'
    - >=1 linked, not all fulfilled-> 'in_progress'
    """
    obligation = (await session.execute(
        select(Obligation).where(Obligation.id == obligation_id)
    )).scalar_one_or_none()
    if obligation is None or obligation.status in _OBLIGATION_LOCKED:
        return

    requirement_statuses = (await session.execute(
        select(Requirement.status)
        .where(Requirement.obligation_id == obligation_id)
    )).scalars().all()

    if not requirement_statuses:
        obligation.status = "applicable"
    elif all(s == "fulfilled" for s in requirement_statuses):
        obligation.status = "fulfilled"
    else:
        obligation.status = "in_progress"

    await refresh_assessment_score(session, obligation.assessment_id)


async def refresh_obligations_for_requirement(session: AsyncSession, requirement_id: str) -> None:
    """Refresh the obligation linked to a given requirement."""
    requirement = (await session.execute(
        select(Requirement).where(Requirement.id == requirement_id)
    )).scalar_one_or_none()
    if requirement is not None:
        await refresh_obligation(session, requirement.obligation_id)


async def refresh_assessment_score(session: AsyncSession, assessment_id: str) -> None:
    """Recompute assessment score and propagate to ai_systems.compliance."""
    assessment = (await session.execute(
        select(Assessment).where(Assessment.id == assessment_id)
    )).scalar_one_or_none()
    if assessment is None:
        return

    applicable = (await session.execute(
        select(func.count()).select_from(Obligation)
        .where(Obligation.assessment_id == assessment_id)
        .where(Obligation.status != "not_applicable")
    )).scalar_one()

    if applicable == 0:
        assessment.score = None
    else:
        fulfilled = (await session.execute(
            select(func.count()).select_from(Obligation)
            .where(Obligation.assessment_id == assessment_id)
            .where(Obligation.status == "fulfilled")
        )).scalar_one()
        assessment.score = round(fulfilled / applicable * 100, 1)

    await _sync_system_compliance(session, assessment.ai_system_id)


async def sync_system_compliance(session: AsyncSession, ai_system_id: str) -> None:
    """Public entry point for callers that need to re-sync without a score recalc.

    Used when an assessment is deleted — the score on the deleted row is gone,
    so we go straight to re-averaging the remaining approved assessments.
    """
    await _sync_system_compliance(session, ai_system_id)


async def _sync_system_compliance(session: AsyncSession, ai_system_id: str) -> None:
    """Write the average approved-assessment score back to ai_systems.compliance.

    Only approved assessments with a non-null score count. If none exist yet,
    the field stays at 0.0 (its registration default) rather than going null,
    so the registry and dashboards always have a meaningful number to display.
    """
    avg = (await session.execute(
        select(func.avg(Assessment.score))
        .where(Assessment.ai_system_id == ai_system_id)
        .where(Assessment.status == "approved")
        .where(Assessment.score.is_not(None))
    )).scalar_one_or_none()

    system = (await session.execute(
        select(AISystem).where(AISystem.id == ai_system_id)
    )).scalar_one_or_none()
    if system is not None:
        system.compliance = round(float(avg), 1) if avg is not None else 0.0
