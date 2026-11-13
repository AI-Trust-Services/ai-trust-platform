"""Contract validators for LLM output schemas.

Each public function validates the output of one LLM step against the contract
in its system prompt (``questionnaire_answer.md`` §3–§9, ``risk_role_
classification.md`` §12). They are used as the ``validator`` of
``parse_with_retry``: on any violation they raise ``LLMParseError`` listing
**all** violations found (capped), so a single retry can fix them together.

Validators take the *expected* shape as an optional argument (the batch config /
the requested label id). Without it only the config-independent rules apply.
"""

from __future__ import annotations

from typing import Any

from app.llm.parsing import LLMParseError

_QUESTION_TYPES = frozenset({"PREDEFINED", "MULTISELECT", "DESCRIPTIVE"})
_ANSWER_STRENGTHS = frozenset({"HIGH", "MEDIUM", "LOW"})
_SOURCE_TYPES = frozenset({"Document", "Registration Data"})

# Outcomes the prompt defines in addition to a question's configured options.
_NOT_ENOUGH_INFORMATION = "NOT_ENOUGH_INFORMATION"
_CONFLICT = "CONFLICT"
_NOT_APPLICABLE = "NOT_APPLICABLE"
_SPECIAL_VALUES = frozenset({_NOT_ENOUGH_INFORMATION, _CONFLICT, _NOT_APPLICABLE})
# These two carry answerStrength null and must be the only answer item.
_NO_STRENGTH_VALUES = frozenset({_NOT_ENOUGH_INFORMATION, _CONFLICT})

# Report at most this many violations in one error (keeps retry prompts short).
_MAX_REPORTED = 10


def _raise_if(errors: list[str]) -> None:
    if not errors:
        return
    shown = errors[:_MAX_REPORTED]
    hidden = len(errors) - len(shown)
    msg = "; ".join(shown)
    if hidden:
        msg += f"; … and {hidden} more violation(s)"
    raise LLMParseError(msg)


# ---------------------------------------------------------------------------
# Questionnaire batch (pipeline 1)
# ---------------------------------------------------------------------------


def _expected_questions(batch: dict | None) -> dict[str, dict[str, Any]] | None:
    """Map ``questionId -> {type, options}`` from a questionnaire batch config.

    ``options`` is ``None`` when the question has no configured option list
    (DESCRIPTIVE) — value membership is then not checked.
    """
    if not batch:
        return None
    expected: dict[str, dict[str, Any]] = {}
    for q in batch.get("questions", []):
        qid = q.get("id")
        if not qid:
            continue
        allowed = q.get("allowedAnswers")
        options: set[str] | None = None
        if isinstance(allowed, list) and allowed:
            options = {
                a if isinstance(a, str) else a.get("value")
                for a in allowed
                if isinstance(a, (str, dict))
            }
            options.discard(None)
        expected[qid] = {"type": q.get("type"), "options": options}
    return expected or None


