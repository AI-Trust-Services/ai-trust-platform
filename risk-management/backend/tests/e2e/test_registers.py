"""E2E tests for /v1/registers endpoints: PATCH null-clearing and the
approve -> clone -> test-report remapping bug.
"""
from __future__ import annotations

from tests.e2e.conftest import approve_register, create_register, create_risk, create_system


async def test_patch_clears_nullable_residual_fields_to_none(client):
    reg = await create_register(client)
    r = await client.patch(
        f"/v1/registers/{reg['id']}",
        json={"residual_severity": "high", "reviewer_username": "reviewer@example.com"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["residual_severity"] == "high"

    r = await client.patch(
        f"/v1/registers/{reg['id']}",
        json={"residual_severity": None, "reviewer_username": None},
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["residual_severity"] is None
    assert updated["reviewer_username"] is None


async def test_clone_preserves_test_report_mitigation_link(client):
    """Regression test: _clone_if_approved hardcoded mitigation_id=None on
    cloned TestReports, dropping the link even when the source TestReport
    referenced a real mitigation that was itself successfully remapped.
    """
    sys_row = await create_system(tier="minimal")
    reg = await create_register(client, system_id=sys_row["id"])
    risk = await create_risk(client, register_id=reg["id"], residual_status="none")

    mit_r = await client.post(
        f"/v1/risks/{risk['id']}/mitigations",
        json={"title": "Test mitigation", "hierarchy_level": "reduce"},
    )
    assert mit_r.status_code == 201, mit_r.text
    mitigation = mit_r.json()

    tr_r = await client.post(
        f"/v1/risks/{risk['id']}/test-reports",
        json={"title": "Test report", "mitigation_id": mitigation["id"]},
    )
    assert tr_r.status_code == 201, tr_r.text

    await approve_register(client, reg["id"])

    r = await client.post(f"/v1/registers/{reg['id']}/clone", json={})
    assert r.status_code == 201, r.text
    new_register_id = r.json()["new_register_id"]
    assert new_register_id != reg["id"]

    r = await client.get(f"/v1/registers/{new_register_id}")
    assert r.status_code == 200, r.text
    new_risks = r.json()["risks"]
    assert len(new_risks) == 1
    new_risk_id = new_risks[0]["id"]
    new_mitigation_id = new_risks[0]["mitigations"][0]["id"]
    assert new_mitigation_id != mitigation["id"]

    r = await client.get(f"/v1/risks/{new_risk_id}/test-reports")
    assert r.status_code == 200, r.text
    new_reports = r.json()
    assert len(new_reports) == 1
    assert new_reports[0]["mitigation_id"] == new_mitigation_id


async def test_create_risk_on_approved_register_lands_in_the_new_draft(client):
    """Regression test: create_risk() called _reopen_if_approved() (which
    clones+archives an approved register) but ignored the returned new
    register_id, attaching the new risk to the now-archived original instead
    of the new draft — silently hiding it from the active register.
    """
    sys_row = await create_system(tier="minimal")
    reg = await create_register(client, system_id=sys_row["id"])
    await create_risk(client, register_id=reg["id"], residual_status="none")
    await approve_register(client, reg["id"])

    r = await client.post(
        f"/v1/registers/{reg['id']}/risks",
        json={"title": "Added after approval", "responsible_role": "ai_engineer"},
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["register_id"] != reg["id"]

    r = await client.get(f"/v1/registers/{created['register_id']}")
    assert r.status_code == 200, r.text
    assert any(rk["title"] == "Added after approval" for rk in r.json()["risks"])

