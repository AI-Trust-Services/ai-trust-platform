"""E2E tests for AI System Registry — in-process via ASGITransport against ai_trust_test DB."""
from __future__ import annotations

import httpx


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ASSIGNEE = "engineer1"
# The workflow router and PUT /systems read the acting user from this header
# (set by oauth2-proxy in production). Only the assigned user may mutate a system.
_HEADERS = {"x-forwarded-preferred-username": _ASSIGNEE}


def _minimal_system() -> dict:
    return {"name": "E2E Test System", "assignee_username": _ASSIGNEE}


async def _create_system(client: httpx.AsyncClient, payload: dict | None = None) -> dict:
    payload = payload or _minimal_system()
    payload.setdefault("assignee_username", _ASSIGNEE)
    r = await client.post("/v1/intake", json=payload, headers=_HEADERS)
    assert r.status_code == 201
    return r.json()


async def _create_model_card(client: httpx.AsyncClient) -> dict:
    r = await client.post("/v1/model-cards", json={"name": "Test Model", "provider": "Test"})
    assert r.status_code == 201
    return r.json()


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

async def test_health_returns_ok(client: httpx.AsyncClient):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# POST /intake — tracer bullet
# ---------------------------------------------------------------------------

async def test_intake_registers_system_and_returns_classification(client: httpx.AsyncClient):
    r = await client.post("/v1/intake", json=_minimal_system(), headers=_HEADERS)
    assert r.status_code == 201
    body = r.json()
    assert body["system"]["id"].startswith("SYS-")
    assert body["system"]["name"] == "E2E Test System"
    # Intake creates a draft stub — classification is deferred until risk flags
    # are filled in (via PUT) or /reclassify is called.
    assert body["classification"]["tier"] == "minimal"
    assert body["system"]["workflow_status"] == "draft"


async def test_update_flag_classifies_prohibited_system(client: httpx.AsyncClient):
    # Intake no longer classifies — setting a risk flag via PUT triggers reclassification.
    system_id = (await _create_system(client))["system"]["id"]
    r = await client.put(
        f"/v1/systems/{system_id}", json={"subliminal_manipulation": True}, headers=_HEADERS
    )
    assert r.status_code == 200
    assert r.json()["tier"] == "prohibited"


async def test_update_flag_classifies_high_risk_system(client: httpx.AsyncClient):
    system_id = (await _create_system(client))["system"]["id"]
    r = await client.put(
        f"/v1/systems/{system_id}", json={"is_biometric_identification": True}, headers=_HEADERS
    )
    assert r.status_code == 200
    assert r.json()["tier"] == "high"


async def test_intake_rejects_missing_name(client: httpx.AsyncClient):
    r = await client.post("/v1/intake", json={"assignee_username": _ASSIGNEE}, headers=_HEADERS)
    assert r.status_code == 422


async def test_intake_rejects_missing_assignee(client: httpx.AsyncClient):
    r = await client.post("/v1/intake", json={"name": "No Assignee"}, headers=_HEADERS)
    assert r.status_code == 422


async def test_update_system_lifecycle(client: httpx.AsyncClient):
    # lifecycle is not an intake field — it is set later via PUT.
    system_id = (await _create_system(client))["system"]["id"]
    r = await client.put(f"/v1/systems/{system_id}", json={"lifecycle": "market"}, headers=_HEADERS)
    assert r.status_code == 200
    assert r.json()["lifecycle"] == "market"


# ---------------------------------------------------------------------------
# GET /systems
# ---------------------------------------------------------------------------

async def test_list_systems_returns_registered_system(client: httpx.AsyncClient):
    await _create_system(client)
    r = await client.get("/v1/systems")
    assert r.status_code == 200
    systems = r.json()
    assert len(systems) == 1
    assert systems[0]["name"] == "E2E Test System"


async def test_list_systems_pagination(client: httpx.AsyncClient):
    for i in range(3):
        await _create_system(client, {"name": f"System {i}"})
    r = await client.get("/v1/systems?limit=2&offset=0")
    assert r.status_code == 200
    assert len(r.json()) == 2


# ---------------------------------------------------------------------------
# GET /systems/{id}
# ---------------------------------------------------------------------------

async def test_get_system_returns_correct_record(client: httpx.AsyncClient):
    system_id = (await _create_system(client))["system"]["id"]
    r = await client.get(f"/v1/systems/{system_id}")
    assert r.status_code == 200
    assert r.json()["id"] == system_id


async def test_get_system_404_on_missing(client: httpx.AsyncClient):
    r = await client.get("/v1/systems/SYS-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /systems/{id}
# ---------------------------------------------------------------------------

async def test_update_system_mutable_field(client: httpx.AsyncClient):
    system_id = (await _create_system(client))["system"]["id"]
    r = await client.put(f"/v1/systems/{system_id}", json={"name": "Updated Name"}, headers=_HEADERS)
    assert r.status_code == 200
    assert r.json()["name"] == "Updated Name"


async def test_update_system_rejected_for_non_assignee(client: httpx.AsyncClient):
    # Only the assigned user may mutate the system.
    system_id = (await _create_system(client))["system"]["id"]
    r = await client.put(
        f"/v1/systems/{system_id}",
        json={"name": "Hijacked"},
        headers={"x-forwarded-preferred-username": "someone-else"},
    )
    assert r.status_code == 403


async def test_update_system_rejects_immutable_basis(client: httpx.AsyncClient):
    system_id = (await _create_system(client))["system"]["id"]
    # basis is in _IMMUTABLE_FIELDS — router returns 422 if client somehow sends it
    # AISystemUpdate has no basis field so Pydantic strips it; test the lifecycle validation instead
    r = await client.put(f"/v1/systems/{system_id}", json={"lifecycle": "invalid_lifecycle"})
    assert r.status_code == 422


async def test_update_system_404_on_missing(client: httpx.AsyncClient):
    r = await client.put("/v1/systems/SYS-NOTFOUND", json={"name": "X"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /systems/{id}
# ---------------------------------------------------------------------------

async def test_delete_system_removes_record(client: httpx.AsyncClient):
    system_id = (await _create_system(client))["system"]["id"]
    r = await client.delete(f"/v1/systems/{system_id}")
    assert r.status_code == 200
    assert r.json()["id"] == system_id
    assert (await client.get(f"/v1/systems/{system_id}")).status_code == 404


async def test_delete_system_404_on_missing(client: httpx.AsyncClient):
    r = await client.delete("/v1/systems/SYS-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /systems/{id}/model — link model card
# ---------------------------------------------------------------------------

async def test_link_model_card_to_system(client: httpx.AsyncClient):
    system_id = (await _create_system(client))["system"]["id"]
    model_id = (await _create_model_card(client))["id"]
    r = await client.put(f"/v1/systems/{system_id}/model?model_id={model_id}")
    assert r.status_code == 200
    assert r.json()["model_id"] == model_id


async def test_link_model_card_404_on_missing_system(client: httpx.AsyncClient):
    model_id = (await _create_model_card(client))["id"]
    r = await client.put(f"/v1/systems/SYS-NOTFOUND/model?model_id={model_id}")
    assert r.status_code == 404


async def test_link_model_card_404_on_missing_model(client: httpx.AsyncClient):
    system_id = (await _create_system(client))["system"]["id"]
    r = await client.put(f"/v1/systems/{system_id}/model?model_id=MDL-NOTFOUND")
    assert r.status_code == 404
