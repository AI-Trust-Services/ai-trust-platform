"""Decision Summary v1 — deterministic trace summarisation.

Builds a structured DecisionRecord from a list of spans (already loaded by
`routers/traces.py`). Pure Python, no I/O, no DB — testable in isolation.

The record answers, for a Compliance Officer:
  - goal: what the user asked
  - outcome: did the system answer / refuse / partially answer / error
  - outcome_reason: one sentence justifying the classification (with a
    `_heuristic` flag when the classification fell back to status_code=2)
  - final_answer: the assistant's last response
  - tools_used / retrievals / guardrails: aggregated calls per name
  - metrics: duration / tokens / span / error counts

Conventions:
  - Name extraction is OTel GenAI-semconv-first (gen_ai.tool.name, then
    span_name with the operation_name prefix stripped). OpenInference attrs
    are intentionally NOT first-class here so the layer stays portable.
  - Span classification (classify_kind) does read openinference.span.kind so
    legacy LangChain traces still light up — extraction vs. classification
    are decoupled.

Module is intentionally one file; mirrors `ai-system-registry/backend/app/classifier.py`.
"""
from __future__ import annotations

import json
import re
from typing import Any, Iterable, Literal, Optional

from pydantic import BaseModel, Field

# --- Truncation limits (chars) ----------------------------------------------

GOAL_MAX_CHARS = 300
FINAL_ANSWER_MAX_CHARS = 1000

# OTel SpanStatusCode — 2 == ERROR. 0 (UNSET) and 1 (OK) both mean "not errored".
STATUS_ERROR = 2


# --- Pydantic schemas (response shape) --------------------------------------

Outcome = Literal["answered", "refused", "partial", "errored", "unknown"]


class ToolUsage(BaseModel):
    name: str
    calls: int
    errors: int


class RetrievalUsage(BaseModel):
    name: str
    calls: int


class GuardrailUsage(BaseModel):
    name: str
    triggered: bool


class Metrics(BaseModel):
    duration_ms: int
    total_tokens: int
    span_count: int
    error_count: int


class DecisionStep(BaseModel):
    """One step in the trace's decision path — a single non-plumbing operation
    in execution order. Multiple consecutive spans with the same name collapse
    into one step (`count`); this is the same de-duplication ConversationGraph
    does on the frontend, so the two surfaces tell the same story."""
    kind: str                       # llm | tool | retriever | reranker | guardrail | agent | other
    name: str                       # tool/retriever/guardrail name, or span_name
    count: int = 1                  # number of contiguous spans collapsed
    detail: Optional[str] = None    # short context (tool args snippet, etc.) — optional


# --- Flag taxonomy -----------------------------------------------------------

# Flag IDs are stable strings; the frontend matches on them to choose the icon
# / colour. Severity is rendered as the badge tint (warning vs. info).
class DecisionFlag(BaseModel):
    id: str                          # stable id, see _FLAG_* constants below
    severity: Literal["info", "warning"]
    label: str                       # short UI label
    detail: str                      # one-sentence explanation

FLAG_TRUNCATED_OUTPUT = "truncated_output"
FLAG_TOOL_FAILURE = "tool_failure"
FLAG_RETRY_LOOP = "retry_loop"
FLAG_NEAR_CONTEXT_LIMIT = "near_context_limit"
FLAG_INSTRUMENTATION_GAP = "instrumentation_gap"


class DecisionRecord(BaseModel):
    goal: Optional[str]
    goal_truncated: bool = False
    outcome: Outcome
    outcome_reason: str
    outcome_reason_heuristic: bool = False
    final_answer: Optional[str]
    final_answer_truncated: bool = False
    decision_path: list[DecisionStep] = Field(default_factory=list)
    flags: list[DecisionFlag] = Field(default_factory=list)
    models_used: list[str] = Field(default_factory=list)
    tools_used: list[ToolUsage] = Field(default_factory=list)
    retrievals: list[RetrievalUsage] = Field(default_factory=list)
    guardrails: list[GuardrailUsage] = Field(default_factory=list)
    metrics: Metrics


# --- Plumbing taxonomy -------------------------------------------------------

# Span names that LangChain emits as framework internals — they wrap every
# real operation and would otherwise dominate the decision_path. Mirrors
# `frontend/src/lib/conversationFlow.ts:PLUMBING_SPAN_NAMES` so backend +
# ConversationGraph stay in sync.
_PLUMBING_SPAN_NAMES = {
    "RunnableSequence",
    "RunnableLambda",
    "ChatPromptTemplate",
    "ToolsAgentOutputParser",
}
_PLUMBING_PREFIXES = ("RunnableParallel", "RunnableAssign")


