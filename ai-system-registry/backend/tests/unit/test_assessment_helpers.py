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
