"""E2E tests for /v1/requirements."""

from __future__ import annotations

import httpx

from tests.e2e.conftest import (
    create_assessment,
    create_requirement,
    create_evidence,
    create_obligation,
    create_system,
)


# ---------------------------------------------------------------------------
# POST /requirements
# ---------------------------------------------------------------------------


async def test_create_requirement_returns_201(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    r = await client.post(
        "/v1/requirements",
        json={
            "obligation_id": obl["id"],
            "title": "My Requirement",
            "category": "documentation",
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("REQ-")
    assert body["status"] == "open"
    assert body["title"] == "My Requirement"
    assert body["obligation_id"] == obl["id"]
    assert body["assessment_id"] == ass["id"]


async def test_create_requirement_404_on_missing_obligation(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/requirements",
        json={
            "obligation_id": "OBL-NOTFOUND",
            "title": "X",
            "category": "general",
        },
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# GET /requirements
# ---------------------------------------------------------------------------


async def test_list_requirements_for_obligation(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    await create_requirement(client, obligation_id=obl["id"])
    await create_requirement(client, obligation_id=obl["id"])
    r = await client.get(f"/v1/requirements?obligation_id={obl['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 2


async def test_list_requirements_filter_by_evidence(client: httpx.AsyncClient):
    req_a = await create_requirement(client)
    req_b = await create_requirement(client)
    evd = await create_evidence(client, requirement_ids=[req_a["id"]])

    r = await client.get(f"/v1/requirements?evidence_id={evd['id']}")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["id"] == req_a["id"]
    assert all(c["id"] != req_b["id"] for c in body)


# ---------------------------------------------------------------------------
# GET /requirements/{id}
# ---------------------------------------------------------------------------


async def test_get_requirement_returns_detail(client: httpx.AsyncClient):
    req = await create_requirement(client)
    r = await client.get(f"/v1/requirements/{req['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == req["id"]
    assert "evidence_count" in body
    assert body["obligation_id"] == req["obligation_id"]


async def test_get_requirement_404_on_missing(client: httpx.AsyncClient):
    r = await client.get("/v1/requirements/REQ-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /requirements/{id}
# ---------------------------------------------------------------------------


async def test_update_requirement_title(client: httpx.AsyncClient):
    req = await create_requirement(client)
    r = await client.put(f"/v1/requirements/{req['id']}", json={"title": "Updated"})
    assert r.status_code == 200
    assert r.json()["title"] == "Updated"


async def test_update_requirement_status(client: httpx.AsyncClient):
    req = await create_requirement(client)
    r = await client.put(
        f"/v1/requirements/{req['id']}", json={"status": "under_review"}
    )
    assert r.status_code == 200
    assert r.json()["status"] == "under_review"


async def test_update_requirement_404_on_missing(client: httpx.AsyncClient):
    r = await client.put("/v1/requirements/REQ-NOTFOUND", json={"title": "X"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /requirements/{id}
# ---------------------------------------------------------------------------


async def test_delete_requirement(client: httpx.AsyncClient):
    req = await create_requirement(client)
    r = await client.delete(f"/v1/requirements/{req['id']}")
    assert r.status_code == 200
    assert (await client.get(f"/v1/requirements/{req['id']}")).status_code == 404


async def test_delete_requirement_404_on_missing(client: httpx.AsyncClient):
    r = await client.delete("/v1/requirements/REQ-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Cascade: deleting a requirement refreshes the obligation
# ---------------------------------------------------------------------------


async def test_delete_requirement_cascades_obligation_status(client: httpx.AsyncClient):
    """Deleting the only requirement on an obligation reverts it to 'applicable'."""
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    req = await create_requirement(client, obligation_id=obl["id"])

    # Once linked the obligation becomes in_progress
    r = await client.get(f"/v1/obligations/{obl['id']}")
    assert r.json()["status"] == "in_progress"

    await client.delete(f"/v1/requirements/{req['id']}")

    r = await client.get(f"/v1/obligations/{obl['id']}")
    assert r.json()["status"] == "applicable"