def _is_plumbing(span: Span) -> bool:
    name = span.get("span_name") or ""
    if name in _PLUMBING_SPAN_NAMES:
        return True
    return any(name.startswith(p) for p in _PLUMBING_PREFIXES)


# --- Per-invocation memoisation ---------------------------------------------

class _SpanCache:
    """Per-`build_summary` cache of the two expensive per-span derivations.

    `classify_kind` runs up to 8 regex checks per span and is called from
    ~13 different code paths (path extraction, flags, aggregates, outcome …);
    without a cache the same regex work happens 13× per trace. Same shape for
    `_is_plumbing`, which walks two constant tuples per call.

    Keyed by `id(span)` because Span is `dict[str, Any]` (unhashable). Safe
    for the lifetime of one `build_summary` call: the docstring promises no
    input mutation and we don't reallocate span dicts during the call.

    Internal helpers accept an optional cache — when None they build a
    throw-away one from the given spans, so calling e.g. `extract_decision_path`
    directly (as the unit tests do) still works.
    """

    __slots__ = ("_kind", "_plumb")

    def __init__(self, spans: list["Span"]) -> None:
        self._kind: dict[int, "SpanKind"] = {id(s): classify_kind(s) for s in spans}
        self._plumb: dict[int, bool] = {id(s): _is_plumbing(s) for s in spans}

    def kind(self, span: "Span") -> "SpanKind":
        # Fall back to a live classify_kind call when a span slipped in that
        # wasn't part of the cache-building list (e.g. a caller synthesised
        # a span mid-flow) — cheaper than raising.
        cached = self._kind.get(id(span))
        return cached if cached is not None else classify_kind(span)

    def is_plumbing(self, span: "Span") -> bool:
        cached = self._plumb.get(id(span))
        return cached if cached is not None else _is_plumbing(span)


def _cache_for(spans: list["Span"], cache: Optional["_SpanCache"]) -> "_SpanCache":
    """Return the provided cache, or build a fresh one for standalone helpers."""
    return cache if cache is not None else _SpanCache(spans)


# --- Internal span helper ----------------------------------------------------

# We accept plain dicts (as returned by routers/traces.py) rather than building
# a parallel SpanRow class — keeps the contract close to ClickHouse rows and
# avoids one more place to mirror new columns.
Span = dict[str, Any]

SpanKind = Literal[
    "tool", "llm", "agent", "chain", "retriever",
    "embedding", "reranker", "guardrail", "other",
]


def classify_kind(span: Span) -> SpanKind:
    """Best-effort kind classifier — mirrors frontend `classifySpan` in
    `decision-trace-analyzer/frontend/src/lib/spanAttributes.ts`.

    OTel GenAI operation.name is authoritative; OpenInference span.kind is the
    fallback so LangChain traces still get a useful kind without that
    instrumentation's authors agreeing on OTel semconv.
    """
    op = (span.get("operation_name") or "").lower()
    if op == "execute_tool":
        return "tool"
    if op in ("chat", "text_completion", "generate_content"):
        return "llm"
    if op in ("invoke_agent", "create_agent", "agent"):
        return "agent"
    if op in ("embeddings", "embed"):
        return "embedding"

    attrs = span.get("attributes") or {}
    oi = (attrs.get("openinference.span.kind") or "").lower()
    if oi in ("tool", "llm", "agent", "chain", "retriever", "embedding", "reranker", "guardrail"):
        return oi  # type: ignore[return-value]

    name = f"{op} {(span.get('span_name') or '').lower()}"
    # Patterns use a leading `\b` only — these matchers run against `span_name`
    # which often embeds the term as a prefix (`rerank_retrieved_docs`,
    # `vector_search_top5`, `safety_check_step`). Requiring a trailing `\b`
    # would miss those because `_` counts as a word character. Mirrors the
    # frontend matchers in `lib/spanAttributes.ts`.
    if re.search(r"\b(rerank|cross[-_]?encoder)", name):
        return "reranker"
    if re.search(r"\b(guardrail|moderation|safety[-_]?check|policy[-_]?check)", name):
        return "guardrail"
    if re.search(r"\b(embed|embedding|vectorize)", name):
        return "embedding"
    if re.search(r"\b(retriev|search|vector[-_]?search|knn|bm25)", name):
        return "retriever"
    return "other"


