"""E2E tests for /v1/incidents endpoints: owner-gated approval and
two-step delete (mirrors plan_tasks; incidents.py is the reference-correct
PATCH implementation already using exclude_unset=True).
"""
from __future__ import annotations

from tests.e2e.conftest import ENGINEER, approve_register, create_register, create_risk, create_system


async def _create_incident(client, register_id: str, **kwargs) -> dict:
    payload = {"title": "Test incident", **kwargs}
    r = await client.post(f"/v1/registers/{register_id}/incidents", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


async def test_owner_can_approve_incident(client):
    reg = await create_register(client)
    incident = await _create_incident(client, reg["id"], assigned_to=ENGINEER)
    client.headers["X-Forwarded-Preferred-Username"] = ENGINEER
    r = await client.patch(f"/v1/incidents/{incident['id']}", json={"approved": True})
    assert r.status_code == 200, r.text
    assert r.json()["approved"] is True
    assert r.json()["approved_by"] == ENGINEER


async def test_non_owner_cannot_approve_incident(client):
    reg = await create_register(client)
    incident = await _create_incident(client, reg["id"], assigned_to="someone-else@example.com")
    client.headers["X-Forwarded-Preferred-Username"] = ENGINEER
    r = await client.patch(f"/v1/incidents/{incident['id']}", json={"approved": True})
    assert r.status_code == 403, r.text


async def test_two_step_delete_requires_owner_to_confirm(client):
    reg = await create_register(client)
    incident = await _create_incident(client, reg["id"], assigned_to=ENGINEER)

    client.headers["X-Forwarded-Preferred-Username"] = "random_user"
    r = await client.patch(f"/v1/incidents/{incident['id']}", json={"pending_delete": True})
    assert r.status_code == 200, r.text
    assert r.json()["pending_delete"] is True

    r = await client.delete(f"/v1/incidents/{incident['id']}")
    assert r.status_code == 403, r.text

    client.headers["X-Forwarded-Preferred-Username"] = ENGINEER
    r = await client.delete(f"/v1/incidents/{incident['id']}")
    assert r.status_code == 204, r.text


async def test_create_incident_on_approved_register_lands_in_the_new_draft(client):
    """Regression test: create_incident() ignored the new register_id
    returned by _reopen_if_approved(), attaching the incident to the
    archived original register instead of the active clone.
    """
    sys_row = await create_system(tier="minimal")
    reg = await create_register(client, system_id=sys_row["id"])
    await create_risk(client, register_id=reg["id"], residual_status="none")
    await approve_register(client, reg["id"])

    incident = await _create_incident(client, reg["id"], title="Added after approval")
    assert incident["register_id"] != reg["id"]

    r = await client.get(f"/v1/registers/{incident['register_id']}/incidents")
    assert r.status_code == 200, r.text
    assert any(i["title"] == "Added after approval" for i in r.json())
