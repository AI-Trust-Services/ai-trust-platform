"""Status cascade + score recalculation.

The governance feedback loop, per spec OBL-FR-04 ("obligation status is
calculated automatically from the status of linked controls and evidence") and
CTL-FR-05 ("control effectiveness is determined by evidence status"):

    approved evidence  -> linked control becomes 'effective'
    all controls on an obligation 'effective' -> obligation 'fulfilled'
    >=1 control linked (not all effective) -> obligation 'in_progress'
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
    Control,
    Obligation,
    control_obligations,
    evidence_controls,
)
from ai_trust_persistence.models.evidence import Evidence

# Statuses that a cascade must never overwrite — they represent explicit human
# or terminal decisions. 'overdue' and 'not_applicable' are deliberate human
# determinations; deactivated/ineffective are terminal control states.
_OBLIGATION_LOCKED = frozenset({"not_applicable", "overdue"})
_CONTROL_LOCKED = frozenset({"deactivated", "ineffective"})


async def refresh_control_effectiveness(session: AsyncSession, control_id: str) -> None:
    """Sync a control's 'effective' status to its approved-evidence backing.

    Spec Control Effectiveness Model, applied symmetrically:
    - >=1 approved evidence item        -> promote to 'effective'
    - no approved evidence, currently
      'effective' (auto-promoted before) -> demote back to 'implemented'

    Only the effective<->implemented transition is auto-managed; other manual
    statuses (not_started / planned / under_review) and locked statuses
    (deactivated / ineffective) are left untouched. Demoting only from
    'effective' ensures we never clobber a manually-chosen non-effective status.
    """
    control = (await session.execute(
        select(Control).where(Control.id == control_id)
    )).scalar_one_or_none()
    if control is None or control.status in _CONTROL_LOCKED:
        return

    approved_count = (await session.execute(
        select(func.count())
        .select_from(evidence_controls)
        .join(Evidence, Evidence.id == evidence_controls.c.evidence_id)
        .where(evidence_controls.c.control_id == control_id)
        .where(Evidence.status == "approved")
    )).scalar_one()

    if approved_count > 0:
        control.status = "effective"
    elif control.status == "effective":
        # Sole supporting evidence was rejected/removed — revert the
        # auto-promotion so obligations/scores can drop accordingly.
        # Use "in_implementation" rather than "implemented": the control may
        # have been auto-promoted from any earlier state (not_started, planned,
        # in_implementation) so "implemented" could be a spurious upgrade.
        control.status = "in_implementation"


async def refresh_obligation(session: AsyncSession, obligation_id: str) -> None:
    """Recompute an obligation's status from its linked controls, then rescore.

    - no controls linked           -> revert to 'applicable' (unless locked)
    - >=1 linked, all 'effective'  -> 'fulfilled'
    - >=1 linked, not all effective-> 'in_progress'
    """
    obligation = (await session.execute(
        select(Obligation).where(Obligation.id == obligation_id)
    )).scalar_one_or_none()
    if obligation is None or obligation.status in _OBLIGATION_LOCKED:
        return

    control_statuses = (await session.execute(
        select(Control.status)
        .join(control_obligations, control_obligations.c.control_id == Control.id)
        .where(control_obligations.c.obligation_id == obligation_id)
    )).scalars().all()

    if not control_statuses:
        obligation.status = "applicable"
    elif all(s == "effective" for s in control_statuses):
        obligation.status = "fulfilled"
    else:
        obligation.status = "in_progress"

    await refresh_assessment_score(session, obligation.assessment_id)


async def refresh_obligations_for_control(session: AsyncSession, control_id: str) -> None:
    """Refresh every obligation linked to a given control."""
    obligation_ids = (await session.execute(
        select(control_obligations.c.obligation_id)
        .where(control_obligations.c.control_id == control_id)
    )).scalars().all()
    for oid in obligation_ids:
        await refresh_obligation(session, oid)


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