def validate_questionnaire_batch(raw: dict, batch: dict | None = None) -> dict:
    """Strict validator for the questionnaire_answer.md §9 output schema.

    Config-independent rules (always): results list, per-item fields, answer
    items, references, no duplicate question ids, and the answer-semantics rules
    (see ``_answer_errors``).

    With ``batch`` (the questionnaire slice that was sent to the LLM) also:
    every ``questionId`` belongs to the batch, **every batch question is
    answered**, ``questionType`` matches the config, and every answer value is
    one of the question's configured options or NOT_ENOUGH_INFORMATION /
    CONFLICT / NOT_APPLICABLE.

    Returns ``raw`` unchanged on success; raises ``LLMParseError`` listing the
    violations otherwise.
    """
    results = raw.get("results")
    if not isinstance(results, list) or len(results) == 0:
        raise LLMParseError(
            "results: must be a non-empty array; got "
            + (
                "empty list"
                if isinstance(results, list)
                else repr(type(results).__name__)
            )
        )

    expected = _expected_questions(batch)
    errors: list[str] = []
    seen: set[str] = set()

    for i, item in enumerate(results):
        prefix = f"results[{i}]"
        if not isinstance(item, dict):
            errors.append(f"{prefix}: must be an object, got {type(item).__name__}")
            continue

        question_id = item.get("questionId")
        if not isinstance(question_id, str) or not question_id:
            errors.append(f"{prefix}.questionId: must be a non-empty string")
            question_id = None
        elif question_id in seen:
            errors.append(f"{prefix}.questionId: duplicate answer for '{question_id}'")
        else:
            seen.add(question_id)

        if not isinstance(item.get("question"), str):
            errors.append(f"{prefix}.question: must be a string")

        q_type = item.get("questionType")
        if not isinstance(q_type, str):
            errors.append(
                f"{prefix}.questionType: must be a string, got {type(q_type).__name__}"
            )
            q_type = None
        elif q_type not in _QUESTION_TYPES:
            errors.append(
                f"{prefix}.questionType: must be one of {sorted(_QUESTION_TYPES)}, got {q_type!r}"
            )

        if not isinstance(item.get("explanation"), str):
            errors.append(f"{prefix}.explanation: must be a string")

        references = item.get("references")
        if not isinstance(references, list):
            errors.append(f"{prefix}.references: must be an array")
        else:
            for k, ref in enumerate(references):
                errors.extend(_reference_errors(ref, f"{prefix}.references[{k}]"))

        options: set[str] | None = None
        if expected is not None and question_id is not None:
            spec = expected.get(question_id)
            if spec is None:
                errors.append(
                    f"{prefix}.questionId: '{question_id}' is not a question of this "
                    f"batch (expected one of {sorted(expected)})"
                )
            else:
                if q_type in _QUESTION_TYPES and q_type != spec["type"]:
                    errors.append(
                        f"{prefix}.questionType: '{question_id}' is {spec['type']}, got {q_type!r}"
                    )
                options = spec["options"]

        answer = item.get("answer")
        if not isinstance(answer, list) or len(answer) == 0:
            errors.append(f"{prefix}.answer: must be a non-empty array")
        else:
            errors.extend(
                _answer_errors(
                    answer,
                    f"{prefix}.answer",
                    q_type if q_type in _QUESTION_TYPES else None,
                    options,
                )
            )

    if expected is not None:
        missing = [qid for qid in expected if qid not in seen]
        if missing:
            errors.append(
                f"results: missing an answer for question(s) {missing} — every "
                f"question of the batch must be answered"
            )

    _raise_if(errors)
    return raw


def _answer_item_errors(ans: object, path: str) -> list[str]:
    if not isinstance(ans, dict):
        return [f"{path}: must be an object, got {type(ans).__name__}"]

    errors: list[str] = []
    value = ans.get("value")
    if not isinstance(value, str) or not value:
        errors.append(f"{path}.value: must be a non-empty string")

    strength = ans.get("answerStrength")
    if strength is not None and (
        not isinstance(strength, str) or strength not in _ANSWER_STRENGTHS
    ):
        errors.append(
            f"{path}.answerStrength: must be one of {sorted(_ANSWER_STRENGTHS)} or null, got {strength!r}"
        )

    reason = ans.get("reason")
    if reason is not None and not isinstance(reason, str):
        errors.append(f"{path}.reason: must be a string or null")
    return errors


def _answer_errors(
    answers: list,
    path: str,
    question_type: str | None,
    options: set[str] | None,
) -> list[str]:
    """Answer-array rules from the questionnaire_answer.md contract.

    * each item is well-formed (value, answerStrength, reason)
    * PREDEFINED has exactly one item; no duplicate values
    * NOT_ENOUGH_INFORMATION / CONFLICT are the only item and carry a null
      answerStrength; every other value carries HIGH/MEDIUM/LOW
    * NOT_APPLICABLE is exclusive and never LOW
    * with ``options``: values are configured options or one of the three outcomes
    """
    errors: list[str] = []
    for j, ans in enumerate(answers):
        errors.extend(_answer_item_errors(ans, f"{path}[{j}]"))

    items = [
        a for a in answers if isinstance(a, dict) and isinstance(a.get("value"), str)
    ]
    values = [a["value"] for a in items]

    if question_type in ("PREDEFINED", "DESCRIPTIVE") and len(answers) != 1:
        errors.append(
            f"{path}: {question_type} questions need exactly one answer item, got {len(answers)}"
        )

    if len(set(values)) != len(values):
        errors.append(f"{path}: duplicate answer values {sorted(values)}")

    for a in items:
        value = a["value"]
        strength = a.get("answerStrength")
        if value in _NO_STRENGTH_VALUES:
            if strength is not None:
                errors.append(
                    f"{path}: {value} must have answerStrength null, got {strength!r}"
                )
            if len(answers) != 1:
                errors.append(f"{path}: {value} must be the only answer item")
        else:
            if strength is None:
                errors.append(
                    f"{path}: value {value!r} needs answerStrength HIGH, MEDIUM or LOW (null is only for "
                    f"{_NOT_ENOUGH_INFORMATION}/{_CONFLICT})"
                )
            if value == _NOT_APPLICABLE and strength == "LOW":
                errors.append(
                    f"{path}: {_NOT_APPLICABLE} must not have answerStrength LOW"
                )

    if _NOT_APPLICABLE in values and any(v != _NOT_APPLICABLE for v in values):
        errors.append(
            f"{path}: {_NOT_APPLICABLE} combined with regular answer values — these "
            f"are mutually exclusive"
        )

    if options is not None:
        allowed = options | _SPECIAL_VALUES
        bad = sorted({v for v in values if v not in allowed})
        if bad:
            errors.append(
                f"{path}: value(s) {bad} are not allowed; use one of {sorted(options)} "
                f"or {sorted(_SPECIAL_VALUES)}"
            )
    return errors


