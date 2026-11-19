"""E2E tests for the classification pipeline (pipeline 2) endpoint.

Uses the stub LLM provider. MinIO is patched at the ``minio_client`` helper level
(``get_json`` / ``put_json`` / ``get_presigned_url``) to avoid a live instance.
"""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.llm.templates import load_questionnaire

_USER = "ai-engineer"
_HDR = {"x-forwarded-preferred-username": _USER}

_STUB_PRESIGNED_C = (
    "http://minio:9000/registration-docs/classification-stub.json?X-Amz-Signature=stub"
)


def _questionnaire_key(system_id: str) -> str:
    return (
        f"questionnaire-results/{system_id}/ai-questionnaire/2026-01-01T00-00-00Z.json"
    )


def _stored_questionnaire_result() -> dict:
    """A complete questionnaire result (every question NOT_ENOUGH_INFORMATION), as
    pipeline 1 stores it — so every active label has its source answers."""
    return {
        "results": [
            {
                "questionId": q["id"],
                "question": q["question"],
                "questionType": q["type"],
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
            for q in load_questionnaire("ai-questionnaire")["questions"]
        ]
    }


async def _create_system(client: httpx.AsyncClient) -> str:
    r = await client.post(
        "/v1/intake",
        json={"name": "Classification E2E System", "assignee_username": _USER},
        headers=_HDR,
    )
    assert r.status_code == 201
    return r.json()["system"]["id"]


@contextmanager
def _mock_minio(get_json: AsyncMock | None = None):
    """Patch pipeline 2's MinIO calls; yields ``(get_json, put_json)`` mocks."""
    get_json = get_json or AsyncMock(return_value=_stored_questionnaire_result())
    with (
        patch("app.classification_pipeline.minio_client.get_json", get_json),
        patch(
            "app.classification_pipeline.minio_client.put_json",
            new_callable=AsyncMock,
        ) as put_json,
        patch(
            "app.classification_pipeline.minio_client.get_presigned_url",
            new_callable=AsyncMock,
            return_value=_STUB_PRESIGNED_C,
        ),
    ):
        yield get_json, put_json


# ---------------------------------------------------------------------------
# run_classification (library function)
# ---------------------------------------------------------------------------


async def test_run_classification_writes_to_minio(client: httpx.AsyncClient):
    """run_classification writes a valid JSON blob to MinIO and returns correct schema."""
    from app.classification_pipeline import run_classification

    sid = await _create_system(client)

    with _mock_minio() as (_, put_json):
        output = await run_classification(
            system_id=sid,
            questionnaire_run_key=_questionnaire_key(sid),
        )

    assert output["run_key"].startswith(f"classification-results/{sid}/")
    assert "presigned_url" in output
    result = output["result"]
    assert result["config_id"] == "risk_role_classification_config"
    assert "config_version" in result
    assert isinstance(result["classifications"], list)
    assert result["classifications"], "stub classifies every active label"
    key, stored = put_json.await_args.args
    assert key == output["run_key"]
    assert stored == result


# ---------------------------------------------------------------------------
# POST /v1/systems/{id}/classification-llm-run
# ---------------------------------------------------------------------------


async def test_classification_run_endpoint(client: httpx.AsyncClient):
    """POST /classification-llm-run returns 200 with correct schema."""
    sid = await _create_system(client)

    with _mock_minio():
        r = await client.post(
            f"/v1/systems/{sid}/classification-llm-run",
            json={"questionnaire_run_key": _questionnaire_key(sid)},
            headers=_HDR,
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["run_key"].startswith(f"classification-results/{sid}/")
    assert body["presigned_url"] == _STUB_PRESIGNED_C
    assert "classifications" in body["result"]
    assert "skipped_labels" in body["result"]


async def test_classification_run_endpoint_missing_key_returns_404(
    client: httpx.AsyncClient,
):
    """POST /classification-llm-run with a non-existent MinIO object returns 404."""
    sid = await _create_system(client)
    missing = _questionnaire_key(sid)

    with _mock_minio(AsyncMock(side_effect=KeyError(f"Object '{missing}' not found"))):
        r = await client.post(
            f"/v1/systems/{sid}/classification-llm-run",
            json={"questionnaire_run_key": missing},
            headers=_HDR,
        )

    assert r.status_code == 404, r.text


async def test_classification_run_unknown_system_returns_404(
    client: httpx.AsyncClient,
):
    with _mock_minio():
        r = await client.post(
            "/v1/systems/SYS-NOTFOUND/classification-llm-run",
            json={"questionnaire_run_key": _questionnaire_key("SYS-NOTFOUND")},
            headers=_HDR,
        )
    assert r.status_code == 404, r.text


async def test_classification_run_with_another_systems_key_returns_422(
    client: httpx.AsyncClient,
):
    """A caller with write access to system A must not classify system B's answers."""
    sid = await _create_system(client)
    other = await _create_system(client)

    with _mock_minio() as (get_json, put_json):
        r = await client.post(
            f"/v1/systems/{sid}/classification-llm-run",
            json={"questionnaire_run_key": _questionnaire_key(other)},
            headers=_HDR,
        )

    assert r.status_code == 422, r.text
    get_json.assert_not_awaited()
    put_json.assert_not_awaited()


@pytest.mark.parametrize(
    "field,value",
    [
        ("classification_config_id", "../README"),
        ("classification_config_id", "/etc/passwd"),
        ("classification_config_id", "a/b/c"),
        ("prompt_id", "../../CLAUDE"),
        ("prompt_id", "risk_classification/../../x"),
    ],
)
async def test_classification_run_rejects_invalid_ids(
    client: httpx.AsyncClient, field: str, value: str
):
    sid = await _create_system(client)

    with _mock_minio():
        r = await client.post(
            f"/v1/systems/{sid}/classification-llm-run",
            json={"questionnaire_run_key": _questionnaire_key(sid), field: value},
            headers=_HDR,
        )

    assert r.status_code == 422, r.text


async def test_classification_run_unknown_config_returns_404(
    client: httpx.AsyncClient,
):
    sid = await _create_system(client)

    with _mock_minio():
        r = await client.post(
            f"/v1/systems/{sid}/classification-llm-run",
            json={
                "questionnaire_run_key": _questionnaire_key(sid),
                "classification_config_id": "risk_classification/does_not_exist",
            },
            headers=_HDR,
        )

    assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# Pipelines stay separate: questionnaire run never triggers classification
# ---------------------------------------------------------------------------


async def test_questionnaire_run_does_not_trigger_classification(
    client: httpx.AsyncClient,
):
    """POST /questionnaire-llm-run triggers pipeline 1 only — classification (pipeline
    2) is not run, whether directly or through the prefill orchestration."""
    import respx

    sid = await _create_system(client)
    spy = AsyncMock()

    with (
        patch(
            "app.questionnaire_pipeline.minio_client.put_json", new_callable=AsyncMock
        ),
        patch(
            "app.questionnaire_pipeline.minio_client.get_presigned_url",
            new_callable=AsyncMock,
            return_value="http://minio/q",
        ),
        patch("app.classification_pipeline.run_classification", spy),
        patch("app.assessment_prefill_pipeline.run_classification", spy),
        patch("app.routers.classification.run_classification", spy),
        respx.mock(assert_all_mocked=False) as mock,
    ):
        mock.post("http://document-indexing-backend:8011/v1/retrieve").mock(
            return_value=httpx.Response(503)
        )
        r = await client.post(
            f"/v1/systems/{sid}/questionnaire-llm-run",
            json={},
            headers=_HDR,
        )

    assert r.status_code == 200, r.text
    spy.assert_not_called()
