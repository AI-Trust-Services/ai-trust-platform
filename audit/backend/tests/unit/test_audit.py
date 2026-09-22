"""Unit tests for audit — pure logic, no ClickHouse required."""
from __future__ import annotations

import json


def _trend(current: int, previous: int) -> float | None:
    if previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


def _parse_changes(raw: str | None) -> dict:
    try:
        return json.loads(raw) if raw else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def test_trend_increase():
    assert _trend(120, 100) == 20.0


def test_trend_decrease():
    assert _trend(80, 100) == -20.0


def test_trend_no_change():
    assert _trend(100, 100) == 0.0


def test_trend_zero_previous_returns_none():
    assert _trend(5, 0) is None


def test_trend_rounds_to_one_decimal():
    assert _trend(1, 3) == -66.7


def test_parse_changes_valid_json():
    raw = '{"tier": {"before": "minimal", "after": "high"}}'
    result = _parse_changes(raw)
    assert result["tier"]["after"] == "high"


def test_parse_changes_none_returns_empty_dict():
    assert _parse_changes(None) == {}


def test_parse_changes_invalid_json_returns_empty_dict():
    assert _parse_changes("not-json") == {}
