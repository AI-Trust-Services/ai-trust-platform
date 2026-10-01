"""
Integration test infrastructure.

Tests run against a live platform (kind, ai-trust-test, or ai-trust-main).
Services are reached via kubectl port-forward — run `make forward-ports` in k8s/
before executing tests locally, or let `make test-int` handle it automatically.

Auth: X-Forwarded-Preferred-Username header set directly (bypasses oauth2-proxy).

Users:
- ADMIN_USER (platform_administrator) — has iam:manage only; used for role assignment.
- TEST_USER (business_owner) — created once per session; has systems:read/write/approve,
  assessments:read/write, evidence:read/write/approve, alerts:read.
  All write operations use TEST_USER. business_owner is chosen because it is the only
  built-in role that covers both systems:write (to register systems) and evidence:approve
  (to test the evidence→compliance cascade).
"""

from __future__ import annotations

import asyncio
import os

import httpx
import pytest
import pytest_asyncio

REGISTRY_URL = os.getenv("REGISTRY_URL", "http://localhost:8001")
COMPLIANCE_URL = os.getenv("COMPLIANCE_URL", "http://localhost:8007")
ALERTS_URL = os.getenv("ALERTS_URL", "http://localhost:8005")
USERS_URL = os.getenv("USERS_URL", "http://localhost:8008")
AUDIT_URL = os.getenv("AUDIT_URL", "http://localhost:8009")
ADMIN_URL = os.getenv("ADMIN_URL", "http://localhost:8010")
MONITORING_URL = os.getenv("MONITORING_URL", "http://localhost:8003")

ADMIN_USER = os.getenv("APP_ADMIN_USERNAME") or "admin"

# Test user with business_owner role — created once per session.
# business_owner has: systems:read/write/approve, assessments:read/write,
# evidence:read/write/approve, alerts:read.
# This role is used because it is the only built-in role that has BOTH
# systems:write (to register systems) and evidence:approve (to test cascades).
TEST_USER = "it-business-owner"
TEST_USER_PASSWORD = "IntegrationTest1!"
TEST_USER_EMAIL = "it-business-owner@integration-tests.example.com"

ADMIN_HEADERS = {"x-forwarded-preferred-username": ADMIN_USER}
TEST_USER_HEADERS = {"x-forwarded-preferred-username": TEST_USER}

# Track systems created during the session for cleanup.
_created_system_ids: list[str] = []


def _headers(username: str) -> dict[str, str]:
    return {"x-forwarded-preferred-username": username}


@pytest_asyncio.fixture
async def registry():
    async with httpx.AsyncClient(base_url=REGISTRY_URL, timeout=15) as c:
        yield c


@pytest_asyncio.fixture
async def compliance():
    async with httpx.AsyncClient(base_url=COMPLIANCE_URL, timeout=15) as c:
        yield c


@pytest_asyncio.fixture
async def users():
    async with httpx.AsyncClient(base_url=USERS_URL, timeout=15) as c:
        yield c


@pytest_asyncio.fixture
async def admin():
    async with httpx.AsyncClient(base_url=ADMIN_URL, timeout=15) as c:
        yield c


# ---------------------------------------------------------------------------
# Session-scoped test user setup and teardown
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session", autouse=True)
def ensure_test_user():
    """Create TEST_USER in Keycloak with business_owner role once per session.

    Idempotent — if the user already exists (409) we skip creation and proceed
    to role assignment. Role assignment is always re-applied to handle the case
    where a previous run left the user with a different role.

    After all tests finish, deletes every AI system created during the session
    (cascades to assessments, obligations, requirements, evidence).
    """
    asyncio.run(_setup_test_user())
    yield
    asyncio.run(_cleanup_test_data())


async def _setup_test_user() -> None:
    async with httpx.AsyncClient(base_url=USERS_URL, timeout=15) as client:
        # Create user (idempotent — 409 means already exists)
        r = await client.post(
            "/v1/users",
            json={
                "username": TEST_USER,
                "email": TEST_USER_EMAIL,
                "firstName": "Integration",
                "lastName": "Test",
                "temporaryPassword": TEST_USER_PASSWORD,
            },
            headers=ADMIN_HEADERS,
        )
        assert r.status_code in (201, 409), f"Failed to create test user: {r.text}"

        # Fetch the user's Keycloak ID
        search_r = await client.get(
            "/v1/users", params={"search": TEST_USER}, headers=ADMIN_HEADERS
        )
        assert search_r.status_code == 200, search_r.text
        users_list = search_r.json().get("users", search_r.json())
        user = next((u for u in users_list if u.get("username") == TEST_USER), None)
        assert user is not None, (
            f"Could not find test user '{TEST_USER}' after creation"
        )
        user_id = user["id"]

        # Assign business_owner role
        role_r = await client.post(
            f"/v1/users/{user_id}/roles/business_owner",
            headers=ADMIN_HEADERS,
        )
        assert role_r.status_code in (200, 201, 204), (
            f"Failed to assign role: {role_r.text}"
        )


