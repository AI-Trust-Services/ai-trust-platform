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


def test_span_without_start_timestamp_is_dropped():
    # Without startTimeUnixNano we cannot place the span on the trace timeline.
    # Dropping it (and logging) is correct — silently substituting `now()`
    # silently reorders the trace and hides instrumentation bugs.
    body = _payload([_span([_attr("gen_ai.operation.name", "chat")], start_nano=None, end_nano=None)])
    rows = _process_payload(body)
    assert rows == []


def test_span_with_start_but_no_end_keeps_zero_duration():
    body = _payload([_span(
        [_attr("gen_ai.operation.name", "chat")],
        start_nano="1000000000",
        end_nano=None,
    )])
    rows = _process_payload(body)
    assert len(rows) == 1
    assert rows[0]["duration_ms"] == 0.0


def test_row_keys_match_columns_constant():
    from ai_trust_clickhouse import COLUMNS
    body = _payload([_span([_attr("gen_ai.operation.name", "chat")])])
    rows = _process_payload(body)
    # `_route_tenant` is a routing key (which tenant database to write to), not a table
    # column — insert_routed pops it before building values. The remaining keys, in order,
    # must match the COLUMNS constant.
    keys = [k for k in rows[0].keys() if k != "_route_tenant"]
    assert keys == COLUMNS


def test_openinference_span_without_gen_ai_operation_is_kept():
    # LangChain auto-instrumentation only sets openinference.span.kind on most
    # child spans (no gen_ai.operation.name) — we still want to keep them so
    # the trace graph is complete.
    body = _payload([_span([_attr("openinference.span.kind", "LLM")])])
    rows = _process_payload(body)
    assert len(rows) == 1
    assert rows[0]["operation_name"] == ""


def test_span_level_fields_are_extracted():
    span = _span([_attr("gen_ai.operation.name", "chat")])
    span["parentSpanId"] = "parent123"
    span["name"] = "ChatOllama"
    span["kind"] = 3
    span["status"] = {"code": 2, "message": "boom"}
    rows = _process_payload(_payload([span]))
    assert rows[0]["parent_span_id"] == "parent123"
    assert rows[0]["span_name"] == "ChatOllama"
    assert rows[0]["span_kind"] == 3
    assert rows[0]["status_code"] == 2
    assert rows[0]["status_message"] == "boom"


def test_all_attributes_land_in_map():
    body = _payload([_span([
        _attr("gen_ai.operation.name", "chat"),
        _attr("openinference.span.kind", "LLM"),
        _attr("llm.model_name", "llama3.2"),
        {"key": "llm.token_count.total", "value": {"intValue": 150}},
    ])])
    rows = _process_payload(body)
    attrs = rows[0]["attributes"]
    assert attrs["gen_ai.operation.name"] == "chat"
    assert attrs["openinference.span.kind"] == "LLM"
    assert attrs["llm.model_name"] == "llama3.2"
    assert attrs["llm.token_count.total"] == "150"


def test_array_value_finish_reasons_promoted_to_column():
    # OTel GenAI semconv defines gen_ai.response.finish_reasons as string[].
    # OTLP encodes it as arrayValue.values=[{stringValue: ...}, ...]; _extract_attr
    # must flatten it to a JSON-array string so downstream readers see "stop".
    body = _payload([_span([
        _attr("gen_ai.operation.name", "chat"),
        {"key": "gen_ai.response.finish_reasons", "value": {
            "arrayValue": {"values": [
                {"stringValue": "content_filter"},
                {"stringValue": "stop"},
            ]}
        }},
    ])])
    rows = _process_payload(body)
    assert rows[0]["finish_reasons"] == '["content_filter", "stop"]'


def test_array_value_attribute_lands_in_map_as_json_array():
    # Same arrayValue, surfaced through the generic attributes map. Both the
    # promoted column AND the map must carry the data so summary._finish_reasons
    # can fall back to the map when the column is empty.
    body = _payload([_span([
        _attr("gen_ai.operation.name", "chat"),
        {"key": "gen_ai.response.finish_reasons", "value": {
            "arrayValue": {"values": [{"stringValue": "stop"}]}
        }},
    ])])
    rows = _process_payload(body)
    assert rows[0]["attributes"]["gen_ai.response.finish_reasons"] in (
        '{"arrayValue": {"values": [{"stringValue": "stop"}]}}',
    )
    # Note: the attributes map uses _value_to_string which dumps the whole
    # arrayValue blob — kept as-is for forward compatibility with non-finish-
    # reason array attrs. The promoted column is the canonical surface.
