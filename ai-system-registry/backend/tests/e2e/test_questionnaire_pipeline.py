"""E2E tests for POST /v1/systems/{system_id}/questionnaire-llm-run.

Uses the stub LLM provider (default — no network call to Thalamus).
MinIO upload is patched to avoid needing a live MinIO instance.
RAG retrieval is mocked via respx.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import respx

_USER = "ai-engineer"
_HDR = {"x-forwarded-preferred-username": _USER}
_RETRIEVE_URL = "http://document-indexing-backend:8011/v1/retrieve"

_STUB_PRESIGNED = "http://minio:9000/registration-docs/questionnaire-results/fake-key.json?X-Amz-Signature=stub"
_STUB_KEY = (
    "questionnaire-results/SYS-TEST0001/ai-questionnaire/2026-01-01T00-00-00Z.json"
)


async def _create_system(client: httpx.AsyncClient) -> str:
    r = await client.post(
        "/v1/intake",
        json={"name": "Test Questionnaire System", "assignee_username": _USER},
        headers=_HDR,
    )
    assert r.status_code == 201
    return r.json()["system"]["id"]


def _mock_minio():
    """Patch MinIO upload and presigned URL to avoid a live MinIO instance."""
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
        return_value=_STUB_PRESIGNED,
    )
    return upload_patch, put_patch, presign_patch


async def test_happy_path_no_rag_documents(client: httpx.AsyncClient):
    """Pipeline succeeds with only registration data when RAG is unavailable."""
    sid = await _create_system(client)

    upload_p, put_p, presign_p = _mock_minio()
    with upload_p, put_p, presign_p:
        with respx.mock(assert_all_mocked=False) as mock:
            mock.post(_RETRIEVE_URL).mock(
                return_value=httpx.Response(503, json={"detail": "unavailable"})
            )
            r = await client.post(
                f"/v1/systems/{sid}/questionnaire-llm-run",
                json={},
                headers=_HDR,
            )

    assert r.status_code == 200, r.text
    body = r.json()
    assert "run_key" in body
    assert "presigned_url" in body
    assert body["presigned_url"] == _STUB_PRESIGNED
    assert "result" in body
    assert "results" in body["result"]
    assert isinstance(body["result"]["results"], list)
    assert len(body["result"]["results"]) >= 1


async def test_happy_path_rag_failure_is_best_effort(client: httpx.AsyncClient):
    """Pipeline succeeds even when RAG retrieval raises a connection error."""
    sid = await _create_system(client)

    upload_p, put_p, presign_p = _mock_minio()
    with upload_p, put_p, presign_p:
        with respx.mock(assert_all_mocked=False) as mock:
            mock.post(_RETRIEVE_URL).mock(side_effect=httpx.ConnectError("refused"))
            r = await client.post(
                f"/v1/systems/{sid}/questionnaire-llm-run",
                json={},
                headers=_HDR,
            )

    assert r.status_code == 200, r.text
    body = r.json()
    assert "results" in body["result"]


async def test_explicit_questionnaire_and_prompt_ids(client: httpx.AsyncClient):
    """Explicit questionnaire_id and prompt_id matching the default files succeed."""
    sid = await _create_system(client)

    upload_p, put_p, presign_p = _mock_minio()
    with upload_p, put_p, presign_p:
        with respx.mock(assert_all_mocked=False) as mock:
            mock.post(_RETRIEVE_URL).mock(
                return_value=httpx.Response(200, json={"results": []})
            )
            r = await client.post(
                f"/v1/systems/{sid}/questionnaire-llm-run",
                json={
                    "questionnaire_id": "ai-questionnaire",
                    "prompt_id": "questionnaire_answer",
                },
                headers=_HDR,
            )

    assert r.status_code == 200, r.text


async def test_unknown_system_returns_404(client: httpx.AsyncClient):
    r = await client.post(
        "/v1/systems/SYS-NOTFOUND/questionnaire-llm-run",
        json={},
        headers=_HDR,
    )
    assert r.status_code == 404


async def test_unknown_questionnaire_id_returns_404(client: httpx.AsyncClient):
    sid = await _create_system(client)
    r = await client.post(
        f"/v1/systems/{sid}/questionnaire-llm-run",
        json={"questionnaire_id": "nonexistent-questionnaire"},
        headers=_HDR,
    )
    assert r.status_code == 404


async def test_unknown_prompt_id_returns_404(client: httpx.AsyncClient):
    sid = await _create_system(client)
    r = await client.post(
        f"/v1/systems/{sid}/questionnaire-llm-run",
        json={"prompt_id": "nonexistent-prompt"},
        headers=_HDR,
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Batch failure — graceful degradation (return_exceptions=True)
# ---------------------------------------------------------------------------


async def test_batch_failure_other_batches_still_succeed(client: httpx.AsyncClient):
    """When one batch exhausts all 3 retries, other batches still complete.

    Simulates a failed batch by patching parse_with_retry to raise LLMParseError
    on the first call only; subsequent calls (other batches) return the stub result.
    """
    from app.llm.parsing import LLMParseError

    sid = await _create_system(client)

    call_count = 0

    async def _patched_parse_with_retry(
        text, task, validator, chat_fn, messages, max_attempts=3
    ):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise LLMParseError("simulated batch failure")
        # Delegate to real validator; stub text is already valid JSON
        import json as _json

        parsed = _json.loads(text)
        return validator(parsed)

    upload_p, put_p, presign_p = _mock_minio()
    with upload_p, put_p, presign_p:
        with patch(
            "app.questionnaire_pipeline.parse_with_retry",
            side_effect=_patched_parse_with_retry,
        ):
            with respx.mock(assert_all_mocked=False) as mock:
                mock.post(_RETRIEVE_URL).mock(return_value=httpx.Response(503))
                r = await client.post(
                    f"/v1/systems/{sid}/questionnaire-llm-run",
                    json={},
                    headers=_HDR,
                )

    # Pipeline must succeed even with one failed batch.
    assert r.status_code == 200, r.text
    body = r.json()
    assert "results" in body["result"]
    # Failed batch contributed 0 questions; others contributed their questions.
    assert isinstance(body["result"]["results"], list)
