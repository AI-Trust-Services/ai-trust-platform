import { type Span } from "../api/traces";
import { classifySpan, extractMessages, type SpanKind } from "./spanAttributes";
import { parseBackendDate } from "./dates";

/**
 * Conversation-flow graph: a reader-friendly view of what an agent actually
 * did during a trace. Built from a single source of truth — the span
 * parent-child hierarchy — with one filter and one dedup pass on top.
 *
 * Design goals:
 *   - Framework-agnostic. We never look at LangChain wrapper names or any
 *     other framework-specific span. The only thing we look at is the span
 *     kind (llm / tool / retriever / ...) which is normalised in
 *     spanAttributes.classifySpan().
 *   - One structural rule. Every edge comes from "nearest interesting
 *     ancestor". No chronological inference, no tool_call_id index, no
 *     scope/agent boundary logic. If the trace puts a tool span under an
 *     LLM span, the edge goes LLM → tool. Period.
 *   - Loops emerge naturally. When the same operation runs twice (same kind,
 *     name, args) it collapses to one node — and if its parent is also a
 *     deduped node that already has an outgoing edge to it, the second
 *     traversal becomes a step-numbered chip on the same edge.
 */

export interface FlowNode {
  /** Stable id derived from the dedup key. */
  id: string;
  /** Display label — span_name, or "User" / "Assistant" for bookends. */
  label: string;
  /** Per-shape rendering hint. */
  shape: "user" | "assistant" | "op";
  /** Classification for op nodes; "other" for user/assistant bookends. */
  kind: SpanKind;
  /** Number of spans that collapsed into this node (≥ 1; 1 for bookends). */
  count: number;
  /** Sum of duration_ms across all backing spans. 0 for bookends. */
  totalDurationMs: number;
  /** All spans backing this node, in execution order. The first is what the
   *  detail panel selects when this node is clicked. */
  spans: Span[];
  /** Free-text payload for user/assistant nodes — actual prompt or reply. */
  text?: string;
  /** Tool-call summaries from an LLM's output (name + args snippet),
   *  aggregated across all backing spans. Empty for non-LLM nodes. */
  toolCalls?: { name: string; argsSnippet: string }[];
  /** Args + result snippets for non-LLM op nodes (tool, retriever, ...). */
  toolPayload?: { argsSnippet: string; resultSnippet: string };
}

/**
 * Edge between two FlowNodes. Role is purely a function of the target's
 * kind, plus a "returns" override for tool→llm back-edges so the UI can
 * colour them differently. Roles drive edge colour only — the structural
 * meaning is the same.
 */
export type EdgeRole =
  | "asks"
  | "calls"
  | "returns"
  | "responds"
  | "next"
  | "retrieves"
  | "reranks"
  | "embeds"
  | "guards"
  | "delegates";

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  role: EdgeRole;
  /** Optional secondary label — usually the target's name on action edges. */
  detail?: string;
  /** Global 1-based step numbers for each traversal, in execution order.
   *  length ≥ 1. Renderers show these as chips so cycles read as ①…②…③. */
  steps: number[];
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** True when the kind-filter left zero ops and we fell back to all spans. */
  fellBackToAllSpans: boolean;
}

/* -------------------------------------------------------------------------- */
/* Constants & helpers                                                        */
/* -------------------------------------------------------------------------- */

/** Kinds that the conversation view actually renders as nodes.
 *
 * Agent and chain spans are deliberately excluded — they're container
 * wrappers around the work, not the work itself. Showing them adds boxes
 * that have no payload of their own ("agent.session" with just a duration
 * tells the user nothing) and forces extra "next"/"delegates" edges that
 * read as noise. The story we want to tell is "the model did X, called
 * tool Y, then answered" — not "an agent wrapped a chain that wrapped a
 * runnable that called a model".
 */
const INTERESTING_KINDS: ReadonlySet<SpanKind> = new Set([
  "llm",
  "tool",
  "retriever",
  "reranker",
  "embedding",
  "guardrail",
]);

const SNIPPET_MAX = 80;

