"""E2E tests for role assignment, /v1/roles, /v1/iam/roles, and /v1/me/permissions."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from tests.e2e.conftest import _kc_user, _make_kc_response


# ---------------------------------------------------------------------------
# POST /v1/users/{user_id}/roles/{role_name} — assign role
# ---------------------------------------------------------------------------

async def test_assign_role_writes_openfga_tuple(client: httpx.AsyncClient):
    user = _kc_user("uid-1", "alice")
    with (
        patch("app.routers.users.admin_client") as mock_ctx,
        patch("ai_trust_authorization.openfga_client.write_tuple", new=AsyncMock()) as write_tuple,
    ):
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.return_value = _make_kc_response(200, user)

        r = await client.post("/v1/users/uid-1/roles/auditor")

    assert r.status_code == 200
    write_tuple.assert_awaited_once_with("user:alice", "member", "role:auditor")


async def test_assign_role_rejects_unknown_role(client: httpx.AsyncClient):
    r = await client.post("/v1/users/uid-1/roles/nonexistent_role")
    assert r.status_code == 400


async def test_assign_role_404_when_user_missing_in_keycloak(client: httpx.AsyncClient):
    with patch("app.routers.users.admin_client") as mock_ctx:
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.return_value = _make_kc_response(404)
        r = await client.post("/v1/users/uid-1/roles/auditor")

    assert r.status_code == 404


async def test_assign_role_replaces_existing_role(client: httpx.AsyncClient):
    """Single-role invariant: assigning a new role removes the previous one."""
    user = _kc_user("uid-1", "alice")
    with (
        patch("app.routers.users.admin_client") as mock_ctx,
        patch("ai_trust_authorization.openfga_client.read_user_roles",
              new=AsyncMock(return_value=["role:auditor"])),
        patch("ai_trust_authorization.openfga_client.delete_tuple", new=AsyncMock()) as del_tuple,
        patch("ai_trust_authorization.openfga_client.write_tuple", new=AsyncMock()) as write_tuple,
    ):
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.return_value = _make_kc_response(200, user)

        r = await client.post("/v1/users/uid-1/roles/ai_engineer")

    assert r.status_code == 200
    del_tuple.assert_awaited_once_with("user:alice", "member", "role:auditor")
    write_tuple.assert_awaited_once_with("user:alice", "member", "role:ai_engineer")


async def test_assign_role_blocks_demoting_last_admin(client: httpx.AsyncClient):
    """Last-admin guard: cannot reassign the only platform_administrator."""
    user = _kc_user("uid-1", "alice")
    with (
        patch("app.routers.users.admin_client") as mock_ctx,
        patch("ai_trust_authorization.openfga_client.read_user_roles",
              new=AsyncMock(return_value=["role:platform_administrator"])),
        patch("ai_trust_authorization.openfga_client.read_role_members",
              new=AsyncMock(return_value=["user:alice"])),
    ):
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.return_value = _make_kc_response(200, user)

        r = await client.post("/v1/users/uid-1/roles/auditor")

    assert r.status_code == 409
    assert "last platform administrator" in r.json()["detail"]


async def test_assign_role_allows_demoting_admin_when_others_exist(client: httpx.AsyncClient):
    """Last-admin guard: reassigning is allowed when another admin exists."""
    user = _kc_user("uid-1", "alice")
    with (
        patch("app.routers.users.admin_client") as mock_ctx,
        patch("ai_trust_authorization.openfga_client.read_user_roles",
              new=AsyncMock(return_value=["role:platform_administrator"])),
        patch("ai_trust_authorization.openfga_client.read_role_members",
              new=AsyncMock(return_value=["user:alice", "user:bob"])),
        patch("ai_trust_authorization.openfga_client.delete_tuple", new=AsyncMock()),
        patch("ai_trust_authorization.openfga_client.write_tuple", new=AsyncMock()),
    ):
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.return_value = _make_kc_response(200, user)

        r = await client.post("/v1/users/uid-1/roles/auditor")

    assert r.status_code == 200


async def test_assign_custom_role_writes_openfga_tuple(client: httpx.AsyncClient):
    """assign_role accepts custom role names (resolved from Postgres)."""
    user = _kc_user("uid-1", "alice")
    with (
        patch("app.routers.users.admin_client") as mock_ctx,
        patch("app.routers.users._is_valid_role", new=AsyncMock(return_value=True)),
        patch("ai_trust_authorization.openfga_client.write_tuple", new=AsyncMock()) as write_tuple,
    ):
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.return_value = _make_kc_response(200, user)

        r = await client.post("/v1/users/uid-1/roles/my_custom_role")

    assert r.status_code == 200
    write_tuple.assert_awaited_once_with("user:alice", "member", "role:my_custom_role")


# ---------------------------------------------------------------------------
# DELETE /v1/users/{user_id}/roles/{role_name} — remove role
# ---------------------------------------------------------------------------

async def test_remove_role_deletes_openfga_tuple(client: httpx.AsyncClient):
    user = _kc_user("uid-1", "alice")
    with (
        patch("app.routers.users.admin_client") as mock_ctx,
        patch("ai_trust_authorization.openfga_client.delete_tuple", new=AsyncMock()) as del_tuple,
    ):
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.return_value = _make_kc_response(200, user)

        r = await client.delete("/v1/users/uid-1/roles/auditor")

    assert r.status_code == 200
    del_tuple.assert_awaited_once_with("user:alice", "member", "role:auditor")


async def test_remove_role_rejects_unknown_role(client: httpx.AsyncClient):
    r = await client.delete("/v1/users/uid-1/roles/made_up_role")
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# GET /v1/roles — role list from constants (no Keycloak call)
# ---------------------------------------------------------------------------

async def test_list_roles_returns_managed_roles(client: httpx.AsyncClient):
    r = await client.get("/v1/roles")
    assert r.status_code == 200
    names = {role["name"] for role in r.json()}
    assert "platform_administrator" in names
    assert "auditor" in names


# ---------------------------------------------------------------------------
# GET /v1/iam/roles — permission matrix (requires iam:manage, stubbed to pass)
# ---------------------------------------------------------------------------

async def test_iam_roles_returns_all_builtin_roles(client: httpx.AsyncClient):
    r = await client.get("/v1/iam/roles")
    assert r.status_code == 200
    roles = r.json()
    names = {role["name"] for role in roles}
    assert "platform_administrator" in names
    assert "auditor" in names
    for role in roles:
        assert isinstance(role["permissions"], list)
        assert len(role["permissions"]) > 0


# ---------------------------------------------------------------------------
# GET /v1/me/permissions — permission list for current user
# ---------------------------------------------------------------------------

async def test_me_permissions_returns_list(client: httpx.AsyncClient):
    r = await client.get("/v1/me/permissions")
    assert r.status_code == 200
    body = r.json()
    assert "username" in body
    assert isinstance(body["permissions"], list)


async def test_me_permissions_respects_openfga_result(client: httpx.AsyncClient):
    """When OpenFGA says only systems:read is allowed, only that comes back."""
    from ai_trust_authorization.constants import RELATION_BY_PERMISSION
    allowed_relation = RELATION_BY_PERMISSION["systems:read"]
    with patch(
        "ai_trust_authorization.openfga_client.list_allowed_relations",
        new=AsyncMock(return_value=[allowed_relation]),
    ):
        r = await client.get("/v1/me/permissions")

    assert r.status_code == 200
    assert r.json()["permissions"] == ["systems:read"]
