"""E2E tests for /v1/evidence."""

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
# POST /evidence
# ---------------------------------------------------------------------------


async def test_create_evidence_linked_to_requirement(client: httpx.AsyncClient):
    req = await create_requirement(client)
    r = await client.post(
        "/v1/evidence",
        data={
            "title": "My Evidence",
            "evidence_type": "document",
            "requirement_ids": [req["id"]],
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("EVD-")
    assert body["status"] == "awaiting_review"
    assert req["id"] in body["requirement_ids"]


async def test_create_evidence_requires_link_target(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/evidence",
        data={
            "title": "Orphan Evidence",
            "evidence_type": "document",
        },
    )
    assert r.status_code == 422


async def test_create_evidence_404_on_missing_requirement(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/evidence",
        data={
            "title": "X",
            "evidence_type": "document",
            "requirement_ids": "REQ-NOTFOUND",
        },
    )
    assert r.status_code == 404


async def test_create_evidence_rejects_disallowed_extension(client: httpx.AsyncClient):
    req = await create_requirement(client)
    r = await client.post(
        "/v1/evidence",
        data={
            "title": "Bad Extension",
            "evidence_type": "document",
            "requirement_ids": [req["id"]],
        },
        files={"file": ("malware.exe", b"BINARY", "application/octet-stream")},
    )
    assert r.status_code == 422


async def test_create_evidence_with_valid_file(client: httpx.AsyncClient):
    req = await create_requirement(client)
    r = await client.post(
        "/v1/evidence",
        data={
            "title": "Valid PDF",
            "evidence_type": "document",
            "requirement_ids": [req["id"]],
        },
        files={"file": ("policy.pdf", b"%PDF-fake", "application/pdf")},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["file_name"] == "policy.pdf"
    assert body["file_size"] == len(b"%PDF-fake")


# ---------------------------------------------------------------------------
# GET /evidence
# ---------------------------------------------------------------------------


async def test_list_evidence_filter_by_requirement(client: httpx.AsyncClient):
    req = await create_requirement(client)
    await create_evidence(client, requirement_ids=[req["id"]])
    await create_evidence(client)

    r = await client.get(f"/v1/evidence?requirement_id={req['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 1


async def test_list_evidence_filter_by_system(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    req = await create_requirement(client, obligation_id=obl["id"])
    await create_evidence(client, requirement_ids=[req["id"]])

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
    assert "requirement_ids" in body


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


async def test_approve_evidence_fulfills_obligation_via_cascade(
    client: httpx.AsyncClient,
):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    req = await create_requirement(client, obligation_id=obl["id"])
    evd = await create_evidence(client, requirement_ids=[req["id"]])

    await client.post(f"/v1/evidence/{evd['id']}/approve")

    obl_r = await client.get(f"/v1/obligations/{obl['id']}")
    assert obl_r.json()["status"] == "fulfilled"


async def test_reject_evidence_demotes_obligation_from_fulfilled(
    client: httpx.AsyncClient,
):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    req = await create_requirement(client, obligation_id=obl["id"])
    evd = await create_evidence(client, requirement_ids=[req["id"]])
    await client.post(f"/v1/evidence/{evd['id']}/approve")

    await client.post(f"/v1/evidence/{evd['id']}/reject")

    obl_r = await client.get(f"/v1/obligations/{obl['id']}")
    assert obl_r.json()["status"] != "fulfilled"


# ---------------------------------------------------------------------------
# GET /evidence/{id}/download-url
# ---------------------------------------------------------------------------


async def test_download_url_returned_for_evidence_with_file(client: httpx.AsyncClient):
    # create_evidence() sets no file — backend returns 404 when file_path is empty
    req = await create_requirement(client)
    r = await client.post(
        "/v1/evidence",
        data={
            "title": "Downloadable",
            "evidence_type": "document",
            "requirement_ids": [req["id"]],
        },
        files={"file": ("report.pdf", b"%PDF-1", "application/pdf")},
    )
    assert r.status_code == 201
    evd_id = r.json()["id"]
    r = await client.get(f"/v1/evidence/{evd_id}/download-url")
    assert r.status_code == 200
    assert "url" in r.json()


async def test_download_url_404_for_evidence_without_file(client: httpx.AsyncClient):
    evd = await create_evidence(client)
    r = await client.get(f"/v1/evidence/{evd['id']}/download-url")
    assert r.status_code == 404


async def test_evidence_response_does_not_expose_internal_file_path(
    client: httpx.AsyncClient,
):
    """file_path is an internal MinIO key and must not appear in list/get responses."""
    # create_evidence() sets no file — use direct POST so file_path is populated in DB
    req = await create_requirement(client)
    r = await client.post(
        "/v1/evidence",
        data={
            "title": "File Path Test",
            "evidence_type": "document",
            "requirement_ids": [req["id"]],
        },
        files={"file": ("doc.pdf", b"%PDF-1", "application/pdf")},
    )
    assert r.status_code == 201
    body = r.json()
    assert "file_path" not in body

    get_body = (await client.get(f"/v1/evidence/{body['id']}")).json()
    assert "file_path" not in get_body


async def test_upload_evidence_rejects_oversized_file(client: httpx.AsyncClient):
    req = await create_requirement(client)
    oversized = b"x" * (100 * 1024 * 1024 + 1)  # 1 byte over the 100 MB limit
    r = await client.post(
        "/v1/evidence",
        data={
            "title": "Big file",
            "evidence_type": "document",
            "requirement_ids": req["id"],
        },
        files={"file": ("big.pdf", oversized, "application/pdf")},
        timeout=30,
    )
    assert r.status_code == 413

    # ---------------------------------------------------------------------------
    # Versioning
    # ---------------------------------------------------------------------------

    evd = await create_evidence(client)
    r = await client.get(f"/v1/evidence/{evd['id']}/versions")
    assert r.status_code == 200
    assert r.json() == []


async def test_upload_version_updates_evidence_and_records_history(
    client: httpx.AsyncClient,
):
    req = await create_requirement(client)
    r = await client.post(
        "/v1/evidence",
        data={
            "title": "Versioned Doc",
            "evidence_type": "document",
            "requirement_ids": req["id"],
        },
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
# POST /evidence/{id}/requirements/{requirement_id}
# DELETE /evidence/{id}/requirements/{requirement_id}
# ---------------------------------------------------------------------------


async def test_link_requirement(client: httpx.AsyncClient):
    req1 = await create_requirement(client)
    req2 = await create_requirement(client)
    evd = await create_evidence(client, requirement_ids=[req1["id"]])

    r = await client.post(f"/v1/evidence/{evd['id']}/requirements/{req2['id']}")
    assert r.status_code == 200
    assert req2["id"] in r.json()["requirement_ids"]


async def test_unlink_requirement(client: httpx.AsyncClient):
    req1 = await create_requirement(client)
    req2 = await create_requirement(client)
    evd = await create_evidence(client, requirement_ids=[req1["id"]])
    await client.post(f"/v1/evidence/{evd['id']}/requirements/{req2['id']}")

    r = await client.delete(f"/v1/evidence/{evd['id']}/requirements/{req2['id']}")
    assert r.status_code == 200
    assert req2["id"] not in r.json()["requirement_ids"]


async def test_unlink_last_requirement_returns_409(client: httpx.AsyncClient):
    req = await create_requirement(client)
    evd = await create_evidence(client, requirement_ids=[req["id"]])
    r = await client.delete(f"/v1/evidence/{evd['id']}/requirements/{req['id']}")
    assert r.status_code == 409


async def test_unlink_requirement_not_linked_returns_404(client: httpx.AsyncClient):
    req1 = await create_requirement(client)
    req2 = await create_requirement(client)
    evd = await create_evidence(client, requirement_ids=[req1["id"]])
    r = await client.delete(f"/v1/evidence/{evd['id']}/requirements/{req2['id']}")
    assert r.status_code == 404


async def test_link_requirement_404_missing_requirement(client: httpx.AsyncClient):
    evd = await create_evidence(client)
    r = await client.post(f"/v1/evidence/{evd['id']}/requirements/REQ-NOTFOUND")
    assert r.status_code == 404


async def test_unlink_requirement_triggers_cascade(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    obl = await create_obligation(client, ass["id"])
    req = await create_requirement(client, obligation_id=obl["id"])
    req2 = await create_requirement(client)  # dummy — satisfies last-link guard
    evd = await create_evidence(client, requirement_ids=[req["id"], req2["id"]])
    await client.post(f"/v1/evidence/{evd['id']}/approve")
    assert (await client.get(f"/v1/obligations/{obl['id']}")).json()[
        "status"
    ] == "fulfilled"

    await client.delete(f"/v1/evidence/{evd['id']}/requirements/{req['id']}")

    assert (await client.get(f"/v1/obligations/{obl['id']}")).json()[
        "status"
    ] != "fulfilled"
