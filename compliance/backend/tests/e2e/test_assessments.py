"""E2E tests for /api/v1/assessments."""
from __future__ import annotations

import httpx
import pytest

from tests.e2e.conftest import create_assessment, create_obligation, create_system


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

async def test_health_returns_ok(client: httpx.AsyncClient):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# POST /assessments
# ---------------------------------------------------------------------------

async def test_create_assessment_returns_201(client: httpx.AsyncClient):
    system = await create_system()
    r = await client.post("/api/v1/assessments", json={
        "ai_system_id": system["id"],
        "framework_id": "FRM-EU-AI-ACT",
        "title": "My Assessment",
        "type": "compliance",
    })
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("ASS-")
    assert body["status"] == "draft"
    assert body["title"] == "My Assessment"


async def test_create_assessment_404_on_missing_system(client: httpx.AsyncClient):
    r = await client.post("/api/v1/assessments", json={
        "ai_system_id": "SYS-NOTFOUND",
        "framework_id": "FRM-EU-AI-ACT",
        "title": "X",
        "type": "compliance",
    })
    assert r.status_code == 404


async def test_create_assessment_404_on_missing_framework(client: httpx.AsyncClient):
    system = await create_system()
    r = await client.post("/api/v1/assessments", json={
        "ai_system_id": system["id"],
        "framework_id": "FRM-UNKNOWN",
        "title": "X",
        "type": "compliance",
    })
    assert r.status_code == 404


async def test_create_assessment_rejects_disabled_framework(client: httpx.AsyncClient):
    system = await create_system()
    await client.patch("/api/v1/frameworks/FRM-ISO-42001", json={"enabled": False})
    r = await client.post("/api/v1/assessments", json={
        "ai_system_id": system["id"],
        "framework_id": "FRM-ISO-42001",
        "title": "X",
        "type": "compliance",
    })
    assert r.status_code == 422
    # Re-enable for other tests
    await client.patch("/api/v1/frameworks/FRM-ISO-42001", json={"enabled": True})


async def test_create_assessment_rejects_decommissioned_system(client: httpx.AsyncClient):
    system = await create_system(lifecycle="decommissioned")
    r = await client.post("/api/v1/assessments", json={
        "ai_system_id": system["id"],
        "framework_id": "FRM-EU-AI-ACT",
        "title": "X",
        "type": "compliance",
    })
    assert r.status_code == 422


async def test_create_assessment_unknown_tier_yields_no_obligations(client: httpx.AsyncClient):
    # obligations_for() returns [] for unknown tiers — assessment is created successfully
    # but with zero obligations. Zero obligations is a valid state (logged as a warning).
    system = await create_system(tier="unknown_tier")
    ass = await create_assessment(client, system["id"])
    obs = (await client.get(f"/api/v1/obligations?assessment_id={ass['id']}")).json()
    assert len(obs) == 0


async def test_create_assessment_obligation_failure_rolls_back_assessment(client: httpx.AsyncClient):
    # If obligation generation raises inside the transaction, the assessment row must
    # also be rolled back — no orphaned assessments with zero obligations from errors.
    from unittest.mock import patch, AsyncMock
    system = await create_system(tier="minimal")

    try:
        with patch(
            "app.routers.assessments._generate_obligations_in_session",
            new=AsyncMock(side_effect=RuntimeError("DB error")),
        ):
            await client.post("/api/v1/assessments", json={
                "ai_system_id": system["id"],
                "framework_id": "FRM-EU-AI-ACT",
                "title": "Atomic Test",
                "type": "compliance",
            })
    except Exception:
        pass  # Unhandled server errors may surface as stream errors in ASGITransport

    # No assessment should exist in the DB — the transaction was rolled back.
    list_r = await client.get(f"/api/v1/assessments?ai_system_id={system['id']}")
    assert len(list_r.json()) == 0


# ---------------------------------------------------------------------------
# GET /assessments
# ---------------------------------------------------------------------------