def _reference_errors(ref: object, path: str) -> list[str]:
    if not isinstance(ref, dict):
        return [f"{path}: must be an object, got {type(ref).__name__}"]

    errors: list[str] = []
    source_type = ref.get("sourceType")
    if not isinstance(source_type, str) or source_type not in _SOURCE_TYPES:
        errors.append(
            f"{path}.sourceType: must be one of {sorted(_SOURCE_TYPES)}, got {source_type!r}"
        )

    source = ref.get("source")
    if not isinstance(source, str) or not source:
        errors.append(f"{path}.source: must be a non-empty string")

    for nullable_field in ("sourceId", "location", "quote"):
        val = ref.get(nullable_field)
        if val is not None and not isinstance(val, str):
            errors.append(f"{path}.{nullable_field}: must be a string or null")
    return errors


def validate_answer_entries(entries: list[dict]) -> None:
    """Pre-flight check of *stored* questionnaire result entries.

    Run by pipeline 2 on the answers it is about to send to the classification
    LLM. Checks only what classification depends on (``questionId`` + the answer
    array and its semantics), using the same rules as ``validate_questionnaire_
    batch`` so there is one definition of a valid answer.
    """
    errors: list[str] = []
    for item in entries:
        q_id = item.get("questionId")
        if not q_id:
            errors.append("Questionnaire result missing 'questionId'")
            continue
        answers = item.get("answer")
        if not isinstance(answers, list) or len(answers) == 0:
            errors.append(f"Question '{q_id}' has an empty or missing 'answer' array")
            continue
        errors.extend(
            _answer_errors(
                answers,
                f"Question '{q_id}'.answer",
                item.get("questionType"),
                None,
            )
        )
    _raise_if(errors)


# ---------------------------------------------------------------------------
# Classification label (pipeline 2)
# ---------------------------------------------------------------------------


def validate_classification_label(
    raw: dict, expected_label_id: str | None = None
) -> dict:
    """Strict validator for the risk_role_classification.md §12 output schema.

    The per-label call must return **exactly one** entry whose ``labelId`` is the
    label that was asked about (when ``expected_label_id`` is given), with a
    boolean ``result``, a 0–100 numeric ``confidence`` and a non-empty
    ``explanation``.

    Returns ``raw`` unchanged on success; raises ``LLMParseError`` listing the
    violations otherwise.
    """
    classifications = raw.get("classifications")
    if not isinstance(classifications, list) or len(classifications) == 0:
        raise LLMParseError(
            "classifications: must be a non-empty array; got "
            + (
                "empty list"
                if isinstance(classifications, list)
                else repr(type(classifications).__name__)
            )
        )

    errors: list[str] = []
    if len(classifications) != 1:
        errors.append(
            f"classifications: must contain exactly one entry, got {len(classifications)}"
        )

    entry = classifications[0]
    if not isinstance(entry, dict):
        errors.append(
            f"classifications[0]: must be an object, got {type(entry).__name__}"
        )
        _raise_if(errors)

    label_id = entry.get("labelId")
    if not isinstance(label_id, str) or not label_id:
        errors.append("classifications[0].labelId: must be a non-empty string")
    elif expected_label_id is not None and label_id != expected_label_id:
        errors.append(
            f"classifications[0].labelId: must be {expected_label_id!r}, got {label_id!r}"
        )

    result = entry.get("result")
    if not isinstance(result, bool):
        errors.append(
            f"classifications[0].result: must be a boolean (true/false), got {type(result).__name__} {result!r}"
        )

    confidence = entry.get("confidence")
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        errors.append(
            f"classifications[0].confidence: must be a number, got {type(confidence).__name__}"
        )
    elif not (0 <= confidence <= 100):
        errors.append(
            f"classifications[0].confidence: must be between 0 and 100, got {confidence}"
        )

    explanation = entry.get("explanation")
    if not isinstance(explanation, str) or not explanation:
        errors.append("classifications[0].explanation: must be a non-empty string")

    _raise_if(errors)
    return raw
