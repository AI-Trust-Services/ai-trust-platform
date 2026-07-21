"""E2E tests for /api/v1/obligations."""
from __future__ import annotations

import httpx

from tests.e2e.conftest import create_assessment, create_control, create_obligation, create_system


# ---------------------------------------------------------------------------
# POST /obligations
# ---------------------------------------------------------------------------

async def test_create_obligation_returns_201(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    r = await client.post("/api/v1/obligations", json={
        "assessment_id": ass["id"],
        "title": "My Obligation",
        "article_ref": "Art. 9",
    })
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("OBL-")
    assert body["status"] == "applicable"
    assert body["title"] == "My Obligation"
    assert body["article_ref"] == "Art. 9"


async def test_create_obligation_404_on_missing_assessment(client: httpx.AsyncClient):
    r = await client.post("/api/v1/obligations", json={
        "assessment_id": "ASS-NOTFOUND",
        "title": "X",
    })
    assert r.status_code == 404


async def test_create_obligation_in_approved_assessment_returns_409(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    await client.post(f"/api/v1/assessments/{ass['id']}/submit")
    await client.post(f"/api/v1/assessments/{ass['id']}/approve")
    r = await client.post("/api/v1/obligations", json={
        "assessment_id": ass["id"],
        "title": "Late Obligation",
    })
    assert r.status_code == 409


async def test_create_obligation_blank_title_returns_422(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    r = await client.post("/api/v1/obligations", json={
        "assessment_id": ass["id"],
        "title": "   ",
    })
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# GET /obligations
# ---------------------------------------------------------------------------

async def test_list_obligations_filter_by_assessment(client: httpx.AsyncClient):
    system = await create_system()
    ass1 = await create_assessment(client, system["id"])
    ass2 = await create_assessment(client, system["id"])
    # Auto-generation creates 3 obligations per assessment (minimal tier).
    # Add 2 more manually to ass1 so we can assert the filter is working.
    await create_obligation(client, ass1["id"])
    await create_obligation(client, ass1["id"])

    r = await client.get(f"/api/v1/obligations?assessment_id={ass1['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 5  # 3 auto-generated + 2 manual

    r2 = await client.get(f"/api/v1/obligations?assessment_id={ass2['id']}")
    assert len(r2.json()) == 3  # only auto-generated


async def test_list_obligations_filter_by_control(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obs = (await client.get(f"/api/v1/obligations?assessment_id={ass['id']}")).json()
    # Link a control to exactly one of the assessment's obligations.
    ctl = await create_control(client, system["id"])
    await client.post(f"/api/v1/controls/{ctl['id']}/link/{obs[0]['id']}")

    r = await client.get(f"/api/v1/obligations?control_id={ctl['id']}")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["id"] == obs[0]["id"]


async def test_list_obligations_filter_by_status(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    await client.put(f"/api/v1/obligations/{obl['id']}", json={"status": "not_applicable"})

    r = await client.get("/api/v1/obligations?status=not_applicable")
    assert r.status_code == 200
    assert all(o["status"] == "not_applicable" for o in r.json())


# ---------------------------------------------------------------------------
# GET /obligations/{id}
# ---------------------------------------------------------------------------

async def test_get_obligation_returns_detail(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    r = await client.get(f"/api/v1/obligations/{obl['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == obl["id"]
    assert "control_ids" in body


async def test_get_obligation_404_on_missing(client: httpx.AsyncClient):
    r = await client.get("/api/v1/obligations/OBL-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /obligations/{id}
# ---------------------------------------------------------------------------

async def test_update_obligation_title(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    r = await client.put(f"/api/v1/obligations/{obl['id']}", json={"title": "Updated"})
    assert r.status_code == 200
    assert r.json()["title"] == "Updated"


async def test_update_obligation_status_to_not_applicable(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    r = await client.put(f"/api/v1/obligations/{obl['id']}", json={"status": "not_applicable"})
    assert r.status_code == 200
    assert r.json()["status"] == "not_applicable"


async def test_update_obligation_invalid_status_returns_422(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    r = await client.put(f"/api/v1/obligations/{obl['id']}", json={"status": "invalid"})
    assert r.status_code == 422


async def test_update_obligation_in_approved_assessment_returns_409(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    await client.post(f"/api/v1/assessments/{ass['id']}/submit")
    await client.post(f"/api/v1/assessments/{ass['id']}/approve")
    r = await client.put(f"/api/v1/obligations/{obl['id']}", json={"title": "X"})
    assert r.status_code == 409


async def test_update_obligation_404_on_missing(client: httpx.AsyncClient):
    r = await client.put("/api/v1/obligations/OBL-NOTFOUND", json={"title": "X"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /obligations/{id}
# ---------------------------------------------------------------------------

async def test_delete_obligation(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    r = await client.delete(f"/api/v1/obligations/{obl['id']}")
    assert r.status_code == 200
    assert (await client.get(f"/api/v1/obligations/{obl['id']}")).status_code == 404


async def test_delete_obligation_in_approved_assessment_returns_409(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    await client.post(f"/api/v1/assessments/{ass['id']}/submit")
    await client.post(f"/api/v1/assessments/{ass['id']}/approve")
    r = await client.delete(f"/api/v1/obligations/{obl['id']}")
    assert r.status_code == 409


async def test_delete_obligation_404_on_missing(client: httpx.AsyncClient):
    r = await client.delete("/api/v1/obligations/OBL-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Assessment score updates when obligation status changes
# ---------------------------------------------------------------------------

async def test_marking_obligation_fulfilled_updates_score(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    # Auto-generation creates 3 obligations (minimal tier). Mark all fulfilled.
    obs = (await client.get(f"/api/v1/obligations?assessment_id={ass['id']}")).json()
    for o in obs:
        await client.put(f"/api/v1/obligations/{o['id']}", json={"status": "fulfilled"})

    r = await client.get(f"/api/v1/assessments/{ass['id']}")
    assert r.json()["score"] == 100.0


async def test_marking_all_obligations_not_applicable_sets_score_none(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    # Auto-generation creates 3 obligations (minimal tier). Mark all not_applicable.
    obs = (await client.get(f"/api/v1/obligations?assessment_id={ass['id']}")).json()
    for o in obs:
        await client.put(f"/api/v1/obligations/{o['id']}", json={"status": "not_applicable"})

    r = await client.get(f"/api/v1/assessments/{ass['id']}")
    assert r.json()["score"] is None
