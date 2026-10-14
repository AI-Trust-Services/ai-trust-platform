"""Scenario 2 — Self-Assessment Workflow.

2a. Owner registers, workflow assigned → owner submits business section, engineer submits
    technical section → system reaches pending_review.
2b. Owner assigns one questionnaire question to a contributor; contributor marks it answered;
    owner reclaims (un-assigns) it.
"""

from __future__ import annotations

from conftest import BUSINESS_ANSWERS, drive_to_pending_review, register_system

# ---------------------------------------------------------------------------
# 2a — sections submit to pending_review
# ---------------------------------------------------------------------------


async def test_sections_submit_to_pending_review(owner, engineer, compliance):
    """Full governance walk: assign → submit-business → submit-technical → pending_review."""
    system = await register_system(
        owner, business_answers=BUSINESS_ANSWERS, name="E2E Self-Assess 2a"
    )
    sid = system["id"]
    base = f"/api/registry/v1/systems/{sid}/workflow"

    await drive_to_pending_review(sid, owner, engineer, compliance.e2e_username)

    # Verify final state
    r = await owner.get(f"/api/registry/v1/systems/{sid}")
    assert r.status_code == 200
    got = r.json()
    assert got["workflow_status"] == "pending_review"
    assert got["business_assignee_username"] == owner.e2e_username
    assert got["technical_assignee_username"] == engineer.e2e_username
    assert got["compliance_officer_username"] == compliance.e2e_username

    # Verify step history records all transitions
    history = await owner.get(f"{base}")
    assert history.status_code == 200
    steps = [s["step"] for s in history.json()]
    assert "section_assigned" in steps
    assert "business_submitted" in steps
    assert "technical_submitted" in steps


# ---------------------------------------------------------------------------
# 2b — per-question delegation and reclaim
# ---------------------------------------------------------------------------


async def test_question_delegation_and_reclaim(
    owner, engineer, compliance, contributor
):
    """Owner delegates a question → contributor answers → owner reclaims."""
    system = await register_system(
        owner, business_answers=BUSINESS_ANSWERS, name="E2E Self-Assess 2b"
    )
    sid = system["id"]
    base = f"/api/registry/v1/systems/{sid}/workflow"

    # Assign workflow so the system is in business_pending (edit gate open for business section)
    r = await owner.post(
        f"{base}/assign",
        json={
            "business_assignee_username": owner.e2e_username,
            "technical_assignee_username": engineer.e2e_username,
            "compliance_officer_username": compliance.e2e_username,
        },
    )
    assert r.status_code == 200, f"assign failed: {r.status_code} {r.text[:300]}"

    # Owner delegates the "use_case" question to contributor
    r = await owner.post(
        f"{base}/question-assign",
        json={
            "section": "business",
            "question_key": "use_case",
            "assignee_username": contributor.e2e_username,
        },
    )
    assert r.status_code == 200, (
        f"question-assign failed: {r.status_code} {r.text[:300]}"
    )

    # Verify the assignment is listed and unanswered
    r = await owner.get(f"{base}/question-assignments")
    assert r.status_code == 200
    assignments = r.json()
    match = next((a for a in assignments if a["question_key"] == "use_case"), None)
    assert match is not None, "question assignment not found"
    assert match["assignee_username"] == contributor.e2e_username
    assert match["answered_at"] is None

    # Contributor marks the question answered
    r = await contributor.post(
        f"{base}/question-answer",
        json={"section": "business", "question_key": "use_case"},
    )
    assert r.status_code == 200, (
        f"question-answer failed: {r.status_code} {r.text[:300]}"
    )

    r = await owner.get(f"{base}/question-assignments")
    assignments = r.json()
    match = next((a for a in assignments if a["question_key"] == "use_case"), None)
    assert match is not None
    assert match["answered_at"] is not None, "answered_at should be set after answer"

    # Owner reclaims (un-assigns) the question
    r = await owner.delete(
        f"{base}/question-assign",
        json={"section": "business", "question_key": "use_case"},
    )
    assert r.status_code == 200, (
        f"question-unassign failed: {r.status_code} {r.text[:300]}"
    )

    r = await owner.get(f"{base}/question-assignments")
    assignments = r.json()
    remaining = [a for a in assignments if a["question_key"] == "use_case"]
    assert not remaining, "question assignment should be gone after reclaim"
