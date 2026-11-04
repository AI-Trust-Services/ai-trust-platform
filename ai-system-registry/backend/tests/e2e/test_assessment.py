"""E2E tests for the single-page EU AI Act assessment flow.

Covers the owner flow (#346/#314): open/prefill, per-question state, the
mandatory-comment-on-change confirm gate, edit-gating for contributors, the
finalize/submit all-confirmed gates, comment soft-delete permissions, and
assignment. The acting user is read from ``x-forwarded-preferred-username``.

Runs in stub LLM mode (THALAMUS_BASE_URL unset → stub), so /open produces
deterministic per-question answers + confidence bands.
"""

from __future__ import annotations

import httpx
import pytest

_OWNER = "owner1"
_CONTRIB = "contrib1"


def _hdr(user: str) -> dict:
    return {"x-forwarded-preferred-username": user}


async def _create_system(client: httpx.AsyncClient, owner: str = _OWNER) -> str:
    """Register an AI-mode system owned by ``owner`` (intake sets business_owners
    to the acting user)."""
    r = await client.post(
        "/v1/intake",
        json={"name": "Assessment System", "registration_mode": "ai"},
        headers=_hdr(owner),
    )
    assert r.status_code == 201, r.text
    return r.json()["system"]["id"]


async def _open(client: httpx.AsyncClient, system_id: str, user: str = _OWNER):
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/open", headers=_hdr(user)
    )
    assert r.status_code == 200, r.text
    return r.json()


# ── open / prefill ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_open_prefills_and_classifies(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    state = await _open(client, system_id)

    assert state["prefilled"] is True
    assert state["tier"]  # classification ran
    # Every catalogue question has a state entry.
    assert len(state["questions"]) >= 1
    # Confidence counts sum to the number of questions with a band.
    counts = state["confidence_counts"]
    assert counts["high"] + counts["medium"] + counts["low"] == len(state["questions"])
    # The stub leaves a few low-confidence/empty → attention count is non-zero.
    assert state["attention_count"] >= 1
    # No question is confirmed yet.
    assert all(not q["confirmed"] for q in state["questions"])


@pytest.mark.asyncio
async def test_prefill_choice_answers_are_valid_options(client: httpx.AsyncClient):
    """A select/boolean question must be prefilled with one of its exact option
    strings, so the frontend's exact-match radios select it (the bug: the model
    returned free-text prose that matched no option)."""
    from app.assessment_catalogue import QUESTION_OPTIONS

    system_id = await _create_system(client)
    state = await _open(client, system_id)
    by_key = {q["question_key"]: q for q in state["questions"]}
    for key, options in QUESTION_OPTIONS.items():
        q = by_key.get(key)
        assert q is not None, f"{key} missing from assessment state"
        # Either a valid option verbatim, or empty (documents didn't support one).
        assert q["answer"] in options or q["answer"] in ("", None), (
            f"{key} prefilled with {q['answer']!r}, not one of {options}"
        )


