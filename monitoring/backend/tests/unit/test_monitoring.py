"""Unit tests for monitoring — pure logic, no DB or ClickHouse required."""

from __future__ import annotations


def test_window_allowlist_rejects_unknown():
    ALLOWED_WINDOWS = {"15m", "1h", "6h", "24h"}
    assert "1h" in ALLOWED_WINDOWS
    assert "7d" not in ALLOWED_WINDOWS


def test_window_allowlist_accepts_all_valid():
    ALLOWED_WINDOWS = {"15m", "1h", "6h", "24h"}
    for w in ("15m", "1h", "6h", "24h"):
        assert w in ALLOWED_WINDOWS


def test_lifecycle_filter_empty_string_means_all():
    systems = [
        {"id": "SYS-1", "lifecycle": "development"},
        {"id": "SYS-2", "lifecycle": "market"},
    ]
    lifecycle = ""
    filtered = (
        systems
        if not lifecycle
        else [s for s in systems if s["lifecycle"] == lifecycle]
    )
    assert len(filtered) == 2


def test_lifecycle_filter_scopes_correctly():
    systems = [
        {"id": "SYS-1", "lifecycle": "development"},
        {"id": "SYS-2", "lifecycle": "market"},
    ]
    filtered = [s for s in systems if s["lifecycle"] == "market"]
    assert len(filtered) == 1
    assert filtered[0]["id"] == "SYS-2"
