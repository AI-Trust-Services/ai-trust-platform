"""
Integration test infrastructure.

Tests run against a live platform (kind, ai-trust-test, or ai-trust-main).
Services are reached via kubectl port-forward — run `make forward-ports` in k8s/
before executing tests locally, or let `make test-int` handle it automatically.

Auth: X-Forwarded-Preferred-Username header set directly (bypasses oauth2-proxy).
The platform admin user is seeded from APP_ADMIN_USERNAME on every deploy.
"""

from __future__ import annotations

import os

import httpx
import pytest
import pytest_asyncio

REGISTRY_URL   = os.getenv("REGISTRY_URL",   "http://localhost:8001")
COMPLIANCE_URL = os.getenv("COMPLIANCE_URL",  "http://localhost:8007")
ALERTS_URL     = os.getenv("ALERTS_URL",      "http://localhost:8005")
USERS_URL      = os.getenv("USERS_URL",       "http://localhost:8008")
AUDIT_URL      = os.getenv("AUDIT_URL",       "http://localhost:8009")
ADMIN_URL      = os.getenv("ADMIN_URL",       "http://localhost:8010")
MONITORING_URL = os.getenv("MONITORING_URL",  "http://localhost:8003")

ADMIN_USER     = os.getenv("APP_ADMIN_USERNAME", "admin")

# Headers for each built-in role. The admin user is seeded as platform_administrator.
# Additional test users are created on the fly in RBAC tests via the IAM API.
ADMIN_HEADERS = {"x-forwarded-preferred-username": ADMIN_USER}


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
# Shared helpers — called by multiple test modules
# ---------------------------------------------------------------------------


async def register_system(
    registry_client: httpx.AsyncClient,
    name: str = "Integration Test System",
    tier: str = "minimal",
) -> dict:
    r = await registry_client.post(
        "/v1/intake",
        json={"name": name, "tier": tier, "assignee_username": ADMIN_USER},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def create_assessment(
    compliance_client: httpx.AsyncClient,
    system_id: str,
) -> dict:
    r = await compliance_client.post(
        "/api/v1/assessments",
        json={
            "ai_system_id": system_id,
            "framework_id": "FRM-EU-AI-ACT",
            "title": "Integration Test Assessment",
            "type": "compliance",
        },
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def assign_role(
    users_client: httpx.AsyncClient,
    username: str,
    role: str,
) -> None:
    r = await users_client.post(
        f"/v1/users/{username}/roles/{role}",
        headers=ADMIN_HEADERS,
    )
    assert r.status_code in (200, 201, 204), r.text
