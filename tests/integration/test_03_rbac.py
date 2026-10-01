"""
IT-05: auditor cannot write systems (registry).
IT-06: ai_engineer cannot approve evidence (compliance).
IT-07: platform_administrator cannot read assessments.
IT-08: Admin stats endpoint calls users backend and returns user/role counts.
"""

from __future__ import annotations

import httpx
import pytest

from conftest import (
    ADMIN_HEADERS,
    TEST_USER_HEADERS,
    register_system,
    create_assessment,
    assign_role,
    _headers,
)


# ---------------------------------------------------------------------------
# IT-05
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_auditor_cannot_write_systems(
    registry: httpx.AsyncClient,
    users: httpx.AsyncClient,
):
    test_user = "it-test-auditor"
    await assign_role(users, test_user, "auditor")

    r = await registry.post(
        "/v1/intake",
        json={"name": "Auditor Attempt", "assignee_username": test_user},
        headers=_headers(test_user),
    )
    assert r.status_code == 403, (
        f"auditor should get 403 on POST /v1/intake, got {r.status_code}: {r.text}"
    )


# ---------------------------------------------------------------------------
# IT-06
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ai_engineer_cannot_approve_evidence(
    registry: httpx.AsyncClient,
    compliance: httpx.AsyncClient,
    users: httpx.AsyncClient,
):
    engineer = "it-test-engineer"
    await assign_role(users, engineer, "ai_engineer")

    # Admin creates system + assessment + evidence. Use high tier so obligations
    # and requirements are generated (minimal tier yields no EU AI Act obligations).
    system = await register_system(registry, tier="high")
    await create_assessment(compliance, system["id"])

    reqs = await compliance.get(
        "/v1/requirements",
        params={"ai_system_id": system["id"]},
        headers=TEST_USER_HEADERS,
    )
    req_list = reqs.json()
    assert req_list, "No requirements generated for high tier — check obligation templates"
    req_id = req_list[0]["id"]

    ev_r = await compliance.post(
        "/v1/evidence",
        data={
            "title": "Engineer approval attempt",
            "evidence_type": "document",
            "requirement_ids": req_id,
        },
        headers=TEST_USER_HEADERS,
    )
    ev_id = ev_r.json()["id"]

    # Engineer tries to approve
    r = await compliance.post(
        f"/v1/evidence/{ev_id}/approve",
        headers=_headers(engineer),
    )
    assert r.status_code == 403, (
        f"ai_engineer should get 403 on evidence approve, got {r.status_code}: {r.text}"
    )


# ---------------------------------------------------------------------------
# IT-07
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_platform_administrator_cannot_read_assessments(
    compliance: httpx.AsyncClient,
    users: httpx.AsyncClient,
):
    admin_user = "it-test-platform-admin"
    await assign_role(users, admin_user, "platform_administrator")

    r = await compliance.get(
        "/v1/assessments",
        headers=_headers(admin_user),
    )
    assert r.status_code == 403, (
        f"platform_administrator should get 403 on GET /v1/assessments, "
        f"got {r.status_code}: {r.text}"
    )


# ---------------------------------------------------------------------------
# IT-08
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_stats_calls_users_backend(admin: httpx.AsyncClient):
    r = await admin.get("/v1/stats", headers=ADMIN_HEADERS)
    assert r.status_code == 200, (
        f"GET /v1/stats returned {r.status_code}: {r.text} — "
        f"admin→users internal HTTP call may be broken (check USERS_BACKEND_URL)"
    )
    body = r.json()
    assert body.get("user_count", 0) >= 1, (
        f"Expected at least 1 user (bootstrap admin), got user_count={body.get('user_count')}"
    )
    assert body.get("role_count", 0) >= 1, (
        f"Expected at least 1 role, got role_count={body.get('role_count')}"
    )
