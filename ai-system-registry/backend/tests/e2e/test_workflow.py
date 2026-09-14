"""E2E tests for the system registration workflow state machine.

Covers the submit → approve / reject transitions and their authorization rules.
The acting user is read from the ``x-forwarded-preferred-username`` header (set by
oauth2-proxy in production); only the assigned user may act on a transition.
"""
from __future__ import annotations

import httpx

_ENGINEER = "engineer1"
_OFFICER = "officer1"
_BIZ = "biz1"
_TECH = "tech1"


def _hdr(user: str) -> dict:
    return {"x-forwarded-preferred-username": user}


async def _create_system(client: httpx.AsyncClient, assignee: str = _ENGINEER) -> str:
    """Register a draft (AI-mode) system assigned to ``assignee`` and return its id.

    No questionnaire answers are seeded, so this system cannot be *approved* until its
    required questions are filled — the completeness gate blocks it (see
    ``_create_complete_system`` for a system that can go all the way to approved).
    """
    r = await client.post(
        "/v1/intake",
        json={"name": "Workflow System", "assignee_username": assignee},
        headers=_hdr(assignee),
    )
    assert r.status_code == 201
    return r.json()["system"]["id"]


# All required business answers (kept in sync with the frontend BUSINESS_QUESTIONS and the
# backend questionnaire_required.REQUIRED_BUSINESS). ``department`` and ``use_case`` are
# top-level AISystem columns; every other key lives in questionnaire_answers.
_COMPLETE_BUSINESS_ANSWERS = {
    "submission_type": "Initial Submission",
    "use_case_owner": "Jane Doe",
    "use_case_type": "Internal development for own organisational use",
    "technologies": "LLM, Python",
    "use_case_status": "New AI use case",
    "planned_modifications": "N/A",
    "entity_role": "Provider",
    "exception_category": "None of the above",
    "sector_legislation": "None of the above",
}
# All required AI-mode technical free-text answers (questionnaire_answers["technical"]).
_COMPLETE_TECHNICAL_ANSWERS = {
    "data_and_inputs": "No sensitive personal data.",
    "decision_domain": "Internal productivity tooling.",
    "automation_and_oversight": "Human reviews every output.",
    "affected_people": "Internal employees only.",
    "model_nature": "General-purpose LLM, training compute unknown.",
    "user_interaction": "Chatbot interface for staff.",
    "prohibited_practices": "None of the listed prohibited practices apply.",
}


