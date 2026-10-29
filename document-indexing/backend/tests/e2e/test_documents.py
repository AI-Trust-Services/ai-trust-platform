"""E2E tests for document-indexing backend.

Covers /v1/systems/{id}/documents, /v1/documents/{id}, /v1/documents/{id}/versions,
/v1/documents/{id}/download-url, /v1/retrieve, and /health.

MinIO calls are mocked in conftest.py — no real MinIO instance needed.
All tests require Postgres (auto-skipped if not reachable).
"""

from __future__ import annotations

import httpx

_HDR = {"x-forwarded-preferred-username": "test-user"}
_PDF_BYTES = b"%PDF-1.4 minimal"


# ── Upload + list documents ───────────────────────────────────────────────────


async def test_upload_document_returns_pending(
    client: httpx.AsyncClient, system_id: str
):
    r = await client.post(
        f"/v1/systems/{system_id}/documents",
        files={"file": ("spec.pdf", _PDF_BYTES, "application/pdf")},
        headers=_HDR,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["document_id"].startswith("DOC-")
    assert body["version_id"].startswith("DOCV-")
    assert body["status"] == "pending"


async def test_list_documents_returns_uploaded(
    client: httpx.AsyncClient, system_id: str
):
    await client.post(
        f"/v1/systems/{system_id}/documents",
        files={"file": ("doc1.pdf", _PDF_BYTES, "application/pdf")},
        headers=_HDR,
    )
    await client.post(
        f"/v1/systems/{system_id}/documents",
        files={"file": ("doc2.md", b"# Hello", "text/markdown")},
        headers=_HDR,
    )

    r = await client.get(f"/v1/systems/{system_id}/documents", headers=_HDR)
    assert r.status_code == 200
    docs = r.json()
    assert len(docs) == 2
    filenames = {d["filename"] for d in docs}
    assert "doc1.pdf" in filenames
    assert "doc2.md" in filenames


async def test_list_documents_empty_for_unknown_system(client: httpx.AsyncClient):
    r = await client.get("/v1/systems/SYS-nonexistent/documents", headers=_HDR)
    assert r.status_code == 200
    assert r.json() == []


async def test_upload_to_unknown_system_returns_404(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/systems/SYS-nonexistent/documents",
        files={"file": ("test.pdf", _PDF_BYTES, "application/pdf")},
        headers=_HDR,
    )
    assert r.status_code == 404


async def test_upload_unsupported_extension_returns_422(
    client: httpx.AsyncClient, system_id: str
):
    r = await client.post(
        f"/v1/systems/{system_id}/documents",
        files={"file": ("data.csv", b"a,b,c", "text/csv")},
        headers=_HDR,
    )
    assert r.status_code == 422


async def test_upload_empty_file_returns_422(client: httpx.AsyncClient, system_id: str):
    r = await client.post(
        f"/v1/systems/{system_id}/documents",
        files={"file": ("empty.pdf", b"", "application/pdf")},
        headers=_HDR,
    )
    assert r.status_code == 422


# ── Get document ──────────────────────────────────────────────────────────────


async def test_get_document_by_id(client: httpx.AsyncClient, system_id: str):
    upload_resp = await client.post(
        f"/v1/systems/{system_id}/documents",
        files={"file": ("lookup.pdf", _PDF_BYTES, "application/pdf")},
        headers=_HDR,
    )
    document_id = upload_resp.json()["document_id"]

    r = await client.get(f"/v1/documents/{document_id}", headers=_HDR)
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == document_id
    assert body["filename"] == "lookup.pdf"
    assert body["status"] == "pending"
    assert body["version_label"] == "1.0"


async def test_get_document_not_found(client: httpx.AsyncClient):
    r = await client.get("/v1/documents/DOC-nonexistent", headers=_HDR)
    assert r.status_code == 404


# ── Version history ───────────────────────────────────────────────────────────


async def test_upload_new_version_increments_label(
    client: httpx.AsyncClient, system_id: str
):
    upload_resp = await client.post(
        f"/v1/systems/{system_id}/documents",
        files={"file": ("versioned.pdf", _PDF_BYTES, "application/pdf")},
        headers=_HDR,
    )
    document_id = upload_resp.json()["document_id"]

    r = await client.post(
        f"/v1/documents/{document_id}/versions",
        files={"file": ("versioned_v2.pdf", _PDF_BYTES, "application/pdf")},
        headers=_HDR,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "pending"

    # Current version should be the new one.
    doc_r = await client.get(f"/v1/documents/{document_id}", headers=_HDR)
    assert doc_r.json()["version_label"] == "2.0"


async def test_list_versions_includes_all(client: httpx.AsyncClient, system_id: str):
    upload_resp = await client.post(
        f"/v1/systems/{system_id}/documents",
        files={"file": ("history.pdf", _PDF_BYTES, "application/pdf")},
        headers=_HDR,
    )
    document_id = upload_resp.json()["document_id"]

    await client.post(
        f"/v1/documents/{document_id}/versions",
        files={"file": ("history_v2.pdf", _PDF_BYTES, "application/pdf")},
        headers=_HDR,
    )

    r = await client.get(f"/v1/documents/{document_id}/versions", headers=_HDR)
    assert r.status_code == 200
    versions = r.json()
    assert len(versions) == 2
    labels = [v["version_label"] for v in versions]
    assert "1.0" in labels
    assert "2.0" in labels


async def test_list_versions_not_found(client: httpx.AsyncClient):
    r = await client.get("/v1/documents/DOC-nonexistent/versions", headers=_HDR)
    assert r.status_code == 404


# ── Download URL ──────────────────────────────────────────────────────────────


async def test_download_url_returns_presigned_url(
    client: httpx.AsyncClient, system_id: str
):
    upload_resp = await client.post(
        f"/v1/systems/{system_id}/documents",
        files={"file": ("download.pdf", _PDF_BYTES, "application/pdf")},
        headers=_HDR,
    )
    document_id = upload_resp.json()["document_id"]

    r = await client.get(f"/v1/documents/{document_id}/download-url", headers=_HDR)
    assert r.status_code == 200
    body = r.json()
    assert "url" in body
    assert body["expires_hours"] == 1


# ── Delete ────────────────────────────────────────────────────────────────────


async def test_delete_document_removes_it(client: httpx.AsyncClient, system_id: str):
    upload_resp = await client.post(
        f"/v1/systems/{system_id}/documents",
        files={"file": ("todelete.pdf", _PDF_BYTES, "application/pdf")},
        headers=_HDR,
    )
    document_id = upload_resp.json()["document_id"]

    r = await client.delete(f"/v1/documents/{document_id}", headers=_HDR)
    assert r.status_code == 200
    assert r.json()["deleted"] is True

    get_r = await client.get(f"/v1/documents/{document_id}", headers=_HDR)
    assert get_r.status_code == 404


async def test_delete_nonexistent_document_returns_404(client: httpx.AsyncClient):
    r = await client.delete("/v1/documents/DOC-nonexistent", headers=_HDR)
    assert r.status_code == 404


async def test_delete_all_system_documents(client: httpx.AsyncClient, system_id: str):
    # Upload two documents, then purge the whole system in one call (used to clean up
    # when a draft registration is abandoned, since the registry has no FK to cascade).
    for fn in ("a.pdf", "b.md"):
        up = await client.post(
            f"/v1/systems/{system_id}/documents",
            files={"file": (fn, _PDF_BYTES, "application/pdf")},
            headers=_HDR,
        )
        assert up.status_code == 200

    r = await client.delete(f"/v1/systems/{system_id}/documents", headers=_HDR)
    assert r.status_code == 200
    assert r.json()["documents_deleted"] == 2

    listing = await client.get(f"/v1/systems/{system_id}/documents", headers=_HDR)
    assert listing.json() == []


async def test_delete_all_system_documents_empty_is_zero(client: httpx.AsyncClient):
    # Idempotent: unknown / document-less system returns 0, not 404.
    r = await client.delete("/v1/systems/SYS-nonexistent/documents", headers=_HDR)
    assert r.status_code == 200
    assert r.json()["documents_deleted"] == 0


# ── Retrieval ─────────────────────────────────────────────────────────────────


async def test_retrieve_returns_empty_for_unknown_system(client: httpx.AsyncClient):
    """Retrieval over an unknown system ID returns an empty list — no chunks indexed."""
    from unittest.mock import AsyncMock, patch

    with patch(
        "app.retrieval.retrieve",
        new=AsyncMock(return_value=[]),
    ):
        r = await client.post(
            "/v1/retrieve",
            json={"ai_system_id": "SYS-nonexistent", "query": "test query", "k": 5},
            headers=_HDR,
        )
    assert r.status_code == 200
    assert r.json() == []


# ── Health ────────────────────────────────────────────────────────────────────


async def test_health_returns_ok(client: httpx.AsyncClient):
    r = await client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"
