"""E2E tests for the AI Test Bed endpoints.

Tests /v1/testbed/samples, /v1/testbed/run, and /v1/testbed/runs.
The registry evaluate endpoint is mocked via the mock_registry_evaluate fixture.
"""

from __future__ import annotations

import httpx

_USER = "test-user"
_HDR = {"x-forwarded-preferred-username": _USER}


async def test_list_samples_returns_all_fixtures(client: httpx.AsyncClient):
    r = await client.get("/v1/testbed/samples", headers=_HDR)
    assert r.status_code == 200
    samples = r.json()
    assert isinstance(samples, list)
    assert len(samples) >= 3
    ids = {s["id"] for s in samples}
    assert "tbs-hiring-screener" in ids
    assert "tbs-internal-chatbot" in ids
    assert "tbs-credit-scoring" in ids


async def test_run_testbed_returns_result(
    client: httpx.AsyncClient, mock_registry_evaluate
):
    r = await client.post(
        "/v1/testbed/run",
        json={
            "sample_id": "tbs-hiring-screener",
            "role": "engineer",
            "enabled_sources": {
                "system_docs": False,
                "eu_ai_act": False,
                "cognee": False,
            },
        },
        headers=_HDR,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["run_id"].startswith("TBR-")
    assert body["sample_id"] == "tbs-hiring-screener"
    assert body["tier"] == "high"
    assert body["role"] == "engineer"
    assert "rationale" in body


async def test_run_testbed_persists_run(
    client: httpx.AsyncClient, mock_registry_evaluate
):
    await client.post(
        "/v1/testbed/run",
        json={
            "sample_id": "tbs-hiring-screener",
            "role": "compliance_officer",
            "enabled_sources": {},
        },
        headers=_HDR,
    )
    r = await client.get("/v1/testbed/runs?sample_id=tbs-hiring-screener", headers=_HDR)
    assert r.status_code == 200
    runs = r.json()
    assert len(runs) >= 1
    assert runs[0]["sample_id"] == "tbs-hiring-screener"


async def test_run_testbed_unknown_sample_returns_404(
    client: httpx.AsyncClient,
):
    r = await client.post(
        "/v1/testbed/run",
        json={"sample_id": "tbs-nonexistent", "enabled_sources": {}},
        headers=_HDR,
    )
    assert r.status_code == 404


async def test_list_runs_empty_initially(client: httpx.AsyncClient):
    r = await client.get("/v1/testbed/runs?sample_id=tbs-hiring-screener", headers=_HDR)
    assert r.status_code == 200
    assert r.json() == []


async def test_run_context_assembly_with_no_ai_system(
    client: httpx.AsyncClient, mock_registry_evaluate
):
    # tbs-hiring-screener has no ai_system_id → system_docs toggle is a no-op.
    r = await client.post(
        "/v1/testbed/run",
        json={
            "sample_id": "tbs-hiring-screener",
            "role": "engineer",
            "enabled_sources": {
                "system_docs": True,
                "eu_ai_act": False,
                "cognee": False,
            },
        },
        headers=_HDR,
    )
    assert r.status_code == 200
    body = r.json()
    # system_docs enabled but no ai_system_id → no passages, still runs cleanly.
    assert body["tier"] == "high"
    assert body["source_passages"] == []