def _strip_op_prefix(span: Span) -> str:
    """Strip the operation_name prefix from a span_name, when present.

    `"execute_tool get_weather"` → `"get_weather"`. This is the natural OTel
    fallback name when a tool span doesn't set `gen_ai.tool.name`. Returns the
    span_name unchanged if the prefix doesn't match.
    """
    name = span.get("span_name") or ""
    op = span.get("operation_name") or ""
    if op and name.startswith(op + " "):
        return name[len(op) + 1:].strip() or name
    return name


def _truncate(text: str, limit: int) -> tuple[str, bool]:
    """Truncate to `limit` chars; appends an ellipsis when cut. Returns
    (text, was_truncated)."""
    if len(text) <= limit:
        return text, False
    # Cap at limit-1 so the ellipsis brings us back exactly to `limit`.
    return text[: max(0, limit - 1)].rstrip() + "…", True


# --- Message extraction ------------------------------------------------------

def _parse_otel_messages(raw: str) -> list[dict[str, Any]]:
    """OTel GenAI semconv stores messages as a JSON array string.

    Returns [] on any parse error — the caller will fall back to OpenInference
    numbered attributes."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    return parsed if isinstance(parsed, list) else []


def _extract_text(content: Any) -> str:
    """Join text parts of a message-content / parts array into a single string.

    OTel GenAI allows `content` as a string, or as an array of parts. Parts
    use a `type` discriminator: `text` parts carry text (under either `text`
    or `content`); `tool_use` / `tool_result` parts are ignored — tool calls
    are surfaced via aggregate fields, not the goal/answer fields.

    Parts WITHOUT an explicit `type` are accepted as text too, because some
    instrumentations (Vertex AI, Ollama) emit `{"type": "text", "content": …}`
    while others emit `{"text": …}` with no type.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out: list[str] = []
        for part in content:
            if not isinstance(part, dict):
                continue
            ptype = (part.get("type") or "text").lower()
            if ptype != "text":
                continue  # tool_use / tool_result etc.
            t = part.get("text") or part.get("content")
            if isinstance(t, str) and t:
                out.append(t)
        return "\n".join(out)
    return ""


def _message_content(msg: dict[str, Any]) -> str:
    """Read the text content of a single OTel-GenAI message dict.

    The semconv allows either a top-level `content` (string or parts array) or
    a top-level `parts` array; instrumentations differ. We accept both.
    Observed in practice:
      - {"role": "user", "content": "hi"}                       (simple)
      - {"role": "user", "content": [{"type": "text", "text": …}]} (Anthropic/OpenAI)
      - {"role": "user", "parts": [{"type": "text", "content": …}]} (Vertex/Ollama)
    """
    if "content" in msg:
        return _extract_text(msg["content"])
    if "parts" in msg:
        return _extract_text(msg["parts"])
    return ""


def _messages_from_span(span: Span, direction: Literal["input", "output"]) -> list[dict[str, str]]:
    """Return [{role, content}, ...] from a span, regardless of instrumentation.

    Order: OTel GenAI JSON first, then OpenInference numbered attributes."""
    # OTel GenAI: dedicated column on the span row
    col_key = f"{direction}_messages"
    parsed = _parse_otel_messages(span.get(col_key) or "")
    if parsed:
        return [
            {"role": str(m.get("role") or ""), "content": _message_content(m)}
            for m in parsed if isinstance(m, dict)
        ]

    # OTel GenAI also lives under attributes when the consumer didn't promote
    # it to its own column (older spans, custom instrumentations).
    attrs = span.get("attributes") or {}
    attr_raw = attrs.get(f"gen_ai.{direction}.messages")
    if attr_raw:
        parsed = _parse_otel_messages(attr_raw)
        if parsed:
            return [
                {"role": str(m.get("role") or ""), "content": _message_content(m)}
                for m in parsed if isinstance(m, dict)
            ]

    # OpenInference numbered fallback — keeps LangChain traces useful even
    # though name extraction stays OTel-pure (extraction vs. parsing decoupled).
    prefix = f"llm.{direction}_messages."
    indices: set[int] = set()
    for k in attrs.keys():
        if not k.startswith(prefix):
            continue
        m = re.match(r"^(\d+)\.", k[len(prefix):])
        if m:
            indices.add(int(m.group(1)))
    if not indices:
        return []
    return [
        {
            "role": str(attrs.get(f"{prefix}{i}.message.role") or ""),
            "content": str(attrs.get(f"{prefix}{i}.message.content") or ""),
        }
        for i in sorted(indices)
    ]


