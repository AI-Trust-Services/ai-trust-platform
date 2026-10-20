"""Scenario 3 — Risk Classification.

3a. AI-mode governance chain: owner registers, PATCH full questionnaire, drives through all
    sections. submit-technical triggers LLM reclassify — assert tier in VALID_TIERS (structural,
    no concrete value). CO approves → workflow_status == "approved".
3b. Bounce-back (manual_questionnaire): CO sends system back for info → owner edits + submits
    info → CO approves.
"""

from __future__ import annotations

from conftest import (
    VALID_TIERS,
    drive_to_pending_review,
    register_system,
    set_all_questionnaire_answers,
)

# ---------------------------------------------------------------------------
# 3a — full AI-mode governance chain (structural assertions)
# ---------------------------------------------------------------------------


async def test_full_governance_chain_ai_preclassification(owner, engineer, compliance):
    """AI-mode: drive full governance chain; tier is whatever the LLM returns (stub or real)."""
    system = await register_system(owner, mode="ai", name="E2E Risk 3a")
    sid = system["id"]

    # intake hardcodes registration_mode="ai" and ignores questionnaire_answers;
    # PATCH both sections in draft state before assigning the workflow.
    await set_all_questionnaire_answers(owner, sid)

    await drive_to_pending_review(
        sid, owner, engineer, compliance.e2e_username, with_technical_answers=True
    )

    # After submit-technical in AI mode the tier should have been reclassified by the LLM.
    r = await owner.get(f"/api/registry/v1/systems/{sid}")
    assert r.status_code == 200
    got = r.json()
    assert (
        got["tier"] in VALID_TIERS
    ), f"unexpected tier after AI reclassify: {got['tier']!r}"
    assert got["workflow_status"] == "pending_review"

    # CO approves
    r = await compliance.post(
        f"/api/registry/v1/systems/{sid}/workflow/approve", json={}
    )
    assert r.status_code == 200, f"approve failed: {r.status_code} {r.text[:300]}"

    r = await owner.get(f"/api/registry/v1/systems/{sid}")
    assert r.json()["workflow_status"] == "approved"
    assert r.json()["tier"] in VALID_TIERS


# ---------------------------------------------------------------------------
# 3b — bounce-back: request-info → edit → submit-info → approve
# ---------------------------------------------------------------------------


async def test_bounce_back_request_info(owner, engineer, compliance):
    """CO sends system back for revision; owner edits + submits-info; CO approves."""
    system = await register_system(owner, name="E2E Risk 3b")
    sid = system["id"]
    base = f"/api/registry/v1/systems/{sid}/workflow"

    await set_all_questionnaire_answers(owner, sid)
    await drive_to_pending_review(
        sid, owner, engineer, compliance.e2e_username, with_technical_answers=True
    )

    # CO requests more info on the business section
    r = await compliance.post(
        f"{base}/request-info",
        json={"section": "business", "note": "Please elaborate on use_case purpose"},
    )
    assert r.status_code == 200, f"request-info failed: {r.status_code} {r.text[:300]}"

    r = await owner.get(f"/api/registry/v1/systems/{sid}")
    got = r.json()
    assert got["workflow_status"] == "info_requested", got["workflow_status"]
    assert got["info_requested_section"] == "business"

    # Owner patches the business section with additional detail.
    # QuestionnaireAnswersPatch requires {"section": ..., "answers": {...}}.
    r = await owner.patch(
        f"/api/registry/v1/systems/{sid}/questionnaire",
        json={
            "section": "business",
            "answers": {"use_case": "Updated: E2E test use case — expanded detail"},
        },
    )
    assert (
        r.status_code == 200
    ), f"questionnaire PATCH failed: {r.status_code} {r.text[:300]}"

    # Owner submits the revision
    r = await owner.post(f"{base}/submit-info", json={})
    assert r.status_code == 200, f"submit-info failed: {r.status_code} {r.text[:300]}"

    r = await owner.get(f"/api/registry/v1/systems/{sid}")
    assert r.json()["workflow_status"] == "pending_review", r.json()["workflow_status"]

    # CO approves
    r = await compliance.post(f"{base}/approve", json={})
    assert r.status_code == 200, f"final approve failed: {r.status_code} {r.text[:300]}"

    r = await owner.get(f"/api/registry/v1/systems/{sid}")
    assert r.json()["workflow_status"] == "approved"
