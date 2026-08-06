"""E2E tests for GET/POST/PUT/DELETE /v1/users — Keycloak calls stubbed in-process."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from tests.e2e.conftest import _kc_user, _make_kc_response


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

async def test_health(client: httpx.AsyncClient):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# GET /v1/users — list
# ---------------------------------------------------------------------------

async def test_list_users_returns_users(client: httpx.AsyncClient):
    users = [_kc_user("uid-1", "alice"), _kc_user("uid-2", "bob")]
    with patch("app.routers.users.admin_client") as mock_ctx:
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.side_effect = [
            _make_kc_response(200, users),            # /users
            _make_kc_response(200, 2),                # /users/count
            _make_kc_response(200, []),               # uid-1 role-mappings
            _make_kc_response(200, []),               # uid-2 role-mappings
        ]
        r = await client.get("/v1/users")

    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert len(body["users"]) == 2
    assert body["users"][0]["username"] == "alice"


async def test_list_users_empty(client: httpx.AsyncClient):
    with patch("app.routers.users.admin_client") as mock_ctx:
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.side_effect = [
            _make_kc_response(200, []),
            _make_kc_response(200, 0),
        ]
        r = await client.get("/v1/users")

    assert r.status_code == 200
    assert r.json() == {"total": 0, "users": []}


# ---------------------------------------------------------------------------
# POST /v1/users — invite
# ---------------------------------------------------------------------------

async def test_invite_user_created(client: httpx.AsyncClient):
    new_user = _kc_user("uid-new", "carol")
    with patch("app.routers.users.admin_client") as mock_ctx:
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        # POST /users → 201 with Location header
        post_resp = _make_kc_response(201, headers={"Location": "/users/uid-new"})
        # GET /users/uid-new
        get_resp = _make_kc_response(200, new_user)
        # GET /users/uid-new/role-mappings/realm (for _to_summary)
        roles_resp = _make_kc_response(200, [])
        kc.post.return_value = post_resp
        kc.get.side_effect = [get_resp, roles_resp]

        r = await client.post("/v1/users", json={
            "username": "carol", "email": "carol@example.com",
            "firstName": "Carol", "lastName": "Jones",
            "temporaryPassword": "Temp1234!",
        })

    assert r.status_code == 201
    assert r.json()["username"] == "carol"


async def test_invite_user_conflict(client: httpx.AsyncClient):
    with patch("app.routers.users.admin_client") as mock_ctx:
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.post.return_value = _make_kc_response(409)

        r = await client.post("/v1/users", json={
            "username": "alice", "email": "alice@example.com",
            "firstName": "Alice", "lastName": "Smith",
            "temporaryPassword": "Temp1234!",
        })

    assert r.status_code == 409


async def test_invite_user_invalid_email(client: httpx.AsyncClient):
    r = await client.post("/v1/users", json={
        "username": "alice", "email": "not-an-email",
        "firstName": "Alice", "lastName": "Smith",
        "temporaryPassword": "x",
    })
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# GET /v1/users/{user_id}
# ---------------------------------------------------------------------------

async def test_get_user_found(client: httpx.AsyncClient):
    with patch("app.routers.users.admin_client") as mock_ctx:
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.side_effect = [
            _make_kc_response(200, _kc_user("uid-1", "alice")),
            _make_kc_response(200, []),   # role-mappings
        ]
        r = await client.get("/v1/users/uid-1")

    assert r.status_code == 200
    assert r.json()["username"] == "alice"


async def test_get_user_not_found(client: httpx.AsyncClient):
    with patch("app.routers.users.admin_client") as mock_ctx:
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.return_value = _make_kc_response(404)
        r = await client.get("/v1/users/nonexistent")

    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /v1/users/{user_id} — update
# ---------------------------------------------------------------------------

async def test_update_user(client: httpx.AsyncClient):
    existing = _kc_user("uid-1", "alice")
    updated = {**existing, "firstName": "Alicia"}
    with patch("app.routers.users.admin_client") as mock_ctx:
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.side_effect = [
            _make_kc_response(200, existing),   # fetch existing
            _make_kc_response(200, updated),    # re-fetch after PUT
            _make_kc_response(200, []),         # role-mappings
        ]
        kc.put.return_value = _make_kc_response(204)
        r = await client.put("/v1/users/uid-1", json={"firstName": "Alicia"})

    assert r.status_code == 200
    assert r.json()["firstName"] == "Alicia"


async def test_update_user_not_found(client: httpx.AsyncClient):
    with patch("app.routers.users.admin_client") as mock_ctx:
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.return_value = _make_kc_response(404)
        r = await client.put("/v1/users/nonexistent", json={"firstName": "X"})

    assert r.status_code == 404


# ---------------------------------------------------------------------------
# POST /v1/users/{user_id}/deactivate and /activate
# ---------------------------------------------------------------------------

async def test_deactivate_user(client: httpx.AsyncClient):
    existing = _kc_user("uid-1", "alice", enabled=True)
    deactivated = {**existing, "enabled": False}
    with patch("app.routers.users.admin_client") as mock_ctx:
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.side_effect = [
            _make_kc_response(200, existing),
            _make_kc_response(200, deactivated),
            _make_kc_response(200, []),
        ]
        kc.put.return_value = _make_kc_response(204)
        r = await client.post("/v1/users/uid-1/deactivate")

    assert r.status_code == 200
    assert r.json()["enabled"] is False


async def test_activate_user(client: httpx.AsyncClient):
    existing = _kc_user("uid-1", "alice", enabled=False)
    activated = {**existing, "enabled": True}
    with patch("app.routers.users.admin_client") as mock_ctx:
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.side_effect = [
            _make_kc_response(200, existing),
            _make_kc_response(200, activated),
            _make_kc_response(200, []),
        ]
        kc.put.return_value = _make_kc_response(204)
        r = await client.post("/v1/users/uid-1/activate")

    assert r.status_code == 200
    assert r.json()["enabled"] is True


# ---------------------------------------------------------------------------
# DELETE /v1/users/{user_id}
# ---------------------------------------------------------------------------

async def test_delete_user(client: httpx.AsyncClient):
    with patch("app.routers.users.admin_client") as mock_ctx:
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.delete.return_value = _make_kc_response(204)
        r = await client.delete("/v1/users/uid-1")

    assert r.status_code == 204


async def test_delete_user_not_found(client: httpx.AsyncClient):
    with patch("app.routers.users.admin_client") as mock_ctx:
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.delete.return_value = _make_kc_response(404)
        r = await client.delete("/v1/users/nonexistent")

    assert r.status_code == 404
