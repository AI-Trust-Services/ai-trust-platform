"""Pipeline 2 — risk & role classification.

Reads completed questionnaire answers from MinIO (pipeline 1's output), runs one
LLM call per active label in the classification config in parallel, and persists
the aggregated result as a versioned JSON file in MinIO.

This is the **only** implementation of the classification run. It is called by
``POST /classification-llm-run`` and by the AI-assessment prefill pipeline
(``app/assessment_prefill_pipeline.py``) — both pass the ``run_key`` of a saved
questionnaire result.

Storage key layout:
    classification-results/{system_id}/{config_id}/{iso_timestamp}.json

Each pipeline run appends a new file — old runs are never overwritten.

The output feeds the hierarchy resolver (issue #371) which selects the final
label from the set of true results; that step is out of scope here.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from functools import partial
from pathlib import Path
from typing import Any

from ai_trust_logging import get_logger

from app.llm.client import chat
from app.llm.parsing import LLMParseError, parse_with_retry
from app.llm.templates import load_template, load_questionnaire
from app.llm.validators import validate_answer_entries, validate_classification_label
from app import minio_client

logger = get_logger(__name__)

# Template IDs use the subfolder prefix supported by the loader. Shared by every
# caller so an empty-body request runs exactly what the assessment runs.
DEFAULT_CLASSIFICATION_PROMPT_ID = "risk_classification/risk_role_classification"
DEFAULT_CLASSIFICATION_CONFIG_ID = "risk_classification/risk_role_classification_config"

_CLASSIFICATION_MAX_TOKENS = int(os.environ.get("CLASSIFICATION_MAX_TOKENS", "2048"))


class InvalidRunKeyError(ValueError):
    """The questionnaire run key does not belong to the system being classified."""


# ---------------------------------------------------------------------------
# Question-id collection (recursive rule-tree walk)
# ---------------------------------------------------------------------------


def _collect_question_ids(node: Any) -> set[str]:
    """Recursively walk a label rule's ``when`` tree and collect all questionId values."""
    if isinstance(node, list):
        ids: set[str] = set()
        for item in node:
            ids |= _collect_question_ids(item)
        return ids
    if isinstance(node, dict):
        if "questionId" in node:
            return {node["questionId"]}
        ids = set()
        for value in node.values():
            ids |= _collect_question_ids(value)
        return ids
    return set()


def _label_question_ids(label: dict) -> set[str]:
    """Collect all questionIds referenced by any rule in a label."""
    ids: set[str] = set()
    for rule in label.get("rules", []):
        ids |= _collect_question_ids(rule.get("when", {}))
    return ids


# ---------------------------------------------------------------------------
# Questionnaire data scoping
# ---------------------------------------------------------------------------


def _scope_questionnaire_data(
    results: list[dict], question_ids: set[str]
) -> list[dict]:
    """Return only the questionnaire result entries referenced by this label."""
    return [r for r in results if r.get("questionId") in question_ids]


def _check_run_key(system_id: str, run_key: str) -> None:
    """The key must be one of *this* system's questionnaire results.

    Without this, a caller with ``systems:write`` on system A could classify the
    stored answers of system B by passing B's key.
    """
    prefix = f"questionnaire-results/{system_id}/"
    if not run_key.startswith(prefix) or ".." in run_key.split("/"):
        raise InvalidRunKeyError(
            f"questionnaire_run_key must be a questionnaire result of system "
            f"'{system_id}' (expected prefix '{prefix}')"
        )


# ---------------------------------------------------------------------------
# Per-label LLM call
# ---------------------------------------------------------------------------


