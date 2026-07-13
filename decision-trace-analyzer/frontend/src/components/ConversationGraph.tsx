import "@ui5/webcomponents-icons/dist/person-placeholder.js";
import "@ui5/webcomponents-icons/dist/discussion.js";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { type Span } from "../api/traces";
import { SpanKindBadge } from "./SpanKindBadge";
import { KIND_STYLES } from "../lib/spanKindStyles";
import { formatDuration } from "../lib/duration";
import {
  buildConversationFlow,
  type FlowNode,
  type EdgeRole,
} from "../lib/conversationFlow";
import { runLayeredLayout, type LayoutPortInput } from "../lib/elkLayout";

interface Props {
  spans: Span[];
  selectedSpanId: string | null;
  onSelect: (span: Span) => void;
}

/**
 * Node sizing — bigger than the previous version because we now show real
 * content inside (tool calls, args/result snippets, prompt/reply text). Width
 * is fixed but height varies by node shape since user/assistant bubbles and
 * tool-call boxes need different room.
 */
const OP_WIDTH = 280;
const OP_HEIGHT_LLM = 76;
const OP_HEIGHT_TOOL = 96;
const OP_HEIGHT_DEFAULT = 56;
const BUBBLE_WIDTH = 280;
const BUBBLE_HEIGHT = 96;

type NodeData = {
  flowNode: FlowNode;
  selected: boolean;
};

/**
 * Conversation-flow view. Visualises an agent trace the way a human reasons
 * about a chat: user prompt at the top, the agent's LLM/Tool loop in the
 * middle, assistant reply at the bottom.
 *
 * This view is intentionally OPINIONATED — it filters and simplifies. Use the
 * generic Graph view when you need to see every span verbatim (retrievers,
 * embeddings, framework plumbing). The hard work happens in
 * lib/conversationFlow.ts:
 *   - LangChain plumbing spans (RunnableSequence, ChatPromptTemplate, etc.)
 *     are dropped — they have no semantic meaning to a user reading the trace.
 *   - LLM and Tool spans are deduplicated by span_name, so the same operation
 *     run multiple times collapses into a single node with iteration count.
 *   - Edges carry *roles* (asks / calls / returns / responds) plus per-step
 *     numbers so the loop reads as ① → ② → ③ rather than "×3".
 */
