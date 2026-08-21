from __future__ import annotations

import os
import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost")

from app.main import app  # noqa: E402


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_list_demos(client):
    r = await client.get("/v1/demos")
    assert r.status_code == 200
    data = r.json()
    assert "demos" in data
    ids = [d["id"] for d in data["demos"]]
    assert "creditsense" in ids
    assert "hirefilter" in ids


async def test_get_demo_not_found(client):
    r = await client.get("/v1/demos/nonexistent")
    assert r.status_code == 404


async def test_llm_status_unavailable(client):
    r = await client.get("/v1/llm/status")
    assert r.status_code == 200
    data = r.json()
    assert "available" in data
    assert "model" in data


async def test_identify_risks_rule_based(client):
    payload = {
        "system_description": "Automated credit scoring system using machine learning to assess loan applicants.",
        "metadata": {
            "name": "TestCredit",
            "version": "1.0",
            "description": "Credit scoring",
            "annex_iii_category": "essential_services",
            "annex_iii_point": "5b",
            "developer_org": "TestOrg",
            "intended_purpose": "Credit scoring",
            "intended_users": ["loan officers"],
            "deployment_context": "Retail banking",
            "data_inputs": ["credit history", "income"],
            "ai_techniques": ["gradient boosting"],
        },
        "use_llm": False,
        "use_stub": False,
    }
    r = await client.post("/v1/assessments/identify", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert "risks" in data
    assert "backend_used" in data


async def test_identify_risks_stub(client):
    payload = {
        "system_description": "Hiring tool that ranks CVs.",
        "metadata": {
            "name": "HireTest",
            "version": "1.0",
            "description": "CV ranker",
            "annex_iii_category": "employment",
            "annex_iii_point": "4a",
            "developer_org": "HireOrg",
            "intended_purpose": "CV screening",
            "intended_users": ["HR"],
            "deployment_context": "Corporate",
            "data_inputs": ["CV text"],
            "ai_techniques": ["NLP"],
        },
        "use_llm": False,
        "use_stub": True,
    }
    r = await client.post("/v1/assessments/identify", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert len(data["risks"]) > 0
