"""Decision-tree operations on a classification config ``when``-tree.

Pure functions, no I/O, no LLM coupling. Mirrors the operator semantics defined
in the LLM-2 system prompt (§4, §7.1, §7.2) so that answer overrides can be
re-evaluated deterministically in Python without a pipeline re-run.

Operator semantics (§7.1/§7.2):
- EQUALS       — true when at least one eligible answer value equals the configured value.
- CONTAINS     — true when the configured value is present among eligible answer values.
- NOT_CONTAINS — true when the configured value is NOT present among eligible answer values.
  (Includes the empty-answer case: no eligible values → value is absent → true.)
- all — true when ALL remaining eligible children are true; empty group → false.
- any — true when AT LEAST ONE eligible child is true; empty group → false.

Special answers (§4) — filtered out before atom evaluation:
  NOT_ENOUGH_INFORMATION, CONFLICT, NOT_APPLICABLE.
If no eligible values remain for an atom condition, it evaluates to false
(not excluded from the parent group — the atom itself resolves false).

"""

from __future__ import annotations

from typing import Any

_SPECIAL_ANSWERS = frozenset({"NOT_ENOUGH_INFORMATION", "CONFLICT", "NOT_APPLICABLE"})


def collect_question_ids(node: Any) -> set[str]:
    """Recursively walk a ``when`` tree and return all referenced questionIds.

    Input: any node in a ``when`` tree — a list, a group dict {"any"/"all": [...]},
    or an atom dict {"questionId": ..., "operator": ..., "value": ...}.
    Example: collect_question_ids({"any": [{"questionId": "High_Risk_1", "operator": "CONTAINS", "value": "MACHINERY"}]})
             → {"High_Risk_1"}
    """

    # reached via recursion when iterating dict values, e.g. the list under "any"/"all"
    if isinstance(node, list):
        ids: set[str] = set()
        for item in node:
            ids |= collect_question_ids(item)
        return ids
    # node is a dict: either an atom {"questionId", "operator", "value"} or a group {"any"/"all": [...]}
    if isinstance(node, dict):
        if "questionId" in node:
            return {node["questionId"]}
        ids = set()
        # recurse into group values (e.g. the list under "any" or "all")
        for value in node.values():
            ids |= collect_question_ids(value)
        return ids
    return set()


def get_question_ids_from_label(label: dict) -> set[str]:
    """Return all questionIds referenced by any rule in a label.

    Input: a label object from risk_role_classification_config.json, e.g.:
      {"id": "HIGH_RISK", "activate": true, "rules": [{"when": {"any": [{"questionId": "High_Risk_1", ...}]}}]}
    Example: get_question_ids_from_label({"rules": [{"when": {"questionId": "High_Risk_1", "operator": "CONTAINS", "value": "X"}}]})
             → {"High_Risk_1"}
    """
    ids: set[str] = set()
    for rule in label.get("rules", []):
        ids |= collect_question_ids(rule.get("when", {}))
    return ids


def eval_tree(when: dict, answers_by_qid: dict[str, list[str]]) -> bool:
    """Evaluate a ``when`` tree against a map of {questionId: [answer values]}.

    Input Example:
      when: {"any": [{"questionId": "High_Risk_1", "operator": "CONTAINS", "value": "MACHINERY"}, ...]}
      answers_by_qid: {"High_Risk_1": ["MACHINERY", "NOT_ENOUGH_INFORMATION"], "Prohibited_1": ["YES"]}

    Special answers are filtered internally at atom evaluation time (§7.1).
    Raises ``ValueError`` on an unknown operator so mis-configured rule trees
    fail loudly rather than silently classifying wrong.
    """
    if "all" in when:
        children = when["all"]
        results = [eval_tree(child, answers_by_qid) for child in children]
        return all(results) if results else False

    if "any" in when:
        children = when["any"]
        results = [eval_tree(child, answers_by_qid) for child in children]
        return any(results) if results else False

    # Atom condition: {questionId, operator, value}
    qid = when.get("questionId")
    operator = when.get("operator")
    configured_value = when.get("value")

    raw_values = answers_by_qid.get(qid, [])
    eligible = [v for v in raw_values if v not in _SPECIAL_ANSWERS]

    if operator in ("EQUALS", "CONTAINS"):
        return configured_value in eligible

    if operator == "NOT_CONTAINS":
        return configured_value not in eligible

    if operator == "IN":
        values = when.get("values", [])
        return any(v in values for v in eligible)

    raise ValueError(
        f"Unknown operator '{operator}' in when-tree for questionId '{qid}'"
    )


def eval_label(label: dict, answers_by_qid: dict[str, list[str]]) -> bool:
    """Return true when at least one rule in the label evaluates to true."""
    for rule in label.get("rules", []):
        if eval_tree(rule.get("when", {}), answers_by_qid):
            return True
    return False
