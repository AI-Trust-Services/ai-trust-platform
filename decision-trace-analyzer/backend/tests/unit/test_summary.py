"""Unit tests for the decision summary analyzer."""
from __future__ import annotations

import json

from app.summary import (
    FINAL_ANSWER_MAX_CHARS,
    FLAG_INSTRUMENTATION_GAP,
    FLAG_NEAR_CONTEXT_LIMIT,
    FLAG_RETRY_LOOP,
    FLAG_TOOL_FAILURE,
    FLAG_TRUNCATED_OUTPUT,
    GOAL_MAX_CHARS,
    aggregate_guardrails,
    aggregate_retrievals,
    aggregate_tools,
    build_summary,
    classify_kind,
    classify_outcome,
    compute_flags,
    compute_metrics,
    extract_decision_path,
    extract_final_answer,
    extract_goal,
    models_used,
)
from tests.unit.conftest import (
    make_guardrail_span,
    make_llm_span,
    make_retriever_span,
    make_span,
    make_tool_span,
)


# --- classify_kind -----------------------------------------------------------

class TestClassifyKind:
    def test_otel_execute_tool(self):
        assert classify_kind(make_span(operation_name="execute_tool")) == "tool"

    def test_otel_chat(self):
        assert classify_kind(make_span(operation_name="chat")) == "llm"

    def test_otel_invoke_agent(self):
        assert classify_kind(make_span(operation_name="invoke_agent")) == "agent"

    def test_openinference_fallback(self):
        s = make_span(operation_name="", span_name="something",
                      attributes={"openinference.span.kind": "TOOL"})
        assert classify_kind(s) == "tool"

    def test_name_heuristic_retriever(self):
        s = make_span(operation_name="", span_name="vector_search top-5")
        assert classify_kind(s) == "retriever"

    def test_name_heuristic_guardrail(self):
        s = make_span(operation_name="", span_name="safety_check")
        assert classify_kind(s) == "guardrail"

    def test_reranker_wins_over_retriever(self):
        # If span_name mentions both, reranker (more specific) should match first.
        s = make_span(operation_name="", span_name="rerank_retrieved_docs")
        assert classify_kind(s) == "reranker"

    def test_other_default(self):
        assert classify_kind(make_span(operation_name="", span_name="parser_run")) == "other"


# --- extract_goal ------------------------------------------------------------

class TestExtractGoal:
    def test_root_input_user_message(self):
        root = make_llm_span(user_prompt="What's the weather in Berlin?", assistant_reply="Hi")
        goal, trunc = extract_goal([root])
        assert goal == "What's the weather in Berlin?"
        assert trunc is False

    def test_picks_last_user_message_among_history(self):
        root = make_span(
            span_id="r", parent_span_id="", operation_name="chat", span_name="chat",
            input_messages=json.dumps([
                {"role": "system", "content": "You are helpful."},
                {"role": "user", "content": "Hi"},
                {"role": "assistant", "content": "Hello"},
                {"role": "user", "content": "Now tell me a joke."},
            ]),
        )
        goal, _ = extract_goal([root])
        assert goal == "Now tell me a joke."

    def test_fallback_to_llm_span_when_root_empty(self):
        root = make_span(span_id="root", parent_span_id="",
                         operation_name="invoke_agent", span_name="agent")
        llm = make_llm_span(span_id="llm-1", parent_span_id="root",
                            started_offset_ms=10, user_prompt="ping")
        goal, _ = extract_goal([root, llm])
        assert goal == "ping"

    def test_none_when_no_content_captured(self):
        root = make_span(span_id="root", parent_span_id="",
                         operation_name="invoke_agent", span_name="agent")
        goal, trunc = extract_goal([root])
        assert goal is None
        assert trunc is False

    def test_truncates_long_input(self):
        long = "x" * (GOAL_MAX_CHARS + 50)
        root = make_llm_span(user_prompt=long)
        goal, trunc = extract_goal([root])
        assert trunc is True
        assert goal is not None
        assert len(goal) == GOAL_MAX_CHARS
        assert goal.endswith("…")

    def test_openinference_numbered_attributes(self):
        # LangChain encoding: llm.input_messages.<n>.message.{role,content}
        s = make_span(
            span_id="root", parent_span_id="", operation_name="chat", span_name="chat",
            attributes={
                "llm.input_messages.0.message.role": "system",
                "llm.input_messages.0.message.content": "you are helpful",
                "llm.input_messages.1.message.role": "user",
                "llm.input_messages.1.message.content": "what's up?",
            },
        )
        goal, _ = extract_goal([s])
        assert goal == "what's up?"

    def test_parts_array_encoding(self):
        # Vertex AI / Ollama emit `parts: [{type, content}]` rather than
        # `content` directly. Real ClickHouse traces use this shape — must work.
        s = make_span(
            span_id="root", parent_span_id="", operation_name="chat", span_name="chat",
            input_messages=json.dumps([{
                "role": "user",
                "parts": [{"type": "text", "content": "Tell me about RAG."}],
            }]),
        )
        goal, _ = extract_goal([s])
        assert goal == "Tell me about RAG."

    def test_content_array_with_text_field(self):
        # Anthropic / OpenAI tool-use encoding: `content` array with text/tool_use parts.
        s = make_span(
            span_id="root", parent_span_id="", operation_name="chat", span_name="chat",
            input_messages=json.dumps([{
                "role": "user",
                "content": [
                    {"type": "text", "text": "What's the weather?"},
                    {"type": "tool_use", "name": "get_weather"},  # ignored
                ],
            }]),
        )
        goal, _ = extract_goal([s])
        assert goal == "What's the weather?"


