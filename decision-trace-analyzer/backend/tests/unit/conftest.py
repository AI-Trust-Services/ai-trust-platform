"""Shared fixtures for unit tests — Span builders.

The Span shape mirrors the dicts returned by `routers/traces._load_spans()`,
which in turn mirror columns in `otel.gen_ai_spans` plus the `attributes` Map.
Tests construct spans via small builders rather than pasting 20-field dicts.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import pytest

_EPOCH = datetime(2026, 6, 29, 12, 0, 0, tzinfo=timezone.utc)


def _isoformat(t: datetime) -> str:
    """ClickHouse-style ISO without timezone suffix (router uses .isoformat())."""
    return t.isoformat()


def make_span(
    *,
    span_id: str = "s1",
    parent_span_id: str = "",
    started_offset_ms: int = 0,
    duration_ms: float = 100.0,
    operation_name: str = "chat",
    span_name: str = "chat",
    span_kind: int = 1,
    status_code: int = 0,
    status_message: str = "",
    service_name: str = "client-agent",
    gen_ai_system: str = "openai",
    request_model: str = "",
    response_model: str = "",
    input_tokens: int = 0,
    output_tokens: int = 0,
    finish_reasons: str = "",
    input_messages: str = "",
    output_messages: str = "",
    attributes: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Build a single span dict with sensible defaults.

    `started_offset_ms` is the offset from a fixed epoch — lets tests order
    spans simply without juggling absolute timestamps.
    """
    return {
        "span_id": span_id,
        "parent_span_id": parent_span_id,
        "started_at": _isoformat(_EPOCH + timedelta(milliseconds=started_offset_ms)),
        "duration_ms": duration_ms,
        "operation_name": operation_name,
        "span_name": span_name,
        "span_kind": span_kind,
        "status_code": status_code,
        "status_message": status_message,
        "service_name": service_name,
        "gen_ai_system": gen_ai_system,
        "request_model": request_model,
        "response_model": response_model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "finish_reasons": finish_reasons,
        "input_messages": input_messages,
        "output_messages": output_messages,
        "attributes": attributes or {},
    }


def make_llm_span(
    *,
    span_id: str = "llm-1",
    parent_span_id: str = "",
    started_offset_ms: int = 0,
    duration_ms: float = 100.0,
    request_model: str = "gpt-4o-mini",
    user_prompt: Optional[str] = None,
    assistant_reply: Optional[str] = None,
    finish_reasons: str = "stop",
    input_tokens: int = 50,
    output_tokens: int = 30,
    status_code: int = 0,
    status_message: str = "",
) -> dict[str, Any]:
    """LLM span with OTel GenAI `gen_ai.input.messages` / `gen_ai.output.messages`."""
    import json
    input_msgs = ""
    output_msgs = ""
    if user_prompt is not None:
        input_msgs = json.dumps([{"role": "user", "content": user_prompt}])
    if assistant_reply is not None:
        output_msgs = json.dumps([{"role": "assistant", "content": assistant_reply}])
    return make_span(
        span_id=span_id,
        parent_span_id=parent_span_id,
        started_offset_ms=started_offset_ms,
        duration_ms=duration_ms,
        operation_name="chat",
        span_name="chat gpt-4o-mini",
        request_model=request_model,
        response_model=request_model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        finish_reasons=finish_reasons,
        input_messages=input_msgs,
        output_messages=output_msgs,
        status_code=status_code,
        status_message=status_message,
    )


def make_tool_span(
    *,
    span_id: str = "tool-1",
    parent_span_id: str = "llm-1",
    started_offset_ms: int = 200,
    duration_ms: float = 50.0,
    tool_name: Optional[str] = "get_weather",
    fallback_span_name: Optional[str] = None,
    status_code: int = 0,
) -> dict[str, Any]:
    """Tool span. If `tool_name` is given, sets `gen_ai.tool.name`; otherwise
    leaves the attribute off so the span_name fallback kicks in."""
    attrs: dict[str, Any] = {}
    if tool_name is not None:
        attrs["gen_ai.tool.name"] = tool_name
    span_name = fallback_span_name or (f"execute_tool {tool_name}" if tool_name else "execute_tool")
    return make_span(
        span_id=span_id,
        parent_span_id=parent_span_id,
        started_offset_ms=started_offset_ms,
        duration_ms=duration_ms,
        operation_name="execute_tool",
        span_name=span_name,
        attributes=attrs,
        status_code=status_code,
    )


def make_retriever_span(
    *,
    span_id: str = "ret-1",
    parent_span_id: str = "llm-1",
    started_offset_ms: int = 50,
    duration_ms: float = 30.0,
    db_collection: Optional[str] = "weather-kb",
    fallback_span_name: str = "vector_search",
) -> dict[str, Any]:
    attrs: dict[str, Any] = {}
    if db_collection is not None:
        attrs["db.collection.name"] = db_collection
    return make_span(
        span_id=span_id,
        parent_span_id=parent_span_id,
        started_offset_ms=started_offset_ms,
        duration_ms=duration_ms,
        operation_name="",
        span_name=fallback_span_name,
        attributes=attrs,
    )


def make_guardrail_span(
    *,
    span_id: str = "gr-1",
    parent_span_id: str = "llm-1",
    started_offset_ms: int = 10,
    duration_ms: float = 5.0,
    name: str = "safety_check",
    triggered_attr: Optional[bool] = None,
    status_code: int = 0,
) -> dict[str, Any]:
    attrs: dict[str, Any] = {}
    if triggered_attr is not None:
        attrs["guardrail.triggered"] = "true" if triggered_attr else "false"
    return make_span(
        span_id=span_id,
        parent_span_id=parent_span_id,
        started_offset_ms=started_offset_ms,
        duration_ms=duration_ms,
        operation_name="",
        span_name=name,
        attributes=attrs,
        status_code=status_code,
    )


@pytest.fixture
def happy_path_trace() -> list[dict[str, Any]]:
    """Root LLM → tool → final assistant reply on the root."""
    root = make_llm_span(
        span_id="root",
        parent_span_id="",
        started_offset_ms=0,
        duration_ms=500.0,
        user_prompt="What's the weather in Berlin?",
        assistant_reply="The forecast for Berlin is sunny.",
        input_tokens=80,
        output_tokens=20,
    )
    tool = make_tool_span(
        span_id="tool-1",
        parent_span_id="root",
        started_offset_ms=100,
        duration_ms=50.0,
        tool_name="get_weather",
    )
    return [root, tool]
