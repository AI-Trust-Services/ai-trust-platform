"""E2E tests for GET /v1/me/organization-contacts — Keycloak + OpenFGA stubbed."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from tests.e2e.conftest import _make_kc_response


def _kc_for(username: str) -> dict:
    return {
        "username": username,
        "firstName": username.title(),
        "lastName": "Example",
        "email": f"{username}@example.com",
    }


async def test_organization_contacts_returns_first_member_per_role(
    client: httpx.AsyncClient,
):
    async def _members(obj: str):
        if obj == "role:ai_compliance_officer":
            return ["user:carol", "user:anna"]  # unsorted on purpose
        if obj == "role:platform_administrator":
            return ["user:dave"]
        return []

    with (
        patch(
            "ai_trust_authorization.openfga_client.read_role_members",
            new=AsyncMock(side_effect=_members),
        ),
        patch("app.routers.organization.admin_client") as mock_ctx,
    ):
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.side_effect = lambda path, params=None: _make_kc_response(
            200, [_kc_for(params["username"])]
        )
        r = await client.get("/v1/me/organization-contacts")

    assert r.status_code == 200
    body = r.json()
    # Alphabetically-first member of each role is returned.
    assert body["compliance_officer"]["username"] == "anna"
    assert body["compliance_officer"]["email"] == "anna@example.com"
    assert body["organization_admin"]["username"] == "dave"


async def test_organization_contacts_none_when_roles_empty(client: httpx.AsyncClient):
    with patch(
        "ai_trust_authorization.openfga_client.read_role_members",
        new=AsyncMock(return_value=[]),
    ):
        r = await client.get("/v1/me/organization-contacts")

    assert r.status_code == 200
    assert r.json() == {"compliance_officer": None, "organization_admin": None}


async def test_organization_contacts_skips_members_missing_in_keycloak(
    client: httpx.AsyncClient,
):
    """If the first member has no Keycloak record, fall through to the next."""

    async def _members(obj: str):
        if obj == "role:ai_compliance_officer":
            return ["user:anna", "user:bob"]
        return []

    def _get(path, params=None):
        # anna has no Keycloak user; bob does.
        if params["username"] == "anna":
            return _make_kc_response(200, [])
        return _make_kc_response(200, [_kc_for(params["username"])])

    with (
        patch(
            "ai_trust_authorization.openfga_client.read_role_members",
            new=AsyncMock(side_effect=_members),
        ),
        patch("app.routers.organization.admin_client") as mock_ctx,
    ):
        kc = MagicMock()
        mock_ctx.return_value.__enter__ = MagicMock(return_value=kc)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        kc.get.side_effect = _get
        r = await client.get("/v1/me/organization-contacts")

    assert r.status_code == 200
    assert r.json()["compliance_officer"]["username"] == "bob"
