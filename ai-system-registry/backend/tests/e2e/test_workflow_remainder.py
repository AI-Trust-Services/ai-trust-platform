"""E2E tests for the workflow endpoints that survive the single-page assessment
redesign: GET /workflow (step history), POST /workflow/assign (record assignees
+ intended purpose at creation), POST /workflow/reset (clear workflow state on
assessment delete). The section-fill / CO-decision / per-question endpoints were
removed — their behaviour is now covered by tests/e2e/test_assessment.py.
"""

from __future__ import annotations

import httpx


def _hdr(user: str) -> dict:
    return {"x-forwarded-preferred-username": user}


async def _create_system(client: httpx.AsyncClient, user: str = "owner1") -> str:
    r = await client.post(
        "/v1/intake",
        json={"name": "Workflow System", "registration_mode": "ai"},
        headers=_hdr(user),
    )
    assert r.status_code == 201, r.text
    return r.json()["system"]["id"]


async def test_get_workflow_returns_registered_step(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    r = await client.get(f"/v1/systems/{system_id}/workflow", headers=_hdr("owner1"))
    assert r.status_code == 200, r.text
    steps = r.json()
    assert any(s["step"] == "registered" for s in steps)


async def test_get_workflow_404_on_missing_system(client: httpx.AsyncClient):
    r = await client.get("/v1/systems/SYS-NOPE/workflow", headers=_hdr("owner1"))
    assert r.status_code == 404, r.text


async def test_assign_records_assignees_and_advances(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    r = await client.post(
        f"/v1/systems/{system_id}/workflow/assign",
        json={
            "business_assignee_username": "owner1",
            "compliance_officer_username": "officer1",
            "intended_purpose": "Testing",
        },
        headers=_hdr("owner1"),
    )
    assert r.status_code == 200, r.text
    assert any(s["step"] == "section_assigned" for s in r.json())


async def test_reset_returns_system_to_draft(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    # Move off draft first via assign, then reset.
    await client.post(
        f"/v1/systems/{system_id}/workflow/assign",
        json={
            "business_assignee_username": "owner1",
            "compliance_officer_username": "officer1",
        },
        headers=_hdr("owner1"),
    )
    r = await client.post(
        f"/v1/systems/{system_id}/workflow/reset", headers=_hdr("owner1")
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "reset"
    sysr = await client.get(f"/v1/systems/{system_id}", headers=_hdr("owner1"))
    assert sysr.json()["workflow_status"] == "draft"
