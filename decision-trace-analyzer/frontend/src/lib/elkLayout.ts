import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";

/**
 * Shared ELK layout helper.
 *
 * Both `SpanGraph` and `ConversationGraph` run ELK's layered algorithm over a
 * caller-built graph. The layout STRATEGIES genuinely differ (SpanGraph uses
 * wrapping + model-order pinning; ConversationGraph uses a single vertical
 * column with back-edges + manually-placed bookends), but the boilerplate is
 * the same in both: build an `ElkNode` root, call `elk.layout`, then unpack
 * the result. That boilerplate lives here so a change to ELK's API only has to
 * be made in one place.
 *
 * Callers still own everything above and below the layout call — port
 * side/back-edge routing, React Flow node/edge construction, post-layout
 * transforms (e.g. ConversationGraph's median-x re-centre and bookend
 * placement). We deliberately do NOT abstract those because they diverge.
 */

/** ELK is a WASM module with a heavy boot cost; share one instance across callers. */
const elk = new ELK();

export type PortSide = "NORTH" | "SOUTH" | "EAST" | "WEST";

export interface LayoutPortInput {
  /** Full port id — must include any node-scoped prefix (e.g. `${nodeId}.back-out`). */
  id: string;
  side: PortSide;
}

export interface LayoutNodeInput {
  id: string;
  width: number;
  height: number;
  ports?: LayoutPortInput[];
  /** Per-node layoutOptions — e.g. `elk.position` for model-order pinning. */
  layoutOptions?: Record<string, string>;
}

export interface LayoutEdgeInput {
  id: string;
  sourceId: string;
  targetId: string;
  /**
   * Optional explicit port references. When omitted we default to
   * `${sourceId}.out` and `${targetId}.in`, matching the port naming both
   * current callers use for their forward edges.
   */
  sourcePort?: string;
  targetPort?: string;
}

export interface LayoutResultNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  children: LayoutResultNode[];
}

/**
 * Run ELK's `layered` algorithm on the caller-provided graph description.
 * Unpacks the response with sensible defaults so callers don't have to
 * juggle possibly-undefined coordinates.
 */
export async function runLayeredLayout(
  nodes: LayoutNodeInput[],
  edges: LayoutEdgeInput[],
  layoutOptions: Record<string, string>,
): Promise<LayoutResult> {
  const graph: ElkNode = {
    id: "root",
    layoutOptions,
    children: nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      layoutOptions: n.layoutOptions,
      ports: (n.ports ?? []).map((p) => ({
        id: p.id,
        layoutOptions: { "elk.port.side": p.side },
      })),
    })),
    edges: edges.map<ElkExtendedEdge>((e) => ({
      id: e.id,
      sources: [e.sourcePort ?? `${e.sourceId}.out`],
      targets: [e.targetPort ?? `${e.targetId}.in`],
    })),
  };

  const laidOut = await elk.layout(graph);
  return {
    children: (laidOut.children ?? []).map((c) => ({
      id: c.id!,
      x: c.x ?? 0,
      y: c.y ?? 0,
      width: c.width ?? 0,
      height: c.height ?? 0,
    })),
  };
}
