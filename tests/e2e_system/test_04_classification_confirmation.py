"""Scenario 4 — Classification Confirmation (single-page assessment flow).

4a. CO issues a classification; the approved system then rejects risk-flag edits (422)
    and assessment edits (409 — locked).
4b. CO issues the high + transparency combo; GET confirms the transparency companion.
"""

from __future__ import annotations

from conftest import drive_to_pending_review, open_assessment, register_system


# ---------------------------------------------------------------------------
# 4a — issuing locks the classification
# ---------------------------------------------------------------------------


async def test_issue_locks_classification(owner, compliance):
    """After the CO issues, the system is approved and immutable."""
    system = await register_system(owner, mode="ai", name="E2E Confirm 4a")
    sid = system["id"]

    await drive_to_pending_review(sid, owner, compliance.e2e_username)

    r = await compliance.post(
        f"/api/registry/v1/systems/{sid}/assessment/issue",
        json={"tier": "high", "confirmed": True},
    )
    assert r.status_code == 200, f"issue failed: {r.status_code} {r.text[:300]}"

    got = (await owner.get(f"/api/registry/v1/systems/{sid}")).json()
    assert got["workflow_status"] == "approved"
    assert got["tier"] == "high"

    # Risk-flag edit via PUT is rejected on an approved system (422, systems.py guard).
    r = await owner.put(
        f"/api/registry/v1/systems/{sid}",
        json={"is_critical_infrastructure": True},
    )
    assert r.status_code == 422, (
        f"expected 422 editing approved system, got {r.status_code}: {r.text[:200]}"
    )

    # Assessment answer edits are locked (409).
    base = f"/api/registry/v1/systems/{sid}/assessment"
    st = await owner.get(f"{base}/state")
    assert st.json()["editable"] is False
    qkey = st.json()["questions"][0]["question_key"]
    r = await owner.post(
        f"{base}/questions/{qkey}/answer", json={"answer": "post-issue edit"}
    )
    assert r.status_code == 409, (
        f"expected 409 editing locked assessment, got {r.status_code}: {r.text[:200]}"
    )


# ---------------------------------------------------------------------------
# 4b — CO issues the high + transparency combo
# ---------------------------------------------------------------------------


async def test_issue_high_plus_transparency(owner, compliance):
    """The only allowed combo — high + transparency — is issued and reflected."""
    system = await register_system(owner, mode="ai", name="E2E Confirm 4b")
    sid = system["id"]

    await drive_to_pending_review(sid, owner, compliance.e2e_username)

    r = await compliance.post(
        f"/api/registry/v1/systems/{sid}/assessment/issue",
        json={"tier": "high", "transparency": True, "confirmed": True},
    )
    assert r.status_code == 200, f"issue failed: {r.status_code} {r.text[:300]}"

    got = (await owner.get(f"/api/registry/v1/systems/{sid}")).json()
    assert got["workflow_status"] == "approved"
    assert got["tier"] == "high"
    assert got["co_issued_transparency"] is True

    # The assessment state surfaces the transparency companion.
    st = await owner.get(f"/api/registry/v1/systems/{sid}/assessment/state")
    assert st.json()["transparency"] is True
