"""E2E tests for /v1/controls."""
from __future__ import annotations

import httpx

from tests.e2e.conftest import (
    create_assessment,
    create_control,
    create_evidence,
    create_obligation,
    create_system,
)


# ---------------------------------------------------------------------------
# POST /controls
# ---------------------------------------------------------------------------

async def test_create_control_returns_201(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    r = await client.post("/v1/controls", json={
        "obligation_id": obl["id"],
        "title": "My Control",
        "category": "documentation",
    })
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("CTL-")
    assert body["status"] == "open"
    assert body["title"] == "My Control"
    assert body["obligation_id"] == obl["id"]
    assert body["assessment_id"] == ass["id"]
    assert body["ai_system_id"] == system["id"]


async def test_create_control_404_on_missing_obligation(client: httpx.AsyncClient):
    r = await client.post("/v1/controls", json={
        "obligation_id": "OBL-NOTFOUND",
        "title": "X",
        "category": "general",
    })
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# GET /controls
# ---------------------------------------------------------------------------

async def test_list_controls_filter_by_system(client: httpx.AsyncClient):
    system = await create_system()
    other = await create_system(name="Other")
    await create_control(client, system_id=system["id"])
    await create_control(client, system_id=other["id"])

    r = await client.get(f"/v1/controls?ai_system_id={system['id']}")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["ai_system_id"] == system["id"]


async def test_list_controls_filter_by_obligation(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl_a = await create_obligation(client, ass["id"])
    obl_b = await create_obligation(client, ass["id"])
    ctl_a = await create_control(client, obligation_id=obl_a["id"])
    await create_control(client, obligation_id=obl_b["id"])

    r = await client.get(f"/v1/controls?obligation_id={obl_a['id']}")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["id"] == ctl_a["id"]


async def test_list_controls_filter_by_evidence(client: httpx.AsyncClient):
    system = await create_system()
    ctl_a = await create_control(client, system_id=system["id"])
    ctl_b = await create_control(client, system_id=system["id"])
    evd = await create_evidence(client, control_ids=[ctl_a["id"]])

    r = await client.get(f"/v1/controls?evidence_id={evd['id']}")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["id"] == ctl_a["id"]
    assert all(c["id"] != ctl_b["id"] for c in body)


# ---------------------------------------------------------------------------
# GET /controls/{id}
# ---------------------------------------------------------------------------

async def test_get_control_returns_detail(client: httpx.AsyncClient):
    ctl = await create_control(client)
    r = await client.get(f"/v1/controls/{ctl['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == ctl["id"]
    assert "evidence_count" in body
    assert "obligation_id" in body


async def test_get_control_404_on_missing(client: httpx.AsyncClient):
    r = await client.get("/v1/controls/CTL-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /controls/{id}
# ---------------------------------------------------------------------------

async def test_update_control_title(client: httpx.AsyncClient):
    ctl = await create_control(client)
    r = await client.put(f"/v1/controls/{ctl['id']}", json={"title": "Updated"})
    assert r.status_code == 200
    assert r.json()["title"] == "Updated"


async def test_update_control_status(client: httpx.AsyncClient):
    ctl = await create_control(client)
    r = await client.put(f"/v1/controls/{ctl['id']}", json={"status": "under_review"})
    assert r.status_code == 200
    assert r.json()["status"] == "under_review"


async def test_update_control_obligation_id_re_derives_assessment(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl_a = await create_obligation(client, ass["id"])
    obl_b = await create_obligation(client, ass["id"])
    ctl = await create_control(client, obligation_id=obl_a["id"])

    r = await client.put(f"/v1/controls/{ctl['id']}", json={"obligation_id": obl_b["id"]})
    assert r.status_code == 200
    body = r.json()
    assert body["obligation_id"] == obl_b["id"]
    # assessment_id stays the same since both obligations are in the same assessment
    assert body["assessment_id"] == ass["id"]


async def test_update_control_404_on_missing(client: httpx.AsyncClient):
    r = await client.put("/v1/controls/CTL-NOTFOUND", json={"title": "X"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /controls/{id}
# ---------------------------------------------------------------------------

async def test_delete_control(client: httpx.AsyncClient):
    ctl = await create_control(client)
    r = await client.delete(f"/v1/controls/{ctl['id']}")
    assert r.status_code == 200
    assert (await client.get(f"/v1/controls/{ctl['id']}")).status_code == 404


async def test_delete_control_404_on_missing(client: httpx.AsyncClient):
    r = await client.delete("/v1/controls/CTL-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Cascade: fulfilled control → obligation status
# ---------------------------------------------------------------------------

async def test_fulfilled_control_fulfills_obligation(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    ctl = await create_control(client, obligation_id=obl["id"])

    await client.put(f"/v1/controls/{ctl['id']}", json={"status": "fulfilled"})

    r = await client.get(f"/v1/obligations/{obl['id']}")
    assert r.json()["status"] == "fulfilled"
