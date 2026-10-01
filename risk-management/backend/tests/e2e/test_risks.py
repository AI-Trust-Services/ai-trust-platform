"""E2E tests for /v1/risks endpoints: CRUD, per-role confirmation workflow,
and PATCH null-clearing semantics.
"""
from __future__ import annotations

from tests.e2e.conftest import ENGINEER, OFFICER, approve_register, create_register, create_risk, create_system


async def _confirm_as(client, risk_id: str, role: str, *, also_complete: bool):
    """Mirrors the frontend's applyRolePatch(): the caller (not the backend)
    decides whether this confirmation completes the risk, and sends
    status="confirmed" in the same PATCH as the per-role confirm flag.
    """
    client.headers["X-Forwarded-Preferred-Username"] = ENGINEER if role == "engineer" else OFFICER
    body = {f"{role}_confirmed": True}
    if also_complete:
        body["status"] = "confirmed"
    return await client.patch(f"/v1/risks/{risk_id}", json=body)


async def test_patch_clears_nullable_string_fields_to_none(client):
    """A PATCH that explicitly sends a field as null must clear it — not leave
    the previous value in place. Regression test for the bug where `patch_risk`
    used `if val is not None: setattr(...)`, which cannot represent "clear this
    field" (indistinguishable from "field omitted").
    """
    risk = await create_risk(
        client,
        risk_owner="owner@example.com",
        ai_lifecycle_phase="development",
        engineer_email="eng@example.com",
        officer_email="officer@example.com",
    )
    assert risk["risk_owner"] == "owner@example.com"

    r = await client.patch(
        f"/v1/risks/{risk['id']}",
        json={
            "risk_owner": None,
            "ai_lifecycle_phase": None,
            "engineer_email": None,
            "officer_email": None,
        },
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["risk_owner"] is None
    assert updated["ai_lifecycle_phase"] is None
    assert updated["engineer_email"] is None
    assert updated["officer_email"] is None


async def test_patch_clearing_deadline_to_none_still_resets_confirmations(client):
    """Clearing `deadline` (an evaluation field) to null must still be treated
    as an edit that resets both confirmations — not silently ignored because
    the new value happens to be None.
    """
    risk = await create_risk(client, deadline="2030-01-01T00:00:00Z")
    await _confirm_as(client, risk["id"], "engineer", also_complete=False)
    r = await _confirm_as(client, risk["id"], "officer", also_complete=True)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed"

    client.headers["X-Forwarded-Preferred-Username"] = ENGINEER
    r = await client.patch(f"/v1/risks/{risk['id']}", json={"deadline": None})
    assert r.status_code == 200, r.text
    edited = r.json()
    assert edited["deadline"] is None
    assert edited["engineer_confirmed"] is False
    assert edited["officer_confirmed"] is False
    assert edited["status"] == "open"


async def test_both_roles_must_confirm_before_risk_is_confirmed(client):
    risk = await create_risk(client, responsible_role="ai_engineer,ai_compliance_officer")

    r = await _confirm_as(client, risk["id"], "engineer", also_complete=False)
    assert r.status_code == 200, r.text
    assert r.json()["status"] != "confirmed"

    r = await _confirm_as(client, risk["id"], "officer", also_complete=True)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed"


async def test_editing_evaluation_field_resets_both_confirmations(client):
    risk = await create_risk(client)
    await _confirm_as(client, risk["id"], "engineer", also_complete=False)
    r = await _confirm_as(client, risk["id"], "officer", also_complete=True)
    assert r.json()["status"] == "confirmed"

    r = await client.patch(f"/v1/risks/{risk['id']}", json={"description": "Updated description"})
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["engineer_confirmed"] is False
    assert updated["officer_confirmed"] is False
    assert updated["status"] == "open"


async def test_confirming_a_role_not_required_on_this_risk_is_rejected(client):
    """A risk whose responsible_role is only "ai_compliance_officer" must
    reject an engineer_confirmed PATCH — that role isn't part of this risk's
    sign-off requirement.
    """
    risk = await create_risk(client, responsible_role="ai_compliance_officer")
    r = await _confirm_as(client, risk["id"], "engineer", also_complete=False)
    assert r.status_code == 422, r.text


async def test_add_mitigation_after_register_approved_is_rejected(client):
    """Regression test: add_mitigation() cloned the now-approved register (via
    _reopen_if_approved) but kept attaching the mitigation to the original
    risk_id, which now only exists in the archived snapshot. There is no safe
    way to redirect a risk-scoped create to its cloned counterpart, so this
    must fail loudly (409) instead of silently orphaning the mitigation.
    """
    sys_row = await create_system(tier="minimal")
    reg = await create_register(client, system_id=sys_row["id"])
    risk = await create_risk(client, register_id=reg["id"], residual_status="none")
    await approve_register(client, reg["id"])

    r = await client.post(
        f"/v1/risks/{risk['id']}/mitigations",
        json={"title": "Too late", "hierarchy_level": "reduce"},
    )
    assert r.status_code == 409, r.text
