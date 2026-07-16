"""E2E tests for /api/v1/evidence."""
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
# POST /evidence
# ---------------------------------------------------------------------------

async def test_create_evidence_linked_to_control(client: httpx.AsyncClient):
    system = await create_system()
    ctl = await create_control(client, system["id"])
    r = await client.post("/api/v1/evidence", data={
        "title": "My Evidence",
        "evidence_type": "document",
        "control_id": ctl["id"],
    })
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("EVD-")
    assert body["status"] == "pending"
    assert ctl["id"] in body["control_ids"]


async def test_create_evidence_linked_to_obligation(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    r = await client.post("/api/v1/evidence", data={
        "title": "My Evidence",
        "evidence_type": "document",
        "obligation_id": obl["id"],
    })
    assert r.status_code == 201
    assert obl["id"] in r.json()["obligation_ids"]


async def test_create_evidence_linked_to_system(client: httpx.AsyncClient):
    system = await create_system()
    evd = await create_evidence(client, ai_system_id=system["id"])
    assert evd["ai_system_id"] == system["id"]


async def test_create_evidence_requires_link_target(client: httpx.AsyncClient):
    r = await client.post("/api/v1/evidence", data={
        "title": "Orphan Evidence",
        "evidence_type": "document",
    })
    assert r.status_code == 422


async def test_create_evidence_404_on_missing_control(client: httpx.AsyncClient):
    r = await client.post("/api/v1/evidence", data={
        "title": "X",
        "evidence_type": "document",
        "control_id": "CTL-NOTFOUND",
    })
    assert r.status_code == 404


async def test_create_evidence_rejects_disallowed_extension(client: httpx.AsyncClient):
    system = await create_system()
    ctl = await create_control(client, system["id"])
    r = await client.post(
        "/api/v1/evidence",
        data={"title": "X", "evidence_type": "document", "control_id": ctl["id"]},
        files={"file": ("malware.exe", b"bad content", "application/octet-stream")},
    )
    assert r.status_code == 422


async def test_create_evidence_with_valid_file(client: httpx.AsyncClient):
    system = await create_system()
    ctl = await create_control(client, system["id"])
    r = await client.post(
        "/api/v1/evidence",
        data={"title": "Policy Doc", "evidence_type": "policy_document", "control_id": ctl["id"]},
        files={"file": ("policy.pdf", b"%PDF-fake", "application/pdf")},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["file_name"] == "policy.pdf"
    assert body["file_size"] == len(b"%PDF-fake")


# ---------------------------------------------------------------------------
# GET /evidence
# ---------------------------------------------------------------------------

async def test_list_evidence_filter_by_control(client: httpx.AsyncClient):
    system = await create_system()
    ctl = await create_control(client, system["id"])
    await create_evidence(client, control_id=ctl["id"])
    await create_evidence(client, ai_system_id=system["id"])

    r = await client.get(f"/api/v1/evidence?control_id={ctl['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 1


async def test_list_evidence_filter_by_system(client: httpx.AsyncClient):
    system = await create_system()
    await create_evidence(client, ai_system_id=system["id"])
    r = await client.get(f"/api/v1/evidence?ai_system_id={system['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 1


# ---------------------------------------------------------------------------
# GET /evidence/{id}
# ---------------------------------------------------------------------------

async def test_get_evidence_returns_detail(client: httpx.AsyncClient):
    system = await create_system()
    evd = await create_evidence(client, ai_system_id=system["id"])
    r = await client.get(f"/api/v1/evidence/{evd['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == evd["id"]
    assert "control_ids" in body
    assert "obligation_ids" in body


async def test_get_evidence_404_on_missing(client: httpx.AsyncClient):
    r = await client.get("/api/v1/evidence/EVD-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /evidence/{id}
# ---------------------------------------------------------------------------

async def test_update_evidence_title(client: httpx.AsyncClient):
    system = await create_system()
    evd = await create_evidence(client, ai_system_id=system["id"])
    r = await client.put(f"/api/v1/evidence/{evd['id']}", json={"title": "Updated"})
    assert r.status_code == 200
    assert r.json()["title"] == "Updated"


async def test_update_evidence_404_on_missing(client: httpx.AsyncClient):
    r = await client.put("/api/v1/evidence/EVD-NOTFOUND", json={"title": "X"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /evidence/{id}
# ---------------------------------------------------------------------------

async def test_delete_evidence(client: httpx.AsyncClient):
    system = await create_system()
    evd = await create_evidence(client, ai_system_id=system["id"])
    r = await client.delete(f"/api/v1/evidence/{evd['id']}")
    assert r.status_code == 200
    assert (await client.get(f"/api/v1/evidence/{evd['id']}")).status_code == 404


async def test_delete_evidence_404_on_missing(client: httpx.AsyncClient):
    r = await client.delete("/api/v1/evidence/EVD-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# POST /evidence/{id}/approve and /reject
# ---------------------------------------------------------------------------

async def test_approve_evidence(client: httpx.AsyncClient):
    system = await create_system()
    evd = await create_evidence(client, ai_system_id=system["id"])
    r = await client.post(f"/api/v1/evidence/{evd['id']}/approve")
    assert r.status_code == 200
    assert r.json()["status"] == "approved"


async def test_reject_evidence(client: httpx.AsyncClient):
    system = await create_system()
    evd = await create_evidence(client, ai_system_id=system["id"])
    r = await client.post(f"/api/v1/evidence/{evd['id']}/reject")
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"


async def test_approve_evidence_promotes_linked_control_to_effective(client: httpx.AsyncClient):
    system = await create_system()
    ctl = await create_control(client, system["id"])
    evd = await create_evidence(client, control_id=ctl["id"])

    await client.post(f"/api/v1/evidence/{evd['id']}/approve")

    r = await client.get(f"/api/v1/controls/{ctl['id']}")
    assert r.json()["status"] == "effective"


async def test_approve_evidence_fulfills_obligation_via_effective_control(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    ctl = await create_control(client, system["id"])
    await client.post(f"/api/v1/controls/{ctl['id']}/link/{obl['id']}")
    evd = await create_evidence(client, control_id=ctl["id"])

    await client.post(f"/api/v1/evidence/{evd['id']}/approve")

    r = await client.get(f"/api/v1/obligations/{obl['id']}")
    assert r.json()["status"] == "fulfilled"


async def test_reject_evidence_demotes_control_from_effective(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    ctl = await create_control(client, system["id"])
    await client.post(f"/api/v1/controls/{ctl['id']}/link/{obl['id']}")
    evd = await create_evidence(client, control_id=ctl["id"])
    await client.post(f"/api/v1/evidence/{evd['id']}/approve")

    # Now reject — control should drop from effective
    await client.post(f"/api/v1/evidence/{evd['id']}/reject")

    ctl_r = await client.get(f"/api/v1/controls/{ctl['id']}")
    assert ctl_r.json()["status"] != "effective"

    obl_r = await client.get(f"/api/v1/obligations/{obl['id']}")
    assert obl_r.json()["status"] != "fulfilled"


# ---------------------------------------------------------------------------
# GET /evidence/{id}/download-url
# ---------------------------------------------------------------------------

async def test_download_url_returned_for_evidence_with_file(client: httpx.AsyncClient):
    system = await create_system()
    ctl = await create_control(client, system["id"])
    r = await client.post(
        "/api/v1/evidence",
        data={"title": "Doc", "evidence_type": "document", "control_id": ctl["id"]},
        files={"file": ("doc.pdf", b"%PDF-fake", "application/pdf")},
    )
    evd_id = r.json()["id"]
    r = await client.get(f"/api/v1/evidence/{evd_id}/download-url")
    assert r.status_code == 200
    assert "url" in r.json()


async def test_download_url_404_for_evidence_without_file(client: httpx.AsyncClient):
    system = await create_system()
    evd = await create_evidence(client, ai_system_id=system["id"])
    r = await client.get(f"/api/v1/evidence/{evd['id']}/download-url")
    assert r.status_code == 404


async def test_evidence_response_does_not_expose_internal_file_path(client: httpx.AsyncClient):
    """file_path is an internal MinIO key and must not appear in list/get responses."""
    system = await create_system()
    ctl = await create_control(client, system["id"])
    r = await client.post(
        "/api/v1/evidence",
        data={"title": "Doc", "evidence_type": "document", "control_id": ctl["id"]},
        files={"file": ("policy.pdf", b"%PDF-fake", "application/pdf")},
    )
    assert r.status_code == 201
    body = r.json()
    assert "file_path" not in body, "internal MinIO key must not be part of the public response"

    get_body = (await client.get(f"/api/v1/evidence/{body['id']}")).json()
    assert "file_path" not in get_body


async def test_upload_evidence_rejects_oversized_file(client: httpx.AsyncClient):
    system = await create_system()
    ctl = await create_control(client, system["id"])
    oversized = b"x" * (100 * 1024 * 1024 + 1)  # 1 byte over the 100 MB limit
    r = await client.post(
        "/api/v1/evidence",
        data={"title": "Big file", "evidence_type": "document", "control_id": ctl["id"]},
        files={"file": ("big.pdf", oversized, "application/pdf")},
        timeout=30,
    )
    assert r.status_code == 413
