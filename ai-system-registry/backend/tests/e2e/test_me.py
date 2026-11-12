"""E2E tests for the Landing Zone per-user feeds (post-#358 single-page flow).

GET /v1/me/open-tasks — two sources:
  * `assigned` — a `question_states` row assigned to the user and not yet
    confirmed.
  * `review`   — a system in `pending_review`, shown to the assigned CO or, if
    none is assigned, to any approver (`systems:approve`).
GET /v1/me/systems — AI systems the current user owns (`business_owners`).

Data is seeded directly via the ORM so arbitrary states can be built without
walking the assessment flow. The acting user is the
`x-forwarded-preferred-username` header; the permission dependency is bypassed
by the e2e conftest.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.assessment import Assessment
from ai_trust_persistence.models.framework import Framework
from ai_trust_persistence.models.question_state import QuestionState

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
# GET /v1/me/open-tasks — assigned source (question_states)
# ---------------------------------------------------------------------------


async def _seed_question(
    *,
    system_id: str,
    assessment_id: str,
    qstate_id: str,
    question_key: str,
    assignee: str | None,
    confirmed: bool = False,
    system_kwargs: dict | None = None,
) -> None:
    fid = await _ensure_framework()
    await _add(_sys(id=system_id, business_owners=_OWNER, **(system_kwargs or {})))
    await _add(
        Assessment(
            id=assessment_id,
            ai_system_id=system_id,
            framework_id=fid,
            title="Cycle",
        )
    )
    await _add(
        QuestionState(
            id=qstate_id,
            assessment_id=assessment_id,
            system_id=system_id,
            question_key=question_key,
            assignee_username=assignee,
            assigned_by_username=_OWNER,
            assigned_at=datetime.now(timezone.utc),
            confirmed_at=datetime.now(timezone.utc) if confirmed else None,
        )
    )


async def test_open_tasks_assigned_unconfirmed(client: httpx.AsyncClient):
    await _seed_question(
        system_id="SYS-ASG00001",
        assessment_id="ASS-ASG00001",
        qstate_id="QST-ASG00001",
        question_key="model_nature",
        assignee=_DELEGATE,
    )
    r = await client.get("/v1/me/open-tasks", headers=_hdr(_DELEGATE))
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["source"] == "assigned"
    assert rows[0]["question_key"] == "model_nature"
    assert rows[0]["assignment_id"] == "QST-ASG00001"
    assert rows[0]["system_id"] == "SYS-ASG00001"
    assert rows[0]["owner_username"] == _OWNER


async def test_open_tasks_assigned_excludes_confirmed(client: httpx.AsyncClient):
    await _seed_question(
        system_id="SYS-CNF00001",
        assessment_id="ASS-CNF00001",
        qstate_id="QST-CNF00001",
        question_key="model_nature",
        assignee=_DELEGATE,
        confirmed=True,
    )
    r = await client.get("/v1/me/open-tasks", headers=_hdr(_DELEGATE))
    assert r.status_code == 200
    assert r.json() == []


async def test_open_tasks_assigned_only_for_assignee(client: httpx.AsyncClient):
    await _seed_question(
        system_id="SYS-ASG00002",
        assessment_id="ASS-ASG00002",
        qstate_id="QST-ASG00002",
        question_key="model_nature",
        assignee=_DELEGATE,
    )
    # A different user sees nothing.
    r = await client.get("/v1/me/open-tasks", headers=_hdr(_OTHER))
    assert r.status_code == 200
    assert r.json() == []


# ---------------------------------------------------------------------------
# GET /v1/me/open-tasks — review source (pending_review)
# ---------------------------------------------------------------------------


async def test_open_tasks_review_for_officer(client: httpx.AsyncClient):
    await _add(
        _sys(
            id="SYS-REV00001",
            compliance_officer_username=_OFFICER,
            workflow_status="pending_review",
            tier="high",
            is_chatbot=True,
        )
    )
    r = await client.get("/v1/me/open-tasks", headers=_hdr(_OFFICER))
    assert r.status_code == 200
    review = [t for t in r.json() if t["source"] == "review"]
    assert len(review) == 1
    assert review[0]["system_id"] == "SYS-REV00001"
    assert review[0]["tier"] == "high"
    assert review[0]["is_chatbot"] is True


async def test_open_tasks_review_excludes_non_pending_review(
    client: httpx.AsyncClient,
):
    await _add(
        _sys(
            id="SYS-REV00002",
            compliance_officer_username=_OFFICER,
            workflow_status="approved",
        )
    )
    r = await client.get("/v1/me/open-tasks", headers=_hdr(_OFFICER))
    assert r.status_code == 200
    assert [t for t in r.json() if t["source"] == "review"] == []


async def test_open_tasks_empty_for_unrelated_user(client: httpx.AsyncClient):
    await _add(
        _sys(
            id="SYS-REV00003",
            compliance_officer_username=_OFFICER,
            workflow_status="pending_review",
        )
    )
    r = await client.get("/v1/me/open-tasks", headers=_hdr(_OTHER))
    assert r.status_code == 200
    assert r.json() == []


async def test_open_tasks_review_unassigned_visible_to_approver(
    client: httpx.AsyncClient,
):
    """A submitted assessment with NO CO assigned surfaces to every approver.

    The single-page submit flow does not assign a specific CO, so the review
    must be visible to any ``systems:approve`` holder — mirroring
    issue_classification, which lets any approver issue when the CO field is
    empty. (In e2e the OpenFGA check is mocked to always-allow, so the acting
    user counts as an approver.)
    """
    await _add(
        _sys(
            id="SYS-REV00004",
            compliance_officer_username=None,
            workflow_status="pending_review",
            tier="high",
        )
    )
    r = await client.get("/v1/me/open-tasks", headers=_hdr(_OTHER))
    assert r.status_code == 200
    review = [t for t in r.json() if t["source"] == "review"]
    assert len(review) == 1
    assert review[0]["system_id"] == "SYS-REV00004"


async def test_open_tasks_review_unassigned_hidden_from_non_approver(
    client: httpx.AsyncClient, monkeypatch
):
    """An unassigned review is hidden from a user who cannot approve.

    Flip the OpenFGA check so ``systems:approve`` (can_approve_systems) is
    denied while ``systems:read`` (the endpoint's own gate) still passes.
    """
    import ai_trust_authorization.openfga_client as _fga

    async def _co_read_only(_user: str, relation: str, _obj: str) -> bool:
        return relation != "can_approve_systems"

    monkeypatch.setattr(_fga, "check", _co_read_only)

    await _add(
        _sys(
            id="SYS-REV00005",
            compliance_officer_username=None,
            workflow_status="pending_review",
        )
    )
    r = await client.get("/v1/me/open-tasks", headers=_hdr(_OTHER))
    assert r.status_code == 200
    assert [t for t in r.json() if t["source"] == "review"] == []