# --- extract_final_answer ----------------------------------------------------

class TestExtractFinalAnswer:
    def test_root_output(self):
        root = make_llm_span(assistant_reply="Sunny.")
        ans, trunc = extract_final_answer([root])
        assert ans == "Sunny."
        assert trunc is False

    def test_fallback_to_last_llm(self):
        root = make_span(span_id="root", parent_span_id="",
                         operation_name="invoke_agent", span_name="agent")
        early_llm = make_llm_span(span_id="llm-1", parent_span_id="root",
                                  started_offset_ms=10, assistant_reply="thinking…")
        later_llm = make_llm_span(span_id="llm-2", parent_span_id="root",
                                  started_offset_ms=200, assistant_reply="Final answer.")
        ans, _ = extract_final_answer([root, early_llm, later_llm])
        assert ans == "Final answer."

    def test_none_when_nothing_captured(self):
        root = make_span(span_id="root", parent_span_id="",
                         operation_name="invoke_agent", span_name="agent")
        ans, _ = extract_final_answer([root])
        assert ans is None

    def test_truncates_long_output(self):
        long = "y" * (FINAL_ANSWER_MAX_CHARS + 100)
        root = make_llm_span(assistant_reply=long)
        ans, trunc = extract_final_answer([root])
        assert trunc is True
        assert ans is not None
        assert len(ans) == FINAL_ANSWER_MAX_CHARS
        assert ans.endswith("…")

    def test_multipart_text_joined(self):
        root = make_span(
            span_id="root", parent_span_id="", operation_name="chat", span_name="chat",
            output_messages=json.dumps([{
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "First."},
                    {"type": "tool_use", "name": "x"},  # ignored
                    {"type": "text", "text": "Second."},
                ],
            }]),
        )
        ans, _ = extract_final_answer([root])
        assert ans == "First.\nSecond."


# --- classify_outcome --------------------------------------------------------

