"""E2E tests for /v1/plan-tasks endpoints: PATCH null-clearing, owner-gated
approval, and two-step delete.
"""
from __future__ import annotations

from tests.e2e.conftest import ENGINEER, approve_register, create_register, create_risk, create_system


async def _create_task(client, register_id: str, **kwargs) -> dict:
    payload = {"title": "Test task", **kwargs}
    r = await client.post(f"/v1/registers/{register_id}/plan-tasks", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


async def test_patch_clears_nullable_fields_to_none(client):
    """Regression test: patch_plan_task used `if val is not None: setattr(...)`,
    which cannot clear risk_id/assigned_to/due_date to null.
    """
    reg = await create_register(client)
    risk = await create_risk(client, register_id=reg["id"])
    task = await _create_task(
        client, reg["id"],
        risk_id=risk["id"], assigned_to="someone@example.com", due_date="2030-01-01T00:00:00Z",
    )
    assert task["risk_id"] == risk["id"]

    r = await client.patch(
        f"/v1/plan-tasks/{task['id']}",
        json={"risk_id": None, "assigned_to": None, "due_date": None},
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["risk_id"] is None
    assert updated["assigned_to"] is None
    assert updated["due_date"] is None


async def test_owner_can_approve_task(client):
    reg = await create_register(client)
    task = await _create_task(client, reg["id"], assigned_to=ENGINEER)
    client.headers["X-Forwarded-Preferred-Username"] = ENGINEER
    r = await client.patch(f"/v1/plan-tasks/{task['id']}", json={"approved": True})
    assert r.status_code == 200, r.text
    assert r.json()["approved"] is True
    assert r.json()["approved_by"] == ENGINEER


async def test_non_owner_cannot_approve_task(client):
    reg = await create_register(client)
    task = await _create_task(client, reg["id"], assigned_to="someone-else@example.com")
    client.headers["X-Forwarded-Preferred-Username"] = ENGINEER
    r = await client.patch(f"/v1/plan-tasks/{task['id']}", json={"approved": True})
    assert r.status_code == 403, r.text


async def test_two_step_delete_requires_owner_to_confirm(client):
    reg = await create_register(client)
    task = await _create_task(client, reg["id"], assigned_to=ENGINEER)

    # Anyone may propose deletion.
    client.headers["X-Forwarded-Preferred-Username"] = "random_user"
    r = await client.patch(f"/v1/plan-tasks/{task['id']}", json={"pending_delete": True})
    assert r.status_code == 200, r.text
    assert r.json()["pending_delete"] is True

    # A non-owner cannot confirm the actual delete.
    r = await client.delete(f"/v1/plan-tasks/{task['id']}")
    assert r.status_code == 403, r.text

    # The owner can.
    client.headers["X-Forwarded-Preferred-Username"] = ENGINEER
    r = await client.delete(f"/v1/plan-tasks/{task['id']}")
    assert r.status_code == 204, r.text


async def test_create_plan_task_on_approved_register_lands_in_the_new_draft(client):
    """Regression test: create_plan_task() ignored the new register_id
    returned by _reopen_if_approved(), attaching the task to the archived
    original register instead of the active clone.
    """
    sys_row = await create_system(tier="minimal")
    reg = await create_register(client, system_id=sys_row["id"])
    await create_risk(client, register_id=reg["id"], residual_status="none")
    await approve_register(client, reg["id"])

    task = await _create_task(client, reg["id"], title="Added after approval")
    assert task["register_id"] != reg["id"]

    r = await client.get(f"/v1/registers/{task['register_id']}/plan-tasks")
    assert r.status_code == 200, r.text
    assert any(t["title"] == "Added after approval" for t in r.json())
