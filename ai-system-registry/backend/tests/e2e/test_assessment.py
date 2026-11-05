"""E2E tests for the single-page EU AI Act assessment flow.

Covers the owner flow (#346/#314/#362): open (empty seed), apply-run (AI answers),
per-question state, the mandatory-comment-on-change confirm gate, edit-gating for
contributors, the finalize/submit all-confirmed gates, comment soft-delete
permissions, and assignment. The acting user is read from
``x-forwarded-preferred-username``.

Runs in stub LLM mode (THALAMUS_BASE_URL unset → stub), so /questionnaire-run
produces a deterministic minimal result (one Scope_1 answer).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

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


_STUB_PRESIGNED = "http://minio:9000/stub.json?sig=stub"


async def _apply_run(client: httpx.AsyncClient, system_id: str, user: str = _OWNER):
    """Run the questionnaire pipeline and apply the results.

    MinIO upload is patched so a live MinIO instance is not required.
    """
    upload_p = patch(
        "app.questionnaire_pipeline.minio_client.ensure_bucket",
        new_callable=AsyncMock,
    )
    put_p = patch(
        "app.questionnaire_pipeline.asyncio.to_thread",
        new_callable=AsyncMock,
        return_value=None,
    )
    presign_p = patch(
        "app.questionnaire_pipeline.minio_client.get_presigned_url",
        new_callable=AsyncMock,
        return_value=_STUB_PRESIGNED,
    )
    with upload_p, put_p, presign_p:
        r = await client.post(
            f"/v1/systems/{system_id}/questionnaire-run",
            json={},
            headers=_hdr(user),
        )
        assert r.status_code == 200, r.text
        run_result = r.json()

    r = await client.post(
        f"/v1/systems/{system_id}/assessment/apply-run",
        json={
            "run_key": run_result["run_key"],
            "results": run_result["result"]["results"],
        },
        headers=_hdr(user),
    )
    assert r.status_code == 200, r.text
    return r.json()


# ── open / seed ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_open_seeds_empty_questions(client: httpx.AsyncClient):
    """POST /open creates one question_state per catalogue key with no answers
    and no confidence. prefilled=True (rows exist), tier stays pending."""
    system_id = await _create_system(client)
    state = await _open(client, system_id)

    assert state["prefilled"] is True
    # Every catalogue question has a state entry.
    assert len(state["questions"]) >= 1
    # All questions start with no answer and no confidence.
    assert all(q["answer"] is None or q["answer"] == "" for q in state["questions"])
    assert state["confidence_counts"]["high"] == 0
    assert state["confidence_counts"]["medium"] == 0
    assert state["confidence_counts"]["low"] == 0
    # Tier stays pending until apply-run is called.
    assert state["tier"] == "pending"
    # No question is confirmed yet.
    assert all(not q["confirmed"] for q in state["questions"])


@pytest.mark.asyncio
async def test_apply_run_writes_answers_and_classifies(client: httpx.AsyncClient):
    """apply-run writes stub answers and runs the classifier.

    The stub returns one Scope_1 result → at least one question gets an answer."""
    system_id = await _create_system(client)
    await _open(client, system_id)
    state = await _apply_run(client, system_id)

    # At least one question was answered by the stub (Scope_1).
    answered = [q for q in state["questions"] if q["answer"]]
    assert len(answered) >= 1
    scope_q = next(
        (q for q in state["questions"] if q["question_key"] == "Scope_1"), None
    )
    assert scope_q is not None
    assert scope_q["answer"]
    # Classifier ran after apply-run.
    assert state["tier"] is not None


@pytest.mark.asyncio
async def test_prefill_choice_answers_are_valid_options(client: httpx.AsyncClient):
    """A predefined question answered by apply-run must contain a value from the
    question's allowed options, so the frontend's exact-match radios select it."""
    from app.assessment_catalogue import QUESTION_OPTIONS

    system_id = await _create_system(client)
    await _open(client, system_id)
    state = await _apply_run(client, system_id)
    by_key = {q["question_key"]: q for q in state["questions"]}
    for key, options in QUESTION_OPTIONS.items():
        q = by_key.get(key)
        if q is None:
            continue
        # Either a valid option verbatim, or empty (stub didn't answer this question).
        assert q["answer"] in options or q["answer"] in ("", None), (
            f"{key} filled with {q['answer']!r}, not one of {options}"
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


@pytest.mark.asyncio
async def test_open_is_idempotent(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    first = await _open(client, system_id)
    # Confirm one question (no answer → source stays ai_prefilled, no comment needed).
    qkey = first["questions"][0]["question_key"]
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
    """After apply-run, confirming an AI-prefilled answer without changes requires
    no comment."""
    system_id = await _create_system(client)
    await _open(client, system_id)
    state = await _apply_run(client, system_id)
    # Pick a question that was answered by the AI.
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
    await _open(client, system_id)
    state = await _apply_run(client, system_id)
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
    # Confirm every question. All are AI-prefilled & unchanged (empty), so
    # confirm is comment-free.
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
    await _open(client, system_id)
    state = await _apply_run(client, system_id)
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
    """Create, open, owner-confirm all, and submit — leaving the system in
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
