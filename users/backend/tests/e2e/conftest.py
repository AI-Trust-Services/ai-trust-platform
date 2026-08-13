"""
E2E test infrastructure for the users backend.

Uses httpx.AsyncClient + ASGITransport — no running server needed.
Both external dependencies (Keycloak Admin API and OpenFGA) are stubbed
in-process, so no Docker services are required for these tests.

What is tested:
  - Route wiring and HTTP contract (status codes, response shapes)
  - Authorization enforcement (iam:manage gate on every endpoint)
  - Error paths (404, 409, 400 from Keycloak)
  - OpenFGA tuple writes on role assign/remove
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import pytest_asyncio

# Set required env vars before any app import
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:8080")
os.environ.setdefault("KEYCLOAK_URL", "http://keycloak:8080")
os.environ.setdefault("KEYCLOAK_REALM", "ai-trust")
os.environ.setdefault("USERS_BACKEND_CLIENT_ID", "users-backend")
os.environ.setdefault("USERS_BACKEND_CLIENT_SECRET", "test-secret")
os.environ.setdefault("OPENFGA_URL", "http://openfga:8080")
os.environ.setdefault("OPENFGA_STORE_ID", "test-store-id")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test")


# ---------------------------------------------------------------------------
# Keycloak stub helpers
# ---------------------------------------------------------------------------

def _kc_user(user_id: str = "uid-1", username: str = "alice",
              email: str = "alice@example.com", enabled: bool = True) -> dict:
    return {
        "id": user_id, "username": username, "email": email,
        "firstName": "Alice", "lastName": "Smith",
        "enabled": enabled, "emailVerified": True,
        "createdTimestamp": 1700000000000,
        "attributes": {},
    }


def _make_kc_response(status_code: int = 200, json_body=None,
                       headers: dict | None = None) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.is_success = (200 <= status_code < 300)
    resp.json.return_value = json_body if json_body is not None else {}
    resp.headers = headers or {}
    resp.raise_for_status = MagicMock()
    if status_code >= 400:
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            f"HTTP {status_code}", request=MagicMock(), response=resp
        )
    return resp


# ---------------------------------------------------------------------------
# Session-scoped fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session", autouse=True)
def patch_openfga():
    """Replace OpenFGA check/write/delete/list_relations with no-ops for all tests."""
    from ai_trust_authorization.constants import BUILT_IN_ROLES

    async def _is_valid_role_stub(role_name: str) -> bool:
        return role_name in BUILT_IN_ROLES

    with (
        patch("ai_trust_authorization.openfga_client.check", new=AsyncMock(return_value=True)),
        patch("ai_trust_authorization.openfga_client.write_tuple", new=AsyncMock()),
        patch("ai_trust_authorization.openfga_client.delete_tuple", new=AsyncMock()),
        patch("ai_trust_authorization.openfga_client.list_allowed_relations",
              new=AsyncMock(return_value=[])),
        patch("ai_trust_authorization.openfga_client.read_user_roles",
              new=AsyncMock(return_value=[])),
        patch("ai_trust_authorization.openfga_client.read_role_members",
              new=AsyncMock(return_value=[])),
        patch("app.routers.users._is_valid_role", new=_is_valid_role_stub),
        # _build_slug_map reads custom roles from Postgres; stub it so the list
        # endpoint needs no DB (custom-role slug resolution is covered elsewhere).
        patch("app.routers.users._build_slug_map", new=AsyncMock(return_value={})),
    ):
        # Override get_current_user so require_permission resolves without headers
        from app.main import app
        from ai_trust_authorization.permissions import get_current_user
        app.dependency_overrides[get_current_user] = lambda: "test-user"
        yield
        app.dependency_overrides.clear()


@pytest.fixture(scope="session")
def patch_keycloak_token():
    """Stub out the token fetch so admin_client() never hits a real Keycloak."""
    with patch("app.keycloak._get_token", return_value="fake-token"):
        yield


@pytest_asyncio.fixture
async def client(patch_keycloak_token):
    from app.main import app
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        timeout=10,
    ) as ac:
        yield ac
