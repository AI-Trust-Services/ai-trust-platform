import { type Span } from "../api/traces";

/** Lightweight reference to fix lint warnings when Span isn't otherwise used at type level. */
export type { Span };

/**
 * Best-effort classifier that picks a single high-level "kind" for a span,
 * regardless of which instrumentation library produced it. OTel GenAI semconv
 * uses gen_ai.operation.name; OpenInference (LangChain) uses
 * openinference.span.kind. We normalise both into one of:
 *
 *   "tool"      — a tool/function execution
 *   "llm"       — a model inference call
 *   "agent"     — an agent orchestration step
 *   "chain"     — a multi-step pipeline (LangChain "chain")
 *   "retriever" — a vector / keyword / hybrid retrieval step (RAG fetch)
 *   "embedding" — an embedding model call (encode → vector)
 *   "reranker"  — a relevance / re-ranking step over retrieved docs
 *   "guardrail" — a safety / policy / moderation check
 *   "other"     — anything else (parsers, evaluators, …)
 */
export type SpanKind =
  | "tool"
  | "llm"
  | "agent"
  | "chain"
  | "retriever"
  | "embedding"
  | "reranker"
  | "guardrail"
  | "other";

export function classifySpan(span: { operation_name?: string; span_name?: string; attributes?: Record<string, string> }): SpanKind {
  const op = span.operation_name?.toLowerCase() ?? "";
  // OTel GenAI semconv — operation_name is authoritative when present.
  if (op === "execute_tool") return "tool";
  if (op === "chat" || op === "text_completion" || op === "generate_content") return "llm";
  if (op === "invoke_agent" || op === "create_agent" || op === "agent") return "agent";
  if (op === "embeddings" || op === "embed") return "embedding";

  // OpenInference (LangChain et al.) — single attribute holds the kind verbatim.
  const oi = span.attributes?.["openinference.span.kind"]?.toLowerCase();
  if (oi === "tool") return "tool";
  if (oi === "llm") return "llm";
  if (oi === "agent") return "agent";
  if (oi === "chain") return "chain";
  if (oi === "retriever") return "retriever";
  if (oi === "embedding") return "embedding";
  if (oi === "reranker") return "reranker";
  if (oi === "guardrail") return "guardrail";

  // Heuristic fallback on operation/span name — this catches custom spans
  // (e.g. `rag.retrieval`, `embed_query`, `safety_check`) that don't set
  // either semconv attribute. Order matters: check most specific first so a
  // span named "rerank_retrieved_docs" wins reranker over retriever.
  const name = `${op} ${span.span_name?.toLowerCase() ?? ""}`;
  if (/\brerank|reranker|cross[-_]?encoder\b/.test(name)) return "reranker";
  if (/\bguardrail|moderation|safety[-_]?check|policy[-_]?check\b/.test(name)) return "guardrail";
  if (/\bembed|embedding|vectorize\b/.test(name)) return "embedding";
  if (/\bretriev|search|vector[-_]?search|knn|bm25\b/.test(name)) return "retriever";

  return "other";
}

export interface ToolCall {
  /** Display name of the tool. */
  name: string;
  /** Optional human-readable description of what the tool does. */
  description?: string;
  /** Arguments passed to the tool — raw string (usually JSON). */
  args?: string;
  /** Result returned by the tool — raw string. */
  result?: string;
  /** Unique ID linking the call back to a parent LLM response, if available. */
  call_id?: string;
}

/**
 * Extract tool-call information from a span. Two cases are handled:
 *
 *   1. The span IS a tool execution — OpenInference encodes this with
 *      openinference.span.kind = "TOOL", tool.name, input.value, output.value.
 *      This is the most common case in LangChain traces.
 *
 *   2. The span is an LLM span that emitted tool-call requests inside its
 *      output — OpenInference encodes these as numbered attributes like
 *      llm.output_messages.0.message.tool_calls.0.tool_call.function.name.
 *      We scan for those and return one ToolCall per call.
 *
 * Returns an empty array when there are no tool calls.
 */