function truncate(s: string, max = SNIPPET_MAX): string {
  if (!s) return "";
  const trimmed = s.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? trimmed.slice(0, max - 1) + "…" : trimmed;
}

/** djb2 — 8-char fingerprint of an args string, used in the dedup key so
 *  two tool calls with the same name but different args stay separate. */
function argsFingerprint(args: string): string {
  if (!args) return "";
  const trimmed = args.replace(/\s+/g, "");
  let hash = 5381;
  for (let i = 0; i < trimmed.length; i++) {
    hash = ((hash * 33) ^ trimmed.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).slice(0, 8);
}

function getArgsString(span: Span): string {
  const a = span.attributes ?? {};
  return a["input.value"] ?? a["gen_ai.tool.call.arguments"] ?? "";
}

function getResultString(span: Span): string {
  const a = span.attributes ?? {};
  return a["output.value"] ?? a["gen_ai.tool.call.result"] ?? "";
}

interface ToolCallReq {
  name: string;
  args: string;
}

/** Tool-calls an LLM emitted in its output. Used to decorate LLM nodes with
 *  "→ tool_name" hints; not used for edge wiring (we get those from the
 *  span hierarchy instead). */
function extractToolCallRequests(span: Span): ToolCallReq[] {
  const attrs = span.attributes ?? {};
  const calls: ToolCallReq[] = [];

  // OpenInference numbered keys
  const pattern = /^llm\.output_messages\.(\d+)\.message\.tool_calls\.(\d+)\.tool_call\.function\.name$/;
  for (const key of Object.keys(attrs)) {
    const m = key.match(pattern);
    if (!m) continue;
    const prefix = `llm.output_messages.${m[1]}.message.tool_calls.${m[2]}.tool_call`;
    calls.push({
      name: attrs[key],
      args: attrs[`${prefix}.function.arguments`] ?? "",
    });
  }

  // OTel GenAI semconv JSON fallback
  if (calls.length === 0) {
    try {
      const raw = attrs["gen_ai.output.messages"];
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const msg of parsed) {
            const parts = msg.parts ?? msg.content;
            if (!Array.isArray(parts)) continue;
            for (const p of parts) {
              if (p?.type === "tool_use" || p?.type === "tool_call") {
                calls.push({
                  name: p.name ?? "",
                  args: typeof p.input === "string" ? p.input : JSON.stringify(p.input ?? {}),
                });
              }
            }
          }
        }
      }
    } catch {
      // best-effort
    }
  }

  return calls;
}

/* -------------------------------------------------------------------------- */
/* Bookend extraction (user prompt / assistant reply)                         */
/* -------------------------------------------------------------------------- */

function findRootSpan(spans: Span[]): Span | undefined {
  return spans.find((s) => !s.parent_span_id);
}

function extractUserPrompt(spans: Span[]): { text: string; span?: Span } | null {
  // 1. Root span's input messages, if it carries any (typical for agent
  //    spans that wrap the whole conversation).
  const root = findRootSpan(spans);
  if (root) {
    const msgs = extractMessages(root, "input");
    const userMsg = msgs.find((m) => m.role === "user" || m.role === "human");
    if (userMsg?.content) return { text: userMsg.content, span: root };
  }
  // 2. Fallback: earliest LLM with a user message in its input.
  const firstLlm = spans
    .filter((s) => classifySpan(s) === "llm")
    .sort((a, b) => {
      const ta = parseBackendDate(a.started_at).getTime();
      const tb = parseBackendDate(b.started_at).getTime();
      if (Number.isNaN(ta) && Number.isNaN(tb)) return a.span_id.localeCompare(b.span_id);
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return ta - tb;
    })[0];
  if (firstLlm) {
    const msgs = extractMessages(firstLlm, "input");
    const userMsg = msgs.find((m) => m.role === "user" || m.role === "human");
    if (userMsg?.content) return { text: userMsg.content, span: firstLlm };
  }
  return null;
}

/** Last LLM that produced a final answer — i.e. has no tool_calls in its
 *  output_messages. Walked newest-first so we end on the answering turn. */
