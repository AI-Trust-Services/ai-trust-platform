"""E2E tests for cognee-eval backend.

Covers /v1/evaluate, /v1/feedback, /v1/ingest, and /v1/ingest/status.
All cognee calls are mocked in conftest.py — no AI gateway or Cognee pipeline needed.
"""

from __future__ import annotations

import httpx


# ── /v1/evaluate ──────────────────────────────────────────────────────────────


async def test_create_evaluation_returns_201(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/evaluate", json={"question": "What is a high-risk AI system?"}
    )
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("EVL-")
    assert body["question"] == "What is a high-risk AI system?"
    assert (
        body["answer"]
        == "High-risk AI systems are defined in Article 6 of the EU AI Act."
    )
    assert len(body["source_evidence"]) == 2
    assert body["source_evidence"][0]["node_id"] == "node-001"
    assert body["knowledge_gap"] is False


async def test_create_evaluation_knowledge_gap_when_no_passages(
    client: httpx.AsyncClient,
):
    import app.cognee_client as _cc
    from unittest.mock import AsyncMock

    orig = _cc.recall
    _cc.recall = AsyncMock(return_value=[])
    try:
        r = await client.post("/v1/evaluate", json={"question": "Unknown question?"})
        assert r.status_code == 201
        body = r.json()
        assert body["knowledge_gap"] is True
        assert body["source_evidence"] == []
    finally:
        _cc.recall = orig


async def test_list_evaluations_returns_created_items(client: httpx.AsyncClient):
    await client.post("/v1/evaluate", json={"question": "First question?"})
    await client.post("/v1/evaluate", json={"question": "Second question?"})

    r = await client.get("/v1/evaluate")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    questions = {i["question"] for i in items}
    assert "First question?" in questions
    assert "Second question?" in questions


async def test_list_evaluations_empty_initially(client: httpx.AsyncClient):
    r = await client.get("/v1/evaluate")
    assert r.status_code == 200
    assert r.json() == []


async def test_get_evaluation_by_id(client: httpx.AsyncClient):
    create_resp = await client.post(
        "/v1/evaluate", json={"question": "What is the EU AI Act?"}
    )
    evaluation_id = create_resp.json()["id"]

    r = await client.get(f"/v1/evaluate/{evaluation_id}")
    assert r.status_code == 200
    assert r.json()["id"] == evaluation_id
    assert r.json()["question"] == "What is the EU AI Act?"


async def test_get_evaluation_not_found(client: httpx.AsyncClient):
    r = await client.get("/v1/evaluate/EVL-nonexistent")
    assert r.status_code == 404


# ── /v1/feedback ──────────────────────────────────────────────────────────────


