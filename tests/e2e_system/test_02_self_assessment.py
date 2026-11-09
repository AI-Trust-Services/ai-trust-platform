"""Scenario 2 — Self-Assessment Workflow (single-page assessment flow).

2a. Owner registers → opens the assessment (AI prefill + classification) → confirms
    every question → submits to the compliance officer → system reaches pending_review.
2b. Owner assigns one question to a contributor; contributor can edit it; owner unassigns.
"""

from __future__ import annotations

from conftest import (
    confirm_all,
    drive_to_pending_review,
    open_assessment,
    register_system,
)


# ---------------------------------------------------------------------------
# 2a — assessment submits to pending_review
# ---------------------------------------------------------------------------


async def test_assessment_submits_to_pending_review(owner, compliance):
    """open → confirm all → submit → pending_review, with the CO recorded."""
    system = await register_system(owner, mode="ai", name="E2E Self-Assess 2a")
    sid = system["id"]

    await drive_to_pending_review(sid, owner, compliance.e2e_username)

    r = await owner.get(f"/api/registry/v1/systems/{sid}")
    assert r.status_code == 200
    got = r.json()
    assert got["workflow_status"] == "pending_review"
    assert got["compliance_officer_username"] == compliance.e2e_username

    # Step history records the submission.
    history = await owner.get(f"/api/registry/v1/systems/{sid}/workflow")
    assert history.status_code == 200
    steps = [s["step"] for s in history.json()]
    assert "assessment_submitted" in steps


# ---------------------------------------------------------------------------
# 2b — per-question assignment and unassignment
# ---------------------------------------------------------------------------


async def test_question_assignment_and_unassign(owner, compliance, contributor):
    """Owner assigns a question to a contributor → contributor may edit it → owner unassigns."""
    system = await register_system(owner, mode="ai", name="E2E Self-Assess 2b")
    sid = system["id"]
    base = f"/api/registry/v1/systems/{sid}/assessment"

    # Register the contributor on the system before assigning questions to them.
    r = await owner.put(
        f"/api/registry/v1/systems/{sid}",
        json={"contributors": [contributor.e2e_username]},
    )
    assert r.status_code == 200, (
        f"add contributor failed: {r.status_code} {r.text[:300]}"
    )

    state = await open_assessment(owner, sid)
    qkey = state["questions"][0]["question_key"]

    # Owner assigns the question to the contributor.
    r = await owner.post(
        f"{base}/questions/{qkey}/assign",
        json={"assignee_username": contributor.e2e_username},
    )
    assert r.status_code == 200, f"assign failed: {r.status_code} {r.text[:300]}"
    assert r.json()["assignee_username"] == contributor.e2e_username

    # The contributor may now edit (save an answer on) that question.
    r = await contributor.post(
        f"{base}/questions/{qkey}/answer",
        json={"answer": "Contributor-provided answer"},
    )
    assert r.status_code == 200, (
        f"contributor edit failed: {r.status_code} {r.text[:300]}"
    )

    # A different contributor (engineer) may NOT edit it.
    # (owner GET confirms assignee is unchanged.)
    st = await owner.get(f"{base}/state")
    q = next(x for x in st.json()["questions"] if x["question_key"] == qkey)
    assert q["assignee_username"] == contributor.e2e_username

    # Owner unassigns.
    r = await owner.request("DELETE", f"{base}/questions/{qkey}/assign")
    assert r.status_code == 204, f"unassign failed: {r.status_code} {r.text[:300]}"

    st = await owner.get(f"{base}/state")
    q = next(x for x in st.json()["questions"] if x["question_key"] == qkey)
    assert q["assignee_username"] is None
