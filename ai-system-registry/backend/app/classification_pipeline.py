"""Risk & role classification pipeline (Step 2).

Reads completed questionnaire answers from MinIO (Step 1 output), runs one LLM
call per active label in the classification config in parallel, and persists the
aggregated result as a versioned JSON file in MinIO.

Storage key layout:
    classification-results/{system_id}/{config_id}/{iso_timestamp}.json

Each pipeline run appends a new file — old runs are never overwritten.

The output feeds the hierarchy resolver (issue #371) which selects the final
label from the set of true results; that step is out of scope here.
"""

from __future__ import annotations

import asyncio
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ai_trust_logging import get_logger

from app.llm.client import chat
from app.llm.parsing import LLMParseError, parse_json_response
from app.llm.templates import PromptTemplateError, load_template, load_questionnaire
from app import minio_client

logger = get_logger(__name__)

_CLASSIFICATION_BUCKET = "registration-docs"

# Template IDs use the subfolder prefix supported by the updated loader.
_DEFAULT_PROMPT_ID = "risk_classification/risk_role_classification"
_DEFAULT_CONFIG_ID = "risk_classification/risk_role_classification_config"

_VALID_ANSWER_STRENGTHS = frozenset({"HIGH", "MEDIUM", "LOW"})
_SPECIAL_ANSWER_VALUES = frozenset(
    {"NOT_ENOUGH_INFORMATION", "CONFLICT", "NOT_APPLICABLE"}
)


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


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------


def _validate_questionnaire_data(data: list[dict]) -> None:
    """Simple structural pre-flight check before sending data to LLM 2.

    Raises ``LLMParseError`` on:
    - missing questionId
    - empty answer[] array
    - invalid answerStrength value (not HIGH/MEDIUM/LOW/null)
    - NOT_APPLICABLE coexisting with regular values in a MULTISELECT result
    """
    for item in data:
        q_id = item.get("questionId")
        if not q_id:
            raise LLMParseError("Questionnaire result missing 'questionId'")

        answers = item.get("answer")
        if not isinstance(answers, list) or len(answers) == 0:
            raise LLMParseError(
                f"Question '{q_id}' has an empty or missing 'answer' array"
            )

        values = [a.get("value") for a in answers if isinstance(a, dict)]
        for answer in answers:
            if not isinstance(answer, dict):
                continue
            strength = answer.get("answerStrength")
            if strength is not None and strength not in _VALID_ANSWER_STRENGTHS:
                raise LLMParseError(
                    f"Question '{q_id}' has invalid answerStrength '{strength}'; "
                    f"must be HIGH, MEDIUM, LOW, or null"
                )

        # NOT_APPLICABLE must not coexist with regular values
        has_not_applicable = "NOT_APPLICABLE" in values
        has_regular = any(
            v not in _SPECIAL_ANSWER_VALUES for v in values if v is not None
        )
        if has_not_applicable and has_regular:
            raise LLMParseError(
                f"Question '{q_id}' has NOT_APPLICABLE combined with regular answer "
                f"values — these are mutually exclusive"
            )


# ---------------------------------------------------------------------------
# Per-label LLM call
# ---------------------------------------------------------------------------


async def _classify_label(
    label: dict,
    questionnaire_results: list[dict],
    system_prompt: str,
) -> dict:
    """Run one LLM call for one active label.

    Scopes questionnaire data to questions this label's rules reference,
    validates it, then calls the LLM 2 prompt and returns the parsed result.

    Returns a dict with keys: labelId, result, confidence, explanation.
    Raises ``LLMParseError`` on unparseable LLM output.
    """
    label_id = label["id"]
    task = f"risk_role_classification_{label_id}"

    # Scope questionnaire data to this label's referenced questions only.
    question_ids = _label_question_ids(label)
    scoped_data = _scope_questionnaire_data(questionnaire_results, question_ids)

    # Validate before sending to LLM.
    try:
        _validate_questionnaire_data(scoped_data)
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

    llm_response = await chat(messages, task=task, json_mode=True)

    if llm_response.get("finish_reason") == "length":
        raise LLMParseError(
            f"LLM output truncated (finish_reason=length) for label '{label_id}': "
            f"input={llm_response.get('input_tokens', '?')} "
            f"output={llm_response.get('output_tokens', '?')} tokens."
        )

    parsed = await parse_json_response(llm_response["text"], task=task)

    # Extract the single classification entry for this label.
    classifications = parsed.get("classifications", [])
    if not classifications:
        raise LLMParseError(
            f"LLM returned empty 'classifications' array for label '{label_id}'"
        )
    entry = classifications[0]
    required_keys = {"labelId", "result", "confidence", "explanation"}
    missing = required_keys - set(entry.keys())
    if missing:
        raise LLMParseError(
            f"LLM classification entry for label '{label_id}' missing keys: {missing}"
        )

    return entry


