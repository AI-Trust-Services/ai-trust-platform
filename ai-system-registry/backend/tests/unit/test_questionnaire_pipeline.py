"""Unit tests for run_questionnaire_pipeline (pipeline 1).

No DB, no network: the system row is faked, RAG retrieval and MinIO are mocked, and
the LLM is the offline stub unless a test replaces ``chat``. These run the *real*
questionnaire (96 questions, many dependency batches) through the strict validator,
so they also pin that the stub output satisfies the answer contract.
"""

from __future__ import annotations

import asyncio
import json
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.assessment_catalogue import ASSESSMENT_QUESTION_KEYS
from app.llm.parsing import LLMParseError
from app.questionnaire_pipeline import (
    DEFAULT_QUESTIONNAIRE_ID,
    DEFAULT_QUESTIONNAIRE_PROMPT_ID,
    _split_by_dependency_groups,
    run_questionnaire_pipeline,
)
from app.llm.templates import load_questionnaire

_SYSTEM = "SYS-UNIT0001"


class _Result:
    def __init__(self, row):
        self._row = row

    def scalar_one_or_none(self):
        return self._row


class _FakeSession:
    def __init__(self, row):
        self._row = row

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, _stmt):
        return _Result(self._row)


def _row():
    return SimpleNamespace(
        name="Unit System",
        intended_purpose="Screens CVs.",
        lifecycle="dev",
        planned_rollout_date=None,
        git_repo_url=None,
    )


