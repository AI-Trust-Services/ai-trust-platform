"""E2E tests for system notes CRUD — /v1/systems/{system_id}/notes."""
from __future__ import annotations

import httpx

_HEADERS = {"x-forwarded-preferred-username": "engineer1"}


async def _create_system(client: httpx.AsyncClient) -> str:
    r = await client.post(
        "/v1/intake",
        json={"name": "Notes Test System", "assignee_username": "engineer1"},
        headers=_HEADERS,
    )
    assert r.status_code == 201
    return r.json()["system"]["id"]


# ---------------------------------------------------------------------------
# POST — create
# ---------------------------------------------------------------------------

async def test_create_note_returns_201(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    r = await client.post(
        f"/v1/systems/{system_id}/notes",
        json={"content": "First note"},
        headers=_HEADERS,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("SNOTE-")
    assert body["content"] == "First note"
    assert body["author_username"] == "engineer1"
    assert body["ai_system_id"] == system_id


async def test_create_note_anonymous_when_no_header(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    r = await client.post(
        f"/v1/systems/{system_id}/notes",
        json={"content": "Anonymous note"},
    )
    assert r.status_code == 201
    assert r.json()["author_username"] == "anonymous"


# ---------------------------------------------------------------------------
# GET — list
# ---------------------------------------------------------------------------

async def test_list_notes_empty(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    r = await client.get(f"/v1/systems/{system_id}/notes")
    assert r.status_code == 200
    assert r.json() == []


async def test_list_notes_returns_newest_first(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    for content in ["first", "second", "third"]:
        await client.post(
            f"/v1/systems/{system_id}/notes",
            json={"content": content},
            headers=_HEADERS,
        )
    r = await client.get(f"/v1/systems/{system_id}/notes")
    assert r.status_code == 200
    notes = r.json()
    assert len(notes) == 3
    assert notes[0]["content"] == "third"


# ---------------------------------------------------------------------------
# PATCH — update
# ---------------------------------------------------------------------------

async def test_update_note_content(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    note_id = (
        await client.post(
            f"/v1/systems/{system_id}/notes",
            json={"content": "original"},
            headers=_HEADERS,
        )
    ).json()["id"]

    r = await client.patch(
        f"/v1/systems/{system_id}/notes/{note_id}",
        json={"content": "updated"},
        headers=_HEADERS,
    )
    assert r.status_code == 200
    assert r.json()["content"] == "updated"


async def test_update_note_not_found(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    r = await client.patch(
        f"/v1/systems/{system_id}/notes/SNOTE-NOTEXIST",
        json={"content": "x"},
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------

async def test_delete_note(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    note_id = (
        await client.post(
            f"/v1/systems/{system_id}/notes",
            json={"content": "to delete"},
            headers=_HEADERS,
        )
    ).json()["id"]

    r = await client.delete(f"/v1/systems/{system_id}/notes/{note_id}")
    assert r.status_code == 204

    notes = (await client.get(f"/v1/systems/{system_id}/notes")).json()
    assert not any(n["id"] == note_id for n in notes)


async def test_delete_note_not_found(client: httpx.AsyncClient):
    system_id = await _create_system(client)
    r = await client.delete(f"/v1/systems/{system_id}/notes/SNOTE-NOTEXIST")
    assert r.status_code == 404