@pytest.mark.asyncio
async def test_open_is_idempotent(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    first = await _open(client, system_id)
    # Confirm one question, then re-open: state must be preserved (not re-prefilled).
    qkey = first["questions"][0]["question_key"]
    # Give it a comment-free confirm path: it's an AI-prefilled answer (unchanged).
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/confirm",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    second = await _open(client, system_id)
    confirmed = {q["question_key"]: q["confirmed"] for q in second["questions"]}
    assert confirmed[qkey] is True


# ── mandatory-comment-on-change confirm gate ─────────────────────────────────


@pytest.mark.asyncio
async def test_confirm_unchanged_ai_answer_needs_no_comment(
    client: httpx.AsyncClient,
):
    system_id = await _create_system(client)
    state = await _open(client, system_id)
    # Pick a high-confidence (non-empty) AI-prefilled question.
    qkey = next(
        q["question_key"]
        for q in state["questions"]
        if q["answer_source"] == "ai_prefilled" and q["answer"]
    )
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/confirm",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    assert r.json()["confirmed"] is True


@pytest.mark.asyncio
async def test_confirm_changed_answer_blocked_without_comment(
    client: httpx.AsyncClient,
):
    system_id = await _create_system(client)
    state = await _open(client, system_id)
    qkey = next(q["question_key"] for q in state["questions"] if q["answer"])
    # Change the AI answer.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/answer",
        json={"answer": "Owner-edited answer differing from the AI proposal."},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    assert r.json()["answer_source"] == "manual"
    # Confirm must be rejected (no comment yet).
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/confirm",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 422, r.text

    # Add a comment, then confirm succeeds.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/comments",
        json={"body": "Changed because the document was out of date."},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/confirm",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text


# ── edit-gating ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_contributor_cannot_edit_unassigned_question(
    client: httpx.AsyncClient,
):
    system_id = await _create_system(client, owner=_OWNER)
    state = await _open(client, system_id)
    qkey = state["questions"][0]["question_key"]
    # A non-owner, non-assignee contributor may not save an answer.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/answer",
        json={"answer": "intruder edit"},
        headers=_hdr(_CONTRIB),
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_assigned_contributor_can_edit(client: httpx.AsyncClient):
    system_id = await _create_system(client, owner=_OWNER)
    state = await _open(client, system_id)
    qkey = state["questions"][0]["question_key"]
    # Owner assigns the question to the contributor.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/assign",
        json={"assignee_username": _CONTRIB},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    assert r.json()["assignee_username"] == _CONTRIB
    # Now the contributor may edit it.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/answer",
        json={"answer": "contributor's answer"},
        headers=_hdr(_CONTRIB),
    )
    assert r.status_code == 200, r.text


# ── comments: soft-delete permissions ────────────────────────────────────────


