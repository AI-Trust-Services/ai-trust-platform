"""Cascade logic tests — call cascade functions directly via DB session.

These tests exercise edge cases that are hard to reach through the HTTP layer:
locked statuses, demotion from 'effective', score=None when all obligations
are not_applicable, etc.

Each test uses the db_session fixture (rollback after test — no truncate needed).
"""
from __future__ import annotations

from sqlalchemy import insert
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
from app.cascade import (
    refresh_assessment_score,
    refresh_control_effectiveness,
    refresh_obligation,
    refresh_obligations_for_control,
    sync_system_compliance,
)
from app.ids import new_id


# ---------------------------------------------------------------------------
# Helpers — insert rows directly without HTTP
# ---------------------------------------------------------------------------

async def _system(session: AsyncSession, tier: str = "minimal") -> AISystem:
    row = AISystem(id=new_id("SYS"), name="Cascade Test System", tier=tier)
    session.add(row)
    await session.flush()
    return row


async def _assessment(session: AsyncSession, system: AISystem) -> Assessment:
    row = Assessment(
        id=new_id("ASS"),
        ai_system_id=system.id,
        framework_id="FRM-EU-AI-ACT",
        title="Cascade Test Assessment",
        type="compliance",
        status="draft",
    )
    session.add(row)
    await session.flush()
    return row


async def _obligation(session: AsyncSession, assessment: Assessment, status: str = "applicable") -> Obligation:
    row = Obligation(
        id=new_id("OBL"),
        assessment_id=assessment.id,
        ai_system_id=assessment.ai_system_id,
        framework_id=assessment.framework_id,
        title="Test Obligation",
        status=status,
    )
    session.add(row)
    await session.flush()
    return row


async def _control(session: AsyncSession, system: AISystem, status: str = "implemented") -> Control:
    row = Control(
        id=new_id("CTL"),
        ai_system_id=system.id,
        title="Test Control",
        category="general",
        status=status,
        effectiveness="medium",
    )
    session.add(row)
    await session.flush()
    return row


async def _evidence(session: AsyncSession, status: str = "pending") -> Evidence:
    row = Evidence(
        id=new_id("EVD"),
        title="Test Evidence",
        evidence_type="document",
        status=status,
        file_path="",
        file_name="",
        file_size=0,
        mime_type="",
        uploaded_by="",
    )
    session.add(row)
    await session.flush()
    return row


async def _link_evidence_control(session: AsyncSession, evidence_id: str, control_id: str) -> None:
    await session.execute(
        insert(evidence_controls).values(evidence_id=evidence_id, control_id=control_id)
    )
    await session.flush()


async def _link_control_obligation(session: AsyncSession, control_id: str, obligation_id: str) -> None:
    await session.execute(
        insert(control_obligations).values(control_id=control_id, obligation_id=obligation_id)
    )
    await session.flush()


# ---------------------------------------------------------------------------
# refresh_control_effectiveness
# ---------------------------------------------------------------------------

async def test_approved_evidence_promotes_control_to_effective(db_session: AsyncSession):
    system = await _system(db_session)
    ctl = await _control(db_session, system, status="implemented")
    evd = await _evidence(db_session, status="approved")
    await _link_evidence_control(db_session, evd.id, ctl.id)

    await refresh_control_effectiveness(db_session, ctl.id)

    assert ctl.status == "effective"


async def test_no_approved_evidence_leaves_non_effective_control_unchanged(db_session: AsyncSession):
    system = await _system(db_session)
    ctl = await _control(db_session, system, status="implemented")
    evd = await _evidence(db_session, status="pending")
    await _link_evidence_control(db_session, evd.id, ctl.id)

    await refresh_control_effectiveness(db_session, ctl.id)

    assert ctl.status == "implemented"


async def test_removing_approved_evidence_demotes_effective_control(db_session: AsyncSession):
    """Control promoted to effective, then its evidence is rejected → should demote."""
    system = await _system(db_session)
    ctl = await _control(db_session, system, status="effective")
    evd = await _evidence(db_session, status="rejected")
    await _link_evidence_control(db_session, evd.id, ctl.id)

    await refresh_control_effectiveness(db_session, ctl.id)

    assert ctl.status == "in_implementation"


