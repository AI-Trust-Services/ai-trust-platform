"""E2E tests for custom role CRUD endpoints (POST/GET/PUT/DELETE /v1/iam/custom-roles)."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from tests.e2e.conftest import _make_kc_response


def _db_row(
    role_id: str = "ROLE-ABCD1234",
    name: str = "My Role",
    description: str = "desc",
) -> MagicMock:
    row = MagicMock()
    row.id = role_id
    row.name = name
    row.description = description
    row.created_at = datetime(2024, 1, 1, tzinfo=timezone.utc)
    return row


def _patch_db(rows):
    """Patch SessionLocal so scalars().all() returns `rows`."""
    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)

    result_mock = MagicMock()
    result_mock.scalars.return_value.all.return_value = rows
    result_mock.scalar_one_or_none.return_value = None
    session.execute = AsyncMock(return_value=result_mock)
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    return patch("app.routers.custom_roles.SessionLocal", return_value=session), session


def _patch_openfga_client(tuples=None):
    """Patch openfga_client.get_client() to return an empty tuple list."""
    tuples = tuples or []
    client_mock = AsyncMock()
    client_mock.__aenter__ = AsyncMock(return_value=client_mock)
    client_mock.__aexit__ = AsyncMock(return_value=False)
    read_resp = MagicMock()
    read_resp.tuples = tuples
    client_mock.read = AsyncMock(return_value=read_resp)
    return patch("app.routers.custom_roles.openfga_client.get_client", return_value=client_mock), client_mock


# ---------------------------------------------------------------------------
# GET /v1/iam/custom-roles
# ---------------------------------------------------------------------------

async def test_list_custom_roles_empty(client: httpx.AsyncClient):
    db_patch, _ = _patch_db([])
    fga_patch, _ = _patch_openfga_client()
    with db_patch, fga_patch:
        r = await client.get("/v1/iam/custom-roles")
    assert r.status_code == 200
    assert r.json() == []


async def test_list_custom_roles_returns_rows(client: httpx.AsyncClient):
    row = _db_row()
    db_patch, _ = _patch_db([row])
    fga_patch, _ = _patch_openfga_client()
    with db_patch, fga_patch:
        r = await client.get("/v1/iam/custom-roles")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["id"] == "ROLE-ABCD1234"
    assert data[0]["name"] == "My Role"
    assert data[0]["permissions"] == []


# ---------------------------------------------------------------------------
# POST /v1/iam/custom-roles
# ---------------------------------------------------------------------------

async def test_create_custom_role_success(client: httpx.AsyncClient):
    db_patch, session = _patch_db([])

    async def _refresh(row):
        row.created_at = datetime(2024, 1, 1, tzinfo=timezone.utc)

    session.refresh.side_effect = _refresh

    with (
        db_patch,
        patch("app.routers.custom_roles.openfga_client.write_tuple", new=AsyncMock()),
        patch("app.routers.custom_roles.openfga_client.delete_tuple", new=AsyncMock()),
        patch("app.routers.custom_roles._get_role_permissions", new=AsyncMock(return_value=[])),
        patch("app.routers.custom_roles._set_role_permissions", new=AsyncMock()),
    ):
        r = await client.post(
            "/v1/iam/custom-roles",
            json={"name": "Reviewer", "description": "Can review", "permissions": ["systems:read"]},
        )

    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Reviewer"
    assert body["permissions"] == ["systems:read"]


async def test_create_custom_role_blank_name(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/iam/custom-roles",
        json={"name": "   ", "description": "", "permissions": []},
    )
    assert r.status_code == 422


async def test_create_custom_role_unknown_permission(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/iam/custom-roles",
        json={"name": "Bad Role", "description": "", "permissions": ["does:not:exist"]},
    )
    assert r.status_code == 400


async def test_create_custom_role_conflict(client: httpx.AsyncClient):
    existing_row = _db_row(name="Existing")
    db_patch, session = _patch_db([])
    # Make the duplicate-check query return an existing row
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = existing_row
    session.execute = AsyncMock(return_value=result_mock)

    with db_patch:
        r = await client.post(
            "/v1/iam/custom-roles",
            json={"name": "Existing", "description": "", "permissions": []},
        )
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# PUT /v1/iam/custom-roles/{role_id}
# ---------------------------------------------------------------------------

async def test_update_custom_role_description(client: httpx.AsyncClient):
    row = _db_row()
    db_patch, session = _patch_db([])
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = row
    session.execute = AsyncMock(return_value=result_mock)

    with (
        db_patch,
        patch("app.routers.custom_roles._set_role_permissions", new=AsyncMock()),
        patch("app.routers.custom_roles._get_role_permissions", new=AsyncMock(return_value=["systems:read"])),
    ):
        r = await client.put(
            "/v1/iam/custom-roles/ROLE-ABCD1234",
            json={"description": "updated"},
        )

    assert r.status_code == 200
    assert r.json()["permissions"] == ["systems:read"]


async def test_update_custom_role_not_found(client: httpx.AsyncClient):
    db_patch, session = _patch_db([])
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = None
    session.execute = AsyncMock(return_value=result_mock)

    with db_patch:
        r = await client.put("/v1/iam/custom-roles/ROLE-MISSING", json={"description": "x"})

    assert r.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /v1/iam/custom-roles/{role_id}
# ---------------------------------------------------------------------------

async def test_list_custom_roles_permissions_mapped_from_openfga(client: httpx.AsyncClient):
    """Permissions from OpenFGA tuples are correctly mapped onto each role in the response."""
    from unittest.mock import MagicMock as TupleMock
    row = _db_row(name="Reviewer")

    # Build a fake tuple: role:reviewer#member has can_read_systems on platform:global
    t = TupleMock()
    t.key.user = "role:reviewer#member"
    t.key.relation = "can_read_systems"

    db_patch, _ = _patch_db([row])
    fga_patch, _ = _patch_openfga_client(tuples=[t])
    with db_patch, fga_patch:
        r = await client.get("/v1/iam/custom-roles")

    assert r.status_code == 200
    data = r.json()
    assert data[0]["permissions"] == ["systems:read"]


async def test_create_custom_role_rolls_back_postgres_on_openfga_failure(client: httpx.AsyncClient):
    """If OpenFGA write fails after Postgres insert, the Postgres row is deleted."""
    import pytest
    db_patch, session = _patch_db([])

    async def _refresh(row):
        row.created_at = datetime(2024, 1, 1, tzinfo=timezone.utc)

    session.refresh.side_effect = _refresh
    # First execute() = duplicate check (returns None), second = rollback lookup
    result_no_existing = MagicMock()
    result_no_existing.scalar_one_or_none.return_value = None
    result_find_row = MagicMock()
    result_find_row.scalar_one_or_none.return_value = _db_row()
    session.execute = AsyncMock(side_effect=[result_no_existing, result_find_row])

    with (
        db_patch,
        patch("app.routers.custom_roles._set_role_permissions",
              new=AsyncMock(side_effect=RuntimeError("OpenFGA down"))),
        pytest.raises(Exception),
    ):
        await client.post(
            "/v1/iam/custom-roles",
            json={"name": "Reviewer", "description": "", "permissions": ["systems:read"]},
        )

    session.delete.assert_awaited_once()
    session.commit.assert_awaited()


async def test_delete_custom_role_strips_all_members(client: httpx.AsyncClient):
    """Deleting a role calls _delete_all_member_tuples to strip users from OpenFGA."""
    row = _db_row()
    db_patch, session = _patch_db([])
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = row
    session.execute = AsyncMock(return_value=result_mock)

    with (
        db_patch,
        patch("app.routers.custom_roles._delete_all_member_tuples", new=AsyncMock()) as del_members,
        patch("app.routers.custom_roles._set_role_permissions", new=AsyncMock()),
    ):
        r = await client.delete("/v1/iam/custom-roles/ROLE-ABCD1234")

    assert r.status_code == 204
    del_members.assert_awaited_once_with("My Role")


async def test_delete_custom_role_success(client: httpx.AsyncClient):
    row = _db_row()
    db_patch, session = _patch_db([])
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = row
    session.execute = AsyncMock(return_value=result_mock)

    with (
        db_patch,
        patch("app.routers.custom_roles._delete_all_member_tuples", new=AsyncMock()),
        patch("app.routers.custom_roles._set_role_permissions", new=AsyncMock()),
    ):
        r = await client.delete("/v1/iam/custom-roles/ROLE-ABCD1234")

    assert r.status_code == 204


async def test_delete_custom_role_not_found(client: httpx.AsyncClient):
    db_patch, session = _patch_db([])
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = None
    session.execute = AsyncMock(return_value=result_mock)

    with db_patch:
        r = await client.delete("/v1/iam/custom-roles/ROLE-MISSING")

    assert r.status_code == 404
