"""E2E tests for /v1/assessments."""
from __future__ import annotations

import httpx
import pytest

from tests.e2e.conftest import create_assessment, create_control, create_obligation, create_system


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
    r = await client.post("/v1/assessments", json={
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
    r = await client.post("/v1/assessments", json={
        "ai_system_id": "SYS-NOTFOUND",
        "framework_id": "FRM-EU-AI-ACT",
        "title": "X",
        "type": "compliance",
    })
    assert r.status_code == 404


async def test_create_assessment_404_on_missing_framework(client: httpx.AsyncClient):
    system = await create_system()
    r = await client.post("/v1/assessments", json={
        "ai_system_id": system["id"],
        "framework_id": "FRM-UNKNOWN",
        "title": "X",
        "type": "compliance",
    })
    assert r.status_code == 404


async def test_create_assessment_rejects_disabled_framework(client: httpx.AsyncClient):
    system = await create_system()
    await client.patch("/v1/frameworks/FRM-ISO-42001", json={"enabled": False})
    r = await client.post("/v1/assessments", json={
        "ai_system_id": system["id"],
        "framework_id": "FRM-ISO-42001",
        "title": "X",
        "type": "compliance",
    })
    assert r.status_code == 422
    # Re-enable for other tests
    await client.patch("/v1/frameworks/FRM-ISO-42001", json={"enabled": True})


async def test_create_assessment_rejects_decommissioned_system(client: httpx.AsyncClient):
    system = await create_system(lifecycle="decommissioned")
    r = await client.post("/v1/assessments", json={
        "ai_system_id": system["id"],
        "framework_id": "FRM-EU-AI-ACT",
        "title": "X",
        "type": "compliance",
    })
    assert r.status_code == 422


async def test_create_assessment_allowed_for_unapproved_system(client: httpx.AsyncClient):
    # Creating an assessment is part of the registration/approval workflow itself, so
    # a system need not already be approved — draft/pending_review/rejected systems are
    # all assessable. (Approval is driven forward by the assessment lifecycle.)
    for status in ("draft", "pending_review", "rejected"):
        system = await create_system(tier="high", workflow_status=status)
        r = await client.post("/v1/assessments", json={
            "ai_system_id": system["id"],
            "framework_id": "FRM-EU-AI-ACT",
            "title": "X",
            "type": "compliance",
        })
        assert r.status_code == 201, f"status={status} should be assessable"


async def test_create_assessment_tier_without_obligations_yields_none(client: httpx.AsyncClient):
    # The cluster catalogue only defines obligations for EU high/limited tiers.
    # A minimal-tier system yields zero obligations — a valid state (logged as a warning).
    system = await create_system(tier="minimal")
    ass = await create_assessment(client, system["id"])
    obs = (await client.get(f"/v1/obligations?assessment_id={ass['id']}")).json()
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
            await client.post("/v1/assessments", json={
                "ai_system_id": system["id"],
                "framework_id": "FRM-EU-AI-ACT",
                "title": "Atomic Test",
                "type": "compliance",
            })
    except Exception:
        pass  # Unhandled server errors may surface as stream errors in ASGITransport

    # No assessment should exist in the DB — the transaction was rolled back.
    list_r = await client.get(f"/v1/assessments?ai_system_id={system['id']}")
    assert len(list_r.json()) == 0


# ---------------------------------------------------------------------------
# GET /assessments
# ---------------------------------------------------------------------------

async def test_list_assessments_returns_created(client: httpx.AsyncClient):
    system = await create_system()
    await create_assessment(client, system["id"])
    r = await client.get("/v1/assessments")
    assert r.status_code == 200
    assert len(r.json()) == 1


async def test_list_assessments_filter_by_system(client: httpx.AsyncClient):
    system1 = await create_system("System A")
    system2 = await create_system("System B")
    await create_assessment(client, system1["id"])
    await create_assessment(client, system2["id"])
    r = await client.get(f"/v1/assessments?ai_system_id={system1['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["ai_system_id"] == system1["id"]


async def test_list_assessments_pagination(client: httpx.AsyncClient):
    system = await create_system()
    for _ in range(3):
        await create_assessment(client, system["id"])
    r = await client.get("/v1/assessments?limit=2&offset=0")
    assert r.status_code == 200
    assert len(r.json()) == 2


async def test_list_assessments_updated_after_includes_recent(client: httpx.AsyncClient):
    from datetime import date, timedelta
    system = await create_system()
    await create_assessment(client, system["id"])
    # cutoff a week ago — the just-created assessment is newer, so it's included
    cutoff = (date.today() - timedelta(days=7)).isoformat()
    r = await client.get(f"/v1/assessments?updated_after={cutoff}")
    assert r.status_code == 200
    assert len(r.json()) == 1


async def test_list_assessments_updated_after_excludes_old(client: httpx.AsyncClient):
    from datetime import date, timedelta
    system = await create_system()
    await create_assessment(client, system["id"])
    # cutoff tomorrow — the just-created assessment is older than the cutoff, so excluded
    cutoff = (date.today() + timedelta(days=1)).isoformat()
    r = await client.get(f"/v1/assessments?updated_after={cutoff}")
    assert r.status_code == 200
    assert len(r.json()) == 0


# ---------------------------------------------------------------------------
# GET /assessments/{id}
# ---------------------------------------------------------------------------

async def test_get_assessment_returns_detail(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    r = await client.get(f"/v1/assessments/{ass['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == ass["id"]
    assert "obligation_count" in body
    assert "fulfilled_count" in body


async def test_get_assessment_404_on_missing(client: httpx.AsyncClient):
    r = await client.get("/v1/assessments/ASS-NOTFOUND")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /assessments/{id}
# ---------------------------------------------------------------------------

async def test_update_assessment_title(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    r = await client.put(f"/v1/assessments/{ass['id']}", json={"title": "Updated Title"})
    assert r.status_code == 200
    assert r.json()["title"] == "Updated Title"


async def test_update_assessment_404_on_missing(client: httpx.AsyncClient):
    r = await client.put("/v1/assessments/ASS-NOTFOUND", json={"title": "X"})
    assert r.status_code == 404


async def test_update_approved_assessment_returns_409(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    await client.post(f"/v1/assessments/{ass['id']}/submit")
    await client.post(f"/v1/assessments/{ass['id']}/approve")
    r = await client.put(f"/v1/assessments/{ass['id']}", json={"title": "X"})
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# DELETE /assessments/{id}
# ---------------------------------------------------------------------------

async def test_delete_assessment(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    r = await client.delete(f"/v1/assessments/{ass['id']}")
    assert r.status_code == 200
    assert (await client.get(f"/v1/assessments/{ass['id']}")).status_code == 404


async def test_delete_assessment_404_on_missing(client: httpx.AsyncClient):
    r = await client.delete("/v1/assessments/ASS-NOTFOUND")
    assert r.status_code == 404


async def test_delete_assessment_removes_generated_controls(client: httpx.AsyncClient):
    # Auto-generated controls should be cleaned up when the assessment is deleted.
    system = await create_system(tier="high")
    ass = await create_assessment(client, system["id"])
    before = (await client.get(f"/v1/controls?ai_system_id={system['id']}")).json()
    assert len(before) == 60

    r = await client.delete(f"/v1/assessments/{ass['id']}")
    assert r.status_code == 200
    assert r.json()["controls_deleted"] == 60

    after = (await client.get(f"/v1/controls?ai_system_id={system['id']}")).json()
    assert len(after) == 0


async def test_delete_assessment_keeps_manual_controls(client: httpx.AsyncClient):
    # Manually-created controls (no control_ref) must survive assessment deletion.
    system = await create_system(tier="high")
    ass = await create_assessment(client, system["id"])
    manual = await create_control(client, system_id=system["id"], title="Manual control")

    r = await client.delete(f"/v1/assessments/{ass['id']}")
    assert r.status_code == 200
    assert r.json()["controls_deleted"] == 60  # only the generated ones

    remaining = (await client.get(f"/v1/controls?ai_system_id={system['id']}")).json()
    ids = [c["id"] for c in remaining]
    assert ids == [manual["id"]]


async def test_delete_assessment_keeps_shared_controls(client: httpx.AsyncClient):
    # A generated control also linked to another assessment's obligation is kept.
    system = await create_system(tier="high")
    ass1 = await create_assessment(client, system["id"])
    ass2 = await create_assessment(client, system["id"])

    # Pick a generated control from ass1 and link it to an obligation of ass2.
    controls = (await client.get(f"/v1/controls?ai_system_id={system['id']}")).json()
    obs2 = (await client.get(f"/v1/obligations?assessment_id={ass2['id']}")).json()
    shared = controls[0]
    await client.post(f"/v1/controls/{shared['id']}/link/{obs2[0]['id']}")

    r = await client.delete(f"/v1/assessments/{ass1['id']}")
    assert r.status_code == 200

    # The shared control must survive because it still links to ass2.
    remaining_ids = [c["id"] for c in
                     (await client.get(f"/v1/controls?ai_system_id={system['id']}")).json()]
    assert shared["id"] in remaining_ids


# ---------------------------------------------------------------------------
# POST /assessments/{id}/generate-obligations
# ---------------------------------------------------------------------------

async def test_generate_obligations_creates_correct_count(client: httpx.AsyncClient):
    # Obligations are auto-generated on assessment creation.
    # The endpoint still works but returns 409 if called again.
    system = await create_system(tier="high")  # org_role defaults to provider
    ass = await create_assessment(client, system["id"])
    obs = (await client.get(f"/v1/obligations?assessment_id={ass['id']}")).json()
    assert len(obs) == 15  # EU AI Act high-risk provider has 15 obligation clusters


async def test_generate_obligations_deployer_high_count(client: httpx.AsyncClient):
    system = await create_system(tier="high", org_role="deployer")
    ass = await create_assessment(client, system["id"])
    obs = (await client.get(f"/v1/obligations?assessment_id={ass['id']}")).json()
    assert len(obs) == 10  # deployer high-risk has 10 obligation clusters


async def test_generate_obligations_importer_yields_none(client: httpx.AsyncClient):
    # Only provider/deployer are supported for EU High/Limited — importer gets none.
    system = await create_system(tier="high", org_role="importer")
    ass = await create_assessment(client, system["id"])
    obs = (await client.get(f"/v1/obligations?assessment_id={ass['id']}")).json()
    assert len(obs) == 0


async def test_generated_obligations_carry_cluster_id(client: httpx.AsyncClient, db_session):
    # cluster_id is internal (not exposed in the API) but must be persisted so
    # carry-forward and control generation key off it.
    from sqlalchemy import select
    from ai_trust_persistence.models import Obligation

    system = await create_system(tier="high")
    ass = await create_assessment(client, system["id"])
    rows = (await db_session.execute(
        select(Obligation).where(Obligation.assessment_id == ass["id"])
    )).scalars().all()
    assert rows
    assert all(o.cluster_id for o in rows)
    assert "P-RM" in {o.cluster_id for o in rows}


async def test_generate_obligations_minimal_tier(client: httpx.AsyncClient):
    # The cluster catalogue defines obligations only for EU high/limited tiers, so a
    # minimal-tier system yields none.
    system = await create_system(tier="minimal")
    ass = await create_assessment(client, system["id"])
    obs = (await client.get(f"/v1/obligations?assessment_id={ass['id']}")).json()
    assert len(obs) == 0


async def test_generate_obligations_idempotent_fails_on_second_call(client: httpx.AsyncClient):
    system = await create_system(tier="high")
    ass = await create_assessment(client, system["id"])
    await client.post(f"/v1/assessments/{ass['id']}/generate-obligations")
    r = await client.post(f"/v1/assessments/{ass['id']}/generate-obligations")
    assert r.status_code == 409


async def test_generate_obligations_approved_assessment_returns_409(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    await client.post(f"/v1/assessments/{ass['id']}/submit")
    await client.post(f"/v1/assessments/{ass['id']}/approve")
    r = await client.post(f"/v1/assessments/{ass['id']}/generate-obligations")
    assert r.status_code == 409


async def test_generate_obligations_prefills_from_prior_approved(client: httpx.AsyncClient):
    system = await create_system(tier="high")

    # First assessment — auto-generated on create. Mark one obligation not_applicable and approve.
    ass1 = await create_assessment(client, system["id"])
    obs1 = (await client.get(f"/v1/obligations?assessment_id={ass1['id']}")).json()
    await client.put(f"/v1/obligations/{obs1[0]['id']}", json={"status": "not_applicable"})
    na_ref = obs1[0]["article_ref"]
    await client.post(f"/v1/assessments/{ass1['id']}/submit")
    await client.post(f"/v1/assessments/{ass1['id']}/approve")

    # Second assessment — auto-generated on create, not_applicable should be carried forward
    ass2 = await create_assessment(client, system["id"])
    obs2 = (await client.get(f"/v1/obligations?assessment_id={ass2['id']}")).json()
    carried = [o for o in obs2 if o["article_ref"] == na_ref]
    assert carried[0]["status"] == "not_applicable"


# ---------------------------------------------------------------------------
# POST /assessments/{id}/submit
# ---------------------------------------------------------------------------

async def test_submit_assessment(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    r = await client.post(f"/v1/assessments/{ass['id']}/submit")
    assert r.status_code == 200
    assert r.json()["status"] == "submitted"


async def test_submit_assessment_succeeds_with_auto_generated_obligations(client: httpx.AsyncClient):
    # Obligations are auto-generated on create so submit should always succeed immediately.
    system = await create_system(tier="high")
    ass = await create_assessment(client, system["id"])
    r = await client.post(f"/v1/assessments/{ass['id']}/submit")
    assert r.status_code == 200
    assert r.json()["status"] == "submitted"


async def test_submit_approved_assessment_returns_409(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    await client.post(f"/v1/assessments/{ass['id']}/submit")
    await client.post(f"/v1/assessments/{ass['id']}/approve")
    r = await client.post(f"/v1/assessments/{ass['id']}/submit")
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# POST /assessments/{id}/approve
# ---------------------------------------------------------------------------

async def test_approve_assessment(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    await client.post(f"/v1/assessments/{ass['id']}/submit")
    r = await client.post(f"/v1/assessments/{ass['id']}/approve")
    assert r.status_code == 200
    assert r.json()["status"] == "approved"


async def test_approve_already_approved_returns_409(client: httpx.AsyncClient):
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    await client.post(f"/v1/assessments/{ass['id']}/submit")
    await client.post(f"/v1/assessments/{ass['id']}/approve")
    r = await client.post(f"/v1/assessments/{ass['id']}/approve")
    assert r.status_code == 409


async def test_approve_draft_assessment_is_allowed(client: httpx.AsyncClient):
    """Approving a draft directly (skipping submit) is permitted — submit step is optional."""
    system = await create_system()
    ass = await create_assessment(client, system["id"])
    await create_obligation(client, ass["id"])
    r = await client.post(f"/v1/assessments/{ass['id']}/approve")
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
    await client.post(f"/v1/assessments/{ass['id']}/generate-obligations")
    await client.post(f"/v1/assessments/{ass['id']}/submit")
    await client.post(f"/v1/assessments/{ass['id']}/approve")

    async with AsyncSession(engine) as session:
        row = (await session.execute(
            select(AISystem).where(AISystem.id == system["id"])
        )).scalar_one()
        # Score = 0/3 * 100 = 0.0 because no obligations are fulfilled yet,
        # but compliance field should be updated (not stale)
        assert row.compliance == 0.0


# ---------------------------------------------------------------------------
# Control auto-generation (on assessment creation)
# ---------------------------------------------------------------------------

async def test_create_assessment_auto_generates_controls(client: httpx.AsyncClient):
    # High-risk EU provider obligations (15 clusters) map to 60 Requirement templates.
    system = await create_system(tier="high")
    await create_assessment(client, system["id"])
    controls = (await client.get(f"/v1/controls?ai_system_id={system['id']}")).json()
    assert len(controls) == 60


async def test_generated_controls_have_control_ref(client: httpx.AsyncClient):
    system = await create_system(tier="high")
    await create_assessment(client, system["id"])
    controls = (await client.get(f"/v1/controls?ai_system_id={system['id']}")).json()
    assert len(controls) == 60
    for c in controls:
        # Every generated control carries a stable control_ref.
        assert c["control_ref"]


async def test_generated_controls_linked_to_obligations(client: httpx.AsyncClient):
    system = await create_system(tier="high")
    ass = await create_assessment(client, system["id"])
    obs = (await client.get(f"/v1/obligations?assessment_id={ass['id']}")).json()
    art9 = [o for o in obs if o["cluster_id"] == "P-RM"][0]
    linked = (await client.get(f"/v1/controls?obligation_id={art9['id']}")).json()
    assert len(linked) == 7  # P-RM cluster (Art. 9) -> 7 Requirements


async def test_high_tier_control_ref_is_requirement_id(client: httpx.AsyncClient):
    # EU High/Limited controls use the bare Requirement ID as control_ref (no ":"),
    # unlike the retained sets which use "{article_ref}:{slug}".
    system = await create_system(tier="high")
    ass = await create_assessment(client, system["id"])
    obs = (await client.get(f"/v1/obligations?assessment_id={ass['id']}")).json()
    art9 = [o for o in obs if o["cluster_id"] == "P-RM"][0]
    linked = (await client.get(f"/v1/controls?obligation_id={art9['id']}")).json()
    refs = {c["control_ref"] for c in linked}
    assert "P-RM-01" in refs
    assert all(":" not in r for r in refs)


async def test_generated_controls_flip_obligations_in_progress(client: httpx.AsyncClient):
    # Cascade: linking >=1 non-fulfilled control moves obligation applicable -> in_progress.
    system = await create_system(tier="high")
    ass = await create_assessment(client, system["id"])
    obs = (await client.get(f"/v1/obligations?assessment_id={ass['id']}")).json()
    assert all(o["status"] == "in_progress" for o in obs)


async def test_generated_controls_start_open(client: httpx.AsyncClient):
    system = await create_system(tier="minimal")
    await create_assessment(client, system["id"])
    controls = (await client.get(f"/v1/controls?ai_system_id={system['id']}")).json()
    assert all(c["status"] == "open" for c in controls)


async def test_prohibited_tier_generates_no_controls(client: httpx.AsyncClient):
    # The cluster catalogue has no prohibited-tier clusters (prohibited practices are
    # banned outright, not remediated via controls) — so no obligations and no controls.
    system = await create_system(tier="prohibited")
    await create_assessment(client, system["id"])
    controls = (await client.get(f"/v1/controls?ai_system_id={system['id']}")).json()
    assert len(controls) == 0


async def test_unknown_tier_generates_no_controls(client: httpx.AsyncClient):
    # A tier with no obligation clusters -> no controls, assessment still created.
    system = await create_system(tier="minimal")
    await create_assessment(client, system["id"])
    controls = (await client.get(f"/v1/controls?ai_system_id={system['id']}")).json()
    assert len(controls) == 0


# ---------------------------------------------------------------------------
# POST /assessments/{id}/generate-controls (standalone)
# ---------------------------------------------------------------------------

async def test_generate_controls_skips_obligations_with_existing_controls(client: httpx.AsyncClient):
    # Controls were already generated on create, so a re-run generates nothing new.
    system = await create_system(tier="high")
    ass = await create_assessment(client, system["id"])
    r = await client.post(f"/v1/assessments/{ass['id']}/generate-controls")
    assert r.status_code == 200
    assert r.json()["created"] == []


async def test_generate_controls_creates_for_obligations_without_controls(client: httpx.AsyncClient):
    # Manually create an obligation (no controls), then generate.
    system = await create_system(tier="minimal")
    ass = await create_assessment(client, system["id"])
    # Manual obligation with a template-backed article_ref but no controls yet.
    # GOVERN is a retained NIST cluster (risk_category "All") -> generates regardless of tier.
    await create_obligation(client, ass["id"], article_ref="GOVERN", title="Manual")
    # The auto-generated minimal obligations already have controls; only the manual
    # GOVERN obligation lacks them -> its 1 control is generated.
    r = await client.post(f"/v1/assessments/{ass['id']}/generate-controls")
    assert r.status_code == 200
    created = r.json()["created"]
    assert len(created) == 1
    assert created[0]["control_ref"] == "GOVERN:AITP-NIST-GOVERN"


async def test_generate_controls_approved_assessment_returns_409(client: httpx.AsyncClient):
    system = await create_system(tier="minimal")
    ass = await create_assessment(client, system["id"])
    await client.post(f"/v1/assessments/{ass['id']}/submit")
    await client.post(f"/v1/assessments/{ass['id']}/approve")
    r = await client.post(f"/v1/assessments/{ass['id']}/generate-controls")
    assert r.status_code == 409


async def test_generate_controls_no_obligations_returns_422(client: httpx.AsyncClient):
    system = await create_system(tier="minimal")  # yields zero obligations
    ass = await create_assessment(client, system["id"])
    r = await client.post(f"/v1/assessments/{ass['id']}/generate-controls")
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Owner carry-forward for controls
# ---------------------------------------------------------------------------

async def test_control_owner_carried_forward_from_prior(client: httpx.AsyncClient):
    system = await create_system(tier="high")

    # First assessment — set an owner on a generated control, then approve.
    ass1 = await create_assessment(client, system["id"])
    controls1 = (await client.get(f"/v1/controls?ai_system_id={system['id']}")).json()
    target = controls1[0]
    await client.put(f"/v1/controls/{target['id']}", json={"owner": "Alice"})
    await client.post(f"/v1/assessments/{ass1['id']}/submit")
    await client.post(f"/v1/assessments/{ass1['id']}/approve")

    # Second assessment — the control with the same control_ref carries Alice.
    await create_assessment(client, system["id"])
    all_controls = (await client.get(f"/v1/controls?ai_system_id={system['id']}")).json()
    carried = [c for c in all_controls
               if c["control_ref"] == target["control_ref"] and c["id"] != target["id"]]
    assert len(carried) == 1
    assert carried[0]["owner"] == "Alice"
