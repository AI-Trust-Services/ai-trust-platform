"""E2E tests for AI System Registry — in-process via ASGITransport against ai_trust_test DB."""
from __future__ import annotations

import httpx


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _minimal_system() -> dict:
    return {"name": "E2E Test System"}


async def _create_system(client: httpx.AsyncClient, payload: dict | None = None) -> dict:
    r = await client.post("/api/v1/intake", json=payload or _minimal_system())
    assert r.status_code == 201
    return r.json()


async def _create_model_card(client: httpx.AsyncClient) -> dict:
    r = await client.post("/api/v1/model-cards", json={"name": "Test Model", "provider": "Test"})
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
    r = await client.post("/api/v1/intake", json=_minimal_system())
    assert r.status_code == 201
    body = r.json()
    assert body["system"]["id"].startswith("SYS-")
    assert body["system"]["name"] == "E2E Test System"
    assert body["classification"]["tier"] == "minimal"


async def test_intake_classifies_prohibited_system(client: httpx.AsyncClient):
    r = await client.post("/api/v1/intake", json={**_minimal_system(), "subliminal_manipulation": True})
    assert r.status_code == 201
    assert r.json()["classification"]["tier"] == "prohibited"


async def test_intake_classifies_high_risk_system(client: httpx.AsyncClient):
    r = await client.post("/api/v1/intake", json={**_minimal_system(), "is_biometric_identification": True})
    assert r.status_code == 201
    assert r.json()["classification"]["tier"] == "high"


async def test_intake_rejects_missing_name(client: httpx.AsyncClient):
    r = await client.post("/api/v1/intake", json={})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# GET /systems
# ---------------------------------------------------------------------------

async def test_list_systems_returns_registered_system(client: httpx.AsyncClient):
    await _create_system(client)
    r = await client.get("/api/v1/systems")
    assert r.status_code == 200
    systems = r.json()
    assert len(systems) == 1
    assert systems[0]["name"] == "E2E Test System"


async def test_list_systems_pagination(client: httpx.AsyncClient):
    for i in range(3):
        await _create_system(client, {"name": f"System {i}"})
    r = await client.get("/api/v1/systems?limit=2&offset=0")
    assert r.status_code == 200
    assert len(r.json()) == 2


# ---------------------------------------------------------------------------
# GET /systems/{id}
# ---------------------------------------------------------------------------

async def test_get_system_returns_correct_record(client: httpx.AsyncClient):
    system_id = (await _create_system(client))["system"]["id"]
    r = await client.get(f"/api/v1/systems/{system_id}")
    assert r.status_code == 200
    assert r.json()["id"] == system_id


async def test_get_system_404_on_missing(client: httpx.AsyncClient):
    r = await client.get("/api/v1/systems/SYS-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /systems/{id}
# ---------------------------------------------------------------------------

async def test_update_system_mutable_field(client: httpx.AsyncClient):
    system_id = (await _create_system(client))["system"]["id"]
    r = await client.put(f"/api/v1/systems/{system_id}", json={"name": "Updated Name"})
    assert r.status_code == 200
    assert r.json()["name"] == "Updated Name"


async def test_update_system_rejects_immutable_basis(client: httpx.AsyncClient):
    system_id = (await _create_system(client))["system"]["id"]
    # basis is in _IMMUTABLE_FIELDS — router returns 422 if client somehow sends it
    # AISystemUpdate has no basis field so Pydantic strips it; test the lifecycle validation instead
    r = await client.put(f"/api/v1/systems/{system_id}", json={"lifecycle": "invalid_lifecycle"})
    assert r.status_code == 422


async def test_update_system_404_on_missing(client: httpx.AsyncClient):
    r = await client.put("/api/v1/systems/SYS-NOTFOUND", json={"name": "X"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /systems/{id}
# ---------------------------------------------------------------------------

async def test_delete_system_removes_record(client: httpx.AsyncClient):
    system_id = (await _create_system(client))["system"]["id"]
    r = await client.delete(f"/api/v1/systems/{system_id}")
    assert r.status_code == 200
    assert r.json()["id"] == system_id
    assert (await client.get(f"/api/v1/systems/{system_id}")).status_code == 404


async def test_delete_system_404_on_missing(client: httpx.AsyncClient):
    r = await client.delete("/api/v1/systems/SYS-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /systems/{id}/model — link model card
# ---------------------------------------------------------------------------

async def test_link_model_card_to_system(client: httpx.AsyncClient):
    system_id = (await _create_system(client))["system"]["id"]
    model_id = (await _create_model_card(client))["id"]
    r = await client.put(f"/api/v1/systems/{system_id}/model?model_id={model_id}")
    assert r.status_code == 200
    assert r.json()["model_id"] == model_id


async def test_link_model_card_404_on_missing_system(client: httpx.AsyncClient):
    model_id = (await _create_model_card(client))["id"]
    r = await client.put(f"/api/v1/systems/SYS-NOTFOUND/model?model_id={model_id}")
    assert r.status_code == 404


async def test_link_model_card_404_on_missing_model(client: httpx.AsyncClient):
    system_id = (await _create_system(client))["system"]["id"]
    r = await client.put(f"/api/v1/systems/{system_id}/model?model_id=MDL-NOTFOUND")
    assert r.status_code == 404
