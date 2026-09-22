"""Unit tests for policy-checker-worker — pure logic, no DB or ClickHouse required."""

from __future__ import annotations

from datetime import datetime, timezone, timedelta


def _is_within_suppression_window(
    handled_at: datetime | None, window_hours: int = 24
) -> bool:
    if handled_at is None:
        return False
    now = datetime.now(timezone.utc)
    return (now - handled_at).total_seconds() < window_hours * 3600


def test_suppression_window_active_when_recently_handled():
    handled_at = datetime.now(timezone.utc) - timedelta(hours=1)
    assert _is_within_suppression_window(handled_at) is True


def test_suppression_window_inactive_when_old():
    handled_at = datetime.now(timezone.utc) - timedelta(hours=25)
    assert _is_within_suppression_window(handled_at) is False


def test_suppression_window_inactive_when_none():
    assert _is_within_suppression_window(None) is False


def test_suppression_window_exactly_at_boundary():
    handled_at = datetime.now(timezone.utc) - timedelta(hours=24, seconds=1)
    assert _is_within_suppression_window(handled_at) is False