async def test_locked_control_deactivated_is_not_changed(db_session: AsyncSession):
    """Deactivated control must never be auto-promoted, even with approved evidence."""
    system = await _system(db_session)
    ctl = await _control(db_session, system, status="deactivated")
    evd = await _evidence(db_session, status="approved")
    await _link_evidence_control(db_session, evd.id, ctl.id)

    await refresh_control_effectiveness(db_session, ctl.id)

    assert ctl.status == "deactivated"


async def test_locked_control_ineffective_is_not_changed(db_session: AsyncSession):
    system = await _system(db_session)
    ctl = await _control(db_session, system, status="ineffective")
    evd = await _evidence(db_session, status="approved")
    await _link_evidence_control(db_session, evd.id, ctl.id)

    await refresh_control_effectiveness(db_session, ctl.id)

    assert ctl.status == "ineffective"


async def test_missing_control_is_silently_ignored(db_session: AsyncSession):
    # Should not raise
    await refresh_control_effectiveness(db_session, "CTL-DOES-NOT-EXIST")


# ---------------------------------------------------------------------------
# refresh_obligation
# ---------------------------------------------------------------------------

async def test_all_effective_controls_fulfill_obligation(db_session: AsyncSession):
    system = await _system(db_session)
    ass = await _assessment(db_session, system)
    obl = await _obligation(db_session, ass)
    ctl = await _control(db_session, system, status="effective")
    await _link_control_obligation(db_session, ctl.id, obl.id)

    await refresh_obligation(db_session, obl.id)

    assert obl.status == "fulfilled"


async def test_mixed_control_statuses_set_obligation_in_progress(db_session: AsyncSession):
    system = await _system(db_session)
    ass = await _assessment(db_session, system)
    obl = await _obligation(db_session, ass)
    ctl1 = await _control(db_session, system, status="effective")
    ctl2 = await _control(db_session, system, status="implemented")
    await _link_control_obligation(db_session, ctl1.id, obl.id)
    await _link_control_obligation(db_session, ctl2.id, obl.id)

    await refresh_obligation(db_session, obl.id)

    assert obl.status == "in_progress"


async def test_no_controls_reverts_obligation_to_applicable(db_session: AsyncSession):
    system = await _system(db_session)
    ass = await _assessment(db_session, system)
    obl = await _obligation(db_session, ass, status="in_progress")

    await refresh_obligation(db_session, obl.id)

    assert obl.status == "applicable"


async def test_locked_not_applicable_obligation_not_changed(db_session: AsyncSession):
    system = await _system(db_session)
    ass = await _assessment(db_session, system)
    obl = await _obligation(db_session, ass, status="not_applicable")
    ctl = await _control(db_session, system, status="effective")
    await _link_control_obligation(db_session, ctl.id, obl.id)

    await refresh_obligation(db_session, obl.id)

    assert obl.status == "not_applicable"


async def test_locked_overdue_obligation_not_changed(db_session: AsyncSession):
    system = await _system(db_session)
    ass = await _assessment(db_session, system)
    obl = await _obligation(db_session, ass, status="overdue")
    ctl = await _control(db_session, system, status="effective")
    await _link_control_obligation(db_session, ctl.id, obl.id)

    await refresh_obligation(db_session, obl.id)

    assert obl.status == "overdue"


# ---------------------------------------------------------------------------
# refresh_assessment_score
# ---------------------------------------------------------------------------

async def test_score_is_none_when_all_obligations_not_applicable(db_session: AsyncSession):
    system = await _system(db_session)
    ass = await _assessment(db_session, system)
    await _obligation(db_session, ass, status="not_applicable")
    await _obligation(db_session, ass, status="not_applicable")

    await refresh_assessment_score(db_session, ass.id)

    assert ass.score is None


