"""E2E tests for the system registration workflow state machine.

Covers the submit → approve / reject transitions and their authorization rules.
The acting user is read from the ``x-forwarded-preferred-username`` header (set by
oauth2-proxy in production); only the assigned user may act on a transition.
"""
from __future__ import annotations

import httpx

_ENGINEER = "engineer1"
_OFFICER = "officer1"


def _hdr(user: str) -> dict:
    return {"x-forwarded-preferred-username": user}


async def _create_system(client: httpx.AsyncClient, assignee: str = _ENGINEER) -> str:
    """Register a draft system assigned to ``assignee`` and return its id."""
    r = await client.post(
        "/v1/intake",
        json={"name": "Workflow System", "assignee_username": assignee},
        headers=_hdr(assignee),
    )
    assert r.status_code == 201
    return r.json()["system"]["id"]


async def _submit(client: httpx.AsyncClient, system_id: str, actor: str, assignee: str) -> httpx.Response:
    return await client.post(
        f"/v1/systems/{system_id}/workflow/submit",
        json={"assignee_username": assignee, "note": "please review"},
        headers=_hdr(actor),
    )


def _status(client: httpx.AsyncClient, system_id: str):
    return client.get(f"/v1/systems/{system_id}", headers=_hdr(_ENGINEER))


# ---------------------------------------------------------------------------
# GET /systems/{id}/workflow
# ---------------------------------------------------------------------------

async def test_get_workflow_returns_registered_step(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    r = await client.get(f"/v1/systems/{system_id}/workflow", headers=_hdr(_ENGINEER))
    assert r.status_code == 200
    steps = r.json()
    assert len(steps) == 1
    assert steps[0]["step"] == "registered"
    assert steps[0]["actor_username"] == _ENGINEER


async def test_get_workflow_404_on_missing_system(client: httpx.AsyncClient):
    r = await client.get("/v1/systems/SYS-NOTFOUND/workflow", headers=_hdr(_ENGINEER))
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# submit: draft → pending_review
# ---------------------------------------------------------------------------

async def test_submit_transitions_to_pending_review(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    r = await _submit(client, system_id, actor=_ENGINEER, assignee=_OFFICER)
    assert r.status_code == 200
    steps = r.json()
    assert steps[-1]["step"] == "details_submitted"
    assert steps[-1]["actor_username"] == _ENGINEER
    assert steps[-1]["assignee_username"] == _OFFICER

    system = (await _status(client, system_id)).json()
    assert system["workflow_status"] == "pending_review"
    assert system["assignee_username"] == _OFFICER


async def test_submit_rejected_for_non_assignee(client: httpx.AsyncClient):
    system_id = await _create_system(client, assignee=_ENGINEER)
    r = await _submit(client, system_id, actor="intruder", assignee=_OFFICER)
    assert r.status_code == 403


async def test_submit_404_on_missing_system(client: httpx.AsyncClient):
    r = await _submit(client, "SYS-NOTFOUND", actor=_ENGINEER, assignee=_OFFICER)
    assert r.status_code == 404


async def test_submit_rejected_from_invalid_status(client: httpx.AsyncClient):
    # Cannot submit a system that is already pending_review.
    system_id = await _create_system(client)
    assert (await _submit(client, system_id, actor=_ENGINEER, assignee=_OFFICER)).status_code == 200
    # Now in pending_review — a second submit (by the current assignee) must 422.
    r = await _submit(client, system_id, actor=_OFFICER, assignee=_OFFICER)
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# approve: pending_review → approved
# ---------------------------------------------------------------------------

async def test_approve_transitions_to_approved(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    await _submit(client, system_id, actor=_ENGINEER, assignee=_OFFICER)

    r = await client.post(
        f"/v1/systems/{system_id}/workflow/approve",
        json={"note": "looks good"},
        headers=_hdr(_OFFICER),
    )
    assert r.status_code == 200
    assert r.json()[-1]["step"] == "approved"

    system = (await _status(client, system_id)).json()
    assert system["workflow_status"] == "approved"
    assert system["assignee_username"] is None


async def test_approve_rejected_for_non_assignee(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    await _submit(client, system_id, actor=_ENGINEER, assignee=_OFFICER)

    r = await client.post(
        f"/v1/systems/{system_id}/workflow/approve",
        json={"note": "sneaky"},
        headers=_hdr("intruder"),
    )
    assert r.status_code == 403


async def test_approve_rejected_from_draft_status(client: httpx.AsyncClient):
    # A draft system has never been submitted — approve must 422.
    system_id = await _create_system(client)
    r = await client.post(
        f"/v1/systems/{system_id}/workflow/approve",
        json={"note": "too early"},
        headers=_hdr(_ENGINEER),
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# reject: pending_review → rejected (with reassignment)
# ---------------------------------------------------------------------------

async def test_reject_transitions_to_rejected_and_reassigns(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    await _submit(client, system_id, actor=_ENGINEER, assignee=_OFFICER)

    r = await client.post(
        f"/v1/systems/{system_id}/workflow/reject",
        json={"note": "missing model card", "assignee_username": _ENGINEER},
        headers=_hdr(_OFFICER),
    )
    assert r.status_code == 200
    steps = r.json()
    assert steps[-1]["step"] == "rejected"
    assert steps[-1]["assignee_username"] == _ENGINEER

    system = (await _status(client, system_id)).json()
    assert system["workflow_status"] == "rejected"
    # Reassigned back to the engineer for rework.
    assert system["assignee_username"] == _ENGINEER


async def test_reject_rejected_for_non_assignee(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    await _submit(client, system_id, actor=_ENGINEER, assignee=_OFFICER)

    r = await client.post(
        f"/v1/systems/{system_id}/workflow/reject",
        json={"note": "nope", "assignee_username": _ENGINEER},
        headers=_hdr("intruder"),
    )
    assert r.status_code == 403


async def test_rejected_system_can_be_resubmitted(client: httpx.AsyncClient):
    # After rejection the engineer owns the system again and may resubmit.
    system_id = await _create_system(client)
    await _submit(client, system_id, actor=_ENGINEER, assignee=_OFFICER)
    await client.post(
        f"/v1/systems/{system_id}/workflow/reject",
        json={"note": "fix it", "assignee_username": _ENGINEER},
        headers=_hdr(_OFFICER),
    )
    r = await _submit(client, system_id, actor=_ENGINEER, assignee=_OFFICER)
    assert r.status_code == 200
    assert (await _status(client, system_id)).json()["workflow_status"] == "pending_review"
