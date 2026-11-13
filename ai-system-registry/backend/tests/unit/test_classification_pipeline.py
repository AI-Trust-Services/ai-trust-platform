"""Unit tests for classification_pipeline.py (pipeline 2).

No DB. The LLM is the offline stub (or a mock) and MinIO is mocked.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from app.classification_pipeline import (
    DEFAULT_CLASSIFICATION_CONFIG_ID,
    InvalidRunKeyError,
    _check_run_key,
    _collect_question_ids,
    _label_question_ids,
    _scope_questionnaire_data,
    run_classification,
)
from app.llm.templates import load_questionnaire


# ---------------------------------------------------------------------------
# _collect_question_ids / _label_question_ids
# ---------------------------------------------------------------------------


def test_collect_question_ids_atomic():
    node = {"questionId": "Q1", "operator": "EQUALS", "value": "YES"}
    assert _collect_question_ids(node) == {"Q1"}


def test_collect_question_ids_nested_all_any():
    node = {
        "all": [
            {"questionId": "Q1", "operator": "IN", "values": ["YES", "PARTIALLY"]},
            {
                "any": [
                    {"questionId": "Q2", "operator": "EQUALS", "value": "NO"},
                    {"questionId": "Q3", "operator": "EQUALS", "value": "NO"},
                ]
            },
        ]
    }
    assert _collect_question_ids(node) == {"Q1", "Q2", "Q3"}


def test_collect_question_ids_list():
    nodes = [
        {"questionId": "Q1", "operator": "EQUALS", "value": "YES"},
        {"questionId": "Q2", "operator": "EQUALS", "value": "NO"},
    ]
    assert _collect_question_ids(nodes) == {"Q1", "Q2"}


def test_label_question_ids_multiple_rules():
    label = {
        "id": "DEPLOYER",
        "activate": True,
        "rules": [
            {
                "id": "RULE_A",
                "when": {"questionId": "Role_3", "operator": "EQUALS", "value": "YES"},
            },
            {
                "id": "RULE_B",
                "when": {"questionId": "Role_4", "operator": "EQUALS", "value": "YES"},
            },
        ],
    }
    assert _label_question_ids(label) == {"Role_3", "Role_4"}


def test_label_question_ids_empty_rules():
    label = {"id": "DISTRIBUTOR", "activate": False, "rules": []}
    assert _label_question_ids(label) == set()


# ---------------------------------------------------------------------------
# _scope_questionnaire_data
# ---------------------------------------------------------------------------


def test_scope_questionnaire_data_filters_correctly():
    results = [
        {"questionId": "Q1", "answer": [{"value": "YES", "answerStrength": "HIGH"}]},
        {"questionId": "Q2", "answer": [{"value": "NO", "answerStrength": "HIGH"}]},
        {"questionId": "Q3", "answer": [{"value": "YES", "answerStrength": "MEDIUM"}]},
    ]
    scoped = _scope_questionnaire_data(results, {"Q1", "Q3"})
    assert len(scoped) == 2
    assert {r["questionId"] for r in scoped} == {"Q1", "Q3"}


def test_scope_questionnaire_data_no_match_returns_empty():
    results = [
        {"questionId": "Q1", "answer": [{"value": "YES", "answerStrength": "HIGH"}]}
    ]
    assert _scope_questionnaire_data(results, {"Q99"}) == []


def test_scope_questionnaire_data_empty_input():
    assert _scope_questionnaire_data([], {"Q1"}) == []


# ---------------------------------------------------------------------------
# config integrity
# ---------------------------------------------------------------------------


def _active_labels() -> list[dict]:
    config = load_questionnaire(DEFAULT_CLASSIFICATION_CONFIG_ID)
    return [
        label
        for label in config["riskLabels"] + config["roleLabels"]
        if label.get("activate", False)
    ]


def test_every_rule_question_id_exists_in_the_questionnaire():
    """A rule that references a question the questionnaire doesn't have could never
    be evaluated — and would make its label skip forever."""
    known = {q["id"] for q in load_questionnaire("ai-questionnaire")["questions"]}
    for label in _active_labels():
        unknown = _label_question_ids(label) - known
        assert not unknown, f"{label['id']} references unknown questions {unknown}"


def test_active_labels_have_rules():
    for label in _active_labels():
        assert _label_question_ids(label), f"{label['id']} has no rule questions"


# ---------------------------------------------------------------------------
# _check_run_key
# ---------------------------------------------------------------------------


def test_run_key_of_the_same_system_is_accepted():
    _check_run_key(
        "SYS-1",
        "questionnaire-results/SYS-1/ai-questionnaire/2026-01-01T00-00-00Z.json",
    )


@pytest.mark.parametrize(
    "key",
    [
        "questionnaire-results/SYS-2/ai-questionnaire/x.json",  # another system
        "classification-results/SYS-1/cfg/x.json",  # wrong result type
        "questionnaire-results/SYS-1/../SYS-2/ai-questionnaire/x.json",  # traversal
        "SYS-1/other.json",
    ],
)
def test_run_key_of_another_system_or_shape_is_rejected(key):
    with pytest.raises(InvalidRunKeyError):
        _check_run_key("SYS-1", key)


# ---------------------------------------------------------------------------
# run_classification (stub LLM / mocked chat, mocked MinIO)
# ---------------------------------------------------------------------------

_SYSTEM = "SYS-UNIT0001"
_RUN_KEY = f"questionnaire-results/{_SYSTEM}/ai-questionnaire/2026-01-01T00-00-00Z.json"


def _nei_result(question: dict) -> dict:
    return {
        "questionId": question["id"],
        "question": question["question"],
        "questionType": question["type"],
        "answer": [
            {"value": "NOT_ENOUGH_INFORMATION", "answerStrength": None, "reason": None}
        ],
        "explanation": "No evidence.",
        "references": [],
    }


def _full_questionnaire_result(skip: frozenset = frozenset()) -> dict:
    questions = load_questionnaire("ai-questionnaire")["questions"]
    return {"results": [_nei_result(q) for q in questions if q["id"] not in skip]}


def _minio(stored: dict):
    """Patch the three MinIO calls run_classification makes."""
    get_json = AsyncMock(return_value=stored)
    put_json = AsyncMock()
    presign = AsyncMock(return_value="http://minio/presigned")
    return (
        get_json,
        put_json,
        patch("app.classification_pipeline.minio_client.get_json", get_json),
        patch("app.classification_pipeline.minio_client.put_json", put_json),
        patch("app.classification_pipeline.minio_client.get_presigned_url", presign),
    )


async def test_run_classification_classifies_every_active_label():
    get_json, put_json, p1, p2, p3 = _minio(_full_questionnaire_result())
    with p1, p2, p3:
        out = await run_classification(_SYSTEM, _RUN_KEY)

    get_json.assert_awaited_once_with(_RUN_KEY)
    labels = {c["labelId"] for c in out["result"]["classifications"]}
    assert labels == {label["id"] for label in _active_labels()}
    assert out["result"]["skipped_labels"] == []
    assert out["result"]["questionnaire_run_key"] == _RUN_KEY

    key, stored = put_json.await_args.args
    assert key == out["run_key"]
    assert key.startswith(
        f"classification-results/{_SYSTEM}/risk_role_classification_config/"
    )
    assert stored == out["result"]


async def test_label_with_missing_question_is_skipped_not_classified():
    """If a label's source answers are absent (their batch failed) it must not be sent
    to the LLM — a likely-false result would be persisted as if it were established."""
    victim = _active_labels()[0]
    missing = sorted(_label_question_ids(victim))[:1]
    _, put_json, p1, p2, p3 = _minio(
        _full_questionnaire_result(skip=frozenset(missing))
    )
    with p1, p2, p3:
        out = await run_classification(_SYSTEM, _RUN_KEY)

    result = out["result"]
    skipped = {s["labelId"]: s for s in result["skipped_labels"]}
    assert victim["id"] in skipped
    assert skipped[victim["id"]]["reason"] == "insufficient_data"
    assert skipped[victim["id"]]["missingQuestionIds"] == missing
    assert victim["id"] not in {c["labelId"] for c in result["classifications"]}
    # Labels that do not depend on the missing question are still classified.
    assert result["classifications"]


async def test_foreign_run_key_is_rejected_before_any_minio_read():
    foreign = "questionnaire-results/SYS-OTHER/ai-questionnaire/x.json"
    get_json, put_json, p1, p2, p3 = _minio(_full_questionnaire_result())
    with p1, p2, p3:
        with pytest.raises(InvalidRunKeyError):
            await run_classification(_SYSTEM, foreign)
    get_json.assert_not_awaited()
    put_json.assert_not_awaited()


def _llm_reply(label_id: str) -> dict:
    return {
        "text": json.dumps(
            {
                "classifications": [
                    {
                        "labelId": label_id,
                        "result": False,
                        "confidence": 70,
                        "explanation": "ok",
                    }
                ]
            }
        ),
        "finish_reason": "stop",
        "input_tokens": 1,
        "output_tokens": 1,
    }


def _single_label_config(*label_ids: str) -> dict:
    labels = [label for label in _active_labels() if label["id"] in label_ids]
    assert {label["id"] for label in labels} == set(label_ids)
    return {"version": "t", "riskLabels": labels, "roleLabels": []}


async def test_wrong_label_id_from_the_llm_is_retried():
    """A reply whose labelId is not the requested label is a contract violation: it is
    re-asked (validation retry) instead of being persisted under the wrong label."""
    config = _single_label_config("PROHIBITED")

    chat = AsyncMock(side_effect=[_llm_reply("HIGH_RISK"), _llm_reply("PROHIBITED")])
    _, _, p1, p2, p3 = _minio(_full_questionnaire_result())
    with (
        p1,
        p2,
        p3,
        patch("app.classification_pipeline.load_questionnaire", return_value=config),
        patch("app.classification_pipeline.chat", chat),
    ):
        out = await run_classification(_SYSTEM, _RUN_KEY)

    assert [c["labelId"] for c in out["result"]["classifications"]] == ["PROHIBITED"]
    assert chat.await_count == 2
    # The retry re-sent the original conversation plus the violation.
    retry_messages = chat.await_args_list[1].args[0]
    assert retry_messages[0]["role"] == "system"
    assert "labelId" in retry_messages[-1]["content"]
    assert chat.await_args_list[1].kwargs["max_tokens"] > 0


async def test_label_failure_is_omitted_and_does_not_abort_the_run():
    config = _single_label_config("PROHIBITED", "HIGH_RISK")

    async def _chat(messages, task="chat", **kwargs):
        if task.endswith("PROHIBITED"):
            return _llm_reply("PROHIBITED")
        return {"text": "no json", "finish_reason": "stop"}  # HIGH_RISK never valid

    _, _, p1, p2, p3 = _minio(_full_questionnaire_result())
    with (
        p1,
        p2,
        p3,
        patch("app.classification_pipeline.load_questionnaire", return_value=config),
        patch("app.classification_pipeline.chat", _chat),
    ):
        out = await run_classification(_SYSTEM, _RUN_KEY)

    assert [c["labelId"] for c in out["result"]["classifications"]] == ["PROHIBITED"]