async def _cleanup_test_data() -> None:
    """Delete all AI systems created during the test session.

    Deleting a system cascades to its assessments, obligations, requirements,
    and evidence (via FK ON DELETE CASCADE). This keeps the cluster clean
    between test runs.
    """
    if not _created_system_ids:
        return
    async with httpx.AsyncClient(base_url=REGISTRY_URL, timeout=15) as client:
        for system_id in _created_system_ids:
            r = await client.delete(
                f"/v1/systems/{system_id}", headers=TEST_USER_HEADERS
            )
            # 404 means already deleted — still counts as clean
            if r.status_code not in (200, 204, 404):
                print(
                    f"Warning: cleanup of {system_id} returned {r.status_code}: {r.text}"
                )
    _created_system_ids.clear()


# ---------------------------------------------------------------------------
# Shared helpers — called by multiple test modules
# ---------------------------------------------------------------------------


async def register_system(
    registry_client: httpx.AsyncClient,
    name: str = "Integration Test System",
    tier: str = "minimal",
    **extra_fields: object,
) -> dict:
    # Intake always creates a "pending" stub — the classifier runs on PUT/reclassify.
    payload: dict[str, object] = {"name": name, "assignee_username": TEST_USER}
    payload.update(extra_fields)
    r = await registry_client.post(
        "/v1/intake",
        json=payload,
        headers=TEST_USER_HEADERS,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    system = body["system"] if "system" in body else body
    system_id = system["id"]
    _created_system_ids.append(system_id)

    if tier == "high":
        # PUT Annex III flag so the stored row classifies as high risk.
        update_r = await registry_client.put(
            f"/v1/systems/{system_id}",
            json={"is_critical_infrastructure": True},
            headers=TEST_USER_HEADERS,
        )
        assert update_r.status_code == 200, update_r.text
        system = update_r.json()
        assert system["tier"] == "high", (
            f"Expected system to classify as 'high' after setting is_critical_infrastructure, "
            f"got tier='{system['tier']}' — classifier or flag may have changed"
        )

    return system


async def create_assessment(
    compliance_client: httpx.AsyncClient,
    system_id: str,
) -> dict:
    r = await compliance_client.post(
        "/v1/assessments",
        json={
            "ai_system_id": system_id,
            "framework_id": "FRM-EU-AI-ACT",
            "title": "Integration Test Assessment",
            "type": "compliance",
        },
        headers=TEST_USER_HEADERS,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _get_user_id(users_client: httpx.AsyncClient, username: str) -> str:
    """Look up a Keycloak user ID by username, creating the user if needed."""
    search_r = await users_client.get(
        "/v1/users", params={"search": username}, headers=ADMIN_HEADERS
    )
    assert search_r.status_code == 200, search_r.text
    users_list = search_r.json().get("users", search_r.json())
    user = next((u for u in users_list if u.get("username") == username), None)
    if user:
        return user["id"]

    # Create minimal user
    create_r = await users_client.post(
        "/v1/users",
        json={
            "username": username,
            "email": f"{username}@integration-tests.example.com",
            "firstName": "IT",
            "lastName": "Test",
            "temporaryPassword": "IntegrationTest1!",
        },
        headers=ADMIN_HEADERS,
    )
    assert create_r.status_code in (201, 409), (
        f"Failed to create user {username}: {create_r.text}"
    )
    return create_r.json()["id"]


async def assign_role(
    users_client: httpx.AsyncClient,
    username: str,
    role: str,
) -> None:
    user_id = await _get_user_id(users_client, username)
    r = await users_client.post(
        f"/v1/users/{user_id}/roles/{role}",
        headers=ADMIN_HEADERS,
    )
    assert r.status_code in (200, 201, 204), r.text