class TestClassifyOutcome:
    def test_answered_happy_path(self, happy_path_trace):
        outcome, reason, heur = classify_outcome(happy_path_trace)
        assert outcome == "answered"
        assert heur is False
        assert "Completed" in reason

    def test_errored_when_root_failed(self):
        root = make_llm_span(status_code=2, status_message="upstream 500",
                             user_prompt="hi", assistant_reply=None)
        outcome, reason, heur = classify_outcome([root])
        assert outcome == "errored"
        assert "upstream 500" in reason
        assert heur is False

    def test_errored_when_llm_failed_no_status_message(self):
        # Root agent OK, but child LLM errored — outcome should still be errored.
        root = make_span(span_id="root", parent_span_id="",
                         operation_name="invoke_agent", span_name="agent",
                         status_code=0)
        llm = make_llm_span(span_id="llm", parent_span_id="root",
                            status_code=2, status_message="")
        outcome, reason, _ = classify_outcome([root, llm])
        assert outcome == "errored"
        assert "failed" in reason.lower()

    def test_refused_via_explicit_guardrail_attribute(self):
        root = make_llm_span(span_id="root", parent_span_id="",
                             user_prompt="something bad", assistant_reply=None)
        gr = make_guardrail_span(span_id="gr", parent_span_id="root",
                                 triggered_attr=True, status_code=0,
                                 name="safety_check")
        outcome, reason, heur = classify_outcome([root, gr])
        assert outcome == "refused"
        assert heur is False
        assert "safety_check" in reason

    def test_refused_via_heuristic_status_error(self):
        # Guardrail span errored without explicit attribute — heuristic kicks in.
        root = make_llm_span(span_id="root", parent_span_id="",
                             user_prompt="x", assistant_reply=None)
        gr = make_guardrail_span(span_id="gr", parent_span_id="root",
                                 triggered_attr=None, status_code=2,
                                 name="moderation")
        outcome, reason, heur = classify_outcome([root, gr])
        assert outcome == "refused"
        assert heur is True
        assert "(heuristic)" in reason

    def test_refused_via_content_filter_finish_reason(self):
        root = make_llm_span(span_id="root", parent_span_id="",
                             user_prompt="hi", assistant_reply="(blocked)",
                             finish_reasons="content_filter")
        outcome, reason, heur = classify_outcome([root])
        assert outcome == "refused"
        assert heur is False
        assert "content_filter" in reason

    def test_partial_on_length_truncation(self):
        root = make_llm_span(span_id="root", parent_span_id="",
                             user_prompt="long story please",
                             assistant_reply="Once upon a time…",
                             finish_reasons="length")
        outcome, reason, _ = classify_outcome([root])
        assert outcome == "partial"
        assert "truncated" in reason.lower()

    def test_partial_when_finish_reason_in_attribute_singular(self):
        # Real-world span: finish_reasons column empty, but the singular
        # `gen_ai.response.finish_reason` attribute carries the value.
        root = make_span(
            span_id="root", parent_span_id="", operation_name="chat", span_name="chat",
            input_messages=json.dumps([{"role": "user", "content": "hi"}]),
            output_messages=json.dumps([{"role": "assistant", "content": "ok"}]),
            finish_reasons="",
            attributes={"gen_ai.response.finish_reason": "length"},
        )
        outcome, _, _ = classify_outcome([root])
        assert outcome == "partial"

    def test_refused_when_finish_reasons_is_json_array(self):
        # OTel GenAI semconv: finish_reasons is string[]. The consumer
        # serialises OTLP arrayValue as a JSON-array string (see consumer
        # `_extract_attr` arrayValue branch). The summary parser must read
        # it as a list — splitting it as free text would still work for the
        # single-element case but breaks once the model returns multiple
        # tokens (e.g. ["content_filter","stop"]).
        root = make_span(
            span_id="root", parent_span_id="", operation_name="chat", span_name="chat",
            input_messages=json.dumps([{"role": "user", "content": "hi"}]),
            output_messages=json.dumps([{"role": "assistant", "content": "ok"}]),
            finish_reasons='["content_filter", "stop"]',
        )
        outcome, _, _ = classify_outcome([root])
        assert outcome == "refused"

    def test_partial_when_finish_reasons_json_array_contains_length(self):
        root = make_span(
            span_id="root", parent_span_id="", operation_name="chat", span_name="chat",
            input_messages=json.dumps([{"role": "user", "content": "hi"}]),
            output_messages=json.dumps([{"role": "assistant", "content": "partial"}]),
            finish_reasons='["length"]',
        )
        outcome, _, _ = classify_outcome([root])
        assert outcome == "partial"

    def test_partial_when_tool_errored_but_trace_continued(self):
        # Tool errored but the root LLM did NOT recover with a final answer.
        # Without a delivered response the trace is partial.
        root = make_span(
            span_id="root", parent_span_id="", operation_name="invoke_agent",
            span_name="agent", finish_reasons="stop",
            input_messages=json.dumps([{"role": "user", "content": "hi"}]),
            output_messages="",
        )
        bad_tool = make_tool_span(span_id="t", parent_span_id="root",
                                  tool_name="get_weather", status_code=2)
        outcome, reason, _ = classify_outcome([root, bad_tool])
        assert outcome == "partial"
        assert "get_weather" in reason

    def test_answered_when_tool_errored_but_trace_recovered(self):
        # Tool errored, but the root LLM still produced an assistant reply —
        # the agent recovered. The audit-friendly outcome is "answered", not
        # "partial": the system delivered a response, the user got an answer.
        root = make_llm_span(span_id="root", parent_span_id="",
                             user_prompt="hi", assistant_reply="best-effort answer",
                             finish_reasons="stop")
        bad_tool = make_tool_span(span_id="t", parent_span_id="root",
                                  tool_name="get_weather", status_code=2)
        outcome, _, _ = classify_outcome([root, bad_tool])
        assert outcome == "answered"

    def test_unknown_when_no_output_captured(self):
        root = make_span(span_id="root", parent_span_id="",
                         operation_name="invoke_agent", span_name="agent",
                         status_code=0)
        outcome, _, _ = classify_outcome([root])
        assert outcome == "unknown"

    def test_unknown_for_empty_trace(self):
        outcome, _, _ = classify_outcome([])
        assert outcome == "unknown"

    def test_errored_takes_precedence_over_refused(self):
        # Both a status_code=2 root AND a triggered guardrail — errored wins.
        root = make_llm_span(status_code=2, status_message="boom",
                             user_prompt="x", assistant_reply=None)
        gr = make_guardrail_span(parent_span_id="root", triggered_attr=True)
        outcome, _, _ = classify_outcome([root, gr])
        assert outcome == "errored"


