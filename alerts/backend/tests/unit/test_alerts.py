"""Unit tests for alerts — pure logic, no DB or ClickHouse required."""
from __future__ import annotations


def _enrich(rows: list[dict], name_map: dict[str, str]) -> list[dict]:
    for row in rows:
        row["entity_display_name"] = name_map.get(row.get("entity_id", ""), row.get("entity_id", ""))
    return rows


def test_enrich_maps_known_entity_id():
    rows = [{"entity_id": "SYS-00000001", "entity_type": "ai_system"}]
    name_map = {"SYS-00000001": "My System"}
    result = _enrich(rows, name_map)
    assert result[0]["entity_display_name"] == "My System"


def test_enrich_falls_back_to_entity_id_when_not_in_map():
    rows = [{"entity_id": "SYS-UNKNOWN", "entity_type": "ai_system"}]
    result = _enrich(rows, {})
    assert result[0]["entity_display_name"] == "SYS-UNKNOWN"


def test_enrich_handles_missing_entity_id():
    rows = [{"entity_type": "ai_system"}]
    result = _enrich(rows, {})
    assert result[0]["entity_display_name"] == ""


def test_enrich_empty_rows():
    assert _enrich([], {}) == []