# --- Goal / Final Answer extraction -----------------------------------------

def _root_span(spans: list[Span]) -> Optional[Span]:
    for s in spans:
        if not (s.get("parent_span_id") or ""):
            return s
    return None


def _first_llm(spans: list[Span], cache: _SpanCache) -> Optional[Span]:
    for s in spans:
        if cache.kind(s) == "llm":
            return s
    return None


def _last_llm(spans: list[Span], cache: _SpanCache) -> Optional[Span]:
    for s in reversed(spans):
        if cache.kind(s) == "llm":
            return s
    return None


def extract_goal(spans: list[Span], _cache: Optional[_SpanCache] = None) -> tuple[Optional[str], bool]:
    """Pick the user's question. Root span first; fall back to the first LLM span.
    From the message list, take the LAST `user`-role message — that's the
    current turn, not a prior history entry or the system prompt.

    Returns (text-or-None, truncated). Returns (None, False) when no source
    yields a non-empty user message — caller renders InstrumentationGapBanner.
    """
    cache = _cache_for(spans, _cache)
    for candidate in (_root_span(spans), _first_llm(spans, cache)):
        if not candidate:
            continue
        msgs = _messages_from_span(candidate, "input")
        users = [m for m in msgs if m.get("role", "").lower() == "user" and m.get("content")]
        if not users:
            continue
        return _truncate(users[-1]["content"], GOAL_MAX_CHARS)
    return None, False


def extract_final_answer(spans: list[Span], _cache: Optional[_SpanCache] = None) -> tuple[Optional[str], bool]:
    """Pick the assistant's final answer. Root span output first; fall back to
    the last LLM span's output. Take the last assistant message (multi-turn
    conversations end with an assistant reply)."""
    cache = _cache_for(spans, _cache)
    for candidate in (_root_span(spans), _last_llm(spans, cache)):
        if not candidate:
            continue
        msgs = _messages_from_span(candidate, "output")
        # Some output_messages have role="assistant", some have no role at all
        # (single-message outputs). Accept both — anything with content counts.
        non_empty = [m for m in msgs if m.get("content") and m.get("role", "").lower() != "user"]
        if not non_empty:
            continue
        return _truncate(non_empty[-1]["content"], FINAL_ANSWER_MAX_CHARS)
    return None, False


# --- Outcome classification --------------------------------------------------

# Finish-reason values that explicitly signal a model refusal. OpenAI uses
# `content_filter`; other providers emit `safety`/`refusal`. We match
# case-insensitively and treat any of these as a refusal trigger.
_REFUSAL_FINISH_REASONS = {"content_filter", "safety", "refusal", "policy"}
_TRUNCATION_FINISH_REASONS = {"length", "max_tokens"}


def _finish_reasons(span: Span) -> list[str]:
    """Return finish_reason tokens for a span, regardless of where they were
    stored.

    Sources, in order:
      1. The dedicated `finish_reasons` column (consumer promoted it).
      2. `gen_ai.response.finish_reasons` attribute (plural, semconv).
      3. `gen_ai.response.finish_reason`  attribute (singular, also seen in
         the wild — some libraries don't follow the plural form).

    Returns lowercase tokens. Empty list when nothing set.
    """
    attrs = span.get("attributes") or {}
    raw = (
        span.get("finish_reasons")
        or attrs.get("gen_ai.response.finish_reasons")
        or attrs.get("gen_ai.response.finish_reason")
        or ""
    )
    raw = str(raw).strip()
    if not raw:
        return []
    # The consumer serialises OTLP arrayValue as a JSON array (e.g. '["stop"]')
    # — preferred path since OTel GenAI semconv defines finish_reasons as
    # string[]. Fall back to the free-form splitter for legacy/loose payloads.
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(x).strip().lower() for x in parsed if str(x).strip()]
        except (ValueError, TypeError):
            pass
    raw_lower = raw.lower()
    # finish_reasons stored as free-form text — could be "stop", "stop,length",
    # "['stop']" etc. Split on common separators.
    return [r.strip().strip("'\"[]") for r in re.split(r"[,\s]+", raw_lower) if r.strip()]