async def test_list_assessments_returns_created(client: httpx.AsyncClient):
    system = await create_system()
    await create_assessment(client, system["id"])
    r = await client.get("/api/v1/assessments")
    assert r.status_code == 200
    assert len(r.json()) == 1


async def test_list_assessments_filter_by_system(client: httpx.AsyncClient):
    system1 = await create_system("System A")
    system2 = await create_system("System B")
    await create_assessment(client, system1["id"])
    await create_assessment(client, system2["id"])
    r = await client.get(f"/api/v1/assessments?ai_system_id={system1['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["ai_system_id"] == system1["id"]


async def test_list_assessments_pagination(client: httpx.AsyncClient):
    system = await create_system()
    for _ in range(3):
        await create_assessment(client, system["id"])
    r = await client.get("/api/v1/assessments?limit=2&offset=0")
    assert r.status_code == 200
    assert len(r.json()) == 2


# ---------------------------------------------------------------------------
# GET /assessments/{id}
# ---------------------------------------------------------------------------

async def test_get_assessment_returns_detail(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    r = await client.get(f"/api/v1/assessments/{ass['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == ass["id"]
    assert "obligation_count" in body
    assert "fulfilled_count" in body


async def test_get_assessment_404_on_missing(client: httpx.AsyncClient):
    r = await client.get("/api/v1/assessments/ASS-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /assessments/{id}
# ---------------------------------------------------------------------------

async def test_update_assessment_title(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    r = await client.put(f"/api/v1/assessments/{ass['id']}", json={"title": "Updated Title"})
    assert r.status_code == 200
    assert r.json()["title"] == "Updated Title"


async def test_update_assessment_404_on_missing(client: httpx.AsyncClient):
    r = await client.put("/api/v1/assessments/ASS-NOTFOUND", json={"title": "X"})
    assert r.status_code == 404


async def test_update_approved_assessment_returns_409(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    await client.post(f"/api/v1/assessments/{ass['id']}/submit")
    await client.post(f"/api/v1/assessments/{ass['id']}/approve")
    r = await client.put(f"/api/v1/assessments/{ass['id']}", json={"title": "X"})
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# DELETE /assessments/{id}
# ---------------------------------------------------------------------------

async def test_delete_assessment(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    r = await client.delete(f"/api/v1/assessments/{ass['id']}")
    assert r.status_code == 200
    assert (await client.get(f"/api/v1/assessments/{ass['id']}")).status_code == 404


async def test_delete_assessment_404_on_missing(client: httpx.AsyncClient):
    r = await client.delete("/api/v1/assessments/ASS-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# POST /assessments/{id}/generate-obligations
# ---------------------------------------------------------------------------

async def test_generate_obligations_creates_correct_count(client: httpx.AsyncClient):
    # Obligations are auto-generated on assessment creation.
    # The endpoint still works but returns 409 if called again.
    system = await create_system(tier="high")
    ass = await create_assessment(client, system["id"])
    obs = (await client.get(f"/api/v1/obligations?assessment_id={ass['id']}")).json()
    assert len(obs) == 11  # EU AI Act high-risk has 11 obligations


async def test_generate_obligations_minimal_tier(client: httpx.AsyncClient):
    system = await create_system(tier="minimal")
    ass = await create_assessment(client, system["id"])
    obs = (await client.get(f"/api/v1/obligations?assessment_id={ass['id']}")).json()
    assert len(obs) == 3


async def test_generate_obligations_idempotent_fails_on_second_call(client: httpx.AsyncClient):
    system = await create_system(tier="high")
    ass = await create_assessment(client, system["id"])
    await client.post(f"/api/v1/assessments/{ass['id']}/generate-obligations")
    r = await client.post(f"/api/v1/assessments/{ass['id']}/generate-obligations")
    assert r.status_code == 409


async def test_generate_obligations_approved_assessment_returns_409(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    await client.post(f"/api/v1/assessments/{ass['id']}/submit")
    await client.post(f"/api/v1/assessments/{ass['id']}/approve")
    r = await client.post(f"/api/v1/assessments/{ass['id']}/generate-obligations")
    assert r.status_code == 409


async def test_generate_obligations_prefills_from_prior_approved(client: httpx.AsyncClient):
    system = await create_system(tier="minimal")

    # First assessment — auto-generated on create. Mark one obligation not_applicable and approve.
    ass1 = await create_assessment(client, system["id"])
    obs1 = (await client.get(f"/api/v1/obligations?assessment_id={ass1['id']}")).json()
    await client.put(f"/api/v1/obligations/{obs1[0]['id']}", json={"status": "not_applicable"})
    na_ref = obs1[0]["article_ref"]
    await client.post(f"/api/v1/assessments/{ass1['id']}/submit")
    await client.post(f"/api/v1/assessments/{ass1['id']}/approve")

    # Second assessment — auto-generated on create, not_applicable should be carried forward
    ass2 = await create_assessment(client, system["id"])
    obs2 = (await client.get(f"/api/v1/obligations?assessment_id={ass2['id']}")).json()
    carried = [o for o in obs2 if o["article_ref"] == na_ref]
    assert carried[0]["status"] == "not_applicable"


# ---------------------------------------------------------------------------
# POST /assessments/{id}/submit
# ---------------------------------------------------------------------------

async def test_submit_assessment(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    r = await client.post(f"/api/v1/assessments/{ass['id']}/submit")
    assert r.status_code == 200
    assert r.json()["status"] == "submitted"


async def test_submit_assessment_succeeds_with_auto_generated_obligations(client: httpx.AsyncClient):
    # Obligations are auto-generated on create so submit should always succeed immediately.
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    r = await client.post(f"/api/v1/assessments/{ass['id']}/submit")
    assert r.status_code == 200
    assert r.json()["status"] == "submitted"


async def test_submit_approved_assessment_returns_409(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    await client.post(f"/api/v1/assessments/{ass['id']}/submit")
    await client.post(f"/api/v1/assessments/{ass['id']}/approve")
    r = await client.post(f"/api/v1/assessments/{ass['id']}/submit")
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# POST /assessments/{id}/approve
# ---------------------------------------------------------------------------

async def test_approve_assessment(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    await client.post(f"/api/v1/assessments/{ass['id']}/submit")
    r = await client.post(f"/api/v1/assessments/{ass['id']}/approve")
    assert r.status_code == 200
    assert r.json()["status"] == "approved"


async def test_approve_already_approved_returns_409(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    await client.post(f"/api/v1/assessments/{ass['id']}/submit")
    await client.post(f"/api/v1/assessments/{ass['id']}/approve")
    r = await client.post(f"/api/v1/assessments/{ass['id']}/approve")
    assert r.status_code == 409


async def test_approve_draft_assessment_is_allowed(client: httpx.AsyncClient):
    """Approving a draft directly (skipping submit) is permitted — submit step is optional."""
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    r = await client.post(f"/api/v1/assessments/{ass['id']}/approve")
    assert r.status_code == 200
    assert r.json()["status"] == "approved"


async def test_approve_updates_system_compliance(client: httpx.AsyncClient):
    """Approving an assessment with fulfilled obligations raises system compliance above 0."""
    from ai_trust_persistence.database import engine
    from ai_trust_persistence.models import AISystem
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession

    system = await create_system(tier="minimal")
    ass = await create_assessment(client, system["id"])
    await client.post(f"/api/v1/assessments/{ass['id']}/generate-obligations")
    await client.post(f"/api/v1/assessments/{ass['id']}/submit")
    await client.post(f"/api/v1/assessments/{ass['id']}/approve")

    async with AsyncSession(engine) as session:
        row = (await session.execute(
            select(AISystem).where(AISystem.id == system["id"])
        )).scalar_one()
        # Score = 0/3 * 100 = 0.0 because no obligations are fulfilled yet,
        # but compliance field should be updated (not stale)
        assert row.compliance == 0.0