@contextmanager
def _env(row=True):
    """Fake DB row + no RAG + mocked MinIO; yields the ``put_json`` mock."""
    system_row = _row() if row else None
    with (
        patch(
            "app.questionnaire_pipeline.SessionLocal", lambda: _FakeSession(system_row)
        ),
        patch(
            "app.questionnaire_pipeline._retrieve_rag_documents",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch(
            "app.questionnaire_pipeline.minio_client.put_json", new_callable=AsyncMock
        ) as put_json,
        patch(
            "app.questionnaire_pipeline.minio_client.get_presigned_url",
            new_callable=AsyncMock,
            return_value="http://minio/presigned",
        ),
    ):
        yield put_json


async def _run(**kwargs):
    return await run_questionnaire_pipeline(
        _SYSTEM,
        DEFAULT_QUESTIONNAIRE_ID,
        DEFAULT_QUESTIONNAIRE_PROMPT_ID,
        "alice",
        **kwargs,
    )


async def test_stub_output_satisfies_the_validator_for_every_real_batch():
    """Every dependency batch of the real questionnaire is answered by the stub and
    accepted by the strict validator; the merged result covers all questions."""
    with _env() as put_json:
        out = await _run()

    answered = [r["questionId"] for r in out["result"]["results"]]
    assert sorted(answered) == sorted(ASSESSMENT_QUESTION_KEYS)
    assert len(answered) == len(set(answered)), "no question answered twice"

    key, stored = put_json.await_args.args
    assert key == out["run_key"]
    assert key.startswith(f"questionnaire-results/{_SYSTEM}/ai-questionnaire/")
    assert stored == out["result"]
    assert out["presigned_url"] == "http://minio/presigned"


async def test_batch_callback_receives_each_validated_batch():
    batches = _split_by_dependency_groups(load_questionnaire(DEFAULT_QUESTIONNAIRE_ID))
    received: list[list[dict]] = []

    async def callback(results):
        received.append(results)

    with _env():
        out = await _run(batch_callback=callback)

    assert len(received) == len(batches)
    merged_ids = sorted(r["questionId"] for r in out["result"]["results"])
    assert merged_ids == sorted(r["questionId"] for batch in received for r in batch)


async def test_batch_callbacks_are_serialised():
    """Callbacks may read-modify-write shared state, so they must never overlap even
    though the batches themselves run in parallel."""
    running = 0
    max_running = 0

    async def callback(_results):
        nonlocal running, max_running
        running += 1
        max_running = max(max_running, running)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        running -= 1

    with _env():
        await _run(batch_callback=callback)

    assert max_running == 1


async def test_failed_batch_is_skipped_and_others_still_succeed():
    calls = {"n": 0}

    async def _flaky(text, task, validator, chat_fn, messages, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise LLMParseError("simulated batch failure")
        return validator(json.loads(text))

    with _env() as put_json:
        with patch("app.questionnaire_pipeline.parse_with_retry", _flaky):
            out = await _run()

    answered = {r["questionId"] for r in out["result"]["results"]}
    assert 0 < len(answered) < len(ASSESSMENT_QUESTION_KEYS)
    put_json.assert_awaited_once()


async def test_no_valid_batch_raises_and_stores_nothing():
    with _env() as put_json:
        with patch(
            "app.questionnaire_pipeline.parse_with_retry",
            new_callable=AsyncMock,
            side_effect=LLMParseError("simulated batch failure"),
        ):
            with pytest.raises(LLMParseError, match="no questionnaire batch produced"):
                await _run()
    put_json.assert_not_awaited()


async def test_callback_failure_counts_as_a_failed_batch():
    """If persisting every batch fails, the run is an error, not a quiet success."""

    async def callback(_results):
        raise RuntimeError("db down")

    with _env() as put_json:
        with pytest.raises(LLMParseError, match="no questionnaire batch produced"):
            await _run(batch_callback=callback)
    put_json.assert_not_awaited()


async def test_unknown_system_raises_key_error():
    with _env(row=False):
        with pytest.raises(KeyError, match="not found"):
            await _run()


# ---------------------------------------------------------------------------
# validation retry inside a batch (own tiny questionnaire → a single batch)
# ---------------------------------------------------------------------------

_TINY = {
    "schemaVersion": "1",
    "questions": [
        {
            "id": "Q1",
            "question": "First?",
            "category": "C",
            "type": "PREDEFINED",
            "allowedAnswers": ["YES", "NO"],
        },
        {
            "id": "Q2",
            "question": "Second?",
            "category": "C",
            "type": "PREDEFINED",
            "allowedAnswers": ["YES", "NO"],
        },
    ],
}


def _reply(*question_ids: str, value: str = "YES") -> dict:
    results = [
        {
            "questionId": qid,
            "question": "?",
            "questionType": "PREDEFINED",
            "answer": [{"value": value, "answerStrength": "HIGH", "reason": None}],
            "explanation": "x",
            "references": [],
        }
        for qid in question_ids
    ]
    return {
        "text": json.dumps({"results": results}),
        "finish_reason": "stop",
        "input_tokens": 1,
        "output_tokens": 1,
    }


async def test_incomplete_batch_answer_is_re_asked_with_the_violation():
    """The LLM skipped Q2 → the validator names it and the model is re-asked with the
    original conversation, instead of the gap silently becoming an unanswered question."""
    chat = AsyncMock(side_effect=[_reply("Q1"), _reply("Q1", "Q2")])
    with _env():
        with (
            patch("app.questionnaire_pipeline.load_questionnaire", return_value=_TINY),
            patch("app.questionnaire_pipeline.chat", chat),
        ):
            out = await _run()

    assert sorted(r["questionId"] for r in out["result"]["results"]) == ["Q1", "Q2"]
    assert chat.await_count == 2
    retry = chat.await_args_list[1]
    sent = retry.args[0]
    assert (
        sent[0]["role"] == "system" and sent[1]["role"] == "user"
    )  # original messages
    assert "missing an answer" in sent[-1]["content"] and "Q2" in sent[-1]["content"]
    assert retry.kwargs["max_tokens"] > 1024  # the retry keeps the large output cap


async def test_disallowed_answer_value_is_re_asked():
    chat = AsyncMock(
        side_effect=[_reply("Q1", "Q2", value="MAYBE"), _reply("Q1", "Q2")]
    )
    with _env():
        with (
            patch("app.questionnaire_pipeline.load_questionnaire", return_value=_TINY),
            patch("app.questionnaire_pipeline.chat", chat),
        ):
            out = await _run()

    assert {r["answer"][0]["value"] for r in out["result"]["results"]} == {"YES"}
    assert "not allowed" in chat.await_args_list[1].args[0][-1]["content"]


async def test_persistently_invalid_batch_fails_after_three_attempts():
    chat = AsyncMock(return_value=_reply("Q1"))  # never answers Q2
    with _env() as put_json:
        with (
            patch("app.questionnaire_pipeline.load_questionnaire", return_value=_TINY),
            patch("app.questionnaire_pipeline.chat", chat),
        ):
            with pytest.raises(LLMParseError, match="no questionnaire batch produced"):
                await _run()

    assert chat.await_count == 3  # 1 call + 2 retries
    put_json.assert_not_awaited()