def _is_guardrail_triggered(span: Span, cache: _SpanCache) -> tuple[bool, bool]:
    """Hybrid detection: explicit attribute wins, otherwise heuristic on errored
    guardrail spans. Returns (triggered, was_heuristic).

    The heuristic is only consulted for spans we already classified as
    guardrail — we do NOT treat any random errored span as a refusal."""
    attrs = span.get("attributes") or {}
    # Accept the common truthy encodings — apps emit booleans through OTLP as
    # "true"/"false", but some normalise to "1"/"0" or "yes"/"no". Matching too
    # strictly causes refusals to show up as "(heuristic)" when they shouldn't.
    raw = str(attrs.get("guardrail.triggered") or "").strip().lower()
    if raw in {"true", "1", "yes"}:
        return True, False
    if cache.kind(span) == "guardrail" and int(span.get("status_code") or 0) == STATUS_ERROR:
        return True, True
    return False, False


def _root_produced_output(root: Optional[Span], last_llm: Optional[Span]) -> bool:
    """True iff the root span (or the trailing LLM as fallback) emitted an
    assistant message — i.e. the trace actually delivered a response."""
    for s in (root, last_llm):
        if not s:
            continue
        for m in _messages_from_span(s, "output"):
            if m.get("content"):
                return True
    return False


def classify_outcome(spans: list[Span], _cache: Optional[_SpanCache] = None) -> tuple[Outcome, str, bool]:
    """Waterfall — first rule wins.

    Returns (outcome, reason_sentence, heuristic_flag). The flag is True when
    the classification came from a Hybrid fallback (e.g. guardrail span with
    status_code=2 but no explicit `guardrail.triggered` attribute).
    """
    if not spans:
        return "unknown", "No spans in trace.", False

    cache = _cache_for(spans, _cache)
    root = _root_span(spans)
    last_llm = _last_llm(spans, cache)

    # --- 1) errored — root or any LLM/agent span failed
    if root and int(root.get("status_code") or 0) == STATUS_ERROR:
        msg = (root.get("status_message") or "").strip()
        return ("errored",
                f"Trace failed with error: {msg}" if msg else "Trace failed at the root span.",
                False)
    for s in spans:
        kind = cache.kind(s)
        if kind in ("llm", "agent") and int(s.get("status_code") or 0) == STATUS_ERROR:
            msg = (s.get("status_message") or "").strip()
            label = s.get("span_name") or kind
            return ("errored",
                    f"{label} failed: {msg}" if msg else f"{label} failed.",
                    False)

    # --- 2) refused — guardrail trigger (hybrid) or LLM safety finish_reason
    for s in spans:
        triggered, was_heur = _is_guardrail_triggered(s, cache)
        if triggered:
            name = _guardrail_name(s)
            suffix = " (heuristic)" if was_heur else ""
            return ("refused",
                    f"Output blocked by guardrail '{name}'{suffix}.",
                    was_heur)

    if last_llm:
        for reason in _finish_reasons(last_llm):
            if reason in _REFUSAL_FINISH_REASONS:
                return ("refused",
                        f"Model refused: finish_reason={reason}.",
                        False)

    # --- 3) partial — truncation always wins. Tool failures only count as
    # partial when the trace did NOT recover (i.e. the root/last LLM never
    # produced an assistant message). A failed tool followed by a successful
    # retry that yields a final answer is "answered", not "partial".
    if last_llm:
        for reason in _finish_reasons(last_llm):
            if reason in _TRUNCATION_FINISH_REASONS:
                return ("partial",
                        f"Response truncated (finish_reason={reason}).",
                        False)

    has_output = _root_produced_output(root, last_llm)

    if not has_output:
        for s in spans:
            if cache.kind(s) == "tool" and int(s.get("status_code") or 0) == STATUS_ERROR:
                name = _tool_name(s)
                return ("partial",
                        f"Tool '{name}' failed; no final answer produced.",
                        False)

    # --- 4) answered — root finished OK and produced an assistant output
    if root and int(root.get("status_code") or 0) != STATUS_ERROR and has_output:
        return ("answered", "Completed; final response delivered.", False)

    # --- 5) unknown
    return ("unknown",
            "Insufficient telemetry to classify (no errors, no output captured).",
            False)


# --- Name extraction (OTel-GenAI-first) -------------------------------------

def _tool_name(span: Span) -> str:
    attrs = span.get("attributes") or {}
    # OTel GenAI semconv canonical
    name = attrs.get("gen_ai.tool.name")
    if name:
        return name
    # Fallback: span_name with the operation_name prefix stripped
    return _strip_op_prefix(span) or "tool"