# --- aggregate_tools ---------------------------------------------------------

class TestAggregateTools:
    def test_single_tool(self):
        spans = [make_tool_span(tool_name="get_weather")]
        result = aggregate_tools(spans)
        assert len(result) == 1
        assert result[0].name == "get_weather"
        assert result[0].calls == 1
        assert result[0].errors == 0

    def test_multiple_calls_same_tool(self):
        spans = [
            make_tool_span(span_id="t1", tool_name="x", started_offset_ms=0),
            make_tool_span(span_id="t2", tool_name="x", started_offset_ms=100),
        ]
        result = aggregate_tools(spans)
        assert len(result) == 1
        assert result[0].calls == 2

    def test_mixed_with_error_count(self):
        spans = [
            make_tool_span(span_id="t1", tool_name="get_weather", status_code=0),
            make_tool_span(span_id="t2", tool_name="get_weather", status_code=2,
                           started_offset_ms=100),
        ]
        result = aggregate_tools(spans)
        assert result[0].calls == 2
        assert result[0].errors == 1

    def test_span_name_fallback_strips_op_prefix(self):
        # No gen_ai.tool.name attribute → span_name "execute_tool get_weather"
        # should be stripped to "get_weather".
        spans = [make_tool_span(tool_name=None,
                                fallback_span_name="execute_tool get_weather")]
        result = aggregate_tools(spans)
        assert result[0].name == "get_weather"

    def test_alphabetical_sort(self):
        spans = [
            make_tool_span(span_id="t1", tool_name="zeta"),
            make_tool_span(span_id="t2", tool_name="alpha", started_offset_ms=100),
        ]
        result = aggregate_tools(spans)
        assert [r.name for r in result] == ["alpha", "zeta"]


