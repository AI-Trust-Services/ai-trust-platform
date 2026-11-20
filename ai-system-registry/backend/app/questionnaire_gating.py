"""Evaluate ``appliesWhen`` gating conditions from ai-questionnaire.json.

A question is *gated* when its ``appliesWhen`` condition is present and
currently not satisfied by the stored answers.  When a dependency question
is itself gated-out, its answer is treated as ``None`` so the full dependency
chain propagates correctly (e.g. High_Risk_32 → High_Risk_31 → High_Risk_3..30).

Supported structure
-------------------
``appliesWhen`` node::

    {"all": [...conditions...]}   # AND — every condition must be true
    {"any": [...conditions...]}   # OR  — at least one condition must be true

Each leaf condition::

    {"questionId": "X", "operator": "CONTAINS", "value": "Y"}
    {"questionId": "X", "operator": "IN",       "values": ["Y", "Z"]}
    {"questionId": "X", "operator": "EQUALS",   "value": "Y"}

MULTISELECT answers are stored as JSON-serialised string arrays
(``'["A","B"]'``).  CONTAINS parses this array and checks membership.
"""

from __future__ import annotations

import json

from app.questionnaire_loader import find_questionnaire

# ---------------------------------------------------------------------------
# Module-level: load gating config once from ai-questionnaire.json
# ---------------------------------------------------------------------------


def _load_gates() -> dict[str, dict]:
    """Return {question_id: appliesWhen_node} for every gated question."""
    path = find_questionnaire()
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        q["id"]: q["appliesWhen"]
        for q in data.get("questions", [])
        if "appliesWhen" in q and q.get("id")
    }


QUESTIONS_WITH_GATE: dict[str, dict] = _load_gates()


# ---------------------------------------------------------------------------
# Condition evaluation
# ---------------------------------------------------------------------------


def _eval_leaf(condition: dict, answers: dict[str, str | None]) -> bool:
    """Evaluate a single leaf condition against the current answers."""
    qid: str = condition["questionId"]
    operator: str = condition["operator"]
    raw: str | None = answers.get(qid)

    if operator == "CONTAINS":
        # MULTISELECT answer is a JSON array string; value must be in that array.
        try:
            selected: list[str] = json.loads(raw) if raw else []
        except (json.JSONDecodeError, TypeError):
            selected = []
        return condition.get("value", "") in selected

    if operator == "IN":
        return (raw or "") in (condition.get("values") or [])

    if operator == "EQUALS":
        return (raw or "") == condition.get("value", "")

    # Unknown operator — treat as not satisfied (fail-safe).
    return False


def evaluate_applies_when(node: dict, answers: dict[str, str | None]) -> bool:
    """Return True when the ``appliesWhen`` condition is satisfied.

    Handles nested ``all``/``any`` trees recursively.
    """
    if "all" in node:
        return all(
            evaluate_applies_when(c, answers)
            if ("all" in c or "any" in c)
            else _eval_leaf(c, answers)
            for c in node["all"]
        )
    if "any" in node:
        return any(
            evaluate_applies_when(c, answers)
            if ("all" in c or "any" in c)
            else _eval_leaf(c, answers)
            for c in node["any"]
        )
    # Leaf node passed directly (shouldn't happen at top level, but handle safely).
    return _eval_leaf(node, answers)


def is_gated(
    question_id: str,
    answers: dict[str, str | None],
    _visited: frozenset[str] = frozenset(),
    _memo: dict[str, bool] | None = None,
) -> bool:
    """Return True when *question_id* is currently locked by its gate condition.

    A question is gated when:
    1. It has an ``appliesWhen`` node in the questionnaire, AND
    2. That condition is not currently satisfied.

    Recursion: when evaluating a leaf condition, if the referenced
    ``questionId`` is itself gated-out, its answer is treated as ``None``
    regardless of what is stored — so the full chain propagates.

    *_visited* guards against circular ``appliesWhen`` dependencies; a cycle
    is treated as gated (fail-safe — the question stays locked).

    *_memo* is an optional shared dict for memoizing results across calls with
    the same *answers* snapshot (e.g. inside ``get_all_gated_question_ids``).
    """
    if question_id in _visited:
        return True  # Cycle detected — treat as gated (fail-safe).

    if _memo is not None and question_id in _memo:
        return _memo[question_id]

    node = QUESTIONS_WITH_GATE.get(question_id)
    if node is None:
        if _memo is not None:
            _memo[question_id] = False
        return False  # No gate — always visible.

    visited = _visited | {question_id}

    # Build a masked answers dict: for any dependency question that is itself
    # gated, substitute None so downstream conditions correctly fail.
    masked: dict[str, str | None] = {}
    for dep_id in _collect_dep_ids(node):
        masked[dep_id] = (
            None if is_gated(dep_id, answers, visited, _memo) else answers.get(dep_id)
        )

    result = not evaluate_applies_when(node, masked)
    if _memo is not None:
        _memo[question_id] = result
    return result


def get_all_gated_question_ids(answers: dict[str, str | None]) -> set[str]:
    """Return the set of all question IDs currently gated-out.

    Uses a shared memo dict so overlapping dependency chains are evaluated
    only once across the full 47-question scan.
    """
    memo: dict[str, bool] = {}
    return {qid for qid in QUESTIONS_WITH_GATE if is_gated(qid, answers, _memo=memo)}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _collect_dep_ids(node: dict) -> set[str]:
    """Collect all questionId values referenced in an appliesWhen node."""
    ids: set[str] = set()
    for cond in node.get("all", []) + node.get("any", []):
        if "questionId" in cond:
            ids.add(cond["questionId"])
        else:
            ids |= _collect_dep_ids(cond)
    return ids
