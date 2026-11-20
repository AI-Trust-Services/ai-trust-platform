"""Hierarchy solver — pure function, no I/O.

Resolves a classification pipeline result to a single risk winner and a list of
role labels, applying optional user overrides and computing confidence bands.
"""

from __future__ import annotations

import logging

from app.classification_config import DEFAULT_CLASSIFICATION_CONFIG_ID
from app.llm.templates import load_questionnaire
from app.questionnaire_tree import eval_label, get_question_ids_from_label
from app.schemas.hierarchy_solver import LabelOverrides, ResolvedLabel, ResolveResponse

logger = logging.getLogger(__name__)

# Risk labels in descending priority order. First true one wins; MINIMAL is the fallback.
_RISK_HIERARCHY = ["PROHIBITED", "HIGH_RISK", "TRANSPARENCY", "MINIMAL"]
_RISK_LABEL_IDS = frozenset(_RISK_HIERARCHY)

_DEFAULT_THRESHOLDS = {"high": 90, "medium": 60}


def _confidence_band(label_id: str, confidence: float) -> str:
    thresholds = load_questionnaire("hierarchy_solver_config").get("confidence_thresholds", {}).get(label_id)
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


def _pipeline_label(c: dict) -> ResolvedLabel:
    confidence = c.get("confidence")
    band = _confidence_band(c["labelId"], confidence) if confidence is not None else None
    return ResolvedLabel(
        labelId=c["labelId"],
        result=c.get("result", False),
        source="pipeline",
        confidence=confidence,
        confidenceBand=band,
        explanation=c.get("explanation"),
    )


def _user_label(label_id: str, result: bool) -> ResolvedLabel:
    return ResolvedLabel(
        labelId=label_id,
        result=result,
        source="user",
        confidence=100,
        confidenceBand="High",
        explanation=None,
    )


def _minimal_label(combined: dict[str, ResolvedLabel]) -> ResolvedLabel:
    # ponytail: min of other risk-label confidences — proxy for "we're as sure as the
    # weakest counterargument"; upgrade to §8/§9 tree eval if MINIMAL gets its own rules.
    other_confidences = [
        combined[rid].confidence
        for rid in _RISK_HIERARCHY[:-1]
        if rid in combined and combined[rid].confidence is not None
    ]
    confidence = min(other_confidences) if other_confidences else None
    band = _confidence_band("MINIMAL", confidence) if confidence is not None else None
    return ResolvedLabel(
        labelId="MINIMAL",
        result=True,
        source="pipeline",
        confidence=confidence,
        confidenceBand=band,
        explanation=None,
    )


def solve(
    pipeline_result: dict,
    overrides: LabelOverrides | None,
    questionnaire_result: dict | None = None,
) -> ResolveResponse:
    """Resolve pipeline_result into a ResolveResponse.

    Override precedence (highest first): riskWinner > labels > answers re-eval > pipeline.
    """
    classifications: list[dict] = pipeline_result.get("classifications", [])
    skipped_label_ids: set[str] = {e["labelId"] for e in pipeline_result.get("skipped_labels", [])}

    config = load_questionnaire(DEFAULT_CLASSIFICATION_CONFIG_ID)
    all_labels = config.get("riskLabels", []) + config.get("roleLabels", [])
    all_question_ids: set[str] = set()
    for label in all_labels:
        all_question_ids |= get_question_ids_from_label(label)

    if overrides:
        _validate_overrides(overrides, classifications, all_question_ids)

    # Pre-compute answer-override results before the loop so the loop is pure lookup.
    answer_results: dict[str, bool] = {}
    if overrides and overrides.answers:
        base_answers = _build_answers_map(questionnaire_result) if questionnaire_result else {}

        effective_answers = base_answers | overrides.answers  # overrides win on conflict
        
        for lbl in all_labels:
            answer_results[lbl["id"]] = eval_label(lbl, effective_answers)

    # Build combined: iterate pipeline classifications, then skipped labels revived by overrides.
    combined: dict[str, ResolvedLabel] = {}

    for c in classifications:
        lid = c["labelId"]
        if overrides and lid in overrides.labels:  # direct label override
            combined[lid] = _user_label(lid, overrides.labels[lid])
        elif lid in answer_results and answer_results[lid] != c.get("result", False):  # answer override flipped result
            combined[lid] = _user_label(lid, answer_results[lid])
        else:  # pipeline result unchanged
            combined[lid] = _pipeline_label(c)

    # Skipped labels: only add if an override revives them.
    for lid in skipped_label_ids:
        if lid in combined:
            continue
        if overrides and lid in overrides.labels:  # direct label override revives skipped
            combined[lid] = _user_label(lid, overrides.labels[lid])
        elif lid in answer_results and answer_results[lid]:  # answer override revives skipped
            combined[lid] = _user_label(lid, answer_results[lid])
        # else: stays out of combined — skipped and not revived

    # Resolve risk winner.
    if overrides and overrides.risk_winner:
        risk = _user_label(overrides.risk_winner, True)
    else:
        winner_id = "MINIMAL"
        for label_id in _RISK_HIERARCHY[:-1]:
            if label_id in combined and combined[label_id].result:
                winner_id = label_id
                break
        risk = combined.get(winner_id) or _minimal_label(combined)

    # Role labels: all active, except skipped ones that were not revived.
    roles = [
        combined[lbl["id"]]
        for lbl in config.get("roleLabels", [])
        if lbl.get("activate", False) and lbl["id"] in combined
    ]

    return ResolveResponse(risk=risk, roles=roles)
