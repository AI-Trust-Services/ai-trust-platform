"""E2E tests for the classification pipeline (Step 2).

Uses the stub LLM provider. MinIO operations are patched to avoid a live instance.
RAG retrieval is mocked via respx.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

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
    """Patch Step 2 MinIO calls — read returns a minimal questionnaire result."""
    # Mock the MinIO get_object response for reading Step 1 output.
    mock_response = MagicMock()
    mock_response.read.return_value = _STUB_QUESTIONNAIRE_RESULT
    mock_response.close = MagicMock()
    mock_response.release_conn = MagicMock()

    get_patch = patch(
        "app.classification_pipeline.asyncio.to_thread",
        new_callable=AsyncMock,
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
    return get_patch, ensure_patch, presign_patch, mock_response


async def test_run_classification_writes_to_minio(client: httpx.AsyncClient):
    """After a questionnaire run, run_classification writes a valid JSON blob to MinIO."""
    from app.classification_pipeline import run_classification

    sid = await _create_system(client)

    get_p, ensure_p, presign_p, mock_resp = _mock_classification_minio()

    # Intercept asyncio.to_thread to capture the stored classification JSON.
    put_calls: list[bytes] = []

    async def _capture_to_thread(fn, *args, **kwargs):
        if hasattr(fn, "__name__") and fn.__name__ == "_get":
            # Reading Step 1 result from MinIO.
            return json.loads(_STUB_QUESTIONNAIRE_RESULT)
        if hasattr(fn, "__name__") and fn.__name__ == "_put":
            # Writing Step 2 result — capture the data argument (io.BytesIO).
            import io
            bio = args[2] if len(args) > 2 else kwargs.get("Body")
            if hasattr(bio, "read"):
                put_calls.append(bio.read())
            return None
        return None

    with patch(
        "app.classification_pipeline.asyncio.to_thread",
        side_effect=_capture_to_thread,
    ), ensure_p, presign_p:
        output = await run_classification(
            system_id=sid,
            questionnaire_run_key=_STUB_QUESTIONNAIRE_KEY,
        )

    assert "run_key" in output
    assert output["run_key"].startswith("classification-results/")
    assert "presigned_url" in output
    result = output["result"]
    assert result["config_id"] == "risk_role_classification_config"
    assert "config_version" in result
    assert "classifications" in result
    assert isinstance(result["classifications"], list)


async def test_questionnaire_run_triggers_classification(client: httpx.AsyncClient):
    """POST /systems/{id}/questionnaire-run triggers Step 2 (non-fatally)."""
    sid = await _create_system(client)

    q_upload_p, q_put_p, q_presign_p = _mock_questionnaire_minio()

    classification_called = []

    async def _fake_run_classification(**kwargs):
        classification_called.append(kwargs)
        return {
            "run_key": _STUB_CLASSIFICATION_KEY,
            "presigned_url": _STUB_PRESIGNED_C,
            "result": {"classifications": []},
        }

    with q_upload_p, q_put_p, q_presign_p:
        with patch(
            "app.routers.questionnaire.run_classification",
            side_effect=_fake_run_classification,
        ):
            with respx.mock(assert_all_mocked=False) as mock:
                mock.post(_RETRIEVE_URL).mock(
                    return_value=httpx.Response(503, json={"detail": "unavailable"})
                )
                r = await client.post(
                    f"/v1/systems/{sid}/questionnaire-run",
                    json={},
                    headers=_HDR,
                )

    assert r.status_code == 200, r.text
    # Step 2 was called with the Step 1 run_key.
    assert len(classification_called) == 1
    assert "questionnaire_run_key" in classification_called[0]


async def test_classification_failure_does_not_break_questionnaire_run(
    client: httpx.AsyncClient,
):
    """Step 2 failure is non-fatal — Step 1 response is still 200."""
    sid = await _create_system(client)

    q_upload_p, q_put_p, q_presign_p = _mock_questionnaire_minio()

    async def _failing_classification(**kwargs):
        raise RuntimeError("MinIO unavailable")

    with q_upload_p, q_put_p, q_presign_p:
        with patch(
            "app.routers.questionnaire.run_classification",
            side_effect=_failing_classification,
        ):
            with respx.mock(assert_all_mocked=False) as mock:
                mock.post(_RETRIEVE_URL).mock(
                    return_value=httpx.Response(503)
                )
                r = await client.post(
                    f"/v1/systems/{sid}/questionnaire-run",
                    json={},
                    headers=_HDR,
                )

    assert r.status_code == 200, r.text
    body = r.json()
    assert "run_key" in body