# ---------------------------------------------------------------------------
# MinIO persistence
# ---------------------------------------------------------------------------


async def _upload_classification_result(
    system_id: str,
    config_id: str,
    result: dict,
    timestamp: datetime,
) -> str:
    """Upload the classification result JSON to MinIO. Returns the object key."""
    # Flatten the config_id for use as a path component (strip any subfolder prefix).
    safe_config_id = Path(config_id).name
    iso = timestamp.strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    key = f"classification-results/{system_id}/{safe_config_id}/{iso}.json"
    data = json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8")

    await minio_client.ensure_bucket()

    from app.minio_client import _get_client

    def _put() -> None:
        _get_client().put_object(
            _CLASSIFICATION_BUCKET,
            key,
            io.BytesIO(data),
            length=len(data),
            content_type="application/json",
        )

    await asyncio.to_thread(_put)
    logger.info(
        "classification_pipeline.result_stored",
        extra={"system_id": system_id, "key": key, "size": len(data)},
    )
    return key


# ---------------------------------------------------------------------------
# MinIO read
# ---------------------------------------------------------------------------


async def _read_questionnaire_result(run_key: str) -> dict:
    """Read a questionnaire pipeline result JSON from MinIO. Returns the parsed dict."""
    from app.minio_client import _get_client

    def _get() -> bytes:
        response = _get_client().get_object(_CLASSIFICATION_BUCKET, run_key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()

    raw = await asyncio.to_thread(_get)
    return json.loads(raw)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def run_classification(
    system_id: str,
    questionnaire_run_key: str,
    classification_config_id: str = _DEFAULT_CONFIG_ID,
    prompt_id: str = _DEFAULT_PROMPT_ID,
) -> dict[str, Any]:
    """Run risk & role label classification against completed questionnaire answers.

    Reads the Step 1 questionnaire result from MinIO, runs one LLM 2 call per
    active label in parallel, merges the results, and persists the output to
    MinIO.

    Returns ``{run_key, presigned_url, result}`` where ``result`` is:
    ``{questionnaire_run_key, config_id, config_version, prompt_id, classifications}``.

    Raises:
        KeyError: MinIO object not found.
        PromptTemplateError: config or prompt file not found.
        LLMParseError: LLM returned unparseable JSON after repair retry.
    """
    # 1. Read Step 1 output from MinIO.
    questionnaire_output = await _read_questionnaire_result(questionnaire_run_key)
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

    logger.info(
        "classification_pipeline.started",
        extra={
            "system_id": system_id,
            "questionnaire_run_key": questionnaire_run_key,
            "active_labels": len(active_labels),
        },
    )

    # 4. Fan out — one LLM call per active label, all in parallel.
    label_results = await asyncio.gather(
        *[
            _classify_label(label, questionnaire_results, system_prompt)
            for label in active_labels
        ],
        return_exceptions=True,
    )

    # Collect successful results; log failures per label.
    classifications: list[dict] = []
    for label, outcome in zip(active_labels, label_results):
        if isinstance(outcome, Exception):
            logger.warning(
                "classification_pipeline.label_failed",
                extra={"system_id": system_id, "label_id": label["id"], "error": str(outcome)},
            )
        else:
            classifications.append(outcome)

    result: dict[str, Any] = {
        "questionnaire_run_key": questionnaire_run_key,
        "config_id": config_id_short,
        "config_version": config_version,
        "prompt_id": Path(prompt_id).name,
        "classifications": classifications,
    }

    # 5. Persist to MinIO.
    timestamp = datetime.now(timezone.utc)
    run_key = await _upload_classification_result(
        system_id, classification_config_id, result, timestamp
    )
    presigned_url = await minio_client.get_presigned_url(run_key, expires_hours=24)

    logger.info(
        "classification_pipeline.completed",
        extra={
            "system_id": system_id,
            "config_id": config_id_short,
            "config_version": config_version,
            "labels_classified": len(classifications),
            "labels_failed": len(active_labels) - len(classifications),
            "run_key": run_key,
        },
    )

    return {
        "run_key": run_key,
        "presigned_url": presigned_url,
        "result": result,
    }