def _retriever_name(span: Span) -> str:
    attrs = span.get("attributes") or {}
    # OTel DB semconv — vector DBs commonly populate this
    name = attrs.get("db.collection.name")
    if name:
        return name
    return _strip_op_prefix(span) or "retriever"


def _guardrail_name(span: Span) -> str:
    # No standardised OTel attribute for guardrail names — fall back to span_name.
    return _strip_op_prefix(span) or "guardrail"


def _kind_name(span: Span, kind: SpanKind) -> str:
    """Best display name for a span given its already-classified kind.

    Dispatches to the per-kind extractor so the decision_path matches the
    aggregates (e.g. a tool step shows the same name as `tools_used[].name`).
    """
    if kind == "tool":
        return _tool_name(span)
    if kind == "retriever":
        return _retriever_name(span)
    if kind == "guardrail":
        return _guardrail_name(span)
    # llm / agent / reranker / embedding / chain / other — span_name is the
    # most legible identifier (ChatOllama, AgentExecutor, vector_search, …).
    return (span.get("span_name") or span.get("operation_name") or kind).strip() or kind


# --- Decision path ----------------------------------------------------------

# Kinds that earn a step in the path. Plumbing (chain) and embedding stays out
# because they're sub-operations of retrieval / framework wrapping — the same
# choice ConversationGraph makes.
_PATH_KINDS = {"llm", "tool", "retriever", "reranker", "guardrail", "agent"}


def extract_decision_path(spans: list[Span], _cache: Optional[_SpanCache] = None) -> list[DecisionStep]:
    """Reduce the span list to a flat, ordered list of meaningful operations.

    Mirrors ConversationGraph: drop LangChain plumbing, keep decision-relevant
    kinds, sort by `started_at`, and collapse consecutive same-name spans into
    one step with a count.

    The agent root span itself is included as the first step when present so
    the path reads as `agent.session → ChatOllama → lookup_order → ChatOllama`
    — the conventional starting point in OTel GenAI semconv.
    """
    if not spans:
        return []

    cache = _cache_for(spans, _cache)

    # Sort by started_at — router already does it, but be defensive: a future
    # caller might hand us an unsorted list. Sort by *parsed* ms-since-epoch,
    # not by ISO string, so timestamps with different formatting (space vs T
    # separator, with vs without tz suffix) still order correctly.
    ordered = sorted(
        spans,
        key=lambda s: (_iso_to_ms(s.get("started_at")) or 0.0, s.get("span_id") or ""),
    )

    steps: list[DecisionStep] = []
    for s in ordered:
        if cache.is_plumbing(s):
            continue
        kind = cache.kind(s)
        if kind not in _PATH_KINDS:
            continue
        name = _kind_name(s, kind)
        # Collapse contiguous duplicates so retry loops show as `tool ×3`
        # rather than three identical rows.
        if steps and steps[-1].kind == kind and steps[-1].name == name:
            steps[-1].count += 1
            continue
        steps.append(DecisionStep(kind=kind, name=name, count=1))

    return steps


# --- Flags ------------------------------------------------------------------

def _retry_loop_repeats(spans: list[Span], cache: _SpanCache) -> Optional[tuple[str, int]]:
    """Find the worst retry hotspot: any (kind, name) pair that fired more than
    3 times. Returns (label, count) or None.

    "More than 3" is the threshold — three calls of the same tool in a loop is
    normal agent behaviour (call → observe → retry); four or more is a sign
    of getting stuck."""
    counts: dict[str, int] = {}
    labels: dict[str, str] = {}
    for s in spans:
        if cache.is_plumbing(s):
            continue
        kind = cache.kind(s)
        if kind not in _PATH_KINDS:
            continue
        name = _kind_name(s, kind)
        key = f"{kind}:{name}"
        counts[key] = counts.get(key, 0) + 1
        labels[key] = f"{kind} {name}"

    worst_key = max(counts, key=counts.get, default=None)
    if worst_key is None or counts[worst_key] <= 3:
        return None
    return labels[worst_key], counts[worst_key]


