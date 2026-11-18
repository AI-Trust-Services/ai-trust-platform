"""Hierarchy solver — pure function, no I/O.

Resolves a classification pipeline result to a single risk winner and a list of
role labels, applying optional user overrides and computing confidence bands.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.classification_config import DEFAULT_CLASSIFICATION_CONFIG_ID
from app.llm.templates import load_questionnaire
from app.questionnaire_tree import eval_label, get_question_ids_from_label
from app.schemas.hierarchy_solver import LabelOverrides, ResolvedLabel, ResolveResponse

logger = logging.getLogger(__name__)

# Risk labels in descending priority order. First true one wins; MINIMAL is the fallback.
_RISK_HIERARCHY = ["PROHIBITED", "HIGH_RISK", "TRANSPARENCY", "MINIMAL"]
_RISK_LABEL_IDS = frozenset(_RISK_HIERARCHY)

_CONFIG_PATH = Path(__file__).parents[1] / "context" / "prompts" / "hierarchy_solver_config.json"
_DEFAULT_THRESHOLDS = {"high": 90, "medium": 60}


@lru_cache(maxsize=1)
def _load_config() -> dict[str, Any]:
    # Cached for the process lifetime. A config change requires a pod restart (image rebuild),
    # since the file is baked into the image at build time.
    return json.loads(_CONFIG_PATH.read_text())


def _confidence_band(label_id: str, confidence: float) -> str:
    thresholds = _load_config().get("confidence_thresholds", {}).get(label_id)
    if thresholds is None:
        logger.warning("hierarchy_solver.missing_threshold_config", extra={"label_id": label_id})
        thresholds = _DEFAULT_THRESHOLDS
    if confidence >= thresholds["high"]:
        return "High"
    if confidence >= thresholds["medium"]:
        return "Medium"
    return "Low"


def _build_answers_map(questionnaire_result: dict) -> dict[str, list[str]]:
    """Build {questionId: [answer values]} from a questionnaire result dict."""
    answers: dict[str, list[str]] = {}
    for entry in questionnaire_result.get("results", []):
        qid = entry.get("questionId")
        if qid:
            answers[qid] = [a["value"] for a in entry.get("answer", []) if "value" in a]
    return answers


def _validate_overrides(
    overrides: LabelOverrides,
    classifications: list[dict],
    all_question_ids: set[str],
) -> None:
    """Raise ValueError (→ 422) for unknown labels/questions or invalid riskWinner."""
    known_label_ids = {c["labelId"] for c in classifications}

    for label_id in overrides.labels:
        if label_id not in known_label_ids:
            raise ValueError(f"Unknown labelId in overrides.labels: '{label_id}'")

    if overrides.risk_winner is not None and overrides.risk_winner not in _RISK_LABEL_IDS:
        raise ValueError(
            f"riskWinner '{overrides.risk_winner}' is not a valid risk label "
            f"(must be one of {sorted(_RISK_LABEL_IDS)})"
        )

    for qid in overrides.answers:
        if qid not in all_question_ids:
            raise ValueError(f"Unknown questionId in overrides.answers: '{qid}'")


def solve(
    pipeline_result: dict,
    overrides: LabelOverrides | None,
    questionnaire_result: dict | None = None,
) -> ResolveResponse:
    """Resolve pipeline_result into a ResolveResponse.

    Override precedence (highest first): riskWinner > labels > answers re-eval > pipeline.
    """
    classifications: list[dict] = pipeline_result.get("classifications", [])

    config = load_questionnaire(DEFAULT_CLASSIFICATION_CONFIG_ID)
    all_labels = config.get("riskLabels", []) + config.get("roleLabels", [])
    all_question_ids: set[str] = set()
    for label in all_labels:
        all_question_ids |= get_question_ids_from_label(label)

    if overrides:
        _validate_overrides(overrides, classifications, all_question_ids)

    # classification_map: {labelId → pipeline classification dict}
    classification_map: dict[str, dict] = {c["labelId"]: dict(c) for c in classifications}

    # Step 1: per-question answer overrides — re-evaluate rule trees deterministically
    # without an LLM call. Only labels whose result flips are marked _answers_overridden.
    if overrides and overrides.answers:
        base_answers = _build_answers_map(questionnaire_result) if questionnaire_result else {}
        effective_answers = {**base_answers, **overrides.answers}
        label_by_id = {lbl["id"]: lbl for lbl in all_labels}
        for label_id, classification in classification_map.items():
            label = label_by_id.get(label_id)
            if label:
                new_result = eval_label(label, effective_answers)
                if new_result != classification["result"]:
                    classification_map[label_id] = {**classification, "result": new_result, "_answers_overridden": True}

    # Step 2: per-label result overrides — directly force a label's boolean result,
    # bypassing rule evaluation entirely.
    if overrides and overrides.labels:
        for label_id, forced_result in overrides.labels.items():
            if label_id in classification_map:
                classification_map[label_id] = {**classification_map[label_id], "result": forced_result, "_user_overridden": True}

    def _build_resolved_label(label_id: str) -> ResolvedLabel:
        classification = classification_map.get(label_id)
        user_overridden = classification and (classification.get("_user_overridden") or classification.get("_answers_overridden"))

        if label_id == "MINIMAL":
            # ponytail: min of other risk-label confidences — proxy for "we're as sure as the
            # weakest counterargument"; upgrade to §8/§9 tree eval if MINIMAL gets its own rules.
            other_confidences = [
                c["confidence"]
                for rid in _RISK_HIERARCHY[:-1]  # PROHIBITED, HIGH_RISK, TRANSPARENCY
                if (c := classification_map.get(rid)) and c.get("confidence") is not None
            ]
            confidence = min(other_confidences) if other_confidences else None
            band = _confidence_band(label_id, confidence) if confidence is not None else None
            return ResolvedLabel(
                labelId=label_id,
                result=True,
                source="pipeline",
                confidence=confidence,
                confidenceBand=band,
                explanation=None,
            )

        if classification is None:
            # Pipeline skipped or failed this label (insufficient data / LLM error).
            return ResolvedLabel(labelId=label_id, result=False, source="skipped", confidence=None, confidenceBand=None, explanation=None)

        if user_overridden:
            return ResolvedLabel(
                labelId=label_id,
                result=classification["result"],
                source="user",
                confidence=100,
                confidenceBand="High",
                explanation=None,
            )

        confidence = classification.get("confidence")
        band = _confidence_band(label_id, confidence) if confidence is not None else None
        return ResolvedLabel(
            labelId=label_id,
            result=classification["result"],
            source="pipeline",
            confidence=confidence,
            confidenceBand=band,
            explanation=classification.get("explanation"),
        )

    # Step 3: resolve risk winner — reads the classification_map already mutated by steps 1+2.
    # riskWinner override beats everything, incl. labels/answers overrides.
    if overrides and overrides.risk_winner:
        risk = ResolvedLabel(
            labelId=overrides.risk_winner,
            result=True,
            source="user",
            confidence=100,
            confidenceBand="High",
            explanation=None,
        )
    else:
        winner_id = "MINIMAL"
        for label_id in _RISK_HIERARCHY[:-1]:  # skip MINIMAL
            classification = classification_map.get(label_id)
            if classification and classification.get("result"):
                winner_id = label_id
                break
        risk = _build_resolved_label(winner_id)

    # Step 4: all role labels (incl. result:false).
    role_ids = [lbl["id"] for lbl in config.get("roleLabels", []) if lbl.get("activate", False)]
    roles = [_build_resolved_label(rid) for rid in role_ids]

    return ResolveResponse(risk=risk, roles=roles)