export function ConversationGraph({ spans, selectedSpanId, onSelect }: Props) {
  const flow = useMemo(() => buildConversationFlow(spans), [spans]);

  const [layout, setLayout] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (flow.nodes.length === 0) {
      setLayout({ nodes: [], edges: [] });
      return;
    }
    layoutFlow(flow).then((result) => {
      if (!cancelled) setLayout(result);
    });
    return () => {
      cancelled = true;
    };
  }, [flow]);

  // Selection state is layered on top of layout so clicks don't re-trigger elk.
  const nodesWithSelection = useMemo(() => {
    if (!layout) return [];
    return layout.nodes.map((n) => {
      const data = n.data as NodeData;
      const isSelected = data.flowNode.spans.some((s) => s.span_id === selectedSpanId);
      return { ...n, data: { ...data, selected: isSelected } };
    });
  }, [layout, selectedSpanId]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const data = node.data as NodeData;
      const first = data.flowNode.spans[0];
      if (first) onSelect(first);
    },
    [onSelect]
  );

  if (spans.length === 0) {
    return <div style={styles.empty}>No spans in this trace.</div>;
  }

  const opCount = flow.nodes.filter((n) => n.shape === "op").length;
  const edgeCount = flow.edges.length;

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span>Execution flow ({opCount} ops, {edgeCount} transitions)</span>
        {flow.fellBackToAllSpans && (
          <span style={styles.fallbackHint} title="No LLM or Tool spans found — showing other spans">
            no llm/tool spans
          </span>
        )}
      </div>
      <div style={styles.flow}>
        {!layout ? (
          <div style={styles.center}>Laying out…</div>
        ) : (
          <ReactFlow
            nodes={nodesWithSelection}
            edges={layout.edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodeClick={handleNodeClick}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
            minZoom={0.1}
            maxZoom={2}
          >
            <Background gap={16} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Node renderers                                                             */
/* ------------------------------------------------------------------------- */

function FlowNodeBox({ data }: NodeProps) {
  const { flowNode, selected } = data as NodeData;

  if (flowNode.shape === "user") {
    return <BubbleNode flowNode={flowNode} selected={selected} variant="user" />;
  }
  if (flowNode.shape === "assistant") {
    return <BubbleNode flowNode={flowNode} selected={selected} variant="assistant" />;
  }
  return <OpNode flowNode={flowNode} selected={selected} />;
}

function BubbleNode({
  flowNode,
  selected,
  variant,
}: {
  flowNode: FlowNode;
  selected: boolean;
  variant: "user" | "assistant";
}) {
  const accent = variant === "user" ? "#4c8bf5" : "#7c4dff";
  return (
    <div
      style={{
        ...nodeStyles.bubble,
        borderColor: selected ? "var(--color-brand, #0070f2)" : accent,
        boxShadow: selected ? "0 0 0 2px var(--color-brand, #0070f2)" : nodeStyles.bubble.boxShadow,
      }}
      title={flowNode.text}
    >
      <Handle id="in" type="target" position={Position.Top} style={handleStyles.hidden} />
      {/* Left-side target — receives skip-down "responds" edges from an LLM
          that sits above intervening ops, so the edge runs around the left
          of the stack into this bubble. Only the assistant ever uses it. */}
      <Handle id="skip-in" type="target" position={Position.Left} style={handleStyles.hidden} />
      <div style={{ ...nodeStyles.bubbleHeader, color: accent }}>
        {/* @ts-ignore */}
        <ui5-icon name={variant === "user" ? "person-placeholder" : "discussion"} style={{ width: 14, height: 14 } as React.CSSProperties} />
        {flowNode.label}
      </div>
      <div style={nodeStyles.bubbleText}>{flowNode.text}</div>
      <Handle id="out" type="source" position={Position.Bottom} style={handleStyles.hidden} />
    </div>
  );
}

function OpNode({ flowNode, selected }: { flowNode: FlowNode; selected: boolean }) {
  const repSpan = flowNode.spans[0];
  const isError = flowNode.spans.some((s) => s.status_code === 2);
  const ks = KIND_STYLES[flowNode.kind];

  return (
    <div
      style={{
        ...nodeStyles.op,
        background: ks.bg,
        borderColor: isError
          ? "var(--color-error-text)"
          : selected
            ? "var(--color-brand, #0070f2)"
            : ks.border,
        boxShadow: selected ? "0 0 0 2px var(--color-brand, #0070f2)" : nodeStyles.op.boxShadow,
      }}
      title={flowNode.label}
    >
      {/* Forward edges enter on the top, exit on the bottom — straight vertical
          flow. Back-edges ("returns") use the right side instead so they route
          as a C-curve around the node rather than overlapping the forward edge
          in the same vertical channel. id="back" matches the sourceHandle /
          targetHandle we set on returns edges in layoutFlow(). */}
      <Handle id="in" type="target" position={Position.Top} style={handleStyles.hidden} />
      {/* Left-side target — receives skip-down "responds" edges from an LLM
          that sits above intervening ops, so the edge runs around the left
          of the stack into this bubble. Only the assistant ever uses it. */}
      <Handle id="skip-in" type="target" position={Position.Left} style={handleStyles.hidden} />
      <Handle id="back-in" type="target" position={Position.Right} style={handleStyles.hidden} />
      <div style={nodeStyles.opTop}>
        <span style={nodeStyles.opLabel}>{flowNode.label}</span>
        <SpanKindBadge span={repSpan} />
      </div>
      <div style={nodeStyles.opMeta}>
        <span style={nodeStyles.opDuration}>{formatDuration(flowNode.totalDurationMs)}</span>
        {flowNode.count > 1 && (
          <span style={nodeStyles.countPill} title={`Executed ${flowNode.count} times`}>
            ×{flowNode.count}
          </span>
        )}
        {isError && <span style={nodeStyles.errorDot} title="One or more iterations errored" />}
      </div>
      {flowNode.kind === "llm" && flowNode.toolCalls && flowNode.toolCalls.length > 0 && (
        <div style={nodeStyles.toolCallsList} title={flowNode.toolCalls.map((c) => c.name).join(", ")}>
          → {flowNode.toolCalls.slice(0, 3).map((c) => c.name).join(", ")}
          {flowNode.toolCalls.length > 3 && ` +${flowNode.toolCalls.length - 3}`}
        </div>
      )}
      {flowNode.kind === "tool" && flowNode.toolPayload && (
        <>
          {flowNode.toolPayload.argsSnippet && (
            <div style={nodeStyles.payloadArgs} title={flowNode.toolPayload.argsSnippet}>
              args: <span style={nodeStyles.payloadValue}>{flowNode.toolPayload.argsSnippet}</span>
            </div>
          )}
          {flowNode.toolPayload.resultSnippet && (
            <div style={nodeStyles.payloadResult} title={flowNode.toolPayload.resultSnippet}>
              ⤷ {flowNode.toolPayload.resultSnippet}
            </div>
          )}
        </>
      )}
      <Handle id="out" type="source" position={Position.Bottom} style={handleStyles.hidden} />
      <Handle id="back-out" type="source" position={Position.Right} style={handleStyles.hidden} />
      {/* Left-side source — used by the "skip-down" responds edge when this
          LLM produced the final answer but a tool ran AFTER it (and so sits
          below this node in the layout). The edge enters the assistant via
          its skip-in handle (also Left), so the visual path is a smooth
          C-curve around the left of the intervening ops. Mirror image of
          back-out on the right. */}
      <Handle id="skip-out" type="source" position={Position.Left} style={handleStyles.hidden} />
    </div>
  );
}

const NODE_TYPES = { flow: FlowNodeBox };

/* Node colours now come from the central KIND_STYLES palette so all views
   stay in sync when new span kinds are added. */

/* ------------------------------------------------------------------------- */
/* Edge styling — role-aware                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Per-role visual treatment. All edges are solid now — the role is conveyed by
 * colour + the chip text inside it, and direction by the arrow head + layout
 * (back-edges route around the right of the node). Dashing turned out to read
 * as "uncertain" rather than "return path", so it's gone.
 */
const EDGE_STYLES: Record<EdgeRole, { stroke: string; pillBg: string }> = {
  asks:      { stroke: "#4c8bf5", pillBg: "#4c8bf5" },
  calls:     { stroke: "#1565c0", pillBg: "#1565c0" },
  returns:   { stroke: "#2e7d32", pillBg: "#2e7d32" },
  next:      { stroke: "#475569", pillBg: "#475569" },
  responds:  { stroke: "#7c4dff", pillBg: "#7c4dff" },
  retrieves: { stroke: "#b45309", pillBg: "#b45309" },
  reranks:   { stroke: "#92400e", pillBg: "#92400e" },
  embeds:    { stroke: "#0369a1", pillBg: "#0369a1" },
  guards:    { stroke: "#be123c", pillBg: "#be123c" },
  delegates: { stroke: "#6d28d9", pillBg: "#6d28d9" },
};

/**
 * Custom edge — renders the standard smooth-step path, then drops one labelled
 * chip per traversal along the path. With a single traversal you see e.g.
 * `① calls foo`; with three you see `① calls foo`, `③ calls foo`, `⑤ calls foo`
 * spread along the same edge so the loop's execution order is readable at a
 * glance. Chips are positioned by interpolating the source→target midpoint per
 * step — exact path-following would need an SVG <textPath>, but for the typical
 * 1-3 traversals straight-line interpolation reads clearly enough.
 */
type StepEdgeData = {
  role: EdgeRole;
  steps: number[];
  detail?: string;
};

function StepNumberedEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const d = data as StepEdgeData;
  const roleStyle = EDGE_STYLES[d.role];
  const baseText = d.role === "calls" && d.detail ? `calls ${d.detail}` : d.role;

  // getSmoothStepPath gives us labelX/Y — the geometric midpoint ON the actual
  // rendered path. For multiple chips we stagger them along the dominant axis
  // of the edge (vertical for forward edges, horizontal for back-edges) so
  // they stay close to the path instead of drifting off onto the chord.
  const n = d.steps.length;
  const STEP = 20; // px between consecutive chips along the edge
  const isHorizontalDominant = Math.abs(targetX - sourceX) > Math.abs(targetY - sourceY);
  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        {d.steps.map((step, i) => {
          const offset = (i - (n - 1) / 2) * STEP;
          const x = labelX + (isHorizontalDominant ? offset : 0);
          const y = labelY + (isHorizontalDominant ? 0 : offset);
          return (
            <div
              key={step}
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
                background: roleStyle.pillBg,
                color: "white",
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 10,
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
                pointerEvents: "all",
                boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
              }}
              title={`Step ${step}: ${baseText}`}
            >
              {step}. {baseText}
            </div>
          );
        })}
      </EdgeLabelRenderer>
    </>
  );
}