def compute_flags(
    spans: list[Span],
    *,
    goal: Optional[str],
    final_answer: Optional[str],
    _cache: Optional[_SpanCache] = None,
) -> list[DecisionFlag]:
    """Deterministic anomaly detection.

    Each flag is independent — order in the returned list is the priority for
    UI rendering (most actionable first). New flags should be appended at the
    end of their severity group.

    Every flag here surfaces something the trace ITSELF emits — no content
    analysis, no name guessing, no app-name heuristics. Adding a flag that
    would require us to "interpret" the trace beyond its OTel-conformant
    signals belongs to a separate analyzer service.
    """
    cache = _cache_for(spans, _cache)
    flags: list[DecisionFlag] = []

    # --- tool_failure (warning) ---
    failed_tools = [
        _tool_name(s) for s in spans
        if cache.kind(s) == "tool" and int(s.get("status_code") or 0) == STATUS_ERROR
    ]
    if failed_tools:
        unique_failed = sorted(set(failed_tools))
        flags.append(DecisionFlag(
            id=FLAG_TOOL_FAILURE,
            severity="warning",
            label="Tool failure",
            detail=f"{len(failed_tools)} tool call(s) errored: {', '.join(unique_failed)}.",
        ))

    # --- retry_loop (warning) ---
    retry = _retry_loop_repeats(spans, cache)
    if retry:
        label, n = retry
        flags.append(DecisionFlag(
            id=FLAG_RETRY_LOOP,
            severity="warning",
            label="Retry loop",
            detail=f"{label} fired {n} times — possible loop or stuck agent.",
        ))

    # --- truncated_output (warning) ---
    last_llm = _last_llm(spans, cache)
    if last_llm and any(r in _TRUNCATION_FINISH_REASONS for r in _finish_reasons(last_llm)):
        flags.append(DecisionFlag(
            id=FLAG_TRUNCATED_OUTPUT,
            severity="warning",
            label="Truncated output",
            detail="The model stopped at the token limit; the response is incomplete.",
        ))

    # --- near_context_limit (info) ---
    # input_tokens > 80% of declared max_tokens on any LLM span. The OTel
    # attribute is `gen_ai.request.max_tokens`; if absent we can't compute.
    for s in spans:
        if cache.kind(s) != "llm":
            continue
        attrs = s.get("attributes") or {}
        max_tokens_raw = attrs.get("gen_ai.request.max_tokens")
        if not max_tokens_raw:
            continue
        try:
            max_t = int(max_tokens_raw)
        except (ValueError, TypeError):
            continue
        in_t = int(s.get("input_tokens") or 0)
        if max_t > 0 and in_t > int(max_t * 0.8):
            flags.append(DecisionFlag(
                id=FLAG_NEAR_CONTEXT_LIMIT,
                severity="info",
                label="Near context limit",
                detail=(
                    f"Input was {in_t} tokens against a {max_t}-token limit "
                    f"(>80%) — risk of dropped context next turn."
                ),
            ))
            break  # one occurrence is enough; don't spam the badge list

    # --- instrumentation_gap (info) ---
    # Aggregable signal that the upstream app didn't set
    # OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true.
    if goal is None and final_answer is None and spans:
        flags.append(DecisionFlag(
            id=FLAG_INSTRUMENTATION_GAP,
            severity="info",
            label="Instrumentation gap",
            detail=(
                "No prompt/response content captured. Set "
                "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true on "
                "the instrumented app to enable audit-grade traces."
            ),
        ))

    return flags


# --- Aggregations ------------------------------------------------------------

def aggregate_tools(spans: list[Span], _cache: Optional[_SpanCache] = None) -> list[ToolUsage]:
    cache = _cache_for(spans, _cache)
    by_name: dict[str, dict[str, int]] = {}
    for s in spans:
        if cache.kind(s) != "tool":
            continue
        name = _tool_name(s)
        bucket = by_name.setdefault(name, {"calls": 0, "errors": 0})
        bucket["calls"] += 1
        if int(s.get("status_code") or 0) == STATUS_ERROR:
            bucket["errors"] += 1
    return [
        ToolUsage(name=n, calls=b["calls"], errors=b["errors"])
        for n, b in sorted(by_name.items())
    ]


def aggregate_retrievals(spans: list[Span], _cache: Optional[_SpanCache] = None) -> list[RetrievalUsage]:
    cache = _cache_for(spans, _cache)
    counts: dict[str, int] = {}
    for s in spans:
        if cache.kind(s) != "retriever":
            continue
        counts[_retriever_name(s)] = counts.get(_retriever_name(s), 0) + 1
    return [RetrievalUsage(name=n, calls=c) for n, c in sorted(counts.items())]