# --- aggregate_retrievals ----------------------------------------------------

class TestAggregateRetrievals:
    def test_db_collection_name_used(self):
        spans = [make_retriever_span(db_collection="weather-kb")]
        result = aggregate_retrievals(spans)
        assert result[0].name == "weather-kb"
        assert result[0].calls == 1

    def test_span_name_fallback(self):
        spans = [make_retriever_span(db_collection=None, fallback_span_name="vector_search")]
        result = aggregate_retrievals(spans)
        assert result[0].name == "vector_search"


# --- aggregate_guardrails ----------------------------------------------------

class TestAggregateGuardrails:
    def test_explicit_triggered_attribute(self):
        spans = [make_guardrail_span(triggered_attr=True, name="safety_check")]
        result = aggregate_guardrails(spans)
        assert result[0].triggered is True

    def test_heuristic_via_status_error(self):
        spans = [make_guardrail_span(triggered_attr=None, status_code=2)]
        result = aggregate_guardrails(spans)
        assert result[0].triggered is True

    def test_not_triggered_when_ok_and_no_attribute(self):
        spans = [make_guardrail_span(triggered_attr=None, status_code=0)]
        result = aggregate_guardrails(spans)
        assert result[0].triggered is False


# --- compute_metrics ---------------------------------------------------------

class TestComputeMetrics:
    def test_basic_aggregates(self, happy_path_trace):
        m = compute_metrics(happy_path_trace)
        assert m.span_count == 2
        assert m.error_count == 0
        # Happy-path: 80 input + 20 output on the root, 0 on tool
        assert m.total_tokens == 100
        # Root started at 0ms with 500ms duration → trace duration 500ms.
        assert m.duration_ms == 500

    def test_empty_spans(self):
        m = compute_metrics([])
        assert m.span_count == 0
        assert m.total_tokens == 0
        assert m.duration_ms == 0
        assert m.error_count == 0


# --- models_used -------------------------------------------------------------

def test_models_used_deduplicates_and_sorts():
    spans = [
        make_llm_span(span_id="a", request_model="gpt-4o"),
        make_llm_span(span_id="b", request_model="gpt-4o", started_offset_ms=100),
        make_llm_span(span_id="c", request_model="claude-3.5", started_offset_ms=200),
    ]
    assert models_used(spans) == ["claude-3.5", "gpt-4o"]


# --- build_summary (end-to-end) ---------------------------------------------

class TestBuildSummary:
    def test_happy_path_record(self, happy_path_trace):
        rec = build_summary(happy_path_trace)
        assert rec.outcome == "answered"
        assert rec.goal == "What's the weather in Berlin?"
        assert rec.final_answer == "The forecast for Berlin is sunny."
        assert rec.goal_truncated is False
        assert rec.final_answer_truncated is False
        assert rec.outcome_reason_heuristic is False
        assert "gpt-4o-mini" in rec.models_used
        assert len(rec.tools_used) == 1
        assert rec.tools_used[0].name == "get_weather"
        assert rec.metrics.span_count == 2
        # Decision path: root LLM → tool
        assert len(rec.decision_path) == 2
        assert rec.decision_path[0].kind == "llm"
        assert rec.decision_path[1].kind == "tool"
        assert rec.decision_path[1].name == "get_weather"

    def test_empty_content_yields_nulls_but_full_record(self):
        # Agent root + tool + retriever, none with content capture
        root = make_span(span_id="root", parent_span_id="",
                         operation_name="invoke_agent", span_name="agent")
        tool = make_tool_span(span_id="t", parent_span_id="root", tool_name="search")
        ret = make_retriever_span(span_id="r", parent_span_id="root",
                                  db_collection="kb", started_offset_ms=10)
        rec = build_summary([root, tool, ret])
        # Content extraction nulled out by design — InstrumentationGapBanner trigger.
        assert rec.goal is None
        assert rec.final_answer is None
        # But aggregates ARE present (they don't depend on message content)
        assert rec.tools_used[0].name == "search"
        assert rec.retrievals[0].name == "kb"
        assert rec.metrics.span_count == 3
        # Instrumentation gap flag should fire
        assert any(f.id == FLAG_INSTRUMENTATION_GAP for f in rec.flags)


