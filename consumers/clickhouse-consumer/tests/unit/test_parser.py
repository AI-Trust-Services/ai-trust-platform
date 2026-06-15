import json
import pytest
from main import _process_payload


def _span(attrs: list, start_nano: str = "1000000000", end_nano: str = "2000000000") -> dict:
    span = {
        "traceId": "abc",
        "spanId": "def",
        "attributes": attrs,
    }
    if start_nano is not None:
        span["startTimeUnixNano"] = start_nano
    if end_nano is not None:
        span["endTimeUnixNano"] = end_nano
    return span


def _payload(spans: list, resource_attrs: list = None) -> bytes:
    return json.dumps({
        "resourceSpans": [{
            "resource": {"attributes": resource_attrs or []},
            "scopeSpans": [{"spans": spans}],
        }]
    }).encode()


def _attr(key: str, value: str) -> dict:
    return {"key": key, "value": {"stringValue": value}}


def test_gen_ai_span_produces_row():
    body = _payload([_span([_attr("gen_ai.operation.name", "chat")])])
    rows = _process_payload(body)
    assert len(rows) == 1
    assert rows[0]["operation_name"] == "chat"


def test_span_without_operation_name_is_skipped():
    body = _payload([_span([_attr("some.other.attr", "value")])])
    rows = _process_payload(body)
    assert rows == []


def test_service_name_comes_from_resource_attributes():
    body = _payload(
        spans=[_span([_attr("gen_ai.operation.name", "chat")])],
        resource_attrs=[_attr("service.name", "my-service")],
    )
    rows = _process_payload(body)
    assert rows[0]["service_name"] == "my-service"


@pytest.mark.parametrize("value_type,value,expected", [
    ("intValue", 42, "42"),
    ("doubleValue", 3.14, "3.14"),
    ("boolValue", True, "true"),
    ("stringValue", "gpt-4", "gpt-4"),
])
def test_attribute_value_types_are_coerced_to_string(value_type, value, expected):
    body = _payload([_span([
        {"key": "gen_ai.operation.name", "value": {"stringValue": "chat"}},
        {"key": "gen_ai.request.model", "value": {value_type: value}},
    ])])
    rows = _process_payload(body)
    assert rows[0]["request_model"] == expected


def test_duration_ms_computed_from_nano_timestamps():
    # 500ms = 500_000_000 ns
    body = _payload([_span(
        [_attr("gen_ai.operation.name", "chat")],
        start_nano="1000000000000",
        end_nano="1000500000000",
    )])
    rows = _process_payload(body)
    assert rows[0]["duration_ms"] == pytest.approx(500.0)


def test_missing_timestamps_default_to_zero_duration():
    body = _payload([_span([_attr("gen_ai.operation.name", "chat")], start_nano=None, end_nano=None)])
    rows = _process_payload(body)
    assert rows[0]["duration_ms"] == 0.0


def test_row_keys_match_columns_constant():
    from ai_trust_clickhouse import COLUMNS
    body = _payload([_span([_attr("gen_ai.operation.name", "chat")])])
    rows = _process_payload(body)
    assert list(rows[0].keys()) == COLUMNS