async def _create_complete_system(client: httpx.AsyncClient, assignee: str = _ENGINEER) -> str:
    """Register an AI-mode system with every required question answered, so it can be
    approved once it reaches pending_review (the completeness gate finds no gaps)."""
    r = await client.post(
        "/v1/intake",
        json={
            "name": "Workflow System",
            "assignee_username": assignee,
            "department": "Engineering",
            "use_case": "A detailed description of the system, its purpose, and its inputs.",
            "questionnaire_answers": {**_COMPLETE_BUSINESS_ANSWERS, "technical": _COMPLETE_TECHNICAL_ANSWERS},
        },
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
# New questionnaire-workflow helpers (draft → business → technical → review)
# ---------------------------------------------------------------------------

async def _register(client: httpx.AsyncClient, creator: str = _ENGINEER) -> str:
    """Register a manual-questionnaire draft (no AI/LLM call) and return its id."""
    r = await client.post(
        "/v1/intake",
        json={"name": "Workflow System", "registration_mode": "manual_questionnaire"},
        headers=_hdr(creator),
    )
    assert r.status_code == 201
    return r.json()["system"]["id"]


async def _drive_to_pending_review(
    client: httpx.AsyncClient,
    creator: str = _ENGINEER,
    biz: str = _BIZ,
    tech: str = _TECH,
    co: str = _OFFICER,
) -> str:
    """Register → assign sections → submit business + technical → land in pending_review.

    ``submit-technical`` runs the deterministic classifier for manual-questionnaire
    mode (no LLM), so this drives the full new state machine without a network call.
    """
    system_id = await _register(client, creator)
    assert (await client.post(
        f"/v1/systems/{system_id}/workflow/assign",
        json={
            "business_assignee_username": biz,
            "technical_assignee_username": tech,
            "compliance_officer_username": co,
        },
        headers=_hdr(creator),
    )).status_code == 200
    assert (await client.post(
        f"/v1/systems/{system_id}/workflow/submit-business", json={}, headers=_hdr(biz)
    )).status_code == 200
    assert (await client.post(
        f"/v1/systems/{system_id}/workflow/submit-technical", json={}, headers=_hdr(tech)
    )).status_code == 200
    return system_id


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
    # A complete system (all required questions answered) approves cleanly.
    system_id = await _create_complete_system(client)
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


async def test_approve_blocked_when_required_questions_unanswered(client: httpx.AsyncClient):
    # The compliance officer cannot approve an AI-mode system with unanswered questions;
    # the gate returns 422 naming the missing keys and points to Request Info.
    system_id = await _create_system(client)  # AI-mode, no answers seeded
    await _submit(client, system_id, actor=_ENGINEER, assignee=_OFFICER)

    r = await client.post(
        f"/v1/systems/{system_id}/workflow/approve",
        json={"note": "looks good"},
        headers=_hdr(_OFFICER),
    )
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "required questions are unanswered" in detail
    assert "use_case" in detail          # a missing business (column) key
    assert "data_and_inputs" in detail   # a missing AI-technical key

    # It stays in pending_review — approval had no effect.
    assert (await _status(client, system_id)).json()["workflow_status"] == "pending_review"


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
# reject: pending_review → back to a section (with reassignment)
# ---------------------------------------------------------------------------

async def test_reject_returns_system_to_business_section(client: httpx.AsyncClient):
    # Reject is no longer terminal — it sends the system back to a section for rework.
    system_id = await _drive_to_pending_review(client)

    r = await client.post(
        f"/v1/systems/{system_id}/workflow/reject",
        json={"note": "missing model card", "assignee_username": _BIZ, "send_to": "business"},
        headers=_hdr(_OFFICER),
    )
    assert r.status_code == 200
    steps = r.json()
    # The workflow step is still named "rejected"; the system returns to the section.
    assert steps[-1]["step"] == "rejected"
    assert steps[-1]["assignee_username"] == _BIZ

    system = (await _status(client, system_id)).json()
    assert system["workflow_status"] == "business_pending"
    # Reassigned back to the business-section owner for rework.
    assert system["assignee_username"] == _BIZ


async def test_reject_rejected_for_non_assignee(client: httpx.AsyncClient):
    system_id = await _drive_to_pending_review(client)

    r = await client.post(
        f"/v1/systems/{system_id}/workflow/reject",
        json={"note": "nope", "assignee_username": _BIZ, "send_to": "business"},
        headers=_hdr("intruder"),
    )
    assert r.status_code == 403


async def test_rejected_system_can_be_resubmitted(client: httpx.AsyncClient):
    # After rejection the section owner reworks and resubmits back up the chain.
    system_id = await _drive_to_pending_review(client)
    assert (await client.post(
        f"/v1/systems/{system_id}/workflow/reject",
        json={"note": "fix it", "assignee_username": _BIZ, "send_to": "business"},
        headers=_hdr(_OFFICER),
    )).status_code == 200
    assert (await _status(client, system_id)).json()["workflow_status"] == "business_pending"

    # Business owner resubmits → technical → compliance review again.
    assert (await client.post(
        f"/v1/systems/{system_id}/workflow/submit-business", json={}, headers=_hdr(_BIZ)
    )).status_code == 200
    assert (await _status(client, system_id)).json()["workflow_status"] == "technical_pending"
    assert (await client.post(
        f"/v1/systems/{system_id}/workflow/submit-technical", json={}, headers=_hdr(_TECH)
    )).status_code == 200
    assert (await _status(client, system_id)).json()["workflow_status"] == "pending_review"