# --- extract_decision_path --------------------------------------------------

class TestExtractDecisionPath:
    def test_orders_by_started_at(self):
        # A retriever ran first, then the agent root reflected on it, then a tool.
        # The path must respect started_at, not span id order.
        ret = make_retriever_span(span_id="r", parent_span_id="root",
                                  db_collection="kb", started_offset_ms=10)
        root = make_llm_span(span_id="root", parent_span_id="",
                             user_prompt="hi", assistant_reply="ok",
                             started_offset_ms=0)
        tool = make_tool_span(span_id="t", parent_span_id="root",
                              tool_name="get_weather", started_offset_ms=200)
        path = extract_decision_path([ret, root, tool])  # unsorted on purpose
        assert [(s.kind, s.name) for s in path] == [
            ("llm", "chat gpt-4o-mini"),
            ("retriever", "kb"),
            ("tool", "get_weather"),
        ]

    def test_collapses_consecutive_duplicates(self):
        # Two ChatOllama spans in a row collapse into one step with count=2.
        s1 = make_llm_span(span_id="a", parent_span_id="", started_offset_ms=0,
                           request_model="llama3", user_prompt="hi",
                           assistant_reply="thinking")
        s2 = make_llm_span(span_id="b", parent_span_id="a", started_offset_ms=10,
                           request_model="llama3", assistant_reply="more")
        path = extract_decision_path([s1, s2])
        assert len(path) == 1
        assert path[0].count == 2

    def test_skips_plumbing(self):
        # LangChain plumbing names must not appear in the path.
        plumb = make_span(span_id="p", parent_span_id="", started_offset_ms=0,
                          operation_name="", span_name="RunnableSequence")
        plumb2 = make_span(span_id="p2", parent_span_id="p", started_offset_ms=5,
                           operation_name="", span_name="RunnableAssign<scratchpad>")
        llm = make_llm_span(span_id="l", parent_span_id="p", started_offset_ms=10,
                            user_prompt="x", assistant_reply="y")
        path = extract_decision_path([plumb, plumb2, llm])
        assert [s.name for s in path] == ["chat gpt-4o-mini"]

    def test_drops_other_and_embedding_kinds(self):
        llm = make_llm_span(span_id="l", parent_span_id="", started_offset_ms=0,
                            user_prompt="x", assistant_reply="y")
        embed = make_span(span_id="e", parent_span_id="l", started_offset_ms=5,
                          operation_name="embeddings", span_name="embed_query")
        other = make_span(span_id="o", parent_span_id="l", started_offset_ms=10,
                          operation_name="", span_name="some_parser")
        path = extract_decision_path([llm, embed, other])
        assert [(s.kind, s.name) for s in path] == [("llm", "chat gpt-4o-mini")]

    def test_includes_agent_root(self):
        # Agent root span counts as a step — it's a decision boundary.
        root = make_span(span_id="root", parent_span_id="", started_offset_ms=0,
                         operation_name="invoke_agent", span_name="agent.session")
        llm = make_llm_span(span_id="l", parent_span_id="root", started_offset_ms=10,
                            user_prompt="x", assistant_reply="y")
        path = extract_decision_path([root, llm])
        assert [(s.kind, s.name) for s in path] == [
            ("agent", "agent.session"),
            ("llm", "chat gpt-4o-mini"),
        ]

    def test_empty_for_no_spans(self):
        assert extract_decision_path([]) == []


# --- compute_flags ----------------------------------------------------------

