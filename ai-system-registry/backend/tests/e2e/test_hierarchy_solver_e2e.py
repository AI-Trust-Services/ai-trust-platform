"""E2E tests for POST /v1/systems/{id}/classification/resolve.

Uses ASGITransport — no running server needed.
MinIO is patched at the minio_client level (list_latest_classification / get_json).
hierarchy_solver.solve() is patched where it only needs a stub (stub tests) or
invoked for real once the implementation exists (full tests use NotImplementedError
as a skip signal — xfail via pytest.mark).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

_USER = "ai-engineer"
_HDR = {"x-forwarded-preferred-username": _USER}

# A minimal pipeline 2 result with two risk labels and two role labels.
_PIPELINE_RESULT = {
    "questionnaire_run_key": "questionnaire-results/SYS-TESTTEST/ai-questionnaire/2026-01-01T00-00-00Z.json",
    "config_id": "risk_role_classification_config",
    "config_version": "1.0.0",
    "prompt_id": "risk_role_classification",
    "classifications": [
        {"labelId": "PROHIBITED", "result": False, "confidence": 30.0, "explanation": "Not prohibited."},
        {"labelId": "HIGH_RISK", "result": True, "confidence": 95.0, "explanation": "High-risk system."},
        {"labelId": "TRANSPARENCY", "result": False, "confidence": 40.0, "explanation": "No transparency obligations."},
        {"labelId": "PROVIDER", "result": True, "confidence": 91.0, "explanation": "Provider."},
        {"labelId": "DEPLOYER", "result": False, "confidence": 50.0, "explanation": "Not deployer."},
    ],
    "skipped_labels": [],
}

# Questionnaire result needed only for answers-override tests.
_QUESTIONNAIRE_RESULT = {
    "results": [
        {
            "questionId": "High_Risk_1",
            "answer": [{"value": "MACHINERY", "answerStrength": "HIGH", "reason": None}],
        }
    ]
}


async def _create_system(client: httpx.AsyncClient) -> str:
    r = await client.post(
        "/v1/intake",
        json={"name": "Hierarchy Solver E2E", "assignee_username": _USER},
        headers=_HDR,
    )
    assert r.status_code == 201
    return r.json()["system"]["id"]


def _mock_minio(pipeline_result=None, questionnaire_result=None):
    """Context manager patching list_latest_classification and get_json."""
    pr = pipeline_result if pipeline_result is not None else _PIPELINE_RESULT
    qr = questionnaire_result if questionnaire_result is not None else _QUESTIONNAIRE_RESULT
    return patch(
        "app.routers.hierarchy_solver.minio_client.list_latest_classification",
        new_callable=AsyncMock,
        return_value=pr,
    ), patch(
        "app.routers.hierarchy_solver.minio_client.get_json",
        new_callable=AsyncMock,
        return_value=qr,
    )


# ---------------------------------------------------------------------------
# 404 cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_unknown_system(client):
    r = await client.post("/v1/systems/SYS-NOTEXIST/classification/resolve", headers=_HDR)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_resolve_no_classification_run(client):
    system_id = await _create_system(client)
    with patch(
        "app.routers.hierarchy_solver.minio_client.list_latest_classification",
        new_callable=AsyncMock,
        return_value=None,
    ):
        r = await client.post(f"/v1/systems/{system_id}/classification/resolve", headers=_HDR)
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Happy-path: no overrides
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_no_overrides_returns_risk_and_roles(client):
    system_id = await _create_system(client)
    p1, p2 = _mock_minio()
    with p1, p2:
        r = await client.post(f"/v1/systems/{system_id}/classification/resolve", headers=_HDR)
    assert r.status_code == 200
    body = r.json()
    assert "risk" in body
    assert "roles" in body
    # HIGH_RISK is the dominant risk label
    assert body["risk"]["labelId"] == "HIGH_RISK"
    assert body["risk"]["result"] is True
    assert body["risk"]["source"] == "pipeline"
    assert body["risk"]["confidenceBand"] == "High"  # 95 >= 90
    # roles list contains all role labels incl. result:false
    role_ids = {rl["labelId"] for rl in body["roles"]}
    assert "PROVIDER" in role_ids
    assert "DEPLOYER" in role_ids


# ---------------------------------------------------------------------------
# MINIMAL fallback
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_minimal_fallback(client):
    """When no risk label is true, risk winner is MINIMAL."""
    system_id = await _create_system(client)
    no_risk = {
        **_PIPELINE_RESULT,
        "classifications": [
            {"labelId": "PROHIBITED", "result": False, "confidence": 10.0, "explanation": ""},
            {"labelId": "HIGH_RISK", "result": False, "confidence": 20.0, "explanation": ""},
            {"labelId": "TRANSPARENCY", "result": False, "confidence": 30.0, "explanation": ""},
            {"labelId": "PROVIDER", "result": False, "confidence": 40.0, "explanation": ""},
        ],
    }
    p1, p2 = _mock_minio(pipeline_result=no_risk)
    with p1, p2:
        r = await client.post(f"/v1/systems/{system_id}/classification/resolve", headers=_HDR)
    assert r.status_code == 200
    assert r.json()["risk"]["labelId"] == "MINIMAL"


# ---------------------------------------------------------------------------
# Confidence bands — boundary conditions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_confidence_band_boundaries(client):
    """>= 90 → High, >= 60 → Medium, else Low. Boundary values are inclusive."""
    system_id = await _create_system(client)
    for confidence, expected_band in [(90.0, "High"), (89.9, "Medium"), (60.0, "Medium"), (59.9, "Low"), (0.0, "Low")]:
        result = {
            **_PIPELINE_RESULT,
            "classifications": [
                {"labelId": "HIGH_RISK", "result": True, "confidence": confidence, "explanation": ""},
            ],
        }
        p1, p2 = _mock_minio(pipeline_result=result)
        with p1, p2:
            r = await client.post(f"/v1/systems/{system_id}/classification/resolve", headers=_HDR)
        assert r.status_code == 200
        assert r.json()["risk"]["confidenceBand"] == expected_band, f"confidence={confidence}"


# ---------------------------------------------------------------------------
# riskWinner override
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_risk_winner_override(client):
    """riskWinner forces the winner regardless of pipeline result."""
    system_id = await _create_system(client)
    p1, p2 = _mock_minio()
    with p1, p2:
        r = await client.post(
            f"/v1/systems/{system_id}/classification/resolve",
            json={"riskWinner": "PROHIBITED"},
            headers=_HDR,
        )
    assert r.status_code == 200
    body = r.json()
    assert body["risk"]["labelId"] == "PROHIBITED"
    assert body["risk"]["source"] == "user"
    assert body["risk"]["confidence"] is None
    assert body["risk"]["confidenceBand"] is None


@pytest.mark.asyncio
async def test_resolve_risk_winner_not_a_risk_label_returns_422(client):
    system_id = await _create_system(client)
    p1, p2 = _mock_minio()
    with p1, p2:
        r = await client.post(
            f"/v1/systems/{system_id}/classification/resolve",
            json={"riskWinner": "PROVIDER"},  # role label, not risk
            headers=_HDR,
        )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# labels override
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_labels_override_sets_source_user(client):
    system_id = await _create_system(client)
    p1, p2 = _mock_minio()
    with p1, p2:
        r = await client.post(
            f"/v1/systems/{system_id}/classification/resolve",
            json={"labels": {"HIGH_RISK": False}},
            headers=_HDR,
        )
    assert r.status_code == 200
    body = r.json()
    # HIGH_RISK forced false → next risk winner or MINIMAL
    risk = body["risk"]
    assert risk["labelId"] != "HIGH_RISK" or risk["result"] is False
    # The overridden label has source="user" and no confidence
    all_labels = [body["risk"]] + body["roles"]
    high_risk = next((l for l in all_labels if l["labelId"] == "HIGH_RISK"), None)
    if high_risk:
        assert high_risk["source"] == "user"
        assert high_risk["confidence"] is None


@pytest.mark.asyncio
async def test_resolve_labels_unknown_label_returns_422(client):
    system_id = await _create_system(client)
    p1, p2 = _mock_minio()
    with p1, p2:
        r = await client.post(
            f"/v1/systems/{system_id}/classification/resolve",
            json={"labels": {"NONEXISTENT_LABEL": True}},
            headers=_HDR,
        )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Override precedence: riskWinner > labels
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_risk_winner_beats_labels(client):
    """riskWinner=PROHIBITED wins even when labels:{PROHIBITED: false}."""
    system_id = await _create_system(client)
    p1, p2 = _mock_minio()
    with p1, p2:
        r = await client.post(
            f"/v1/systems/{system_id}/classification/resolve",
            json={"riskWinner": "PROHIBITED", "labels": {"PROHIBITED": False}},
            headers=_HDR,
        )
    assert r.status_code == 200
    assert r.json()["risk"]["labelId"] == "PROHIBITED"


# ---------------------------------------------------------------------------
# result:false labels still appear in roles output with band
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_false_role_label_included_with_band(client):
    system_id = await _create_system(client)
    p1, p2 = _mock_minio()
    with p1, p2:
        r = await client.post(f"/v1/systems/{system_id}/classification/resolve", headers=_HDR)
    assert r.status_code == 200
    roles = r.json()["roles"]
    deployer = next((rl for rl in roles if rl["labelId"] == "DEPLOYER"), None)
    assert deployer is not None
    assert deployer["result"] is False
    assert deployer["confidenceBand"] is not None  # band computed even for false


# ---------------------------------------------------------------------------
# answers override triggers re-evaluation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_answers_override_reeval(client):
    """answers override re-evaluates rules; a label that was false can flip true."""
    system_id = await _create_system(client)
    p1, p2 = _mock_minio()
    with p1, p2:
        r = await client.post(
            f"/v1/systems/{system_id}/classification/resolve",
            json={"answers": {"High_Risk_1": ["MACHINERY"]}},
            headers=_HDR,
        )
    # just assert we get a valid response — the exact flip depends on config rules
    assert r.status_code == 200
    body = r.json()
    assert "risk" in body


@pytest.mark.asyncio
async def test_resolve_answers_unknown_question_id_returns_422(client):
    system_id = await _create_system(client)
    p1, p2 = _mock_minio()
    with p1, p2:
        r = await client.post(
            f"/v1/systems/{system_id}/classification/resolve",
            json={"answers": {"UNKNOWN_QUESTION_ID_XYZ": ["YES"]}},
            headers=_HDR,
        )
    assert r.status_code == 422