def aggregate_guardrails(spans: list[Span], _cache: Optional[_SpanCache] = None) -> list[GuardrailUsage]:
    # Triggered status is per-name aggregated: any triggered call → triggered.
    cache = _cache_for(spans, _cache)
    by_name: dict[str, bool] = {}
    for s in spans:
        if cache.kind(s) != "guardrail":
            continue
        name = _guardrail_name(s)
        triggered, _ = _is_guardrail_triggered(s, cache)
        by_name[name] = by_name.get(name, False) or triggered
    return [GuardrailUsage(name=n, triggered=t) for n, t in sorted(by_name.items())]


def models_used(spans: list[Span]) -> list[str]:
    seen: list[str] = []
    for s in spans:
        for key in ("request_model", "response_model"):
            m = (s.get(key) or "").strip()
            if m and m not in seen:
                seen.append(m)
    return sorted(seen)


def compute_metrics(spans: list[Span]) -> Metrics:
    if not spans:
        return Metrics(duration_ms=0, total_tokens=0, span_count=0, error_count=0)
    # Trace duration = wall-clock span of the trace, computed by the same
    # helper used in the frontend (totalDuration) — first started_at to the
    # latest finish (started + duration).
    starts = []
    ends = []
    for s in spans:
        sa = s.get("started_at")
        d = float(s.get("duration_ms") or 0)
        # started_at is ISO 8601 from ClickHouse; parse to ms-since-epoch.
        ms = _iso_to_ms(sa)
        if ms is None:
            continue
        starts.append(ms)
        ends.append(ms + d)
    duration_ms = int(round(max(ends) - min(starts))) if starts else 0
    total_tokens = sum(int(s.get("input_tokens") or 0) + int(s.get("output_tokens") or 0) for s in spans)
    error_count = sum(1 for s in spans if int(s.get("status_code") or 0) == STATUS_ERROR)
    return Metrics(
        duration_ms=duration_ms,
        total_tokens=total_tokens,
        span_count=len(spans),
        error_count=error_count,
    )


def _iso_to_ms(value: Any) -> Optional[float]:
    """Parse a backend-supplied ISO timestamp to ms since epoch (UTC). None on failure.

    Spans arrive with `started_at` as an ISO string (router serialises
    `datetime.isoformat()`). datetime.fromisoformat handles the common shapes
    ClickHouse emits; we don't import a heavy parser for this.

    Naive datetimes (no tzinfo) are interpreted as UTC. Without this the
    fallback path uses the *container's* local timezone, which silently shifts
    every timestamp by the host's UTC offset when CH returns DateTime64 values
    without a tz suffix.
    """
    if value is None:
        return None
    from datetime import datetime, timezone
    try:
        # ClickHouse usually omits a `T` separator — fromisoformat needs it
        # since Python 3.10 to handle the space variant. fromisoformat in 3.11+
        # accepts a space, but let's be defensive.
        s = str(value).replace(" ", "T")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp() * 1000.0
    except (ValueError, TypeError):
        return None


# --- Public entry point ------------------------------------------------------

def build_summary(spans: Iterable[Span]) -> DecisionRecord:
    """Top-level orchestrator — pure function of the span list.

    Spans MUST be ordered by `started_at` ASC (the router already does this).
    No mutation of the input.
    """
    spans = list(spans)
    # One cache per invocation — precomputes classify_kind / _is_plumbing so
    # the ~13 downstream passes reuse the result instead of re-running the
    # regex waterfall per span.
    cache = _SpanCache(spans)

    goal, goal_trunc = extract_goal(spans, cache)
    answer, answer_trunc = extract_final_answer(spans, cache)
    outcome, reason, heuristic = classify_outcome(spans, cache)
    path = extract_decision_path(spans, cache)
    flags = compute_flags(spans, goal=goal, final_answer=answer, _cache=cache)

    return DecisionRecord(
        goal=goal,
        goal_truncated=goal_trunc,
        outcome=outcome,
        outcome_reason=reason,
        outcome_reason_heuristic=heuristic,
        final_answer=answer,
        final_answer_truncated=answer_trunc,
        decision_path=path,
        flags=flags,
        models_used=models_used(spans),
        tools_used=aggregate_tools(spans, cache),
        retrievals=aggregate_retrievals(spans, cache),
        guardrails=aggregate_guardrails(spans, cache),
        metrics=compute_metrics(spans),
    )
