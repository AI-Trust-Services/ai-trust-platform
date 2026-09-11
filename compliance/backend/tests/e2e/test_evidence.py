"""E2E tests for /v1/evidence."""
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
    ctl = await create_control(client)
    r = await client.post("/v1/evidence", data=[
        ("title", "My Evidence"),
        ("evidence_type", "document"),
        ("control_ids", ctl["id"]),
    ])
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("EVD-")
    assert body["status"] == "pending"
    assert any(c["id"] == ctl["id"] for c in body["controls"])


async def test_create_evidence_requires_link_target(client: httpx.AsyncClient):
    r = await client.post("/v1/evidence", data={
        "title": "Orphan Evidence",
        "evidence_type": "document",
    })
    assert r.status_code == 422


async def test_create_evidence_404_on_missing_control(client: httpx.AsyncClient):
    r = await client.post("/v1/evidence", data={
        "title": "X",
        "evidence_type": "document",
        "control_ids": "CTL-NOTFOUND",
    })
    assert r.status_code == 404


async def test_create_evidence_rejects_disallowed_extension(client: httpx.AsyncClient):
    ctl = await create_control(client)
    r = await client.post(
        "/v1/evidence",
        data={"title": "X", "evidence_type": "document", "control_ids": ctl["id"]},
        files={"file": ("malware.exe", b"bad content", "application/octet-stream")},
    )
    assert r.status_code == 422


