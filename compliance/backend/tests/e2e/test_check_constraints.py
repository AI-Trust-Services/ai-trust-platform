"""Verify that DB-level CHECK constraints reject invalid status/tier/lifecycle values.

These tests bypass the Pydantic API layer and write directly to the DB via
SQLAlchemy, confirming the constraints fire at the storage layer regardless
of what the application does.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.e2e.conftest import _test_engine, create_system
from app.ids import new_id


async def _insert_raw(table: str, **values) -> None:
    cols = ", ".join(values)
    placeholders = ", ".join(f":{k}" for k in values)
    async with AsyncSession(_test_engine) as session:
        await session.execute(
            text(f"INSERT INTO {table} ({cols}) VALUES ({placeholders})"),
            values,
        )
        await session.commit()


# ---------------------------------------------------------------------------
# assessments.status
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_invalid_assessment_status_rejected():
    system = await create_system()
    with pytest.raises(IntegrityError, match="ck_assessments_status"):
        await _insert_raw(
            "assessments",
            id=new_id("ASS"),
            ai_system_id=system["id"],
            framework_id="FRM-EU-AI-ACT",
            title="Bad Status",
            type="compliance",
            status="pending",   # not in the allowed set
            notes="",
        )


@pytest.mark.asyncio
async def test_valid_assessment_statuses_accepted():
    system = await create_system()
    for status in ("draft", "submitted", "under_review", "approved"):
        await _insert_raw(
            "assessments",
            id=new_id("ASS"),
            ai_system_id=system["id"],
            framework_id="FRM-EU-AI-ACT",
            title=f"Assessment {status}",
            type="compliance",
            status=status,
            notes="",
        )


# ---------------------------------------------------------------------------
# obligations.status
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_invalid_obligation_status_rejected():
    system = await create_system()
    async with AsyncSession(_test_engine) as session:
        await session.execute(
            text(
                "INSERT INTO assessments (id, ai_system_id, framework_id, title, type, status, notes) "
                "VALUES (:id, :sys, 'FRM-EU-AI-ACT', 'A', 'compliance', 'draft', '')"
            ),
            {"id": (ass_id := new_id("ASS")), "sys": system["id"]},
        )
        await session.commit()

    with pytest.raises(IntegrityError, match="ck_obligations_status"):
        await _insert_raw(
            "obligations",
            id=new_id("OBL"),
            assessment_id=ass_id,
            ai_system_id=system["id"],
            framework_id="FRM-EU-AI-ACT",
            title="Bad Obligation",
            article_ref="",
            description="",
            status="open",   # not in the allowed set
            owner="",
        )


# ---------------------------------------------------------------------------
# controls.status
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_invalid_control_status_rejected():
    system = await create_system()
    with pytest.raises(IntegrityError, match="ck_controls_status"):
        await _insert_raw(
            "controls",
            id=new_id("CTL"),
            ai_system_id=system["id"],
            title="Bad Control",
            description="",
            category="general",
            status="broken",   # not in the allowed set
            effectiveness="",
            owner="",
        )


# ---------------------------------------------------------------------------
# evidence.status
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_invalid_evidence_status_rejected():
    system = await create_system()
    with pytest.raises(IntegrityError, match="ck_evidence_status"):
        await _insert_raw(
            "evidence",
            id=new_id("EVD"),
            ai_system_id=system["id"],
            title="Bad Evidence",
            evidence_type="document",
            status="in_review",   # not in the allowed set
            uploaded_by="",
            file_name="",
            file_path="",
            file_size=0,
            version_label="v1",
        )


# ---------------------------------------------------------------------------
# ai_systems.tier
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_invalid_tier_rejected():
    with pytest.raises(IntegrityError, match="ck_ai_systems_tier"):
        await create_system(tier="unknown_tier")


@pytest.mark.asyncio
async def test_valid_tiers_accepted():
    for tier in ("prohibited", "gpai-systemic", "gpai-standard", "high", "limited", "minimal"):
        await create_system(tier=tier)


# ---------------------------------------------------------------------------
# ai_systems.lifecycle
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_invalid_lifecycle_rejected():
    with pytest.raises(IntegrityError, match="ck_ai_systems_lifecycle"):
        await create_system(lifecycle="production")  # not allowed — use 'market'


@pytest.mark.asyncio
async def test_valid_lifecycles_accepted():
    for lifecycle in ("development", "testing", "conformity", "market", "post-market", "decommissioned"):
        await create_system(lifecycle=lifecycle)
