import { type Span } from "../api/traces";
import { classifySpan, type SpanKind } from "./spanAttributes";
import { parseBackendDate } from "./dates";

/**
 * Generic span DAG — one node per span, edges follow parent_span_id verbatim.
 *
 * Unlike the conversation-flow graph, this view does NOT filter, deduplicate,
 * or relabel. Every span the backend returns becomes exactly one node so the
 * picture matches reality bit-for-bit: framework plumbing, retrievers,
 * guardrails, custom spans — all visible.
 */
export interface DagNode {
  /** span_id — also used as the React Flow node id. */
  id: string;
  span: Span;
  kind: SpanKind;
  /**
   * Pre-order DFS step number (root = 1, then children left-to-right by
   * started_at). This way the root is always "1" and numbering follows the
   * tree structure rather than raw timestamps, which can be misleading when
   * child spans start microseconds before their parent due to clock skew.
   */
  step: number;
  /** Whether this span overlaps another span in time (parallel sibling). */
  overlapsWithSibling: boolean;
}

export type DagEdgeKind =
  /** parent_span_id link — the structural backbone of the DAG. */
  | "parent";

export interface DagEdge {
  id: string;
  source: string;
  target: string;
  kind: DagEdgeKind;
}

export interface SpanDag {
  nodes: DagNode[];
  edges: DagEdge[];
  /** True when at least one node ran concurrently with a sibling. */
  hasParallelWork: boolean;
}

/**
 * Two spans overlap meaningfully when their intervals intersect by more than
 * MIN_OVERLAP_MS. A small threshold filters out instrumentation jitter where
 * a child span starts 0–2ms "before" its parent due to clock skew.
 */
const MIN_OVERLAP_MS = 10;

function overlaps(a: Span, b: Span): boolean {
  const aStart = parseBackendDate(a.started_at).getTime();
  const aEnd   = aStart + (a.duration_ms || 0);
  const bStart = parseBackendDate(b.started_at).getTime();
  const bEnd   = bStart + (b.duration_ms || 0);
  const overlapMs = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
  return overlapMs > MIN_OVERLAP_MS;
}

/**
 * Build the generic DAG from a flat span list.
 *
 *  1. Group spans by parent_span_id. Spans with no parent / unknown parent
 *     become roots.
 *  2. Sort siblings by started_at — children run in that order.
 *  3. Assign step numbers via pre-order DFS so the root is always 1 and
 *     sibling order follows the tree structure, not raw wall-clock times
 *     (which can be slightly out-of-order due to instrumentation overhead).
 *  4. Emit one "parent" edge per parent→child link.
 *  5. Detect parallel siblings (overlapping time intervals) and mark them.
 */
export function buildSpanDag(spans: Span[]): SpanDag {
  if (spans.length === 0) {
    return { nodes: [], edges: [], hasParallelWork: false };
  }

  const bySpanId = new Map(spans.map((s) => [s.span_id, s]));

  const childrenOf = new Map<string, Span[]>();
  const roots: Span[] = [];
  for (const s of spans) {
    const parent = s.parent_span_id;
    if (!parent || !bySpanId.has(parent)) {
      roots.push(s);
    } else {
      const list = childrenOf.get(parent) ?? [];
      list.push(s);
      childrenOf.set(parent, list);
    }
  }

  const byStart = (a: Span, b: Span) =>
    parseBackendDate(a.started_at).getTime() - parseBackendDate(b.started_at).getTime();

  // Sort every sibling group by started_at once.
  roots.sort(byStart);
  for (const children of childrenOf.values()) children.sort(byStart);

  // Pre-order DFS step numbering: root(s) get the smallest numbers, then
  // children in started_at order, recursively. This guarantees the root is
  // always step 1 regardless of instrumentation clock skew.
  const stepBySpanId = new Map<string, number>();
  let counter = 0;
  function dfs(span: Span) {
    stepBySpanId.set(span.span_id, ++counter);
    for (const child of childrenOf.get(span.span_id) ?? []) dfs(child);
  }
  for (const root of roots) dfs(root);
  // Any orphaned spans not reachable from roots (shouldn't happen, but be safe).
  for (const s of spans) {
    if (!stepBySpanId.has(s.span_id)) stepBySpanId.set(s.span_id, ++counter);
  }

  // Detect parallel siblings.
  const overlapBySpanId = new Map<string, boolean>();
  let hasParallelWork = false;
  for (const group of [roots, ...childrenOf.values()]) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (overlaps(group[i], group[j])) {
          overlapBySpanId.set(group[i].span_id, true);
          overlapBySpanId.set(group[j].span_id, true);
          hasParallelWork = true;
        }
      }
    }
  }

  const nodes: DagNode[] = spans.map((s) => ({
    id: s.span_id,
    span: s,
    kind: classifySpan(s),
    step: stepBySpanId.get(s.span_id) ?? 0,
    overlapsWithSibling: overlapBySpanId.get(s.span_id) === true,
  }));

  const edges: DagEdge[] = [];
  for (const s of spans) {
    const parent = s.parent_span_id;
    if (parent && bySpanId.has(parent)) {
      edges.push({
        id: `parent:${parent}->${s.span_id}`,
        source: parent,
        target: s.span_id,
        kind: "parent",
      });
    }
  }

  return { nodes, edges, hasParallelWork };
}