const EDGE_TYPES = { step: StepNumberedEdge };

/* ------------------------------------------------------------------------- */
/* Layout — elkjs                                                             */
/* ------------------------------------------------------------------------- */

async function layoutFlow(
  flow: ReturnType<typeof buildConversationFlow>
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const heightFor = (n: FlowNode): number => {
    if (n.shape === "user" || n.shape === "assistant") return BUBBLE_HEIGHT;
    if (n.kind === "llm") return OP_HEIGHT_LLM;
    if (n.kind === "tool") return OP_HEIGHT_TOOL;
    return OP_HEIGHT_DEFAULT;
  };
  const widthFor = (n: FlowNode): number =>
    n.shape === "user" || n.shape === "assistant" ? BUBBLE_WIDTH : OP_WIDTH;

  // A back-edge is any edge whose target appears at or before its source in
  // execution order. Detected topologically (not by role) so loops between
  // ANY two op kinds route around the right of the nodes instead of through
  // the central forward channel.
  const nodeIndex = new Map(flow.nodes.map((n, i) => [n.id, i]));
  const isBackEdge = (e: { source: string; target: string }): boolean => {
    const si = nodeIndex.get(e.source);
    const ti = nodeIndex.get(e.target);
    return si !== undefined && ti !== undefined && ti <= si;
  };
  const nodesWithBackEdge = new Set(
    flow.edges.filter(isBackEdge).flatMap((e) => [e.source, e.target])
  );

  // Strategy: lay out ONLY the op nodes with elk, then manually place the
  // user bubble above the first LLM op and the assistant bubble below the
  // final LLM op (the bookends' edge targets). Why manual? elk's layered
  // algorithm has no opinion about where in the layer a bookend goes — it
  // happily parks the assistant next to a tool that happens to be in the
  // deepest layer, producing the criss-cross "responds" edges we kept
  // hitting. Removing bookends from the layered graph removes the problem.
  const bookendIds = new Set(
    flow.nodes.filter((n) => n.shape !== "op").map((n) => n.id)
  );
  const opNodes = flow.nodes.filter((n) => n.shape === "op");
  const opEdges = flow.edges.filter(
    (e) => !bookendIds.has(e.source) && !bookendIds.has(e.target)
  );

  // "Skip-down" responds: the assistant edge originates from an LLM that
  // sits in the middle of the op stack (because a tool ran after it). We
  // route that edge through a LEFT-side handle on the LLM, so it runs
  // around the left of the intervening ops — mirror image of the right-
  // side returns back-edge. (Implemented in the React Flow handle/edge
  // wiring further down; elk doesn't see this edge because the assistant
  // bubble is placed manually.)
  const respondsEdge = flow.edges.find((e) => e.role === "responds");
  const trailingOpId = opNodes.length > 0 ? opNodes[opNodes.length - 1].id : null;
  const respondsIsSkipDown = !!(
    respondsEdge &&
    !bookendIds.has(respondsEdge.source) &&
    respondsEdge.source !== trailingOpId
  );

  const elkNodes = opNodes.map((n) => {
    const ports: LayoutPortInput[] = [
      { id: `${n.id}.in`, side: "NORTH" },
      { id: `${n.id}.out`, side: "SOUTH" },
    ];
    if (nodesWithBackEdge.has(n.id)) {
      ports.push(
        { id: `${n.id}.back-in`, side: "EAST" },
        { id: `${n.id}.back-out`, side: "EAST" },
      );
    }
    return { id: n.id, width: widthFor(n), height: heightFor(n), ports };
  });
  const elkEdges = opEdges.map((e) => {
    const useBack = isBackEdge(e);
    return {
      id: e.id,
      sourceId: e.source,
      targetId: e.target,
      sourcePort: useBack ? `${e.source}.back-out` : `${e.source}.out`,
      targetPort: useBack ? `${e.target}.back-in` : `${e.target}.in`,
    };
  });

  const laidOut = await runLayeredLayout(elkNodes, elkEdges, {
    "elk.algorithm": "layered",
    "elk.direction": "DOWN",
    "elk.layered.spacing.nodeNodeBetweenLayers": "90",
    "elk.spacing.nodeNode": "60",
    "elk.spacing.edgeNode": "30",
    "elk.spacing.edgeEdge": "20",
    "elk.layered.spacing.edgeNodeBetweenLayers": "30",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "20",
    "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
    "elk.portConstraints": "FIXED_SIDE",
    "elk.edgeRouting": "ORTHOGONAL",
  });
  const flowNodeById = new Map(flow.nodes.map((n) => [n.id, n]));

  // Op nodes — positions from elk, but x-centred on a single column.
  // elk's layered algorithm places each layer's nodes optimally for THAT
  // layer's edges, which can produce small x-drifts even in a one-node-
  // per-layer stack (ports compete for centring with edge bend points).
  // Forcing all op nodes onto the same x — the median x of what elk
  // produced — turns the graph into a clean vertical column without
  // breaking any of elk's edge routing decisions.
  const rawCenters = laidOut.children.map((c) => c.x + (c.width || OP_WIDTH) / 2);
  const medianCenter = rawCenters.length > 0
    ? rawCenters.slice().sort((a, b) => a - b)[Math.floor(rawCenters.length / 2)]
    : 0;

  const opPositions = new Map<string, { x: number; y: number }>();
  const nodes: Node[] = laidOut.children.map((child) => {
    const flowNode = flowNodeById.get(child.id)!;
    const w = child.width || OP_WIDTH;
    const x = medianCenter - w / 2;
    const y = child.y;
    opPositions.set(child.id, { x, y });
    return {
      id: child.id,
      type: "flow",
      position: { x, y },
      data: { flowNode, selected: false } satisfies NodeData,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      draggable: false,
      selectable: false,
      width: w,
    };
  });

  // Bookends — manually placed so they always sit cleanly above/below the
  // op stack instead of being crammed into a layer by elk.
  //
  //   - user bubble: above the FIRST op (highest y from elk's layout)
  //   - assistant bubble: below the LAST op (largest y + height)
  //
  // We deliberately anchor on the layout extremes rather than on whichever
  // op happens to be the responds-edge source. Anchoring on the source
  // works for linear traces but breaks for "LLM → tool → tool → ..."
  // where the LLM is not at the bottom; the assistant would then land in
  // the middle of the stack, blocking it.
  // Gap large enough that the step chip on the bookend's incoming/outgoing
  // edge sits in clear space and never overlaps the anchor op's body.
  // The chip is rendered at the geometric midpoint of the edge, so we need
  // at least ~80px of clear vertical space below the op's bottom for the
  // chip to land cleanly.
  const BOOKEND_GAP = 160;
  let firstOpId: string | undefined;
  let lastOpId: string | undefined;
  let firstY = Infinity;
  let lastBottom = -Infinity;
  for (const [id, pos] of opPositions) {
    const op = opNodes.find((n) => n.id === id);
    if (!op) continue;
    const h = heightFor(op);
    if (pos.y < firstY) {
      firstY = pos.y;
      firstOpId = id;
    }
    if (pos.y + h > lastBottom) {
      lastBottom = pos.y + h;
      lastOpId = id;
    }
  }

  for (const node of flow.nodes) {
    if (node.shape === "op") continue;
    const isUser = node.shape === "user";
    const anchorId = isUser ? firstOpId : lastOpId;
    const anchorPos = anchorId ? opPositions.get(anchorId) : undefined;
    const w = widthFor(node);
    const h = heightFor(node);
    if (anchorPos && anchorId) {
      const opNode = opNodes.find((n) => n.id === anchorId);
      const opW = opNode ? widthFor(opNode) : OP_WIDTH;
      const opH = opNode ? heightFor(opNode) : OP_HEIGHT_DEFAULT;
      const x = anchorPos.x + opW / 2 - w / 2;
      const y = isUser ? anchorPos.y - h - BOOKEND_GAP : anchorPos.y + opH + BOOKEND_GAP;
      nodes.push({
        id: node.id,
        type: "flow",
        position: { x, y },
        data: { flowNode: node, selected: false } satisfies NodeData,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        draggable: false,
        selectable: false,
        width: w,
      });
    }
  }

  const edges: Edge[] = flow.edges.map((e) => {
    const style = EDGE_STYLES[e.role];
    const useBack = isBackEdge(e);
    // Skip-down responds: the only responds edge in the flow, and only
    // when its source isn't the spatially-last op. Route via left-side
    // handles so it C-curves around any tools that ran after the LLM.
    const useSkip = respondsIsSkipDown && e === respondsEdge;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      // sourceHandle/targetHandle must match the Handle id= props on the node;
      // this is what tells React Flow which anchor on the source/target to use.
      sourceHandle: useSkip ? "skip-out" : useBack ? "back-out" : "out",
      targetHandle: useSkip ? "skip-in" : useBack ? "back-in" : "in",
      // Custom edge renders one step-numbered chip per traversal — data is the
      // contract between buildConversationFlow and StepNumberedEdge.
      type: "step",
      data: {
        role: e.role,
        steps: e.steps,
        detail: e.detail,
      } satisfies StepEdgeData,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: style.stroke,
        width: 20,
        height: 20,
      },
      style: {
        stroke: style.stroke,
        strokeWidth: 2,
      },
    };
  });

  return { nodes, edges };
}

