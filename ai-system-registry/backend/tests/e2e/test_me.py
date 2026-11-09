"""E2E tests for the Landing Zone per-user feeds.

GET /v1/me/open-tasks — required / assigned / review rows for the current user.
GET /v1/me/systems    — AI systems the current user owns.

Data is seeded directly via the ORM (SessionLocal) so arbitrary workflow
states, assignees and assignments can be constructed without walking the full
workflow state machine. The acting user is the ``x-forwarded-preferred-username``
header; the permission dependency is bypassed by the e2e conftest.
"""

from __future__ import annotations

import uuid

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.assessment import Assessment
from ai_trust_persistence.models.framework import Framework
from ai_trust_persistence.models.question_assignment import QuestionAssignment

_OWNER = "owner1"
_DELEGATE = "delegate1"
_OFFICER = "officer1"
_OTHER = "other1"


def _hdr(user: str) -> dict:
    return {"x-forwarded-preferred-username": user}


def _sys(**kwargs) -> AISystem:
    defaults = dict(
        id=f"SYS-{uuid.uuid4().hex[:8].upper()}",
        name="Test System",
        tier="high",
        lifecycle="development",
        compliance=0.0,
        workflow_status="draft",
        registration_mode="ai",
    )
    return AISystem(**{**defaults, **kwargs})


async def _add(*objs) -> None:
    async with SessionLocal() as session:
        for o in objs:
            session.add(o)
        await session.commit()


async def _ensure_framework(fid: str = "FRM-TEST") -> str:
    """Idempotently insert a framework (not truncated between tests)."""
    async with SessionLocal() as session:
        await session.execute(
            pg_insert(Framework)
            .values(id=fid, name="EU AI Act")
            .on_conflict_do_nothing(index_elements=["id"])
        )
        await session.commit()
    return fid


# ---------------------------------------------------------------------------
# GET /v1/me/systems
# ---------------------------------------------------------------------------


async def test_my_systems_lists_only_owned(client: httpx.AsyncClient):
    await _add(
        _sys(id="SYS-OWN00001", business_owners=_OWNER),
        _sys(id="SYS-OTH00001", business_owners=_OTHER),
    )
    r = await client.get("/v1/me/systems", headers=_hdr(_OWNER))
    assert r.status_code == 200
    assert [row["id"] for row in r.json()] == ["SYS-OWN00001"]


async def test_my_systems_empty_for_non_owner(client: httpx.AsyncClient):
    await _add(_sys(business_owners=_OWNER))
    r = await client.get("/v1/me/systems", headers=_hdr(_OTHER))
    assert r.status_code == 200
    assert r.json() == []


# ---------------------------------------------------------------------------
# GET /v1/me/open-tasks — required source
# ---------------------------------------------------------------------------


async def test_open_tasks_required_business(client: httpx.AsyncClient):
    await _add(
        _sys(
            id="SYS-REQ00001",
            business_assignee_username=_OWNER,
            workflow_status="business_pending",
        )
    )
    r = await client.get("/v1/me/open-tasks", headers=_hdr(_OWNER))
    assert r.status_code == 200
    rows = r.json()
    assert rows, "expected required business tasks for the section assignee"
    assert all(t["source"] == "required" and t["section"] == "business" for t in rows)
    # Every required business key is unanswered on a fresh system.
    assert "submission_type" in {t["question_key"] for t in rows}


async def test_open_tasks_empty_for_unrelated_user(client: httpx.AsyncClient):
    await _add(
        _sys(business_assignee_username=_OWNER, workflow_status="business_pending")
    )
    r = await client.get("/v1/me/open-tasks", headers=_hdr(_OTHER))
    assert r.status_code == 200
    assert r.json() == []


async def test_open_tasks_suppresses_delegated_key_for_owner(
    client: httpx.AsyncClient,
):
    """A key delegated to a per-question assignee must not surface as a
    *required* task for the section owner (it would point to a locked field);
    it surfaces instead as an *assigned* task for the delegate."""
    sysid = "SYS-DEL00001"
    await _add(
        _sys(
            id=sysid,
            business_assignee_username=_OWNER,
            workflow_status="business_pending",
        ),
        QuestionAssignment(
            id="QAS-DEL00001",
            system_id=sysid,
            section="business",
            question_key="submission_type",
            assignee_username=_DELEGATE,
            assigned_by_username=_OWNER,
        ),
    )

    owner_rows = (await client.get("/v1/me/open-tasks", headers=_hdr(_OWNER))).json()
    owner_keys = {t["question_key"] for t in owner_rows}
    assert "submission_type" not in owner_keys  # delegated → suppressed
    assert "use_case_owner" in owner_keys  # still required for the owner

    delegate_rows = (
        await client.get("/v1/me/open-tasks", headers=_hdr(_DELEGATE))
    ).json()
    assert [(t["source"], t["question_key"]) for t in delegate_rows] == [
        ("assigned", "submission_type")
    ]


async def test_open_tasks_ignores_assignment_in_inactive_section(
    client: httpx.AsyncClient,
):
    """A delegate's assignment for a section the workflow has moved past is
    unactionable and must not surface."""
    sysid = "SYS-INACT001"
    await _add(
        # Active section is business, but the assignment targets technical.
        _sys(id=sysid, workflow_status="business_pending"),
        QuestionAssignment(
            id="QAS-INACT01",
            system_id=sysid,
            section="technical",
            question_key="model_nature",
            assignee_username=_DELEGATE,
            assigned_by_username=_OWNER,
        ),
    )
    r = await client.get("/v1/me/open-tasks", headers=_hdr(_DELEGATE))
    assert r.status_code == 200
    assert r.json() == []


# ---------------------------------------------------------------------------
# GET /v1/me/open-tasks — review source
# ---------------------------------------------------------------------------


async def test_open_tasks_review_for_compliance_officer(client: httpx.AsyncClient):
    fid = await _ensure_framework()
    sysid = "SYS-REV00001"
    await _add(
        _sys(
            id=sysid,
            compliance_officer_username=_OFFICER,
            tier="high",
            is_chatbot=True,
        )
    )
    await _add(
        Assessment(
            id="ASS-REV00001",
            ai_system_id=sysid,
            framework_id=fid,
            title="Q3 Review",
            status="pending_review",
        )
    )
    r = await client.get("/v1/me/open-tasks", headers=_hdr(_OFFICER))
    assert r.status_code == 200
    review = [t for t in r.json() if t["source"] == "review"]
    assert len(review) == 1
    row = review[0]
    assert row["assignment_id"] == "ASS-REV00001"  # overloaded with assessment id
    assert row["tier"] == "high"
    assert row["is_chatbot"] is True


async def test_open_tasks_review_excludes_approved_assessment(
    client: httpx.AsyncClient,
):
    fid = await _ensure_framework()
    sysid = "SYS-REV00002"
    await _add(_sys(id=sysid, compliance_officer_username=_OFFICER))
    await _add(
        Assessment(
            id="ASS-REV00002",
            ai_system_id=sysid,
            framework_id=fid,
            title="Done",
            status="approved",
        )
    )
    r = await client.get("/v1/me/open-tasks", headers=_hdr(_OFFICER))
    assert r.status_code == 200
    assert [t for t in r.json() if t["source"] == "review"] == []