async def test_create_feedback_returns_201(client: httpx.AsyncClient):
    eval_resp = await client.post("/v1/evaluate", json={"question": "Test question?"})
    evaluation_id = eval_resp.json()["id"]

    r = await client.post(
        "/v1/feedback",
        json={
            "evaluation_id": evaluation_id,
            "conclusion": "The answer was incorrect.",
            "reasoning": "Article 6 does not apply here.",
            "supporting_node_ids": ["node-001"],
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("EFB-")
    assert body["evaluation_id"] == evaluation_id
    assert body["status"] == "pending"
    assert body["supporting_node_ids"] == ["node-001"]


async def test_create_feedback_marks_evaluation_as_knowledge_gap(
    client: httpx.AsyncClient,
):
    eval_resp = await client.post("/v1/evaluate", json={"question": "Feedback test?"})
    evaluation_id = eval_resp.json()["id"]
    assert eval_resp.json()["knowledge_gap"] is False

    await client.post(
        "/v1/feedback",
        json={
            "evaluation_id": evaluation_id,
            "conclusion": "Wrong answer.",
            "reasoning": "The passages were misleading.",
        },
    )

    r = await client.get(f"/v1/evaluate/{evaluation_id}")
    assert r.json()["knowledge_gap"] is True


async def test_create_feedback_unknown_evaluation_returns_404(
    client: httpx.AsyncClient,
):
    r = await client.post(
        "/v1/feedback",
        json={
            "evaluation_id": "EVL-nonexistent",
            "conclusion": "Wrong.",
            "reasoning": "Does not exist.",
        },
    )
    assert r.status_code == 404


async def test_list_feedback(client: httpx.AsyncClient):
    eval_resp = await client.post(
        "/v1/evaluate", json={"question": "List feedback test?"}
    )
    evaluation_id = eval_resp.json()["id"]

    await client.post(
        "/v1/feedback",
        json={"evaluation_id": evaluation_id, "conclusion": "C1", "reasoning": "R1"},
    )
    await client.post(
        "/v1/feedback",
        json={"evaluation_id": evaluation_id, "conclusion": "C2", "reasoning": "R2"},
    )

    r = await client.get("/v1/feedback")
    assert r.status_code == 200
    assert len(r.json()) == 2


async def test_list_feedback_filter_by_status(client: httpx.AsyncClient):
    eval_resp = await client.post(
        "/v1/evaluate", json={"question": "Status filter test?"}
    )
    evaluation_id = eval_resp.json()["id"]
    await client.post(
        "/v1/feedback",
        json={"evaluation_id": evaluation_id, "conclusion": "C", "reasoning": "R"},
    )

    r = await client.get("/v1/feedback?status=pending")
    assert r.status_code == 200
    assert all(item["status"] == "pending" for item in r.json())

    r2 = await client.get("/v1/feedback?status=approved")
    assert r2.status_code == 200
    assert r2.json() == []


async def test_reject_feedback(client: httpx.AsyncClient):
    eval_resp = await client.post("/v1/evaluate", json={"question": "Reject test?"})
    evaluation_id = eval_resp.json()["id"]
    fb_resp = await client.post(
        "/v1/feedback",
        json={"evaluation_id": evaluation_id, "conclusion": "C", "reasoning": "R"},
    )
    feedback_id = fb_resp.json()["id"]

    r = await client.patch(
        f"/v1/feedback/{feedback_id}/reject",
        headers={"x-forwarded-preferred-username": "reviewer"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "rejected"
    assert body["reviewer"] == "reviewer"


async def test_reject_already_rejected_returns_409(client: httpx.AsyncClient):
    eval_resp = await client.post("/v1/evaluate", json={"question": "409 test?"})
    evaluation_id = eval_resp.json()["id"]
    fb_resp = await client.post(
        "/v1/feedback",
        json={"evaluation_id": evaluation_id, "conclusion": "C", "reasoning": "R"},
    )
    feedback_id = fb_resp.json()["id"]

    await client.patch(f"/v1/feedback/{feedback_id}/reject")
    r = await client.patch(f"/v1/feedback/{feedback_id}/reject")
    assert r.status_code == 409


async def test_get_feedback_not_found(client: httpx.AsyncClient):
    r = await client.get("/v1/feedback/EFB-nonexistent")
    assert r.status_code == 404


async def test_approve_feedback_returns_202(client: httpx.AsyncClient):
    eval_resp = await client.post("/v1/evaluate", json={"question": "Approve test?"})
    evaluation_id = eval_resp.json()["id"]
    fb_resp = await client.post(
        "/v1/feedback",
        json={"evaluation_id": evaluation_id, "conclusion": "C", "reasoning": "R"},
    )
    feedback_id = fb_resp.json()["id"]

    r = await client.patch(
        f"/v1/feedback/{feedback_id}/approve",
        headers={"x-forwarded-preferred-username": "reviewer"},
    )
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "approving"
    assert body["reviewer"] == "reviewer"


async def test_approve_already_approved_returns_409(client: httpx.AsyncClient):
    eval_resp = await client.post(
        "/v1/evaluate", json={"question": "409 approve test?"}
    )
    evaluation_id = eval_resp.json()["id"]
    fb_resp = await client.post(
        "/v1/feedback",
        json={"evaluation_id": evaluation_id, "conclusion": "C", "reasoning": "R"},
    )
    feedback_id = fb_resp.json()["id"]

    await client.patch(f"/v1/feedback/{feedback_id}/reject")
    r = await client.patch(f"/v1/feedback/{feedback_id}/approve")
    assert r.status_code == 409


# ── /v1/ingest ────────────────────────────────────────────────────────────────


async def test_ingest_status_returns_ingested(client: httpx.AsyncClient):
    r = await client.get("/v1/ingest/status")
    assert r.status_code == 200
    body = r.json()
    assert body["ingested"] is True
    assert body["dataset"] == "eu_ai_act_v1"


async def test_ingest_non_pdf_returns_400(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/ingest",
        files={"file": ("document.txt", b"not a pdf", "text/plain")},
    )
    assert r.status_code == 400


# ── /health ───────────────────────────────────────────────────────────────────


async def test_health_returns_ok(client: httpx.AsyncClient):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