export function extractToolCalls(span: Span): ToolCall[] {
  const attrs = span.attributes ?? {};

  // Case 1: this span is itself a tool execution.
  if (classifySpan(span) === "tool") {
    return [
      {
        name: attrs["tool.name"] ?? attrs["gen_ai.tool.name"] ?? span.span_name ?? "tool",
        description: attrs["tool.description"] ?? attrs["gen_ai.tool.description"],
        args: attrs["input.value"] ?? attrs["gen_ai.tool.call.arguments"],
        result: attrs["output.value"] ?? attrs["gen_ai.tool.call.result"],
        call_id: attrs["tool.call_id"] ?? attrs["gen_ai.tool.call.id"],
      },
    ];
  }

  // Case 2: scan llm.output_messages.<m>.message.tool_calls.<n>.tool_call.* for
  // requested tool invocations inside an LLM span. We discover indices from the
  // keys themselves rather than assuming there's only one — agents commonly
  // emit several tool calls in a single turn.
  const pattern = /^llm\.output_messages\.(\d+)\.message\.tool_calls\.(\d+)\.tool_call\.function\.name$/;
  const calls: ToolCall[] = [];
  for (const key of Object.keys(attrs)) {
    const match = key.match(pattern);
    if (!match) continue;
    const [, m, n] = match;
    const prefix = `llm.output_messages.${m}.message.tool_calls.${n}.tool_call`;
    calls.push({
      name: attrs[key],
      args: attrs[`${prefix}.function.arguments`],
      call_id: attrs[`${prefix}.id`],
    });
  }
  return calls;
}

export interface ChatMessage {
  role: string;
  content: string;
}

/**
 * Pull a chat-style message list out of a span. Two encodings supported:
 *
 *   - OTel GenAI:    gen_ai.input.messages / gen_ai.output.messages as JSON arrays
 *   - OpenInference: llm.input_messages.<n>.message.{role,content} numbered keys
 *
 * Returns an empty array if neither encoding is present.
 */
export function extractMessages(span: Span, direction: "input" | "output"): ChatMessage[] {
  const attrs = span.attributes ?? {};

  // 1. OTel GenAI semconv — single attribute holding a JSON array
  const semconvKey = `gen_ai.${direction}.messages`;
  const raw = attrs[semconvKey];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((m: { role: string; parts?: { content: string }[]; content?: string }) => ({
          role: (m.role ?? "").toLowerCase().trim(),
          content: m.parts?.[0]?.content ?? m.content ?? "",
        }));
      }
    } catch {
      // fall through to OpenInference
    }
  }

  // 2. OpenInference — numbered attributes per message
  const prefix = `llm.${direction}_messages.`;
  const indices = new Set<number>();
  for (const key of Object.keys(attrs)) {
    if (!key.startsWith(prefix)) continue;
    const m = key.slice(prefix.length).match(/^(\d+)\./);
    if (m) indices.add(parseInt(m[1], 10));
  }
  return [...indices]
    .sort((a, b) => a - b)
    .map((i) => ({
      role: (attrs[`${prefix}${i}.message.role`] ?? "").toLowerCase().trim(),
      content: attrs[`${prefix}${i}.message.content`] ?? "",
    }))
    .filter((m) => m.role || m.content);
}

/**
 * For spans that don't have structured chat messages (chains, parsers, runnables),
 * OpenInference falls back to a single input.value / output.value pair —
 * usually JSON. Returns null when nothing useful is there.
 */
export function extractGenericIO(span: Span): { input?: string; output?: string } | null {
  const attrs = span.attributes ?? {};
  const input = attrs["input.value"];
  const output = attrs["output.value"];
  if (!input && !output) return null;
  return { input, output };
}

/**
 * Token usage with provider-agnostic field names. OTel GenAI semconv exposes
 * these as dedicated span columns (input_tokens / output_tokens); OpenInference
 * encodes them as llm.token_count.prompt / .completion / .total. We pick
 * whichever is non-zero.
 */
export interface TokenUsage {
  input?: number;
  output?: number;
  total?: number;
}

export function extractTokens(span: Span): TokenUsage | null {
  const attrs = span.attributes ?? {};
  const input = span.input_tokens || parseInt(attrs["llm.token_count.prompt"] ?? "0", 10) || 0;
  const output = span.output_tokens || parseInt(attrs["llm.token_count.completion"] ?? "0", 10) || 0;
  const total = parseInt(attrs["llm.token_count.total"] ?? "0", 10) || (input + output);
  if (input === 0 && output === 0 && total === 0) return null;
  return { input, output, total };
}

/**
 * Pick the model name that's actually set, regardless of convention. OTel uses
 * gen_ai.request.model; OpenInference uses llm.model_name. The dedicated DB
 * column wins (it's set when the consumer recognised gen_ai.request.model).
 */
export function getModelName(span: Span): string {
  if (span.request_model) return span.request_model;
  return span.attributes?.["llm.model_name"] ?? "";
}

/**
 * Provider/system name from either convention. OTel uses gen_ai.system;
 * OpenInference splits this into llm.provider (vendor) and llm.system
 * (sometimes a sub-system like "openai" for an OpenAI-compatible endpoint).
 */
export function getSystemName(span: Span): string {
  if (span.gen_ai_system) return span.gen_ai_system;
  const attrs = span.attributes ?? {};
  return attrs["llm.provider"] ?? attrs["llm.system"] ?? "";
}
