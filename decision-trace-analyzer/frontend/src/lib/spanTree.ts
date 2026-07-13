import { type Span } from "../api/traces";

export interface TreeNode {
  span: Span;
  children: TreeNode[];
}

/**
 * Build the parent/child forest from a flat list of spans.
 *
 * A span is a root if its parent_span_id is empty OR if its parent_span_id
 * doesn't match any span in this trace (orphans — can happen when an
 * upstream span was filtered out). Roots are rendered at depth 0; orphans
 * keep their hierarchy intact below.
 *
 * Sibling order: by started_at (earliest first), so the tree reads top-down
 * the way the execution actually unfolded.
 */
export function buildForest(spans: Span[]): TreeNode[] {
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

  const cmp = (a: Span, b: Span) => a.started_at.localeCompare(b.started_at);
  const wrap = (span: Span): TreeNode => ({
    span,
    children: (childrenOf.get(span.span_id) ?? []).sort(cmp).map(wrap),
  });
  return roots.sort(cmp).map(wrap);
}

/**
 * Flatten a forest in DFS order, carrying the depth alongside each node.
 * Used by row-oriented views (Tree, Timeline) that render one row per span
 * with indentation proportional to depth.
 */
export function flattenForest(forest: TreeNode[]): { span: Span; depth: number }[] {
  const out: { span: Span; depth: number }[] = [];
  const walk = (node: TreeNode, depth: number) => {
    out.push({ span: node.span, depth });
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const root of forest) walk(root, 0);
  return out;
}
