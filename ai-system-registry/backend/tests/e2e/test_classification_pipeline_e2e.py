"""E2E tests for the classification pipeline (Step 2) and pipeline orchestration endpoints.

Uses the stub LLM provider. MinIO operations are patched to avoid a live instance.
RAG retrieval is mocked via respx.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx

_USER = "ai-engineer"
_HDR = {"x-forwarded-preferred-username": _USER}
_RETRIEVE_URL = "http://document-indexing-backend:8011/v1/retrieve"

_STUB_QUESTIONNAIRE_KEY = (
    "questionnaire-results/SYS-TEST0001/ai-questionnaire/2026-01-01T00-00-00Z.json"
)
_STUB_CLASSIFICATION_KEY = (
    "classification-results/SYS-TEST0001/risk_role_classification_config/2026-01-01T00-00-00Z.json"
)
_STUB_PRESIGNED_Q = "http://minio:9000/registration-docs/questionnaire-stub.json?X-Amz-Signature=stub"
_STUB_PRESIGNED_C = "http://minio:9000/registration-docs/classification-stub.json?X-Amz-Signature=stub"

# Minimal questionnaire result that satisfies the classification pipeline validator.
_STUB_QUESTIONNAIRE_RESULT = json.dumps(
    {
        "results": [
            {
                "questionId": "Scope_1",
                "question": "Is your system an AI system?",
                "questionType": "PREDEFINED",
                "answer": [
                    {
                        "value": "NOT_ENOUGH_INFORMATION",
                        "answerStrength": None,
                        "reason": None,
                    }
                ],
                "explanation": "Stub mode.",
                "references": [],
            }
        ]
    }
).encode("utf-8")

_STUB_CLASSIFICATION_OUTPUT = {
    "run_key": _STUB_CLASSIFICATION_KEY,
    "presigned_url": _STUB_PRESIGNED_C,
    "result": {
        "questionnaire_run_key": _STUB_QUESTIONNAIRE_KEY,
        "config_id": "risk_role_classification_config",
        "config_version": "1.0.0",
        "prompt_id": "risk_role_classification",
        "classifications": [],
    },
}


async def _create_system(client: httpx.AsyncClient) -> str:
    r = await client.post(
        "/v1/intake",
        json={"name": "Classification E2E System", "assignee_username": _USER},
        headers=_HDR,
    )
    assert r.status_code == 201
    return r.json()["system"]["id"]


def _mock_questionnaire_minio():
    """Patch Step 1 MinIO calls."""
    upload_patch = patch(
        "app.questionnaire_pipeline.minio_client.ensure_bucket",
        new_callable=AsyncMock,
    )
    put_patch = patch(
        "app.questionnaire_pipeline.asyncio.to_thread",
        new_callable=AsyncMock,
        return_value=None,
    )
    presign_patch = patch(
        "app.questionnaire_pipeline.minio_client.get_presigned_url",
        new_callable=AsyncMock,
        return_value=_STUB_PRESIGNED_Q,
    )
    return upload_patch, put_patch, presign_patch


def _mock_classification_minio():
    """Patch Step 2 MinIO calls."""
    async def _capture_to_thread(fn, *args, **kwargs):
        if hasattr(fn, "__name__") and fn.__name__ == "_get":
            return json.loads(_STUB_QUESTIONNAIRE_RESULT)
        return None

    get_patch = patch(
        "app.classification_pipeline.asyncio.to_thread",
        side_effect=_capture_to_thread,
    )
    ensure_patch = patch(
        "app.classification_pipeline.minio_client.ensure_bucket",
        new_callable=AsyncMock,
    )
    presign_patch = patch(
        "app.classification_pipeline.minio_client.get_presigned_url",
        new_callable=AsyncMock,
        return_value=_STUB_PRESIGNED_C,
    )
    return get_patch, ensure_patch, presign_patch


# ---------------------------------------------------------------------------
# run_classification (library function)
# ---------------------------------------------------------------------------


async def test_run_classification_writes_to_minio(client: httpx.AsyncClient):
    """run_classification writes a valid JSON blob to MinIO and returns correct schema."""
    from app.classification_pipeline import run_classification

    sid = await _create_system(client)
    get_p, ensure_p, presign_p = _mock_classification_minio()

    with get_p, ensure_p, presign_p:
        output = await run_classification(
            system_id=sid,
            questionnaire_run_key=_STUB_QUESTIONNAIRE_KEY,
        )

    assert output["run_key"].startswith("classification-results/")
    assert "presigned_url" in output
    result = output["result"]
    assert result["config_id"] == "risk_role_classification_config"
    assert "config_version" in result
    assert isinstance(result["classifications"], list)


# ---------------------------------------------------------------------------
# POST /v1/systems/{id}/classification-run
# ---------------------------------------------------------------------------


async def test_classification_run_endpoint(client: httpx.AsyncClient):
    """POST /classification-llm-run returns 200 with correct schema."""
    sid = await _create_system(client)
    get_p, ensure_p, presign_p = _mock_classification_minio()

    with get_p, ensure_p, presign_p:
        r = await client.post(
            f"/v1/systems/{sid}/classification-llm-run",
            json={"questionnaire_run_key": _STUB_QUESTIONNAIRE_KEY},
            headers=_HDR,
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["run_key"].startswith("classification-results/")
    assert "presigned_url" in body
    assert "classifications" in body["result"]


async def test_classification_run_endpoint_missing_key_returns_404(
    client: httpx.AsyncClient,
):
    """POST /classification-llm-run with a non-existent MinIO key returns 404."""
    sid = await _create_system(client)

    async def _raise_key_error(fn, *args, **kwargs):
        raise KeyError("questionnaire-results/missing/key.json")

    with patch(
        "app.classification_pipeline.asyncio.to_thread",
        side_effect=_raise_key_error,
    ):
        r = await client.post(
            f"/v1/systems/{sid}/classification-llm-run",
            json={"questionnaire_run_key": "questionnaire-results/missing/key.json"},
            headers=_HDR,
        )

    assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# POST /v1/systems/{id}/pipeline-run
# ---------------------------------------------------------------------------


async def test_pipeline_run_endpoint(client: httpx.AsyncClient):
    """POST /ai-assisted-assessment-prefill-run returns both questionnaire and classification keys."""
    sid = await _create_system(client)

    q_upload_p, q_put_p, q_presign_p = _mock_questionnaire_minio()

    async def _fake_run_classification(**kwargs):
        return _STUB_CLASSIFICATION_OUTPUT

    with q_upload_p, q_put_p, q_presign_p:
        with patch(
            "app.routers.pipeline.run_classification",
            side_effect=_fake_run_classification,
        ):
            with respx.mock(assert_all_mocked=False) as mock:
                mock.post(_RETRIEVE_URL).mock(
                    return_value=httpx.Response(503, json={"detail": "unavailable"})
                )
                r = await client.post(
                    f"/v1/systems/{sid}/ai-assisted-assessment-prefill-run",
                    json={},
                    headers=_HDR,
                )

    assert r.status_code == 200, r.text
    body = r.json()
    assert "questionnaire" in body
    assert "classification" in body
    assert body["questionnaire"]["run_key"].startswith("questionnaire-results/")
    assert body["classification"]["run_key"] == _STUB_CLASSIFICATION_KEY


async def test_questionnaire_run_does_not_trigger_classification(
    client: httpx.AsyncClient,
):
    """POST /questionnaire-llm-run is Step 1 only — classification is NOT auto-triggered."""
    sid = await _create_system(client)

    q_upload_p, q_put_p, q_presign_p = _mock_questionnaire_minio()
    classification_called = []

    async def _spy(**kwargs):
        classification_called.append(kwargs)

    with q_upload_p, q_put_p, q_presign_p:
        with patch("app.routers.pipeline.run_classification", side_effect=_spy):
            with respx.mock(assert_all_mocked=False) as mock:
                mock.post(_RETRIEVE_URL).mock(
                    return_value=httpx.Response(503)
                )
                r = await client.post(
                    f"/v1/systems/{sid}/questionnaire-llm-run",
                    json={},
                    headers=_HDR,
                )

    assert r.status_code == 200, r.text
    assert classification_called == [], "classification must not be auto-triggered from questionnaire-llm-run"
