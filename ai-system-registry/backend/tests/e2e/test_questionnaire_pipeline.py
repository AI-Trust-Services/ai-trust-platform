"""E2E tests for POST /v1/systems/{system_id}/questionnaire-llm-run (pipeline 1).

Uses the stub LLM provider (default — no network call to Thalamus).
MinIO is patched at the ``minio_client`` helper level (``put_json`` /
``get_presigned_url``) to avoid needing a live MinIO instance.
RAG retrieval is mocked via respx.
"""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import AsyncMock, patch

import httpx
import respx

_USER = "ai-engineer"
_HDR = {"x-forwarded-preferred-username": _USER}
_RETRIEVE_URL = "http://document-indexing-backend:8011/v1/retrieve"

_STUB_PRESIGNED = "http://minio:9000/registration-docs/questionnaire-results/fake-key.json?X-Amz-Signature=stub"


async def _create_system(client: httpx.AsyncClient) -> str:
    r = await client.post(
        "/v1/intake",
        json={"name": "Test Questionnaire System", "assignee_username": _USER},
        headers=_HDR,
    )
    assert r.status_code == 201
    return r.json()["system"]["id"]


@contextmanager
def _mock_minio():
    """Patch MinIO writes and the presigned URL; yields the ``put_json`` mock."""
    with (
        patch(
            "app.questionnaire_pipeline.minio_client.put_json",
            new_callable=AsyncMock,
        ) as put_json,
        patch(
            "app.questionnaire_pipeline.minio_client.get_presigned_url",
            new_callable=AsyncMock,
            return_value=_STUB_PRESIGNED,
        ),
    ):
        yield put_json


async def test_happy_path_no_rag_documents(client: httpx.AsyncClient):
    """Pipeline succeeds with only registration data when RAG is unavailable."""
    sid = await _create_system(client)

    with _mock_minio() as put_json:
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
    assert body["presigned_url"] == _STUB_PRESIGNED
    assert isinstance(body["result"]["results"], list)
    assert len(body["result"]["results"]) >= 1

    # The result file is stored under the versioned key and equals the response.
    key, stored = put_json.await_args.args
    assert key == body["run_key"]
    assert key.startswith(f"questionnaire-results/{sid}/ai-questionnaire/")
    assert stored == body["result"]


async def test_every_questionnaire_question_is_answered(client: httpx.AsyncClient):
    """The stub follows the answer contract (one result per question of each batch),
    so the strict validator accepts every batch and the merged result covers the
    whole questionnaire."""
    from app.assessment_catalogue import ASSESSMENT_QUESTION_KEYS

    sid = await _create_system(client)

    with _mock_minio():
        with respx.mock(assert_all_mocked=False) as mock:
            mock.post(_RETRIEVE_URL).mock(return_value=httpx.Response(503))
            r = await client.post(
                f"/v1/systems/{sid}/questionnaire-llm-run",
                json={},
                headers=_HDR,
            )

    assert r.status_code == 200, r.text
    answered = [item["questionId"] for item in r.json()["result"]["results"]]
    assert sorted(answered) == sorted(ASSESSMENT_QUESTION_KEYS)


async def test_happy_path_rag_failure_is_best_effort(client: httpx.AsyncClient):
    """Pipeline succeeds even when RAG retrieval raises a connection error."""
    sid = await _create_system(client)

    with _mock_minio():
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

    with _mock_minio():
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


async def test_path_traversal_ids_are_rejected(client: httpx.AsyncClient):
    sid = await _create_system(client)
    for field in ("questionnaire_id", "prompt_id"):
        r = await client.post(
            f"/v1/systems/{sid}/questionnaire-llm-run",
            json={field: "../README"},
            headers=_HDR,
        )
        assert r.status_code == 422, (field, r.text)


# ---------------------------------------------------------------------------
# Batch failure — graceful degradation (return_exceptions=True)
# ---------------------------------------------------------------------------


def _patched_parse_with_retry_factory(fail_first_n: int):
    """A parse_with_retry stand-in that fails the first ``fail_first_n`` calls.

    Later calls delegate to the real validator (the stub text is valid JSON).
    """
    from app.llm.parsing import LLMParseError

    calls = {"n": 0}

    async def _patched(
        text, task, validator, chat_fn, messages, max_attempts=3, max_tokens=None
    ):
        calls["n"] += 1
        if calls["n"] <= fail_first_n:
            raise LLMParseError("simulated batch failure")
        import json as _json

        return validator(_json.loads(text))

    return _patched


async def test_batch_failure_other_batches_still_succeed(client: httpx.AsyncClient):
    """When one batch exhausts all retries, other batches still complete."""
    sid = await _create_system(client)

    with _mock_minio():
        with patch(
            "app.questionnaire_pipeline.parse_with_retry",
            side_effect=_patched_parse_with_retry_factory(fail_first_n=1),
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
    assert isinstance(body["result"]["results"], list)
    assert len(body["result"]["results"]) >= 1


async def test_all_batches_failing_returns_502(client: httpx.AsyncClient):
    """If no batch produced a valid result the run is an error, not an empty success."""
    sid = await _create_system(client)

    with _mock_minio() as put_json:
        with patch(
            "app.questionnaire_pipeline.parse_with_retry",
            side_effect=_patched_parse_with_retry_factory(fail_first_n=10_000),
        ):
            with respx.mock(assert_all_mocked=False) as mock:
                mock.post(_RETRIEVE_URL).mock(return_value=httpx.Response(503))
                r = await client.post(
                    f"/v1/systems/{sid}/questionnaire-llm-run",
                    json={},
                    headers=_HDR,
                )

    assert r.status_code == 502, r.text
    assert "no questionnaire batch produced a valid result" in r.json()["detail"]
    put_json.assert_not_awaited()  # nothing is stored for a failed run
