"""Scenario 4 — Classification Confirmation.

4a. CO approves a system with tier "high" (is_critical_infrastructure flag); verify that
    attempting to change risk flags on an approved system returns 422.
4b. CO overrides tier and org_role at approve time; GET confirms the overridden values.
"""

from __future__ import annotations

from conftest import BUSINESS_ANSWERS, drive_to_pending_review, register_system

# ---------------------------------------------------------------------------
# 4a — approval locks risk classification
# ---------------------------------------------------------------------------


async def test_co_approve_locks_classification(owner, engineer, compliance):
    """Approved system rejects risk-flag edits with 422."""
    system = await register_system(
        owner, business_answers=BUSINESS_ANSWERS, name="E2E Confirm 4a"
    )
    sid = system["id"]

    # Set tier to "high" via is_critical_infrastructure flag
    r = await owner.put(
        f"/api/registry/v1/systems/{sid}",
        json={"is_critical_infrastructure": True},
    )
    assert r.status_code == 200, f"PUT flags failed: {r.status_code} {r.text[:300]}"
    assert r.json()["tier"] == "high"

    await drive_to_pending_review(sid, owner, engineer, compliance.e2e_username)

    # CO approves
    r = await compliance.post(
        f"/api/registry/v1/systems/{sid}/workflow/approve", json={}
    )
    assert r.status_code == 200, f"approve failed: {r.status_code} {r.text[:300]}"

    r = await owner.get(f"/api/registry/v1/systems/{sid}")
    got = r.json()
    assert got["workflow_status"] == "approved"
    assert got["tier"] == "high"

    # Attempt to change a risk flag — must be rejected (approved state)
    r = await engineer.put(
        f"/api/registry/v1/systems/{sid}",
        json={"is_critical_infrastructure": False},
    )
    assert r.status_code == 422, (
        f"Expected 422 when editing risk flag on approved system, got {r.status_code}: {r.text[:300]}"
    )


# ---------------------------------------------------------------------------
# 4b — CO overrides tier and org_role on approval
# ---------------------------------------------------------------------------


async def test_co_corrects_tier_and_role_on_approval(owner, engineer, compliance):
    """CO can override tier and org_role at approve time; GET confirms the overrides."""
    system = await register_system(
        owner, business_answers=BUSINESS_ANSWERS, name="E2E Confirm 4b"
    )
    sid = system["id"]

    await drive_to_pending_review(sid, owner, engineer, compliance.e2e_username)

    # CO approves with explicit tier + org_role overrides
    r = await compliance.post(
        f"/api/registry/v1/systems/{sid}/workflow/approve",
        json={"tier": "high", "org_role": "deployer"},
    )
    assert r.status_code == 200, (
        f"approve with overrides failed: {r.status_code} {r.text[:300]}"
    )

    r = await owner.get(f"/api/registry/v1/systems/{sid}")
    assert r.status_code == 200
    got = r.json()
    assert got["workflow_status"] == "approved"
    assert got["tier"] == "high", (
        f"tier should be overridden to 'high', got {got['tier']!r}"
    )
    assert got["org_role"] == "deployer", (
        f"org_role should be 'deployer', got {got['org_role']!r}"
    )
