"""Scenario 3 — Risk Classification (single-page assessment flow).

3a. Owner registers (ai mode), opens the assessment (LLM prefill + classification),
    confirms all, submits → CO issues a final classification → approved.
3b. Bounce-back: CO returns the assessment with comments → owner re-opens (editable
    again) → re-confirms → resubmits → CO issues → approved.
"""

from __future__ import annotations

from conftest import (
    VALID_TIERS,
    confirm_all,
    drive_to_pending_review,
    open_assessment,
    register_system,
)


# ---------------------------------------------------------------------------
# 3a — full chain: open → confirm → submit → CO issue → approved
# ---------------------------------------------------------------------------


async def test_full_chain_issue(owner, compliance):
    """Drive the full assessment; tier is whatever the LLM returns (stub or real)."""
    system = await register_system(owner, mode="ai", name="E2E Risk 3a")
    sid = system["id"]

    await drive_to_pending_review(sid, owner, compliance.e2e_username)

    r = await owner.get(f"/api/registry/v1/systems/{sid}")
    got = r.json()
    assert got["tier"] in VALID_TIERS, f"unexpected tier: {got['tier']!r}"
    assert got["workflow_status"] == "pending_review"

    # CO issues the final classification.
    r = await compliance.post(
        f"/api/registry/v1/systems/{sid}/assessment/issue",
        json={"tier": "high", "transparency": False, "confirmed": True},
    )
    assert r.status_code == 200, f"issue failed: {r.status_code} {r.text[:300]}"

    r = await owner.get(f"/api/registry/v1/systems/{sid}")
    assert r.json()["workflow_status"] == "approved"
    assert r.json()["tier"] == "high"


# ---------------------------------------------------------------------------
# 3b — bounce-back: CO reject → owner re-opens + resubmits → CO issue
# ---------------------------------------------------------------------------


async def test_bounce_back_reject_and_resubmit(owner, compliance):
    """CO returns the assessment with a comment; owner resubmits; CO issues."""
    system = await register_system(owner, mode="ai", name="E2E Risk 3b")
    sid = system["id"]

    await drive_to_pending_review(sid, owner, compliance.e2e_username)

    # CO returns it with a mandatory comment.
    r = await compliance.post(
        f"/api/registry/v1/systems/{sid}/assessment/reject",
        json={"note": "Please revisit the intended-purpose answer."},
    )
    assert r.status_code == 200, f"reject failed: {r.status_code} {r.text[:300]}"

    r = await owner.get(f"/api/registry/v1/systems/{sid}")
    assert r.json()["workflow_status"] == "returned", r.json()["workflow_status"]

    # Returned ⇒ editable again for the owner: re-open, re-confirm, resubmit.
    state = await open_assessment(owner, sid)
    assert state["editable"] is True
    await confirm_all(owner, sid, state)
    r = await owner.post(
        f"/api/registry/v1/systems/{sid}/assessment/submit",
        json={"note": "revised"},
    )
    assert r.status_code == 200, f"resubmit failed: {r.status_code} {r.text[:300]}"
    assert r.json()["workflow_status"] == "pending_review"

    # CO issues.
    r = await compliance.post(
        f"/api/registry/v1/systems/{sid}/assessment/issue",
        json={"tier": "minimal", "confirmed": True},
    )
    assert r.status_code == 200, f"issue failed: {r.status_code} {r.text[:300]}"
    r = await owner.get(f"/api/registry/v1/systems/{sid}")
    assert r.json()["workflow_status"] == "approved"