class TestFlags:
    # tool_failure

    def test_tool_failure_lists_failed_tools(self):
        root = make_llm_span(span_id="root", parent_span_id="",
                             user_prompt="x", assistant_reply="y",
                             finish_reasons="stop")
        bad = make_tool_span(span_id="t1", parent_span_id="root",
                             tool_name="get_weather", status_code=2)
        flags = compute_flags([root, bad], goal="x", final_answer="y")
        flag = next(f for f in flags if f.id == FLAG_TOOL_FAILURE)
        assert "get_weather" in flag.detail
        assert flag.severity == "warning"

    # retry_loop

    def test_retry_loop_when_same_tool_fires_four_times(self):
        root = make_llm_span(span_id="root", parent_span_id="",
                             user_prompt="x", assistant_reply="y")
        tools = [
            make_tool_span(span_id=f"t{i}", parent_span_id="root",
                           tool_name="get_weather",
                           started_offset_ms=100 * (i + 1))
            for i in range(4)
        ]
        flags = compute_flags([root, *tools], goal="x", final_answer="y")
        assert any(f.id == FLAG_RETRY_LOOP for f in flags)

    def test_retry_loop_silent_for_three_calls(self):
        # Threshold is "> 3" — exactly 3 is fine (call → observe → retry pattern).
        root = make_llm_span(span_id="root", parent_span_id="",
                             user_prompt="x", assistant_reply="y")
        tools = [
            make_tool_span(span_id=f"t{i}", parent_span_id="root",
                           tool_name="search",
                           started_offset_ms=100 * (i + 1))
            for i in range(3)
        ]
        flags = compute_flags([root, *tools], goal="x", final_answer="y")
        assert all(f.id != FLAG_RETRY_LOOP for f in flags)

    # truncated_output

    def test_truncated_output_flag_on_length_finish_reason(self):
        root = make_llm_span(span_id="root", parent_span_id="",
                             user_prompt="long story",
                             assistant_reply="Once upon a time…",
                             finish_reasons="length")
        flags = compute_flags([root], goal="long story",
                              final_answer="Once upon a time…")
        assert any(f.id == FLAG_TRUNCATED_OUTPUT for f in flags)

    # near_context_limit

    def test_near_context_limit_when_input_above_80_percent(self):
        root = make_llm_span(span_id="root", parent_span_id="",
                             user_prompt="x", assistant_reply="y",
                             input_tokens=900)
        root["attributes"] = {"gen_ai.request.max_tokens": "1000"}
        flags = compute_flags([root], goal="x", final_answer="y")
        flag = next(f for f in flags if f.id == FLAG_NEAR_CONTEXT_LIMIT)
        assert flag.severity == "info"

    def test_near_context_limit_silent_below_threshold(self):
        root = make_llm_span(span_id="root", parent_span_id="",
                             user_prompt="x", assistant_reply="y",
                             input_tokens=400)
        root["attributes"] = {"gen_ai.request.max_tokens": "1000"}
        flags = compute_flags([root], goal="x", final_answer="y")
        assert all(f.id != FLAG_NEAR_CONTEXT_LIMIT for f in flags)

    def test_near_context_limit_silent_without_max_tokens(self):
        # No max_tokens attribute → can't compute → no flag, even with huge input.
        root = make_llm_span(span_id="root", parent_span_id="",
                             user_prompt="x", assistant_reply="y",
                             input_tokens=50_000)
        flags = compute_flags([root], goal="x", final_answer="y")
        assert all(f.id != FLAG_NEAR_CONTEXT_LIMIT for f in flags)

    # instrumentation_gap

    def test_instrumentation_gap_when_both_null(self):
        root = make_span(span_id="root", parent_span_id="",
                         operation_name="invoke_agent", span_name="agent")
        flags = compute_flags([root], goal=None, final_answer=None)
        assert any(f.id == FLAG_INSTRUMENTATION_GAP for f in flags)

    def test_instrumentation_gap_silent_when_partial_capture(self):
        # Only goal captured (no answer) → still not a full gap, no flag.
        root = make_span(span_id="root", parent_span_id="",
                         operation_name="invoke_agent", span_name="agent")
        flags = compute_flags([root], goal="hello", final_answer=None)
        assert all(f.id != FLAG_INSTRUMENTATION_GAP for f in flags)


# --- end --------------------------------------------------------------------
