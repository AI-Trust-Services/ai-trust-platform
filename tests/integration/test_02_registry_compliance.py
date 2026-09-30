"""
IT-01: System registered in registry is resolvable by compliance (shared FK integrity).
IT-02: Assessment creation auto-generates obligations and requirements.
IT-03: Approving evidence cascades compliance score back to registry ai_systems.compliance.
IT-04: Rejecting evidence reverts the compliance score.
"""

from __future__ import annotations

import httpx
import pytest

from conftest import (
    ADMIN_HEADERS,
    register_system,
    create_assessment,
)


# ---------------------------------------------------------------------------
# IT-01
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_system_visible_in_compliance_after_registration(
    registry: httpx.AsyncClient,
    compliance: httpx.AsyncClient,
):
    system = await register_system(registry)
    system_id = system["id"]
    assert system_id.startswith("SYS-")

    r = await compliance.get(
        "/v1/assessments",
        params={"ai_system_id": system_id},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200, r.text
    # No assessments yet — but the query must succeed (FK resolvable).
    # A 404 or 500 here means the shared ai_systems table is out of sync.
    body = r.json()
    assert isinstance(body, list)


# ---------------------------------------------------------------------------
# IT-02
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_assessment_creation_generates_obligations_and_requirements(
    registry: httpx.AsyncClient,
    compliance: httpx.AsyncClient,
):
    system = await register_system(registry, tier="high")
    assessment = await create_assessment(compliance, system["id"])
    assessment_id = assessment["id"]

    obligations = await compliance.get(
        "/v1/obligations",
        params={"assessment_id": assessment_id},
        headers=ADMIN_HEADERS,
    )
    assert obligations.status_code == 200, obligations.text
    obl_list = obligations.json()
    assert len(obl_list) > 0, "No obligations generated for high-tier EU AI Act assessment"

    requirements = await compliance.get(
        "/v1/requirements",
        params={"ai_system_id": system["id"]},
        headers=ADMIN_HEADERS,
    )
    assert requirements.status_code == 200, requirements.text
    req_list = requirements.json()
    assert len(req_list) > 0, "No requirements generated for high-tier EU AI Act assessment"


# ---------------------------------------------------------------------------
# IT-03
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_evidence_approval_cascades_compliance_score_to_registry(
    registry: httpx.AsyncClient,
    compliance: httpx.AsyncClient,
):
    system = await register_system(registry, tier="high")
    system_id = system["id"]
    assessment = await create_assessment(compliance, system_id)

    # Get the first requirement from the auto-generated set
    reqs = await compliance.get(
        "/v1/requirements",
        params={"ai_system_id": system_id},
        headers=ADMIN_HEADERS,
    )
    assert reqs.status_code == 200, reqs.text
    req_list = reqs.json()
    assert len(req_list) > 0, "No requirements to attach evidence to"
    req_id = req_list[0]["id"]

    # Upload evidence (no file — title + type only)
    ev_r = await compliance.post(
        "/v1/evidence",
        data={
            "title": "Integration Test Evidence",
            "evidence_type": "document",
            "requirement_ids": req_id,
        },
        headers=ADMIN_HEADERS,
    )
    assert ev_r.status_code == 201, ev_r.text
    ev_id = ev_r.json()["id"]

    # Approve
    approve_r = await compliance.post(
        f"/v1/evidence/{ev_id}/approve",
        headers=ADMIN_HEADERS,
    )
    assert approve_r.status_code == 200, approve_r.text

    # Requirement should be fulfilled
    req_r = await compliance.get(f"/v1/requirements/{req_id}", headers=ADMIN_HEADERS)
    assert req_r.status_code == 200, req_r.text
    assert req_r.json()["status"] == "fulfilled", f"Requirement status: {req_r.json()['status']}"

    # Assessment score should be > 0
    ass_r = await compliance.get(
        f"/v1/assessments/{assessment['id']}", headers=ADMIN_HEADERS
    )
    assert ass_r.status_code == 200, ass_r.text
    assert ass_r.json()["score"] > 0, "Assessment score did not update after evidence approval"

    # Cross-service write: compliance must have updated ai_systems.compliance in registry
    sys_r = await registry.get(f"/v1/systems/{system_id}", headers=ADMIN_HEADERS)
    assert sys_r.status_code == 200, sys_r.text
    assert sys_r.json()["compliance"] > 0.0, (
        "registry ai_systems.compliance was not updated after evidence approval — "
        "cascade.py cross-service write broken"
    )


# ---------------------------------------------------------------------------
# IT-04
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_evidence_rejection_reverts_compliance_score(
    registry: httpx.AsyncClient,
    compliance: httpx.AsyncClient,
):
    system = await register_system(registry, tier="high")
    system_id = system["id"]
    await create_assessment(compliance, system_id)

    reqs = await compliance.get(
        "/v1/requirements",
        params={"ai_system_id": system_id},
        headers=ADMIN_HEADERS,
    )
    req_id = reqs.json()[0]["id"]

    ev_r = await compliance.post(
        "/v1/evidence",
        data={
            "title": "Evidence to reject",
            "evidence_type": "document",
            "requirement_ids": req_id,
        },
        headers=ADMIN_HEADERS,
    )
    ev_id = ev_r.json()["id"]

    # Approve then reject
    await compliance.post(f"/v1/evidence/{ev_id}/approve", headers=ADMIN_HEADERS)
    reject_r = await compliance.post(
        f"/v1/evidence/{ev_id}/reject", headers=ADMIN_HEADERS
    )
    assert reject_r.status_code == 200, reject_r.text

    # Requirement should revert
    req_r = await compliance.get(f"/v1/requirements/{req_id}", headers=ADMIN_HEADERS)
    assert req_r.json()["status"] != "fulfilled", (
        "Requirement remained fulfilled after evidence rejection"
    )

    # Registry compliance score should drop back to 0
    sys_r = await registry.get(f"/v1/systems/{system_id}", headers=ADMIN_HEADERS)
    assert sys_r.json()["compliance"] == 0.0, (
        "registry ai_systems.compliance was not reverted after evidence rejection"
    )