@pytest.mark.asyncio
async def test_author_can_delete_own_comment_owner_can_delete_any(
    client: httpx.AsyncClient,
):
    system_id = await _create_system(client, owner=_OWNER)
    state = await _open(client, system_id)
    qkey = state["questions"][0]["question_key"]
    # Owner assigns to contributor so the contributor can comment on it.
    await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/assign",
        json={"assignee_username": _CONTRIB},
        headers=_hdr(_OWNER),
    )
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/comments",
        json={"body": "contributor comment"},
        headers=_hdr(_CONTRIB),
    )
    cid = r.json()["id"]
    # A different non-owner may not delete it.
    r = await client.request(
        "DELETE",
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/comments/{cid}",
        headers=_hdr("someone-else"),
    )
    assert r.status_code == 403, r.text
    # The owner may delete any comment.
    r = await client.request(
        "DELETE",
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/comments/{cid}",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 204, r.text
    # It no longer appears in the thread.
    r = await client.get(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/comments",
        headers=_hdr(_OWNER),
    )
    assert all(c["id"] != cid for c in r.json())


# ── finalize / submit gates ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_finalize_blocked_until_all_confirmed(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    await _open(client, system_id)
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/finalize", headers=_hdr(_OWNER)
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_submit_after_confirming_all(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    state = await _open(client, system_id)
    # Confirm every question. For changed answers we'd need comments, but all are
    # AI-prefilled & unchanged here, so confirm is comment-free.
    for q in state["questions"]:
        r = await client.post(
            f"/v1/systems/{system_id}/assessment/questions/{q['question_key']}/confirm",
            headers=_hdr(_OWNER),
        )
        assert r.status_code == 200, r.text
    # Finalize now passes.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/finalize", headers=_hdr(_OWNER)
    )
    assert r.status_code == 200, r.text
    # Submit transitions to pending_review.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/submit",
        json={"note": "ready for review"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    assert r.json()["workflow_status"] == "pending_review"


@pytest.mark.asyncio
async def test_reedit_confirmed_question_reverts_to_incomplete(
    client: httpx.AsyncClient,
):
    system_id = await _create_system(client)
    state = await _open(client, system_id)
    qkey = next(
        q["question_key"]
        for q in state["questions"]
        if q["answer_source"] == "ai_prefilled" and q["answer"]
    )
    # Confirm it.
    await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/confirm",
        headers=_hdr(_OWNER),
    )
    # Re-edit (change away from the AI value) → source manual + unconfirmed.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/answer",
        json={"answer": "a different, manually edited answer"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    assert r.json()["confirmed"] is False


# ── iteration 2 (#347): owner-confirm, locked read-only, compliance sync ─────


async def _confirm_all_as_owner(client: httpx.AsyncClient, system_id: str, state: dict):
    for q in state["questions"]:
        r = await client.post(
            f"/v1/systems/{system_id}/assessment/questions/{q['question_key']}/confirm",
            headers=_hdr(_OWNER),
        )
        assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_contributor_confirm_does_not_satisfy_submit_gate(
    client: httpx.AsyncClient,
):
    """A contributor confirming their assigned question is progress only — the
    owner must personally confirm every question before finalize/submit."""
    system_id = await _create_system(client, owner=_OWNER)
    state = await _open(client, system_id)
    qkey = state["questions"][0]["question_key"]
    # Owner assigns q0 to the contributor; owner confirms everything else.
    await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/assign",
        json={"assignee_username": _CONTRIB},
        headers=_hdr(_OWNER),
    )
    for q in state["questions"][1:]:
        await client.post(
            f"/v1/systems/{system_id}/assessment/questions/{q['question_key']}/confirm",
            headers=_hdr(_OWNER),
        )
    # Contributor confirms their assigned q0.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/confirm",
        headers=_hdr(_CONTRIB),
    )
    assert r.status_code == 200, r.text
    # q0 is 'confirmed' but NOT owner_confirmed → finalize blocked.
    st = await client.get(
        f"/v1/systems/{system_id}/assessment/state", headers=_hdr(_OWNER)
    )
    q0 = next(q for q in st.json()["questions"] if q["question_key"] == qkey)
    assert q0["confirmed"] is True
    assert q0["owner_confirmed"] is False
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/finalize", headers=_hdr(_OWNER)
    )
    assert r.status_code == 422, r.text
    # Owner personally confirms q0 → finalize passes.
    await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/confirm",
        headers=_hdr(_OWNER),
    )
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/finalize", headers=_hdr(_OWNER)
    )
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_locked_assessment_is_read_only(client: httpx.AsyncClient):
    """After submit the assessment is locked: editable=false and edits 409."""
    system_id = await _create_system(client)
    state = await _open(client, system_id)
    assert state["editable"] is True
    await _confirm_all_as_owner(client, system_id, state)
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/submit",
        json={"note": "done"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    locked = r.json()
    assert locked["editable"] is False
    assert locked["status_label"] == "locked"
    # Any edit now 409s.
    qkey = state["questions"][0]["question_key"]
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/answer",
        json={"answer": "post-lock edit"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 409, r.text
    # state read still works and reports editable=false + per-question can_edit=false.
    st = await client.get(
        f"/v1/systems/{system_id}/assessment/state", headers=_hdr(_OWNER)
    )
    assert st.json()["editable"] is False
    assert all(not q["can_edit"] for q in st.json()["questions"])


@pytest.mark.asyncio
async def test_submit_advances_compliance_assessment_status(
    client: httpx.AsyncClient,
):
    """/submit atomically advances the compliance Assessment row (owner's tab)."""
    from ai_trust_persistence.database import engine
    from ai_trust_persistence.models.assessment import Assessment
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession

    system_id = await _create_system(client)
    state = await _open(client, system_id)

    # Seed a current compliance Assessment row in questionnaire_pending.
    async with AsyncSession(engine) as s:
        s.add(
            Assessment(
                id="ASS-TEST0001",
                ai_system_id=system_id,
                framework_id="FRM-EU-AI-ACT",
                title="EU AI Act Assessment",
                status="questionnaire_pending",
            )
        )
        await s.commit()

    await _confirm_all_as_owner(client, system_id, state)
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/submit",
        json={"note": "done"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text

    async with AsyncSession(engine) as s:
        row = (
            await s.execute(select(Assessment).where(Assessment.id == "ASS-TEST0001"))
        ).scalar_one()
        assert row.status == "pending_review"


@pytest.mark.asyncio
async def test_can_edit_false_for_contributor_on_unassigned(
    client: httpx.AsyncClient,
):
    system_id = await _create_system(client, owner=_OWNER)
    await _open(client, system_id)
    st = await client.get(
        f"/v1/systems/{system_id}/assessment/state", headers=_hdr(_CONTRIB)
    )
    assert st.status_code == 200, st.text
    # A plain contributor is assigned nothing → can_edit false everywhere.
    assert all(not q["can_edit"] for q in st.json()["questions"])


# ── iteration 3 (#348): CO issue / reject ────────────────────────────────────

_CO = "officer1"


async def _submit_as_owner(client: httpx.AsyncClient) -> str:
    """Create, prefill, owner-confirm all, and submit — leaving the system in
    pending_review (locked, ready for the CO)."""
    system_id = await _create_system(client)
    state = await _open(client, system_id)
    await _confirm_all_as_owner(client, system_id, state)
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/submit",
        json={"note": "done"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    return system_id


@pytest.mark.asyncio
async def test_co_issue_sets_approved_and_immutable(client: httpx.AsyncClient):
    system_id = await _submit_as_owner(client)
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/issue",
        json={"tier": "high", "transparency": True, "confirmed": True},
        headers=_hdr(_CO),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tier"] == "high"
    assert body["workflow_status"] == "approved"
    assert body["editable"] is False
    # Immutable: the owner can no longer edit.
    qkey = body["questions"][0]["question_key"]
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/answer",
        json={"answer": "post-issue edit"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 409, r.text


@pytest.mark.asyncio
async def test_co_issue_requires_confirmation_checkbox(client: httpx.AsyncClient):
    system_id = await _submit_as_owner(client)
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/issue",
        json={"tier": "high", "confirmed": False},
        headers=_hdr(_CO),
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_co_transparency_only_with_high(client: httpx.AsyncClient):
    system_id = await _submit_as_owner(client)
    # transparency + a non-high tier is rejected (the combo rule).
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/issue",
        json={"tier": "minimal", "transparency": True, "confirmed": True},
        headers=_hdr(_CO),
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_co_issue_rejects_unissuable_tier(client: httpx.AsyncClient):
    system_id = await _submit_as_owner(client)
    # gpai-* tiers are not issuable by the CO (schema validation → 422).
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/issue",
        json={"tier": "gpai-systemic", "confirmed": True},
        headers=_hdr(_CO),
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_co_reject_returns_to_owner_editable_again(client: httpx.AsyncClient):
    system_id = await _submit_as_owner(client)
    # Reject requires a note.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/reject",
        json={"note": ""},
        headers=_hdr(_CO),
    )
    assert r.status_code == 422, r.text
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/reject",
        json={"note": "Please add evidence for question 3."},
        headers=_hdr(_CO),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["workflow_status"] == "returned"
    # Owner sees it as 'under_review' (label mapping) and can edit again.
    assert body["status_label"] == "under_review"
    assert body["editable"] is True
    st = await client.get(
        f"/v1/systems/{system_id}/assessment/state", headers=_hdr(_OWNER)
    )
    assert st.json()["editable"] is True


@pytest.mark.asyncio
async def test_co_cannot_issue_before_submit(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    await _open(client, system_id)
    # Not yet submitted (not pending_review) → 409.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/issue",
        json={"tier": "high", "confirmed": True},
        headers=_hdr(_CO),
    )
    assert r.status_code == 409, r.text
