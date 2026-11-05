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
    to the acting user). ``_CONTRIB`` is registered as a contributor so per-question
    assignment to them is valid (assign now rejects non-owner/non-contributor users)."""
    r = await client.post(
        "/v1/intake",
        json={
            "name": "Assessment System",
            "registration_mode": "ai",
            "contributors": [_CONTRIB],
        },
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
async def test_unknown_question_key_returns_422(client: httpx.AsyncClient):
    """An unknown question_key in the path is a client error (422), not a 500 —
    _validate_question_key raises HTTPException, not a bare ValueError."""
    system_id = await _create_system(client)
    await _open(client, system_id)
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/not_a_real_key/confirm",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 422, r.text
    """use_case / department are storage:"system" keys — editing them in the
    assessment must update the AISystem column (what every other consumer reads),
    not just the questionnaire_answers JSON."""
    system_id = await _create_system(client)
    await _open(client, system_id)
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/use_case/answer",
        json={"answer": "A detailed, owner-edited use-case description."},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    # The AISystem column reflects the edit (read via the system endpoint).
    sys_resp = await client.get(f"/v1/systems/{system_id}", headers=_hdr(_OWNER))
    assert sys_resp.status_code == 200, sys_resp.text
    assert (
        sys_resp.json()["use_case"] == "A detailed, owner-edited use-case description."
    )
    # And the assessment state reads it back from the column.
    state = await client.get(
        f"/v1/systems/{system_id}/assessment/state", headers=_hdr(_OWNER)
    )
    uc = next(q for q in state.json()["questions"] if q["question_key"] == "use_case")
    assert uc["answer"] == "A detailed, owner-edited use-case description."


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


@pytest.mark.asyncio
async def test_confirm_change_requires_comment_after_the_change(
    client: httpx.AsyncClient,
):
    """A comment that predates the change must NOT satisfy the gate — the comment
    has to be recorded at/after the answer change (audit of the override)."""
    system_id = await _create_system(client)
    state = await _open(client, system_id)
    qkey = next(q["question_key"] for q in state["questions"] if q["answer"])
    # A pre-existing comment, before any change.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/comments",
        json={"body": "Looks fine as prefilled."},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    # Now change the answer.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/answer",
        json={"answer": "Owner-edited value that differs from the AI proposal."},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    # Confirm must still be rejected: the only comment predates the change.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/confirm",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 422, r.text
    # A fresh comment (after the change) unblocks it.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/comments",
        json={"body": "Changed: the prefill missed the HR context."},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/confirm",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_revert_to_ai_original_clears_confirmation(client: httpx.AsyncClient):
    """Editing a confirmed answer back to the AI original is still a change, so it
    must clear the prior confirmation (not leave a stale owner-confirmed state)."""
    system_id = await _create_system(client)
    state = await _open(client, system_id)
    q = next(
        q
        for q in state["questions"]
        if q["answer"] and q["answer_source"] == "ai_prefilled"
    )
    qkey, original = q["question_key"], q["answer"]
    # Confirm the unchanged AI answer (no comment needed).
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/confirm",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    # Change it (manual), add a comment, confirm again.
    await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/answer",
        json={"answer": "A different, manually-entered value."},
        headers=_hdr(_OWNER),
    )
    await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/comments",
        json={"body": "Override rationale."},
        headers=_hdr(_OWNER),
    )
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/confirm",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    # Revert back to the exact AI original — a genuine change → confirmation clears.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/answer",
        json={"answer": original},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    assert r.json()["confirmed"] is False
    st = await client.get(
        f"/v1/systems/{system_id}/assessment/state", headers=_hdr(_OWNER)
    )
    q_now = next(x for x in st.json()["questions"] if x["question_key"] == qkey)
    assert q_now["confirmed"] is False
    assert q_now["owner_confirmed"] is False


@pytest.mark.asyncio
async def test_state_exposes_owner_username(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    state = await _open(client, system_id)
    assert state["owner_username"] == _OWNER


@pytest.mark.asyncio
async def test_attention_count_drops_when_owner_confirms(client: httpx.AsyncClient):
    """Confirming a flagged (low-confidence or empty) question removes it from the
    'N questions require your attention' count — confirmation, not just an answer,
    is what clears it (the question's confidence band stays 'low')."""
    system_id = await _create_system(client)
    state = await _open(client, system_id)
    before = state["attention_count"]
    assert before >= 1
    # Pick a flagged question. The stub leaves it empty/low-confidence; give it a
    # value + justifying comment so Confirm passes, then confirm it.
    target = next(q for q in state["questions"] if q["needs_attention"])
    qkey = target["question_key"]
    await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/answer",
        json={"answer": "Owner-supplied answer for a low-evidence question."},
        headers=_hdr(_OWNER),
    )
    await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/comments",
        json={"body": "Filled in from internal knowledge; docs lacked it."},
        headers=_hdr(_OWNER),
    )
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/confirm",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    st = await client.get(
        f"/v1/systems/{system_id}/assessment/state", headers=_hdr(_OWNER)
    )
    body = st.json()
    q_now = next(x for x in body["questions"] if x["question_key"] == qkey)
    assert q_now["needs_attention"] is False
    assert q_now["owner_confirmed"] is True
    assert body["attention_count"] == before - 1


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
    # /open creates the current compliance Assessment and scopes this cycle's
    # question_states to it — use that id (no manual seeding needed now that state
    # is per-assessment).
    assessment_id = state["assessment_id"]
    assert assessment_id

    await _confirm_all_as_owner(client, system_id, state)
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/submit",
        json={"note": "done"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text

    async with AsyncSession(engine) as s:
        row = (
            await s.execute(select(Assessment).where(Assessment.id == assessment_id))
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
    # Assign the compliance officer as the compliance "New Assessment" modal does
    # (→ /workflow/assign), so this helper exercises the assigned-CO path.
    r = await client.post(
        f"/v1/systems/{system_id}/workflow/assign",
        json={"compliance_officer_username": _CO},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
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


# ── review-feedback regression tests (PR #358 bot findings) ───────────────────


@pytest.mark.asyncio
async def test_assign_rejects_unregistered_username(client: httpx.AsyncClient):
    """Assignment must be the owner or a registered contributor (no arbitrary
    account delegation / notify spam)."""
    system_id = await _create_system(client)
    state = await _open(client, system_id)
    qkey = state["questions"][0]["question_key"]
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/assign",
        json={"assignee_username": "stranger99"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_non_assignee_cannot_comment(client: httpx.AsyncClient):
    """A contributor may not comment on a question that isn't assigned to them."""
    system_id = await _create_system(client)
    state = await _open(client, system_id)
    qkey = state["questions"][0]["question_key"]
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/comments",
        json={"body": "I shouldn't be able to post this"},
        headers=_hdr(_CONTRIB),
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_comment_delete_scoped_to_question(client: httpx.AsyncClient):
    """A comment id from another question on the same system must not be deletable
    through a mismatched question_key in the URL (→ 404, not a cross-question delete)."""
    system_id = await _create_system(client)
    state = await _open(client, system_id)
    q1 = state["questions"][0]["question_key"]
    q2 = state["questions"][1]["question_key"]
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{q1}/comments",
        json={"body": "comment on q1"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    comment_id = r.json()["id"]
    # Delete via the WRONG question's path → not found.
    r = await client.delete(
        f"/v1/systems/{system_id}/assessment/questions/{q2}/comments/{comment_id}",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 404, r.text
    # Correct path still works.
    r = await client.delete(
        f"/v1/systems/{system_id}/assessment/questions/{q1}/comments/{comment_id}",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 204, r.text


@pytest.mark.asyncio
async def test_assignment_and_comment_mutations_locked_after_submit(
    client: httpx.AsyncClient,
):
    """Once submitted (pending_review), assign/unassign/comment all 409 — the
    assessment is immutable per the documented locked UX."""
    system_id = await _submit_as_owner(client)
    qkey = (
        await client.get(f"/v1/systems/{system_id}/assessment/state", headers=_hdr(_CO))
    ).json()["questions"][0]["question_key"]
    # unassign
    r = await client.delete(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/assign",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 409, r.text
    # comment create
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/comments",
        json={"body": "late comment"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 409, r.text


@pytest.mark.asyncio
async def test_issue_without_assigned_co_allows_any_approver(client: httpx.AsyncClient):
    """Loose CO model (by design): when no compliance officer is assigned (e.g. the
    registry's direct "Start assessment" path), any systems:approve caller may issue.
    A specific assigned CO is only enforced when one was set via /workflow/assign."""
    # _create_system does NOT assign a CO; confirm + submit manually.
    system_id = await _create_system(client)
    state = await _open(client, system_id)
    await _confirm_all_as_owner(client, system_id, state)
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/submit",
        json={"note": "done"},
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/issue",
        json={"tier": "high", "transparency": True, "confirmed": True},
        headers=_hdr(_CO),
    )
    assert r.status_code == 200, r.text
    assert r.json()["workflow_status"] == "approved"


# ── R2-2: issuing a classification generates obligations + requirements ──────


async def _count_governance(system_id: str) -> tuple[int, int]:
    """(#obligations, #requirements) for a system, read straight from the DB."""
    from ai_trust_persistence.database import engine
    from ai_trust_persistence.models.obligation import Obligation
    from ai_trust_persistence.models.requirement import Requirement
    from sqlalchemy import func, select
    from sqlalchemy.ext.asyncio import AsyncSession

    async with AsyncSession(engine) as s:
        obl = (
            await s.execute(
                select(func.count())
                .select_from(Obligation)
                .where(Obligation.ai_system_id == system_id)
            )
        ).scalar_one()
        req = (
            await s.execute(
                select(func.count())
                .select_from(Requirement)
                .where(Requirement.ai_system_id == system_id)
            )
        ).scalar_one()
    return obl, req


@pytest.mark.asyncio
async def test_issue_high_tier_generates_obligations_and_requirements(
    client: httpx.AsyncClient,
):
    """Issuing a high-risk classification generates the governance chain atomically
    in the same transaction as the approve."""
    system_id = await _submit_as_owner(client)
    assert await _count_governance(system_id) == (0, 0)  # none before issue
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/issue",
        json={"tier": "high", "transparency": True, "confirmed": True},
        headers=_hdr(_CO),
    )
    assert r.status_code == 200, r.text
    obligations, requirements = await _count_governance(system_id)
    assert obligations > 0, "high-risk issue must generate obligations"
    assert requirements > 0, "high-risk issue must generate requirements"


@pytest.mark.asyncio
async def test_issue_minimal_tier_generates_no_obligations(
    client: httpx.AsyncClient,
):
    """A minimal-risk classification has no EU AI Act obligations — generation is a
    no-op (not an error)."""
    system_id = await _submit_as_owner(client)
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/issue",
        json={"tier": "minimal", "confirmed": True},
        headers=_hdr(_CO),
    )
    assert r.status_code == 200, r.text
    assert await _count_governance(system_id) == (0, 0)


@pytest.mark.asyncio
async def test_state_has_qualifying_comment_tracks_change_gate(
    client: httpx.AsyncClient,
):
    """/state.has_qualifying_comment mirrors the confirm gate: false for a changed
    answer whose only comment predates the change, true once a post-change comment
    exists. Lets the frontend enable Confirm exactly as the backend will accept."""

    def _q(state: dict, key: str) -> dict:
        return next(x for x in state["questions"] if x["question_key"] == key)

    system_id = await _create_system(client)
    state = await _open(client, system_id)
    qkey = next(q["question_key"] for q in state["questions"] if q["answer"])
    # Comment BEFORE the change.
    await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/comments",
        json={"body": "pre-change note"},
        headers=_hdr(_OWNER),
    )
    # Change the answer.
    await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/answer",
        json={"answer": "Owner-edited value differing from the AI proposal."},
        headers=_hdr(_OWNER),
    )
    st = (
        await client.get(
            f"/v1/systems/{system_id}/assessment/state", headers=_hdr(_OWNER)
        )
    ).json()
    # Only a pre-change comment exists → does NOT qualify.
    assert _q(st, qkey)["has_qualifying_comment"] is False
    # Add a post-change comment → now qualifies.
    await client.post(
        f"/v1/systems/{system_id}/assessment/questions/{qkey}/comments",
        json={"body": "post-change justification"},
        headers=_hdr(_OWNER),
    )
    st = (
        await client.get(
            f"/v1/systems/{system_id}/assessment/state", headers=_hdr(_OWNER)
        )
    ).json()
    assert _q(st, qkey)["has_qualifying_comment"] is True


# ── per-assessment-cycle: start-new + frozen history + by-id view ────────────


async def _issue_as_co(client: httpx.AsyncClient, system_id: str, tier: str = "high"):
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/issue",
        json={"tier": tier, "transparency": tier == "high", "confirmed": True},
        headers=_hdr(_CO),
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_start_new_after_approved_creates_fresh_cycle(
    client: httpx.AsyncClient,
):
    """Once approved, Start-new archives the old cycle and opens a fresh, blank one;
    the old cycle's answers stay frozen and viewable by id."""
    system_id = await _submit_as_owner(client)
    first = await _issue_as_co(client, system_id, "high")
    first_id = first["assessment_id"]
    assert first["workflow_status"] == "approved"

    # Start a new cycle.
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/start-new", headers=_hdr(_OWNER)
    )
    assert r.status_code == 200, r.text
    second = r.json()
    # A different assessment id, and a fresh (not-approved, editable) cycle.
    assert second["assessment_id"] != first_id
    assert second["workflow_status"] != "approved"
    assert second["editable"] is True
    # The old cycle is still readable by id, read-only, with its frozen high tier.
    old = await client.get(
        f"/v1/systems/{system_id}/assessment/state?assessment_id={first_id}",
        headers=_hdr(_OWNER),
    )
    assert old.status_code == 200, old.text
    old_body = old.json()
    assert old_body["assessment_id"] == first_id
    assert old_body["editable"] is False
    assert old_body["tier"] == "high"


@pytest.mark.asyncio
async def test_start_new_on_unapproved_opens_same_cycle(client: httpx.AsyncClient):
    """If the current cycle is NOT approved, Start-new just opens it — no new cycle,
    nothing archived (cycles are sequential)."""
    system_id = await _create_system(client)
    opened = await _open(client, system_id)
    r = await client.post(
        f"/v1/systems/{system_id}/assessment/start-new", headers=_hdr(_OWNER)
    )
    assert r.status_code == 200, r.text
    assert r.json()["assessment_id"] == opened["assessment_id"]


@pytest.mark.asyncio
async def test_state_by_unknown_assessment_id_404(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    await _open(client, system_id)
    r = await client.get(
        f"/v1/systems/{system_id}/assessment/state?assessment_id=ASS-NOPE0000",
        headers=_hdr(_OWNER),
    )
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_new_cycle_states_are_isolated(client: httpx.AsyncClient):
    """Answers/confirmations from an approved cycle do not bleed into a new cycle."""
    system_id = await _submit_as_owner(client)
    first = await _issue_as_co(client, system_id, "high")
    first_id = first["assessment_id"]
    # Old cycle: everything owner-confirmed.
    assert all(q["owner_confirmed"] for q in first["questions"])

    r = await client.post(
        f"/v1/systems/{system_id}/assessment/start-new", headers=_hdr(_OWNER)
    )
    assert r.status_code == 200, r.text
    second = r.json()
    assert second["assessment_id"] != first_id
    # Fresh cycle: nothing confirmed yet.
    assert all(not q["owner_confirmed"] for q in second["questions"])
