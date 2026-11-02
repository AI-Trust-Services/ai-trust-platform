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
