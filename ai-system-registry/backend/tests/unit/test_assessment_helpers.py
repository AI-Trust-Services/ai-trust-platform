"""Unit tests for the single-page assessment helpers (no DB, no network)."""

from __future__ import annotations

from unittest.mock import MagicMock

from app.routers import assessment


def test_status_label_maps_locked_and_returned():
    sys = MagicMock()
    sys.workflow_status = "pending_review"
    assert assessment._status_label(sys) == "locked"
    sys.workflow_status = "returned"
    assert assessment._status_label(sys) == "under_review"
    sys.workflow_status = "draft"
    assert assessment._status_label(sys) == "draft"


def test_is_editable():
    sys = MagicMock()
    for ws, expected in [
        ("draft", True),
        ("returned", True),
        ("pending_review", False),
        ("approved", False),
    ]:
        sys.workflow_status = ws
        assert assessment._is_editable(sys) is expected


# ── questionnaire-pipeline result conversion ─────────────────────────────────


def _item(qid, answers, refs=None, explanation="because"):
    return {
        "questionId": qid,
        "answer": answers,
        "explanation": explanation,
        "references": refs or [],
    }


def test_proposals_predefined_uses_plain_value_and_strength_band():
    out = assessment._proposals_from_results(
        [_item("Scope_1", [{"value": "YES", "answerStrength": "MEDIUM"}])]
    )
    assert out["Scope_1"]["answer"] == "YES"
    assert out["Scope_1"]["confidence"] == "medium"
    assert out["Scope_1"]["explanation"] == "because"


def test_proposals_multiselect_serialises_json_array_with_lowest_strength():
    import json

    from app.assessment_catalogue import QUESTION_TYPES

    key = next(k for k, t in QUESTION_TYPES.items() if t == "MULTISELECT")
    out = assessment._proposals_from_results(
        [
            _item(
                key,
                [
                    {"value": "a", "answerStrength": "HIGH"},
                    {"value": "b", "answerStrength": "LOW"},
                ],
            )
        ]
    )
    assert json.loads(out[key]["answer"]) == ["a", "b"]
    assert out[key]["confidence"] == "low"


def test_proposals_single_multiselect_value_is_still_a_json_array():
    import json

    from app.assessment_catalogue import QUESTION_TYPES

    key = next(k for k, t in QUESTION_TYPES.items() if t == "MULTISELECT")
    out = assessment._proposals_from_results(
        [_item(key, [{"value": "a", "answerStrength": "HIGH"}])]
    )
    assert json.loads(out[key]["answer"]) == ["a"]


def test_proposals_skip_unknown_ids_unanswered_and_malformed_items():
    out = assessment._proposals_from_results(
        [
            _item("Not_A_Question", [{"value": "YES"}]),
            _item("Scope_1", []),
            _item("Scope_2", [{"value": ""}]),
            "garbage",
            {"questionId": "Scope_3", "answer": None},
        ]
    )
    assert out == {}


def test_proposals_without_strength_return_none_confidence():
    out = assessment._proposals_from_results(
        [_item("Scope_1", [{"value": "NOT_ENOUGH_INFORMATION"}])]
    )
    assert out["Scope_1"]["confidence"] is None


# ── attention flag ───────────────────────────────────────────────────────────


def _row(owner: str = "owner"):
    row = MagicMock()
    row.business_owners = owner
    return row


def _state(confidence=None, confirmed_at=None, confirmed_by=None):
    st = MagicMock()
    st.confidence = confidence
    st.confirmed_at = confirmed_at
    st.confirmed_by = confirmed_by
    return st


def test_needs_attention_when_no_confidence_band():
    """NOT_ENOUGH_INFORMATION is a NON-BLANK answer with a null answerStrength, so
    the empty-answer check never catches it — the missing band has to."""
    assert (
        assessment._needs_attention(
            _row(), _state(confidence=None), "NOT_ENOUGH_INFORMATION"
        )
        is True
    )


def test_needs_attention_when_low_confidence():
    assert assessment._needs_attention(_row(), _state(confidence="low"), "YES") is True


def test_needs_attention_when_answer_blank():
    assert assessment._needs_attention(_row(), _state(confidence=None), None) is True
    assert assessment._needs_attention(_row(), _state(confidence=None), "   ") is True


def test_no_attention_once_owner_confirmed():
    st = _state(confidence="low", confirmed_at="2026-01-01", confirmed_by="owner")
    assert assessment._needs_attention(_row("owner"), st, "YES") is False


def test_no_attention_for_established_band():
    """HIGH/MEDIUM are auto-confirmed on the owner's behalf; even before that lands
    an established band is not flagged for review."""
    for band in ("high", "medium"):
        assert (
            assessment._needs_attention(_row(), _state(confidence=band), "YES") is False
        )


def test_sources_are_distinct_in_first_seen_order():
    proposals = {
        "Scope_1": {"references": [{"source": "a.pdf"}, {"source": "b.pdf"}]},
        "Scope_2": {"references": [{"source": "a.pdf"}, {"quote": "no source"}, "x"]},
    }
    assert [s.name for s in assessment._sources_from_proposals(proposals)] == [
        "a.pdf",
        "b.pdf",
    ]
