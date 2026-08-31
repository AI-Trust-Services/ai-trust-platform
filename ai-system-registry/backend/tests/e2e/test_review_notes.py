"""E2E tests for review notes CRUD — /v1/review-notes."""
from __future__ import annotations

import httpx

_HEADERS = {"x-forwarded-preferred-username": "reviewer1"}


async def _create_note(client: httpx.AsyncClient, page: str = "/registry", content: str = "note") -> dict:
    r = await client.post(
        "/v1/review-notes",
        json={"page_path": page, "content": content},
        headers=_HEADERS,
    )
    assert r.status_code == 201
    return r.json()


# ---------------------------------------------------------------------------
# POST — create
# ---------------------------------------------------------------------------

async def test_create_review_note_returns_201(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/review-notes",
        json={"page_path": "/registry", "content": "Looks good"},
        headers=_HEADERS,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("NOTE-")
    assert body["page_path"] == "/registry"
    assert body["content"] == "Looks good"
    assert body["status"] == "pending"
    assert body["author_username"] == "reviewer1"


async def test_create_review_note_anonymous(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/review-notes",
        json={"page_path": "/overview", "content": "anon note"},
    )
    assert r.status_code == 201
    assert r.json()["author_username"] == "anonymous"


# ---------------------------------------------------------------------------
# GET — list
# ---------------------------------------------------------------------------

async def test_list_review_notes_empty(client: httpx.AsyncClient):
    r = await client.get("/v1/review-notes")
    assert r.status_code == 200
    assert r.json() == []


async def test_list_review_notes_filter_by_page(client: httpx.AsyncClient):
    await _create_note(client, page="/registry", content="note A")
    await _create_note(client, page="/overview", content="note B")

    r = await client.get("/v1/review-notes", params={"page_path": "/registry"})
    assert r.status_code == 200
    notes = r.json()
    assert len(notes) == 1
    assert notes[0]["page_path"] == "/registry"


async def test_list_review_notes_filter_by_status(client: httpx.AsyncClient):
    note = await _create_note(client)
    await client.patch(f"/v1/review-notes/{note['id']}", json={"status": "confirmed"})

    r = await client.get("/v1/review-notes", params={"status": "pending"})
    assert all(n["status"] == "pending" for n in r.json())


# ---------------------------------------------------------------------------
# PATCH — update
# ---------------------------------------------------------------------------

async def test_update_review_note_content(client: httpx.AsyncClient):
    note = await _create_note(client)
    r = await client.patch(
        f"/v1/review-notes/{note['id']}",
        json={"content": "updated content"},
    )
    assert r.status_code == 200
    assert r.json()["content"] == "updated content"


async def test_update_review_note_status(client: httpx.AsyncClient):
    note = await _create_note(client)
    r = await client.patch(
        f"/v1/review-notes/{note['id']}",
        json={"status": "confirmed"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "confirmed"


async def test_update_review_note_not_found(client: httpx.AsyncClient):
    r = await client.patch("/v1/review-notes/NOTE-NOTEXIST", json={"content": "x"})
    assert r.status_code == 404


async def test_update_review_note_no_fields_returns_422(client: httpx.AsyncClient):
    note = await _create_note(client)
    r = await client.patch(f"/v1/review-notes/{note['id']}", json={})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------

async def test_delete_review_note(client: httpx.AsyncClient):
    note = await _create_note(client)
    r = await client.delete(f"/v1/review-notes/{note['id']}")
    assert r.status_code == 200
    assert r.json()["status"] == "deleted"

    remaining = (await client.get("/v1/review-notes")).json()
    assert not any(n["id"] == note["id"] for n in remaining)


async def test_delete_review_note_not_found(client: httpx.AsyncClient):
    r = await client.delete("/v1/review-notes/NOTE-NOTEXIST")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# GET /export — CSV
# ---------------------------------------------------------------------------

async def test_export_review_notes_csv(client: httpx.AsyncClient):
    await _create_note(client, page="/registry", content="export me")
    r = await client.get("/v1/review-notes/export")
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    assert "export me" in r.text
    assert "id,page_path,content" in r.text