/* ------------------------------------------------------------------------- */
/* Styles                                                                     */
/* ------------------------------------------------------------------------- */

const styles: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    minWidth: 0,
    background: "var(--color-surface)",
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "10px 16px",
    fontWeight: 600,
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    borderBottom: "1px solid var(--color-border)",
    flexShrink: 0,
  },
  fallbackHint: {
    fontSize: 10,
    fontWeight: 500,
    color: "var(--color-text-secondary)",
    background: "var(--color-code-bg)",
    padding: "2px 6px",
    borderRadius: 4,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  flow: { flex: 1, minHeight: 0, position: "relative" as const },
  empty: {
    padding: "32px 16px",
    textAlign: "center" as const,
    color: "var(--color-text-secondary)",
    fontSize: "var(--font-size-sm)",
  },
  center: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    width: "100%",
    color: "var(--color-text-secondary)",
    fontSize: "var(--font-size-sm)",
  },
};

const nodeStyles: Record<string, React.CSSProperties> = {
  // --- User / Assistant bubble -------------------------------------------
  bubble: {
    width: BUBBLE_WIDTH,
    height: BUBBLE_HEIGHT,
    padding: "10px 14px",
    borderRadius: 14,
    border: "2px solid",
    background: "var(--color-surface)",
    boxSizing: "border-box" as const,
    boxShadow: "0 2px 4px rgba(0,0,0,0.08)",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    overflow: "hidden",
  },
  bubbleHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  bubbleText: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical" as const,
    fontSize: 12,
    lineHeight: 1.35,
    color: "var(--color-text)",
  },

  // --- Operation node -----------------------------------------------------
  op: {
    width: OP_WIDTH,
    minHeight: OP_HEIGHT_DEFAULT,
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1.5px solid",
    boxSizing: "border-box" as const,
    boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text)",
    overflow: "hidden",
  },
  opTop: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 },
  opMeta: { display: "flex", alignItems: "center", gap: 6, minHeight: 14 },
  opLabel: {
    flex: 1,
    minWidth: 0,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  opDuration: {
    fontSize: 10,
    color: "var(--color-text-secondary)",
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  },
  countPill: {
    fontSize: 10,
    fontWeight: 700,
    padding: "1px 6px",
    borderRadius: 8,
    background: "var(--color-brand, #0070f2)",
    color: "white",
    letterSpacing: "0.02em",
  },
  errorDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--color-error-text, #d32f2f)",
  },
  toolCallsList: {
    fontSize: 10,
    color: "#1565c0",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  payloadArgs: {
    fontSize: 10,
    color: "var(--color-text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  payloadValue: {
    color: "var(--color-text)",
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
  },
  payloadResult: {
    fontSize: 10,
    color: "#2e7d32",
    fontStyle: "italic" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
};

// React Flow needs <Handle> in the DOM to anchor edges. We hide it visually so
// nothing draws over the node content.
const handleStyles: Record<string, React.CSSProperties> = {
  hidden: {
    width: 1,
    height: 1,
    minWidth: 0,
    minHeight: 0,
    background: "transparent",
    border: "none",
    opacity: 0,
    pointerEvents: "none" as const,
  },
};