async def _classify_label(
    label: dict,
    scoped_data: list[dict],
    system_prompt: str,
) -> dict:
    """Run one LLM call for one active label.

    ``scoped_data`` is the questionnaire data narrowed to the questions this
    label's rules reference. It is validated before being sent, and the LLM
    answer is validated (exactly one entry, ``labelId`` equal to this label).

    Returns a dict with keys: labelId, result, confidence, explanation.
    Raises ``LLMParseError`` on invalid input data or unparseable/invalid LLM output.
    """
    label_id = label["id"]
    task = f"risk_role_classification_{label_id}"

    # Validate before sending to the LLM.
    try:
        validate_answer_entries(scoped_data)
    except LLMParseError as exc:
        raise LLMParseError(
            f"Questionnaire data validation failed for label '{label_id}': {exc}"
        ) from exc

    user_message = (
        "QUESTIONNAIRE_DATA:\n"
        + json.dumps(scoped_data, ensure_ascii=False, indent=2)
        + "\n\nCLASSIFICATION_CONFIG:\n"
        + json.dumps(label, ensure_ascii=False, indent=2)
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    llm_response = await chat(
        messages, task=task, json_mode=True, max_tokens=_CLASSIFICATION_MAX_TOKENS
    )

    if llm_response.get("finish_reason") == "length":
        raise LLMParseError(
            f"LLM output truncated (finish_reason=length) for label '{label_id}': "
            f"input={llm_response.get('input_tokens', '?')} "
            f"output={llm_response.get('output_tokens', '?')} tokens."
        )

    parsed = await parse_with_retry(
        llm_response["text"],
        task=task,
        validator=partial(validate_classification_label, expected_label_id=label_id),
        chat_fn=chat,
        messages=messages,
        max_attempts=3,
        max_tokens=_CLASSIFICATION_MAX_TOKENS,
    )

    return parsed["classifications"][0]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def run_classification(
    system_id: str,
    questionnaire_run_key: str,
    classification_config_id: str = DEFAULT_CLASSIFICATION_CONFIG_ID,
    prompt_id: str = DEFAULT_CLASSIFICATION_PROMPT_ID,
) -> dict[str, Any]:
    """Run risk & role label classification against completed questionnaire answers.

    Reads the questionnaire result from MinIO by ``questionnaire_run_key``, runs
    one LLM call per active label in parallel, merges the results, and persists
    the output to MinIO.

    A label is **skipped** (not sent to the LLM, listed under ``skipped_labels``)
    when any question its rules reference has no answer in the questionnaire
    result — typically because that questionnaire batch failed. Classifying on
    partial evidence would persist a likely-``false`` as if it were established.
    A label whose LLM call fails is logged and omitted; neither aborts the run.

    Returns ``{run_key, presigned_url, result}`` where ``result`` is:
    ``{questionnaire_run_key, config_id, config_version, prompt_id,
    classifications, skipped_labels}``.

    Raises:
        InvalidRunKeyError: the key is not a questionnaire result of ``system_id``.
        KeyError: MinIO object not found.
        PromptTemplateError: config or prompt file not found.
    """
    _check_run_key(system_id, questionnaire_run_key)

    # 1. Read the questionnaire result from MinIO.
    questionnaire_output = await minio_client.get_json(questionnaire_run_key)
    questionnaire_results: list[dict] = questionnaire_output.get("results", [])

    # 2. Load config + prompt.
    config = load_questionnaire(classification_config_id)
    system_prompt = load_template(prompt_id)

    config_id_short = Path(classification_config_id).name
    config_version = config.get("version", "unknown")

    # 3. Collect all active labels from riskLabels + roleLabels.
    active_labels = [
        label
        for label in config.get("riskLabels", []) + config.get("roleLabels", [])
        if label.get("activate", False)
    ]

    # 4. Scope the answers per label; skip labels whose evidence is incomplete.
    runnable: list[tuple[dict, list[dict]]] = []
    skipped: list[dict] = []
    for label in active_labels:
        question_ids = _label_question_ids(label)
        scoped = _scope_questionnaire_data(questionnaire_results, question_ids)
        missing = sorted(question_ids - {r.get("questionId") for r in scoped})
        if missing:
            logger.warning(
                "classification_pipeline.label_skipped_insufficient_data",
                extra={
                    "system_id": system_id,
                    "label_id": label["id"],
                    "missing_questions": missing,
                },
            )
            skipped.append(
                {
                    "labelId": label["id"],
                    "reason": "insufficient_data",
                    "missingQuestionIds": missing,
                }
            )
        else:
            runnable.append((label, scoped))

    logger.info(
        "classification_pipeline.started",
        extra={
            "system_id": system_id,
            "questionnaire_run_key": questionnaire_run_key,
            "active_labels": len(active_labels),
            "skipped_labels": len(skipped),
        },
    )

    # 5. Fan out — one LLM call per runnable label, all in parallel.
    label_results = await asyncio.gather(
        *[_classify_label(label, scoped, system_prompt) for label, scoped in runnable],
        return_exceptions=True,
    )

    # Collect successful results; log failures per label.
    classifications: list[dict] = []
    for (label, _), outcome in zip(runnable, label_results):
        if isinstance(outcome, Exception):
            logger.warning(
                "classification_pipeline.label_failed",
                extra={
                    "system_id": system_id,
                    "label_id": label["id"],
                    "error": str(outcome),
                },
            )
        else:
            classifications.append(outcome)

    result: dict[str, Any] = {
        "questionnaire_run_key": questionnaire_run_key,
        "config_id": config_id_short,
        "config_version": config_version,
        "prompt_id": Path(prompt_id).name,
        "classifications": classifications,
        "skipped_labels": skipped,
    }

    # 6. Persist to MinIO.
    timestamp = datetime.now(timezone.utc)
    iso = timestamp.strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    run_key = f"classification-results/{system_id}/{config_id_short}/{iso}.json"
    await minio_client.put_json(run_key, result)
    presigned_url = await minio_client.get_presigned_url(run_key, expires_hours=24)

    logger.info(
        "classification_pipeline.completed",
        extra={
            "system_id": system_id,
            "config_id": config_id_short,
            "config_version": config_version,
            "labels_classified": len(classifications),
            "labels_failed": len(runnable) - len(classifications),
            "labels_skipped": len(skipped),
            "run_key": run_key,
        },
    )

    return {
        "run_key": run_key,
        "presigned_url": presigned_url,
        "result": result,
    }