async def test_create_evidence_with_valid_file(client: httpx.AsyncClient):
    ctl = await create_control(client)
    r = await client.post(
        "/v1/evidence",
        data={"title": "Policy Doc", "evidence_type": "policy_document", "control_ids": ctl["id"]},
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
    ctl = await create_control(client)
    await create_evidence(client, control_ids=[ctl["id"]])
    await create_evidence(client)  # different control

    r = await client.get(f"/v1/evidence?control_id={ctl['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 1


async def test_list_evidence_filter_by_system(client: httpx.AsyncClient):
    system = await create_system()
    ctl = await create_control(client, system_id=system["id"])
    await create_evidence(client, control_ids=[ctl["id"]])

    r = await client.get(f"/v1/evidence?system_id={system['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 1


# ---------------------------------------------------------------------------
# GET /evidence/{id}
# ---------------------------------------------------------------------------

async def test_get_evidence_returns_detail(client: httpx.AsyncClient):
    evd = await create_evidence(client)
    r = await client.get(f"/v1/evidence/{evd['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == evd["id"]
    assert "controls" in body


async def test_get_evidence_404_on_missing(client: httpx.AsyncClient):
    r = await client.get("/v1/evidence/EVD-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /evidence/{id}
# ---------------------------------------------------------------------------

async def test_update_evidence_title(client: httpx.AsyncClient):
    evd = await create_evidence(client)
    r = await client.put(f"/v1/evidence/{evd['id']}", json={"title": "Updated"})
    assert r.status_code == 200
    assert r.json()["title"] == "Updated"


async def test_update_evidence_404_on_missing(client: httpx.AsyncClient):
    r = await client.put("/v1/evidence/EVD-NOTFOUND", json={"title": "X"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /evidence/{id}
# ---------------------------------------------------------------------------

async def test_delete_evidence(client: httpx.AsyncClient):
    evd = await create_evidence(client)
    r = await client.delete(f"/v1/evidence/{evd['id']}")
    assert r.status_code == 200
    assert (await client.get(f"/v1/evidence/{evd['id']}")).status_code == 404


async def test_delete_evidence_404_on_missing(client: httpx.AsyncClient):
    r = await client.delete("/v1/evidence/EVD-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# POST /evidence/{id}/approve and /reject
# ---------------------------------------------------------------------------

async def test_approve_evidence(client: httpx.AsyncClient):
    evd = await create_evidence(client)
    r = await client.post(f"/v1/evidence/{evd['id']}/approve")
    assert r.status_code == 200
    assert r.json()["status"] == "approved"


async def test_reject_evidence(client: httpx.AsyncClient):
    evd = await create_evidence(client)
    r = await client.post(f"/v1/evidence/{evd['id']}/reject")
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"


async def test_approve_evidence_fulfills_obligation_via_cascade(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    ctl = await create_control(client, obligation_id=obl["id"])
    evd = await create_evidence(client, control_ids=[ctl["id"]])

    await client.post(f"/v1/evidence/{evd['id']}/approve")

    obl_r = await client.get(f"/v1/obligations/{obl['id']}")
    assert obl_r.json()["status"] == "fulfilled"


async def test_reject_evidence_demotes_obligation_from_fulfilled(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    ctl = await create_control(client, obligation_id=obl["id"])
    evd = await create_evidence(client, control_ids=[ctl["id"]])
    await client.post(f"/v1/evidence/{evd['id']}/approve")

    await client.post(f"/v1/evidence/{evd['id']}/reject")

    obl_r = await client.get(f"/v1/obligations/{obl['id']}")
    assert obl_r.json()["status"] != "fulfilled"


# ---------------------------------------------------------------------------
# GET /evidence/{id}/download-url
# ---------------------------------------------------------------------------

async def test_download_url_returned_for_evidence_with_file(client: httpx.AsyncClient):
    ctl = await create_control(client)
    r = await client.post(
        "/v1/evidence",
        data={"title": "Doc", "evidence_type": "document", "control_ids": ctl["id"]},
        files={"file": ("doc.pdf", b"%PDF-fake", "application/pdf")},
    )
    evd_id = r.json()["id"]
    r = await client.get(f"/v1/evidence/{evd_id}/download-url")
    assert r.status_code == 200
    assert "url" in r.json()


async def test_download_url_404_for_evidence_without_file(client: httpx.AsyncClient):
    evd = await create_evidence(client)
    r = await client.get(f"/v1/evidence/{evd['id']}/download-url")
    assert r.status_code == 404


async def test_evidence_response_does_not_expose_internal_file_path(client: httpx.AsyncClient):
    """file_path is an internal MinIO key and must not appear in list/get responses."""
    ctl = await create_control(client)
    r = await client.post(
        "/v1/evidence",
        data={"title": "Doc", "evidence_type": "document", "control_ids": ctl["id"]},
        files={"file": ("policy.pdf", b"%PDF-fake", "application/pdf")},
    )
    assert r.status_code == 201
    body = r.json()
    assert "file_path" not in body

    get_body = (await client.get(f"/v1/evidence/{body['id']}")).json()
    assert "file_path" not in get_body


async def test_upload_evidence_rejects_oversized_file(client: httpx.AsyncClient):
    ctl = await create_control(client)
    oversized = b"x" * (100 * 1024 * 1024 + 1)
    r = await client.post(
        "/v1/evidence",
        data={"title": "Big file", "evidence_type": "document", "control_ids": ctl["id"]},
        files={"file": ("big.pdf", oversized, "application/pdf")},
        timeout=30,
    )
    assert r.status_code == 413


# ---------------------------------------------------------------------------
# Versioning
# ---------------------------------------------------------------------------

async def test_evidence_versions_empty_on_fresh_item(client: httpx.AsyncClient):
    evd = await create_evidence(client)
    r = await client.get(f"/v1/evidence/{evd['id']}/versions")
    assert r.status_code == 200
    assert r.json() == []


async def test_upload_version_updates_evidence_and_records_history(client: httpx.AsyncClient):
    ctl = await create_control(client)
    r = await client.post(
        "/v1/evidence",
        data={"title": "Versioned Doc", "evidence_type": "document", "control_ids": ctl["id"]},
        files={"file": ("v1.pdf", b"%PDF-v1", "application/pdf")},
    )
    assert r.status_code == 201
    evd = r.json()
    original_label = evd["version_label"]
    assert evd["file_name"] == "v1.pdf"

    r2 = await client.post(
        f"/v1/evidence/{evd['id']}/upload-version",
        data={"version_label": "v2", "uploaded_by": "tester"},
        files={"file": ("v2.pdf", b"%PDF-v2", "application/pdf")},
    )
    assert r2.status_code == 200
    updated = r2.json()
    assert updated["version_label"] == "v2"
    assert updated["file_name"] == "v2.pdf"

    r3 = await client.get(f"/v1/evidence/{evd['id']}/versions")
    assert r3.status_code == 200
    history = r3.json()
    assert len(history) == 1
    assert history[0]["version_label"] == original_label
    assert history[0]["file_name"] == "v1.pdf"


# ---------------------------------------------------------------------------
# POST /evidence/{id}/controls/{control_id}
# DELETE /evidence/{id}/controls/{control_id}
# ---------------------------------------------------------------------------

async def test_link_control(client: httpx.AsyncClient):
    system = await create_system()
    ctl1 = await create_control(client, system_id=system["id"])
    ctl2 = await create_control(client, system_id=system["id"])
    evd = await create_evidence(client, control_ids=[ctl1["id"]])

    r = await client.post(f"/v1/evidence/{evd['id']}/controls/{ctl2['id']}")
    assert r.status_code == 200
    assert any(c["id"] == ctl2["id"] for c in r.json()["controls"])


async def test_unlink_control(client: httpx.AsyncClient):
    system = await create_system()
    ctl1 = await create_control(client, system_id=system["id"])
    ctl2 = await create_control(client, system_id=system["id"])
    evd = await create_evidence(client, control_ids=[ctl1["id"]])
    await client.post(f"/v1/evidence/{evd['id']}/controls/{ctl2['id']}")

    r = await client.delete(f"/v1/evidence/{evd['id']}/controls/{ctl2['id']}")
    assert r.status_code == 200
    assert not any(c["id"] == ctl2["id"] for c in r.json()["controls"])


async def test_unlink_last_control_returns_409(client: httpx.AsyncClient):
    ctl = await create_control(client)
    evd = await create_evidence(client, control_ids=[ctl["id"]])
    r = await client.delete(f"/v1/evidence/{evd['id']}/controls/{ctl['id']}")
    assert r.status_code == 409


async def test_unlink_control_not_linked_returns_404(client: httpx.AsyncClient):
    system = await create_system()
    ctl1 = await create_control(client, system_id=system["id"])
    ctl2 = await create_control(client, system_id=system["id"])
    evd = await create_evidence(client, control_ids=[ctl1["id"]])
    r = await client.delete(f"/v1/evidence/{evd['id']}/controls/{ctl2['id']}")
    assert r.status_code == 404


async def test_link_control_404_missing_control(client: httpx.AsyncClient):
    evd = await create_evidence(client)
    r = await client.post(f"/v1/evidence/{evd['id']}/controls/CTL-NOTFOUND")
    assert r.status_code == 404


async def test_unlink_control_triggers_cascade(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    ctl = await create_control(client, obligation_id=obl["id"])
    evd = await create_evidence(client, control_ids=[ctl["id"]])
    await client.post(f"/v1/evidence/{evd['id']}/approve")
    assert (await client.get(f"/v1/obligations/{obl['id']}")).json()["status"] == "fulfilled"

    await client.delete(f"/v1/evidence/{evd['id']}/controls/{ctl['id']}")

    assert (await client.get(f"/v1/obligations/{obl['id']}")).json()["status"] != "fulfilled"