function findFinalLlmSpan(spans: Span[]): Span | undefined {
  const llms = spans
    .filter((s) => classifySpan(s) === "llm")
    .sort((a, b) => {
      const ta = parseBackendDate(a.started_at).getTime();
      const tb = parseBackendDate(b.started_at).getTime();
      if (Number.isNaN(ta) && Number.isNaN(tb)) return a.span_id.localeCompare(b.span_id);
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return ta - tb;
    });
  for (let i = llms.length - 1; i >= 0; i--) {
    const s = llms[i];
    const hasToolCalls = Object.keys(s.attributes ?? {}).some((k) =>
      /^llm\.output_messages\.\d+\.message\.tool_calls\./.test(k)
    );
    if (!hasToolCalls) return s;
  }
  return undefined;
}

function extractAssistantReply(spans: Span[]): { text: string; span?: Span } | null {
  const root = findRootSpan(spans);
  if (root) {
    const msgs = extractMessages(root, "output");
    const reply = msgs.find((m) => m.role === "assistant" || m.role === "model")?.content;
    if (reply) return { text: reply, span: root };
  }
  const final = findFinalLlmSpan(spans);
  if (final) {
    const msgs = extractMessages(final, "output");
    const reply = msgs[0]?.content;
    if (reply) return { text: reply, span: final };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Role inference                                                             */
/* -------------------------------------------------------------------------- */

function roleFor(sourceKind: SpanKind, targetKind: SpanKind): EdgeRole {
  switch (targetKind) {
    case "tool":      return "calls";
    case "retriever": return "retrieves";
    case "embedding": return "embeds";
    case "reranker":  return "reranks";
    case "guardrail": return "guards";
    case "agent":     return "delegates";
    case "llm":       return sourceKind === "tool" ? "returns" : "next";
    default:          return "next";
  }
}

/* -------------------------------------------------------------------------- */
/* Main builder                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build the conversation flow in five short passes:
 *
 *   1. Index spans by id so we can walk parent chains in O(1).
 *   2. Pick the "interesting" spans (LLM, Tool, Retriever, Reranker,
 *      Embedding, Guardrail, Agent). Fall back to all spans if zero matched,
 *      so we always show *something*.
 *   3. Dedup into FlowNodes by (kind, name, args-fingerprint). Identical
 *      retries collapse; same tool with different args stays separate.
 *   4. For every interesting span, find the NEAREST interesting ancestor
 *      via parent_span_id. That's the edge source. Emit one edge per span,
 *      collapsed by (source-node, target-node, role) so loops accumulate
 *      step numbers instead of becoming parallel edges.
 *   5. Add User / Assistant bookend nodes if the trace captured them.
 */
export function buildConversationFlow(spans: Span[]): FlowGraph {
  if (spans.length === 0) {
    return { nodes: [], edges: [], fellBackToAllSpans: false };
  }

  // --- 1. index -----------------------------------------------------------
  const bySpanId = new Map<string, Span>();
  for (const s of spans) bySpanId.set(s.span_id, s);

  // --- 2. filter ----------------------------------------------------------
  const isInteresting = (s: Span): boolean =>
    INTERESTING_KINDS.has(classifySpan(s));

  let ops = spans.filter(isInteresting);
  const fellBackToAllSpans = ops.length === 0;
  if (fellBackToAllSpans) ops = spans;

  // Stable execution-order sort. Used both for the step counter (so chips
  // read 1, 2, 3 in time order) and for picking the bookend anchors.
  // Guard against NaN (malformed timestamps): NaN comparisons always return
  // false, which makes Array.sort non-deterministic. Fall back to span_id
  // lexicographic order so the result is at least stable and reproducible.
  ops = [...ops].sort((a, b) => {
    const ta = parseBackendDate(a.started_at).getTime();
    const tb = parseBackendDate(b.started_at).getTime();
    const bothValid = !Number.isNaN(ta) && !Number.isNaN(tb);
    if (bothValid) return ta - tb || a.span_id.localeCompare(b.span_id);
    // Put spans with invalid timestamps last; break ties by span_id.
    if (Number.isNaN(ta) && Number.isNaN(tb)) return a.span_id.localeCompare(b.span_id);
    return Number.isNaN(ta) ? 1 : -1;
  });

  // --- 3. dedup -----------------------------------------------------------
  const nodeKeyFor = (s: Span, kind: SpanKind): string => {
    const name = s.span_name || s.operation_name || "(unnamed)";
    // LLM: fingerprint empty — iterations collapse to one node.
    // Other kinds: fingerprint on args so foo("Berlin") ≠ foo("Tokyo").
    const fp = kind === "llm" ? "" : argsFingerprint(getArgsString(s));
    return `${kind}|${name}|${fp}`;
  };

  const nodesByKey = new Map<string, FlowNode>();
  const nodeOrder: FlowNode[] = [];
  const spanToNodeId = new Map<string, string>();

  for (const s of ops) {
    const kind = classifySpan(s);
    const key = nodeKeyFor(s, kind);
    spanToNodeId.set(s.span_id, key);

    const existing = nodesByKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalDurationMs += s.duration_ms || 0;
      existing.spans.push(s);
      if (kind === "llm") {
        existing.toolCalls = (existing.toolCalls ?? []).concat(
          extractToolCallRequests(s).map((c) => ({
            name: c.name,
            argsSnippet: truncate(c.args, 60),
          }))
        );
      }
      continue;
    }

    const node: FlowNode = {
      id: key,
      label: s.span_name || s.operation_name || "(unnamed)",
      shape: "op",
      kind,
      count: 1,
      totalDurationMs: s.duration_ms || 0,
      spans: [s],
    };
    if (kind === "llm") {
      node.toolCalls = extractToolCallRequests(s).map((c) => ({
        name: c.name,
        argsSnippet: truncate(c.args, 60),
      }));
    } else {
      node.toolPayload = {
        argsSnippet: truncate(getArgsString(s), 70),
        resultSnippet: truncate(getResultString(s), 90),
      };
    }
    nodesByKey.set(key, node);
    nodeOrder.push(node);
  }

  // --- 4. edges from pure chronological order -----------------------------
  //
  // The simplest possible rule: every op (except the first) gets ONE
  // incoming edge from the op that came right before it in time. That's it.
  //
  // No scope walking, no hierarchy lookup, no tool_call_id indexing — those
  // mechanisms tried to be smarter than the data and produced layouts that
  // confused the user (criss-cross edges, double "delegates"/"asks" pairs,
  // orphan agent nodes). One rule for everything: time order.
  //
  // Dedup + this rule is enough for loops. If a trace runs ChatOllama,
  // then get_faq, then ChatOllama again, the third event collapses onto the
  // first node's dedup key. The edge get_faq → ChatOllama (which already
  // exists from the previous step in time terms) gets a second step number,
  // and the visual back-edge happens naturally because the target appears
  // earlier in nodeOrder than the source.

  type EdgeAcc = Omit<FlowEdge, "id">;
  const edgeKey = (a: Pick<EdgeAcc, "source" | "target" | "role" | "detail">) =>
    `${a.source}->${a.target}|${a.role}|${a.detail ?? ""}`;
  const edgesAcc = new Map<string, EdgeAcc>();

  // Step numbering reflects the user-visible story order, NOT the order we
  // happen to emit edges in this builder. The story is:
  //   1. user asks
  //   2..N. ops happen in chronological order
  //   N+1. assistant responds
  //
  // We reserve step 1 for the asks bookend (set further down) so the chips
  // read 1→2→3→… in left-to-right reading order. Op edges start at step 2.
  const userBookendInfo = extractUserPrompt(spans);
  const assistantBookendInfo = extractAssistantReply(spans);
  let stepCounter = userBookendInfo ? 1 : 0;

  for (let i = 1; i < ops.length; i++) {
    const previous = ops[i - 1];
    const target = ops[i];
    const sourceNodeId = spanToNodeId.get(previous.span_id);
    const targetNodeId = spanToNodeId.get(target.span_id);
    if (!sourceNodeId || !targetNodeId) continue;
    if (sourceNodeId === targetNodeId) continue; // collapsed onto self

    const role = roleFor(classifySpan(previous), classifySpan(target));
    const detail = role === "calls" ? target.span_name : undefined;
    const k = edgeKey({ source: sourceNodeId, target: targetNodeId, role, detail });

    stepCounter += 1;
    const existing = edgesAcc.get(k);
    if (existing) existing.steps.push(stepCounter);
    else edgesAcc.set(k, { source: sourceNodeId, target: targetNodeId, role, detail, steps: [stepCounter] });
  }

  // --- 5. bookends --------------------------------------------------------
  // userBookendInfo / assistantBookendInfo were captured in pass 4 so we
  // could reserve step 1 for "asks". Re-use them here to build the nodes.
  const userInfo = userBookendInfo;
  const assistantInfo = assistantBookendInfo;

  const userNode: FlowNode | null = userInfo
    ? {
        id: "__user__",
        label: "User",
        shape: "user",
        kind: "other",
        count: 1,
        totalDurationMs: 0,
        spans: userInfo.span ? [userInfo.span] : [],
        text: userInfo.text,
      }
    : null;

  const assistantNode: FlowNode | null = assistantInfo
    ? {
        id: "__assistant__",
        label: "Assistant",
        shape: "assistant",
        kind: "other",
        count: 1,
        totalDurationMs: 0,
        spans: assistantInfo.span ? [assistantInfo.span] : [],
        text: assistantInfo.text,
      }
    : null;

  // User → first op. Step 1, reserved at the top of pass 4.
  if (userNode && ops.length > 0) {
    const firstOpId = spanToNodeId.get(ops[0].span_id);
    if (firstOpId) {
      edgesAcc.set(`${userNode.id}->${firstOpId}|asks|`, {
        source: userNode.id,
        target: firstOpId,
        role: "asks",
        steps: [1],
      });
    }
  }

  // Final-answer → Assistant edge. Step N+1, after all op edges.
  //
  // Source: the LLM that produced the final reply (per findFinalLlmSpan),
  // because semantically the LLM is what answers the user — not the tool
  // that ran just before it. Visually, when that LLM isn't the spatially
  // last node in the stack (e.g. LLM → tool → ... loop where the tool is
  // physically below the LLM), the layout step recognises this responds
  // edge as a "skip-down" and routes it through a WEST port — left around
  // any nodes in between — so it never cuts through a tool body.
  const finalLlm = findFinalLlmSpan(ops);
  if (assistantNode && finalLlm) {
    const finalNodeId = spanToNodeId.get(finalLlm.span_id);
    if (finalNodeId && finalNodeId !== assistantNode.id) {
      stepCounter += 1;
      edgesAcc.set(`${finalNodeId}->${assistantNode.id}|responds|`, {
        source: finalNodeId,
        target: assistantNode.id,
        role: "responds",
        steps: [stepCounter],
      });
    }
  } else if (assistantNode && nodeOrder.length > 0) {
    // No LLM at all (rare — retriever-only traces, fallback span set).
    // Fall back to the spatially-last node so the bubble still anchors.
    const last = nodeOrder[nodeOrder.length - 1];
    if (last.id !== assistantNode.id) {
      stepCounter += 1;
      edgesAcc.set(`${last.id}->${assistantNode.id}|responds|`, {
        source: last.id,
        target: assistantNode.id,
        role: "responds",
        steps: [stepCounter],
      });
    }
  }

  const allNodes: FlowNode[] = [
    ...(userNode ? [userNode] : []),
    ...nodeOrder,
    ...(assistantNode ? [assistantNode] : []),
  ];
  const allEdges: FlowEdge[] = [...edgesAcc.values()].map((a) => ({
    id: edgeKey(a),
    ...a,
  }));

  return { nodes: allNodes, edges: allEdges, fellBackToAllSpans };
}

/** Role text shown inside a step-chip on the edge (without the step number). */
export function edgeRoleText(edge: FlowEdge): string {
  return edge.role === "calls" && edge.detail ? `calls ${edge.detail}` : edge.role;
}