async def test_score_is_zero_when_no_obligations_fulfilled(db_session: AsyncSession):
    system = await _system(db_session)
    ass = await _assessment(db_session, system)
    await _obligation(db_session, ass, status="applicable")
    await _obligation(db_session, ass, status="in_progress")

    await refresh_assessment_score(db_session, ass.id)

    assert ass.score == 0.0


async def test_score_is_100_when_all_fulfilled(db_session: AsyncSession):
    system = await _system(db_session)
    ass = await _assessment(db_session, system)
    await _obligation(db_session, ass, status="fulfilled")
    await _obligation(db_session, ass, status="fulfilled")

    await refresh_assessment_score(db_session, ass.id)

    assert ass.score == 100.0


async def test_score_excludes_not_applicable_from_denominator(db_session: AsyncSession):
    system = await _system(db_session)
    ass = await _assessment(db_session, system)
    await _obligation(db_session, ass, status="fulfilled")
    await _obligation(db_session, ass, status="not_applicable")

    await refresh_assessment_score(db_session, ass.id)

    # 1 fulfilled / 1 applicable = 100%
    assert ass.score == 100.0


async def test_score_is_50_for_half_fulfilled(db_session: AsyncSession):
    system = await _system(db_session)
    ass = await _assessment(db_session, system)
    await _obligation(db_session, ass, status="fulfilled")
    await _obligation(db_session, ass, status="applicable")

    await refresh_assessment_score(db_session, ass.id)

    assert ass.score == 50.0


async def test_missing_assessment_is_silently_ignored(db_session: AsyncSession):
    await refresh_assessment_score(db_session, "ASS-DOES-NOT-EXIST")


# ---------------------------------------------------------------------------
# sync_system_compliance
# ---------------------------------------------------------------------------

async def test_sync_compliance_averages_approved_assessments(db_session: AsyncSession):
    system = await _system(db_session)

    ass1 = await _assessment(db_session, system)
    ass1.status = "approved"
    ass1.score = 80.0

    ass2 = await _assessment(db_session, system)
    ass2.status = "approved"
    ass2.score = 60.0

    await db_session.flush()
    await sync_system_compliance(db_session, system.id)

    assert system.compliance == 70.0


async def test_sync_compliance_ignores_non_approved_assessments(db_session: AsyncSession):
    system = await _system(db_session)

    ass1 = await _assessment(db_session, system)
    ass1.status = "approved"
    ass1.score = 80.0

    ass2 = await _assessment(db_session, system)
    ass2.status = "draft"
    ass2.score = 20.0

    await db_session.flush()
    await sync_system_compliance(db_session, system.id)

    assert system.compliance == 80.0


async def test_sync_compliance_is_zero_with_no_approved_assessments(db_session: AsyncSession):
    system = await _system(db_session)
    system.compliance = 99.0  # stale value
    await db_session.flush()

    await sync_system_compliance(db_session, system.id)

    assert system.compliance == 0.0


async def test_sync_compliance_ignores_null_scores(db_session: AsyncSession):
    system = await _system(db_session)

    ass1 = await _assessment(db_session, system)
    ass1.status = "approved"
    ass1.score = 60.0

    ass2 = await _assessment(db_session, system)
    ass2.status = "approved"
    ass2.score = None  # all obligations were not_applicable

    await db_session.flush()
    await sync_system_compliance(db_session, system.id)

    assert system.compliance == 60.0


# ---------------------------------------------------------------------------
# refresh_obligations_for_control
# ---------------------------------------------------------------------------

async def test_refresh_obligations_for_control_updates_all_linked(db_session: AsyncSession):
    system = await _system(db_session)
    ass = await _assessment(db_session, system)
    obl1 = await _obligation(db_session, ass)
    obl2 = await _obligation(db_session, ass)
    ctl = await _control(db_session, system, status="effective")
    await _link_control_obligation(db_session, ctl.id, obl1.id)
    await _link_control_obligation(db_session, ctl.id, obl2.id)

    await refresh_obligations_for_control(db_session, ctl.id)

    assert obl1.status == "fulfilled"
    assert obl2.status == "fulfilled"
