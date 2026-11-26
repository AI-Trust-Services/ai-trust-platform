"""Unit tests for assessment_prefill_pipeline — hook wiring.

Pure-function / mock level: no DB, no MinIO, no LLM.
"""

from __future__ import annotations

import os

os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://u:p@localhost/ai_trust_test"
)

import pytest
from unittest.mock import AsyncMock, patch

from app.assessment_prefill_pipeline import (
    run_assessment_prefill_pipeline,
    PrefillOutput,
)


FAKE_Q = {
    "run_key": "questionnaire-results/SYS-TEST/ai-questionnaire/t.json",
    "result": {"results": []},
    "presigned_url": "",
}
FAKE_C = {
    "run_key": "classification-results/SYS-TEST/risk_role_classification_config/t.json",
    "result": {},
    "presigned_url": "",
}


@pytest.fixture(autouse=True)
def _stub_provider():
    """Pin the provider the orchestrator resolves once per run (no DB in unit tests)."""
    from app.llm.client import RuntimeConfig

    stub_cfg = RuntimeConfig(
        base_url="stub", api_token="", model="m", source="thalamus"
    )
    with patch(
        "app.assessment_prefill_pipeline.resolve_runtime_config",
        new_callable=AsyncMock,
        return_value=stub_cfg,
    ):
        yield


def _patch(questionnaire: AsyncMock, classification: AsyncMock):
    return (
        patch(
            "app.assessment_prefill_pipeline.run_questionnaire_pipeline", questionnaire
        ),
        patch("app.assessment_prefill_pipeline.run_classification", classification),
    )


@pytest.mark.asyncio
async def test_on_classification_done_called_with_classification_result():
    """on_classification_done receives the classification dict on success."""
    received = []

    async def capture(c):
        received.append(c)

    with (
        patch(
            "app.assessment_prefill_pipeline.run_questionnaire_pipeline",
            new=AsyncMock(return_value=FAKE_Q),
        ),
        patch(
            "app.assessment_prefill_pipeline.run_classification",
            new=AsyncMock(return_value=FAKE_C),
        ),
    ):
        out = await run_assessment_prefill_pipeline(
            "SYS-TEST",
            "user",
            on_classification_done=capture,
        )

    assert received == [FAKE_C]
    assert out.classification == FAKE_C
    assert out.classification_error is None


@pytest.mark.asyncio
async def test_on_classification_done_not_called_when_classification_fails():
    """on_classification_done is skipped when step 2 fails."""
    called = []

    with (
        patch(
            "app.assessment_prefill_pipeline.run_questionnaire_pipeline",
            new=AsyncMock(return_value=FAKE_Q),
        ),
        patch(
            "app.assessment_prefill_pipeline.run_classification",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ),
    ):
        out = await run_assessment_prefill_pipeline(
            "SYS-TEST",
            "user",
            on_classification_done=AsyncMock(side_effect=lambda _: called.append(1)),
        )

    assert called == []
    assert out.classification is None
    assert isinstance(out.classification_error, RuntimeError)


@pytest.mark.asyncio
async def test_on_classification_done_error_propagates():
    """A failure in on_classification_done propagates out of the pipeline."""
    with (
        patch(
            "app.assessment_prefill_pipeline.run_questionnaire_pipeline",
            new=AsyncMock(return_value=FAKE_Q),
        ),
        patch(
            "app.assessment_prefill_pipeline.run_classification",
            new=AsyncMock(return_value=FAKE_C),
        ),
    ):
        with pytest.raises(ValueError, match="tier write failed"):
            await run_assessment_prefill_pipeline(
                "SYS-TEST",
                "user",
                on_classification_done=AsyncMock(
                    side_effect=ValueError("tier write failed")
                ),
            )


@pytest.mark.asyncio
async def test_on_questionnaire_done_still_runs_concurrently():
    """on_questionnaire_done is still called (even without on_classification_done)."""
    received = []

    with (
        patch(
            "app.assessment_prefill_pipeline.run_questionnaire_pipeline",
            new=AsyncMock(return_value=FAKE_Q),
        ),
        patch(
            "app.assessment_prefill_pipeline.run_classification",
            new=AsyncMock(return_value=FAKE_C),
        ),
    ):
        await run_assessment_prefill_pipeline(
            "SYS-TEST",
            "user",
            on_questionnaire_done=AsyncMock(side_effect=lambda q: received.append(q)),
        )

    assert received == [FAKE_Q]
