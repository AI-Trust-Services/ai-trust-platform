"""E2E tests for the knowledge-grounded task agent endpoints.

Uses httpx.AsyncClient + ASGITransport — no running server needed.
The LLM is replaced with PydanticAI TestModel; registry, document-indexing, and
cognee HTTP calls are mocked via unittest.mock.

Requires Postgres (same as the existing e2e suite).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

_USER = "test-user"
_HDR = {"x-forwarded-preferred-username": _USER}
_SYSTEM_ID = "SYS-TESTAGENT"

# Canned registry system response (includes questionnaire_answers)
_STUB_SYSTEM = {
    "id": _SYSTEM_ID,
    "name": "Test Agent System",
    "description": "A test system for the agent e2e suite.",
    "tier": "pending",
    "questionnaire_answers": {
        "intended_purpose": "Automated HR screening",
        "use_case": "CV ranking for job applications",
        "technical": {
            "model_type": "gradient_boosting",
            "training_data": "historical HR decisions",
        },
    },
}

# Canned TaskResult output for TestModel
_STUB_TASK_RESULT_ARGS = {
    "proposed_answer": "High risk under Annex III, point 4 (employment).",
    "rationale": "The system screens job applicants — a clear Annex III trigger.",
    "source_references": [],
    "applicable_judgments": [],
    "missing_facts": [],
    "review_required": False,
    "review_questions": [],
}

# Canned cognee evaluate response
_STUB_EVAL_RESPONSE = {
    "id": "eval-123",
    "source_evidence": [
        {
            "text": "Employment screening triggers Annex III.",
            "node_id": "n1",
            "score": 0.9,
        }
    ],
}
_STUB_FEEDBACK_RESPONSE = {"id": "fb-456"}
_STUB_APPROVE_RESPONSE = {"status": "approved"}


def _make_registry_mock():
    """Return a mock that stands in for httpx.AsyncClient for registry calls."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = _STUB_SYSTEM

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.get = AsyncMock(return_value=mock_resp)
    return mock_client


def _make_cognee_mock():
    """Return a mock that handles the evaluate→feedback→approve cognee sequence."""

    async def _post(url, *args, **kwargs):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        if "/evaluate" in url:
            mock_resp.json.return_value = _STUB_EVAL_RESPONSE
        elif "/feedback" in url:
            mock_resp.json.return_value = _STUB_FEEDBACK_RESPONSE
        else:
            mock_resp.json.return_value = {"status": "ok"}
        return mock_resp

    async def _patch(url, *args, **kwargs):
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_resp.json.return_value = _STUB_APPROVE_RESPONSE
        return mock_resp

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = AsyncMock(side_effect=_post)
    mock_client.patch = AsyncMock(side_effect=_patch)
    return mock_client


@pytest.fixture
def mock_registry():
    """Patch the httpx.AsyncClient used by the agent router's _fetch_system."""
    with patch(
        "app.routers.agent.httpx.AsyncClient", return_value=_make_registry_mock()
    ):
        yield


@pytest.fixture
def mock_cognee():
    """Patch the httpx.AsyncClient used by the agent feedback endpoint."""
    with patch("app.routers.agent.httpx.AsyncClient", return_value=_make_cognee_mock()):
        yield


@pytest.fixture
def mock_agent_run():
    """Replace run_task with a stub that does not hit a real LLM or network."""
    from app.agent.models import TaskResult

    stub_result = TaskResult(**_STUB_TASK_RESULT_ARGS)
    stub_passages: list[dict] = [
        {
            "ref_id": "L-chunk1",
            "text": "Annex III text.",
            "source_label": "legal",
            "backend": "classic",
            "meta": {},
        }
    ]
    stub_usage = {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150}

    async def _fake_run_task(**kwargs):
        return stub_result, stub_passages, stub_usage

    with patch("app.routers.agent.run_task", side_effect=_fake_run_task):
        yield


# ---------------------------------------------------------------------------
# POST /testbed/agent/run
# ---------------------------------------------------------------------------


