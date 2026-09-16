"""E2E tests for /v1/requirements."""
from __future__ import annotations

import httpx

from tests.e2e.conftest import create_assessment, create_requirement, create_evidence, create_obligation, create_system


# ---------------------------------------------------------------------------
# POST /requirements
# ---------------------------------------------------------------------------

async def test_create_requirement_returns_201(client: httpx.AsyncClient):
    system = await create_system()
    r = await client.post("/v1/requirements", json={
        "ai_system_id": system["id"],
        "title": "My Requirement",
        "category": "documentation",
    })
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("REQ-")
    assert body["status"] == "open"
    assert body["title"] == "My Requirement"


async def test_create_org_wide_requirement_no_system(client: httpx.AsyncClient):
    r = await client.post("/v1/requirements", json={
        "title": "Org-wide Requirement",
        "category": "general",
    })
    assert r.status_code == 201
    assert r.json()["ai_system_id"] is None


async def test_create_requirement_404_on_missing_system(client: httpx.AsyncClient):
    r = await client.post("/v1/requirements", json={
        "ai_system_id": "SYS-NOTFOUND",
        "title": "X",
        "category": "general",
    })
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# GET /requirements
# ---------------------------------------------------------------------------

async def test_list_requirements_for_system_includes_org_wide(client: httpx.AsyncClient):
    system = await create_system()
    await create_requirement(client, system["id"])
    await create_requirement(client)  # org-wide
    r = await client.get(f"/v1/requirements?ai_system_id={system['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 2


async def test_list_requirements_filter_by_evidence(client: httpx.AsyncClient):
    system = await create_system()
    req_a = await create_requirement(client, system["id"])
    req_b = await create_requirement(client, system["id"])
    evd = await create_evidence(client, requirement_ids=[req_a["id"]])

    r = await client.get(f"/v1/requirements?evidence_id={evd['id']}")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["id"] == req_a["id"]
    assert all(c["id"] != req_b["id"] for c in body)


async def test_list_requirements_filter_by_obligation(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    req = await create_requirement(client, system["id"])
    await client.post(f"/v1/requirements/{req['id']}/link/{obl['id']}")

    r = await client.get(f"/v1/requirements?obligation_id={obl['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["id"] == req["id"]


# ---------------------------------------------------------------------------
# GET /requirements/{id}
# ---------------------------------------------------------------------------

async def test_get_requirement_returns_detail(client: httpx.AsyncClient):
    system = await create_system()
    req = await create_requirement(client, system["id"])
    r = await client.get(f"/v1/requirements/{req['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == req["id"]
    assert "obligation_ids" in body
    assert "evidence_count" in body


async def test_get_requirement_404_on_missing(client: httpx.AsyncClient):
    r = await client.get("/v1/requirements/REQ-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /requirements/{id}
# ---------------------------------------------------------------------------

async def test_update_requirement_title(client: httpx.AsyncClient):
    system = await create_system()
    req = await create_requirement(client, system["id"])
    r = await client.put(f"/v1/requirements/{req['id']}", json={"title": "Updated"})
    assert r.status_code == 200
    assert r.json()["title"] == "Updated"


async def test_update_requirement_status(client: httpx.AsyncClient):
    system = await create_system()
    req = await create_requirement(client, system["id"])
    r = await client.put(f"/v1/requirements/{req['id']}", json={"status": "under_review"})
    assert r.status_code == 200
    assert r.json()["status"] == "under_review"


async def test_update_requirement_404_on_missing(client: httpx.AsyncClient):
    r = await client.put("/v1/requirements/REQ-NOTFOUND", json={"title": "X"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /requirements/{id}
# ---------------------------------------------------------------------------

async def test_delete_requirement(client: httpx.AsyncClient):
    system = await create_system()
    req = await create_requirement(client, system["id"])
    r = await client.delete(f"/v1/requirements/{req['id']}")
    assert r.status_code == 200
    assert (await client.get(f"/v1/requirements/{req['id']}")).status_code == 404


async def test_delete_requirement_404_on_missing(client: httpx.AsyncClient):
    r = await client.delete("/v1/requirements/REQ-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# POST /requirements/{id}/link/{obligation_id}
# ---------------------------------------------------------------------------

async def test_link_requirement_to_obligation(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    req = await create_requirement(client, system["id"])

    r = await client.post(f"/v1/requirements/{req['id']}/link/{obl['id']}")
    assert r.status_code == 200
    assert obl["id"] in r.json()["obligation_ids"]


async def test_link_idempotent(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    req = await create_requirement(client, system["id"])

    await client.post(f"/v1/requirements/{req['id']}/link/{obl['id']}")
    r = await client.post(f"/v1/requirements/{req['id']}/link/{obl['id']}")
    assert r.status_code == 200
    assert r.json()["obligation_ids"].count(obl["id"]) == 1


async def test_link_404_on_missing_requirement(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    r = await client.post(f"/v1/requirements/REQ-NOTFOUND/link/{obl['id']}")
    assert r.status_code == 404


async def test_link_404_on_missing_obligation(client: httpx.AsyncClient):
    system = await create_system()
    req = await create_requirement(client, system["id"])
    r = await client.post(f"/v1/requirements/{req['id']}/link/OBL-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /requirements/{id}/link/{obligation_id}
# ---------------------------------------------------------------------------

async def test_unlink_requirement_from_obligation(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    req = await create_requirement(client, system["id"])
    await client.post(f"/v1/requirements/{req['id']}/link/{obl['id']}")

    r = await client.delete(f"/v1/requirements/{req['id']}/link/{obl['id']}")
    assert r.status_code == 200
    assert obl["id"] not in r.json()["obligation_ids"]


async def test_linking_effective_requirement_fulfills_obligation(client: httpx.AsyncClient):
    """An effective requirement linked to an obligation should fulfill it."""
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    req = await create_requirement(client, system["id"])

    # Manually set requirement to fulfilled
    await client.put(f"/v1/requirements/{req['id']}", json={"status": "fulfilled"})
    await client.post(f"/v1/requirements/{req['id']}/link/{obl['id']}")

    r = await client.get(f"/v1/obligations/{obl['id']}")
    assert r.json()["status"] == "fulfilled"
