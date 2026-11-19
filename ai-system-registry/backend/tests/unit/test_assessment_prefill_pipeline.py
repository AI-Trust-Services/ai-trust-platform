"""Unit tests for the AI-assessment prefill orchestration (pipeline 3).

Both underlying pipelines are mocked — this module only sequences them, so these
tests pin the order, the hook wiring and the failure policy.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.assessment_prefill_pipeline import (
    PrefillOutput,
    run_assessment_prefill_pipeline,
)
from app.classification_pipeline import (
    DEFAULT_CLASSIFICATION_CONFIG_ID,
    DEFAULT_CLASSIFICATION_PROMPT_ID,
)
from app.llm.parsing import LLMParseError
from app.questionnaire_pipeline import (
    DEFAULT_QUESTIONNAIRE_ID,
    DEFAULT_QUESTIONNAIRE_PROMPT_ID,
)

_Q_OUT = {
    "run_key": "questionnaire-results/SYS-1/ai-questionnaire/t.json",
    "presigned_url": "http://q",
    "result": {"results": [{"questionId": "Scope_1"}]},
}
_C_OUT = {
    "run_key": "classification-results/SYS-1/cfg/t.json",
    "presigned_url": "http://c",
    "result": {"classifications": []},
}


def _patch(questionnaire: AsyncMock, classification: AsyncMock):
    return (
        patch(
            "app.assessment_prefill_pipeline.run_questionnaire_pipeline", questionnaire
        ),
        patch("app.assessment_prefill_pipeline.run_classification", classification),
    )


async def test_runs_questionnaire_then_classification_with_the_saved_run_key():
    events: list[str] = []

    async def questionnaire(**kwargs):
        events.append("questionnaire")
        return _Q_OUT

    async def classification(**kwargs):
        events.append("classification")
        return _C_OUT

    q, c = AsyncMock(side_effect=questionnaire), AsyncMock(side_effect=classification)
    p1, p2 = _patch(q, c)
    with p1, p2:
        out = await run_assessment_prefill_pipeline("SYS-1", "alice")

    assert events == ["questionnaire", "classification"]
    assert isinstance(out, PrefillOutput)
    assert out.questionnaire is _Q_OUT
    assert out.classification is _C_OUT
    assert out.classification_error is None
    # Step 2 is fed the key step 1 saved — one input path, same as the endpoint.
    assert c.await_args.kwargs["questionnaire_run_key"] == _Q_OUT["run_key"]
    assert c.await_args.kwargs["system_id"] == "SYS-1"


async def test_defaults_are_the_shared_constants():
    q, c = AsyncMock(return_value=_Q_OUT), AsyncMock(return_value=_C_OUT)
    p1, p2 = _patch(q, c)
    with p1, p2:
        await run_assessment_prefill_pipeline("SYS-1", "alice")

    assert q.await_args.kwargs["questionnaire_id"] == DEFAULT_QUESTIONNAIRE_ID
    assert q.await_args.kwargs["prompt_id"] == DEFAULT_QUESTIONNAIRE_PROMPT_ID
    assert q.await_args.kwargs["username"] == "alice"
    assert (
        c.await_args.kwargs["classification_config_id"]
        == DEFAULT_CLASSIFICATION_CONFIG_ID
    )
    assert c.await_args.kwargs["prompt_id"] == DEFAULT_CLASSIFICATION_PROMPT_ID


async def test_batch_callback_is_forwarded_to_the_questionnaire_pipeline():
    q, c = AsyncMock(return_value=_Q_OUT), AsyncMock(return_value=_C_OUT)
    callback = AsyncMock()
    p1, p2 = _patch(q, c)
    with p1, p2:
        await run_assessment_prefill_pipeline("SYS-1", "alice", batch_callback=callback)

    assert q.await_args.kwargs["batch_callback"] is callback


async def test_done_hook_gets_the_questionnaire_output_and_runs_with_classification():
    started: list[str] = []
    release = asyncio.Event()

    async def classification(**kwargs):
        started.append("classification")
        await release.wait()
        return _C_OUT

    async def hook(output):
        started.append("hook")
        assert output is _Q_OUT
        release.set()  # only completes if the hook ran *while* classification waits

    q, c = AsyncMock(return_value=_Q_OUT), AsyncMock(side_effect=classification)
    p1, p2 = _patch(q, c)
    with p1, p2:
        out = await asyncio.wait_for(
            run_assessment_prefill_pipeline(
                "SYS-1", "alice", on_questionnaire_done=hook
            ),
            timeout=5,
        )

    assert set(started) == {"classification", "hook"}
    assert out.classification is _C_OUT


async def test_classification_failure_is_returned_not_raised():
    boom = RuntimeError("minio down")
    q, c = AsyncMock(return_value=_Q_OUT), AsyncMock(side_effect=boom)
    hook = AsyncMock()
    p1, p2 = _patch(q, c)
    with p1, p2:
        out = await run_assessment_prefill_pipeline(
            "SYS-1", "alice", on_questionnaire_done=hook
        )

    assert out.classification is None
    assert out.classification_error is boom
    assert out.questionnaire is _Q_OUT
    # The caller's post-step still ran, so the assessment is not held back by step 2.
    hook.assert_awaited_once_with(_Q_OUT)


async def test_hook_failure_propagates():
    q, c = AsyncMock(return_value=_Q_OUT), AsyncMock(return_value=_C_OUT)
    hook = AsyncMock(side_effect=ValueError("tier step failed"))
    p1, p2 = _patch(q, c)
    with p1, p2:
        with pytest.raises(ValueError, match="tier step failed"):
            await run_assessment_prefill_pipeline(
                "SYS-1", "alice", on_questionnaire_done=hook
            )


async def test_questionnaire_failure_propagates_and_skips_classification():
    q = AsyncMock(side_effect=LLMParseError("no questionnaire batch produced"))
    c = AsyncMock(return_value=_C_OUT)
    p1, p2 = _patch(q, c)
    with p1, p2:
        with pytest.raises(LLMParseError):
            await run_assessment_prefill_pipeline("SYS-1", "alice")
    c.assert_not_awaited()


async def test_overrides_are_forwarded():
    q, c = AsyncMock(return_value=_Q_OUT), AsyncMock(return_value=_C_OUT)
    p1, p2 = _patch(q, c)
    with p1, p2:
        await run_assessment_prefill_pipeline(
            "SYS-1",
            "alice",
            questionnaire_id="other-q",
            questionnaire_prompt_id="other-p",
            classification_config_id="risk_classification/other-cfg",
            classification_prompt_id="risk_classification/other-p",
        )

    assert q.await_args.kwargs["questionnaire_id"] == "other-q"
    assert q.await_args.kwargs["prompt_id"] == "other-p"
    assert (
        c.await_args.kwargs["classification_config_id"]
        == "risk_classification/other-cfg"
    )
    assert c.await_args.kwargs["prompt_id"] == "risk_classification/other-p"