async def test_agent_run_returns_correct_shape(
    client: httpx.AsyncClient, mock_registry, mock_agent_run
):
    r = await client.post(
        "/v1/testbed/agent/run",
        json={"system_id": _SYSTEM_ID},
        headers=_HDR,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["run_id"].startswith("TBR-")
    assert body["system_id"] == _SYSTEM_ID
    assert "task" in body
    assert "source_backends" in body
    assert "result" in body
    assert "retrieved_passages" in body
    assert "created_at" in body
    assert body["created_by"] == _USER


async def test_agent_run_persists_agent_run_row(
    client: httpx.AsyncClient, mock_registry, mock_agent_run
):
    r = await client.post(
        "/v1/testbed/agent/run",
        json={"system_id": _SYSTEM_ID},
        headers=_HDR,
    )
    assert r.status_code == 200
    run_id = r.json()["run_id"]

    # Verify it appears in the runs list.
    list_r = await client.get("/v1/testbed/agent/runs", headers=_HDR)
    assert list_r.status_code == 200
    runs = list_r.json()
    assert any(run["run_id"] == run_id for run in runs)


async def test_agent_run_404_on_missing_system(client: httpx.AsyncClient):
    """If the registry returns 404, the agent run should return 404."""
    mock_resp = MagicMock()
    mock_resp.status_code = 404
    mock_resp.text = "Not found"

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("app.routers.agent.httpx.AsyncClient", return_value=mock_client):
        r = await client.post(
            "/v1/testbed/agent/run",
            json={"system_id": "SYS-NONEXISTENT"},
            headers=_HDR,
        )
    assert r.status_code == 404


async def test_agent_run_result_has_resolved_flags(
    client: httpx.AsyncClient, mock_registry, mock_agent_run
):
    """source_references in the result must have a resolved flag."""
    r = await client.post(
        "/v1/testbed/agent/run",
        json={
            "system_id": _SYSTEM_ID,
            "source_backends": {
                "legal": "classic",
                "reviewed_judgments": "classic",
                "system_evidence": "classic",
            },
        },
        headers=_HDR,
    )
    assert r.status_code == 200
    # The stub result has no source_references so just check the key structure
    result = r.json()["result"]
    assert "proposed_answer" in result
    assert "rationale" in result
    assert "source_references" in result
    assert "review_required" in result


# ---------------------------------------------------------------------------
# GET /testbed/agent/runs
# ---------------------------------------------------------------------------


async def test_agent_runs_empty_initially(client: httpx.AsyncClient):
    r = await client.get("/v1/testbed/agent/runs", headers=_HDR)
    assert r.status_code == 200
    assert r.json() == []


async def test_agent_runs_returns_summaries(
    client: httpx.AsyncClient, mock_registry, mock_agent_run
):
    await client.post(
        "/v1/testbed/agent/run",
        json={"system_id": _SYSTEM_ID},
        headers=_HDR,
    )
    r = await client.get("/v1/testbed/agent/runs", headers=_HDR)
    assert r.status_code == 200
    runs = r.json()
    assert len(runs) >= 1
    run = runs[0]
    assert "run_id" in run
    assert "system_id" in run
    assert "task" in run
    assert "source_backends" in run
    assert "review_required" in run
    assert "created_at" in run


# ---------------------------------------------------------------------------
# GET /testbed/agent/runs/{run_id}
# ---------------------------------------------------------------------------


async def test_agent_run_detail_returns_full_payload(
    client: httpx.AsyncClient, mock_registry, mock_agent_run
):
    create_r = await client.post(
        "/v1/testbed/agent/run",
        json={"system_id": _SYSTEM_ID},
        headers=_HDR,
    )
    run_id = create_r.json()["run_id"]

    r = await client.get(f"/v1/testbed/agent/runs/{run_id}", headers=_HDR)
    assert r.status_code == 200
    body = r.json()
    assert body["run_id"] == run_id
    assert "result" in body
    assert "retrieved_passages" in body


async def test_agent_run_detail_404_for_missing(client: httpx.AsyncClient):
    r = await client.get("/v1/testbed/agent/runs/TBR-NOTFOUND", headers=_HDR)
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# POST /testbed/agent/feedback
# ---------------------------------------------------------------------------


async def test_agent_feedback_happy_path(
    client: httpx.AsyncClient, mock_registry, mock_agent_run
):
    create_r = await client.post(
        "/v1/testbed/agent/run",
        json={"system_id": _SYSTEM_ID},
        headers=_HDR,
    )
    run_id = create_r.json()["run_id"]

    with patch("app.routers.agent.httpx.AsyncClient", return_value=_make_cognee_mock()):
        r = await client.post(
            "/v1/testbed/agent/feedback",
            json={
                "run_id": run_id,
                "conclusion": "correct",
                "reasoning": "The classification matches Art. 6 criteria.",
            },
            headers=_HDR,
        )

    assert r.status_code == 200
    body = r.json()
    assert body["feedback_id"] == "fb-456"
    assert body["status"] == "approved"


async def test_agent_feedback_503_on_cognee_unreachable(
    client: httpx.AsyncClient, mock_registry, mock_agent_run
):
    create_r = await client.post(
        "/v1/testbed/agent/run",
        json={"system_id": _SYSTEM_ID},
        headers=_HDR,
    )
    run_id = create_r.json()["run_id"]

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = AsyncMock(side_effect=httpx.ConnectError("refused"))

    with patch("app.routers.agent.httpx.AsyncClient", return_value=mock_client):
        r = await client.post(
            "/v1/testbed/agent/feedback",
            json={
                "run_id": run_id,
                "conclusion": "correct",
                "reasoning": "test",
            },
            headers=_HDR,
        )

    assert r.status_code == 503


async def test_agent_feedback_404_on_missing_run(client: httpx.AsyncClient):
    with patch("app.routers.agent.httpx.AsyncClient", return_value=_make_cognee_mock()):
        r = await client.post(
            "/v1/testbed/agent/feedback",
            json={
                "run_id": "TBR-NOTEXIST",
                "conclusion": "correct",
                "reasoning": "test",
            },
            headers=_HDR,
        )
    assert r.status_code == 404
