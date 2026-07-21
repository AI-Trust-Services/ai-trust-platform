"""E2E tests for /api/v1/controls."""
from __future__ import annotations

import httpx

from tests.e2e.conftest import create_assessment, create_control, create_evidence, create_obligation, create_system


# ---------------------------------------------------------------------------
# POST /controls
# ---------------------------------------------------------------------------

async def test_create_control_returns_201(client: httpx.AsyncClient):
    system = await create_system()
    r = await client.post("/api/v1/controls", json={
        "ai_system_id": system["id"],
        "title": "My Control",
        "category": "documentation",
    })
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("CTL-")
    assert body["status"] == "not_started"
    assert body["title"] == "My Control"


async def test_create_org_wide_control_no_system(client: httpx.AsyncClient):
    r = await client.post("/api/v1/controls", json={
        "title": "Org-wide Control",
        "category": "general",
    })
    assert r.status_code == 201
    assert r.json()["ai_system_id"] is None


async def test_create_control_404_on_missing_system(client: httpx.AsyncClient):
    r = await client.post("/api/v1/controls", json={
        "ai_system_id": "SYS-NOTFOUND",
        "title": "X",
        "category": "general",
    })
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# GET /controls
# ---------------------------------------------------------------------------

async def test_list_controls_for_system_includes_org_wide(client: httpx.AsyncClient):
    system = await create_system()
    await create_control(client, system["id"])
    await create_control(client)  # org-wide
    r = await client.get(f"/api/v1/controls?ai_system_id={system['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 2


async def test_list_controls_filter_by_evidence(client: httpx.AsyncClient):
    system = await create_system()
    ctl_a = await create_control(client, system["id"])
    ctl_b = await create_control(client, system["id"])
    evd = await create_evidence(client, control_id=ctl_a["id"])

    r = await client.get(f"/api/v1/controls?evidence_id={evd['id']}")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["id"] == ctl_a["id"]
    assert all(c["id"] != ctl_b["id"] for c in body)


async def test_list_controls_filter_by_obligation(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    ctl = await create_control(client, system["id"])
    await client.post(f"/api/v1/controls/{ctl['id']}/link/{obl['id']}")

    r = await client.get(f"/api/v1/controls?obligation_id={obl['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["id"] == ctl["id"]


# ---------------------------------------------------------------------------
# GET /controls/{id}
# ---------------------------------------------------------------------------

async def test_get_control_returns_detail(client: httpx.AsyncClient):
    system = await create_system()
    ctl = await create_control(client, system["id"])
    r = await client.get(f"/api/v1/controls/{ctl['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == ctl["id"]
    assert "obligation_ids" in body
    assert "evidence_count" in body


async def test_get_control_404_on_missing(client: httpx.AsyncClient):
    r = await client.get("/api/v1/controls/CTL-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /controls/{id}
# ---------------------------------------------------------------------------

async def test_update_control_title(client: httpx.AsyncClient):
    system = await create_system()
    ctl = await create_control(client, system["id"])
    r = await client.put(f"/api/v1/controls/{ctl['id']}", json={"title": "Updated"})
    assert r.status_code == 200
    assert r.json()["title"] == "Updated"


async def test_update_control_status(client: httpx.AsyncClient):
    system = await create_system()
    ctl = await create_control(client, system["id"])
    r = await client.put(f"/api/v1/controls/{ctl['id']}", json={"status": "implemented"})
    assert r.status_code == 200
    assert r.json()["status"] == "implemented"


async def test_update_control_404_on_missing(client: httpx.AsyncClient):
    r = await client.put("/api/v1/controls/CTL-NOTFOUND", json={"title": "X"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /controls/{id}
# ---------------------------------------------------------------------------

async def test_delete_control(client: httpx.AsyncClient):
    system = await create_system()
    ctl = await create_control(client, system["id"])
    r = await client.delete(f"/api/v1/controls/{ctl['id']}")
    assert r.status_code == 200
    assert (await client.get(f"/api/v1/controls/{ctl['id']}")).status_code == 404


async def test_delete_control_404_on_missing(client: httpx.AsyncClient):
    r = await client.delete("/api/v1/controls/CTL-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# POST /controls/{id}/link/{obligation_id}
# ---------------------------------------------------------------------------

async def test_link_control_to_obligation(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    ctl = await create_control(client, system["id"])

    r = await client.post(f"/api/v1/controls/{ctl['id']}/link/{obl['id']}")
    assert r.status_code == 200
    assert obl["id"] in r.json()["obligation_ids"]


async def test_link_idempotent(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    ctl = await create_control(client, system["id"])

    await client.post(f"/api/v1/controls/{ctl['id']}/link/{obl['id']}")
    r = await client.post(f"/api/v1/controls/{ctl['id']}/link/{obl['id']}")
    assert r.status_code == 200
    assert r.json()["obligation_ids"].count(obl["id"]) == 1


async def test_link_404_on_missing_control(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    r = await client.post(f"/api/v1/controls/CTL-NOTFOUND/link/{obl['id']}")
    assert r.status_code == 404


async def test_link_404_on_missing_obligation(client: httpx.AsyncClient):
    system = await create_system()
    ctl = await create_control(client, system["id"])
    r = await client.post(f"/api/v1/controls/{ctl['id']}/link/OBL-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /controls/{id}/link/{obligation_id}
# ---------------------------------------------------------------------------

async def test_unlink_control_from_obligation(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    ctl = await create_control(client, system["id"])
    await client.post(f"/api/v1/controls/{ctl['id']}/link/{obl['id']}")

    r = await client.delete(f"/api/v1/controls/{ctl['id']}/link/{obl['id']}")
    assert r.status_code == 200
    assert obl["id"] not in r.json()["obligation_ids"]


async def test_linking_effective_control_fulfills_obligation(client: httpx.AsyncClient):
    """An effective control linked to an obligation should fulfill it."""
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    ctl = await create_control(client, system["id"])

    # Manually set control to effective
    await client.put(f"/api/v1/controls/{ctl['id']}", json={"status": "effective"})
    await client.post(f"/api/v1/controls/{ctl['id']}/link/{obl['id']}")

    r = await client.get(f"/api/v1/obligations/{obl['id']}")
    assert r.json()["status"] == "fulfilled"
