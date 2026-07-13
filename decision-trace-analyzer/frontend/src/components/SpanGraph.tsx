import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { type Span } from "../api/traces";
import { SpanKindBadge } from "./SpanKindBadge";
import { formatDuration } from "../lib/duration";
import { KIND_STYLES, type KindStyle } from "../lib/spanKindStyles";
import { buildSpanDag, type DagNode } from "../lib/spanDag";
import { type SpanKind } from "../lib/spanAttributes";
import { runLayeredLayout } from "../lib/elkLayout";

interface Props {
  spans: Span[];
  selectedSpanId: string | null;
  onSelect: (span: Span) => void;
}

const NODE_WIDTH = 260;
const NODE_HEIGHT = 56;

type NodeData = { dagNode: DagNode; selected: boolean };

/**
 * Generic span DAG. Every span is one node; edges follow parent_span_id.
 * Step numbers come from pre-order DFS so root = 1, children in started_at
 * order. Nothing is filtered — what you see is what happened.
 *
 * For the simplified agent/conversation view use the Conversation tab.
 */
export function SpanGraph({ spans, selectedSpanId, onSelect }: Props) {
  const dag = useMemo(() => buildSpanDag(spans), [spans]);

  const [layout, setLayout] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (dag.nodes.length === 0) {
      setLayout({ nodes: [], edges: [] });
      return;
    }
    layoutDag(dag).then((r) => { if (!cancelled) setLayout(r); });
    return () => { cancelled = true; };
  }, [dag]);

  const nodesWithSelection = useMemo(() => {
    if (!layout) return [];
    return layout.nodes.map((n) => {
      const data = n.data as NodeData;
      return { ...n, data: { ...data, selected: data.dagNode.span.span_id === selectedSpanId } };
    });
  }, [layout, selectedSpanId]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const data = node.data as NodeData;
      onSelect(data.dagNode.span);
    },
    [onSelect]
  );

  // Collect only the kinds that actually appear so the legend isn't full of
  // unused entries. Must be declared BEFORE any early return — React requires
  // the same hook order on every render.
  const presentKinds = useMemo(() => {
    const seen = new Set<SpanKind>();
    for (const n of dag.nodes) seen.add(n.kind);
    return [...seen];
  }, [dag]);

  if (spans.length === 0) {
    return <div style={styles.empty}>No spans in this trace.</div>;
  }

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span>Span graph ({dag.nodes.length} spans)</span>
      </div>

      {/* Legend — one chip per kind present in this trace */}
      <div style={styles.legend}>
        {presentKinds.map((k) => (
          <LegendChip key={k} kind={k} ks={KIND_STYLES[k]} />
        ))}
        {dag.hasParallelWork && (
          <>
            <span style={styles.legendSep} />
            <span style={{ ...styles.legendItem, color: "var(--color-text-secondary)" }}>
              <span style={styles.parallelDot as React.CSSProperties} /> ran in parallel with a sibling step
            </span>
          </>
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

/* -------------------------------------------------------------------------- */
/* Legend helpers                                                              */
/* -------------------------------------------------------------------------- */

const KIND_LABELS: Record<SpanKind, string> = {
  llm: "LLM", tool: "Tool", agent: "Agent", chain: "Chain",
  retriever: "Retriever", embedding: "Embedding",
  reranker: "Reranker", guardrail: "Guardrail", other: "Other",
};

function LegendChip({ kind, ks }: { kind: SpanKind; ks: KindStyle }) {
  if (kind === "other") return null;
  return (
    <span style={{ ...styles.legendItem }}>
      <span style={{
        display: "inline-block",
        width: 10, height: 10,
        borderRadius: 3,
        background: ks.bg,
        border: `1.5px solid ${ks.border}`,
        flexShrink: 0,
      }} />
      <span style={{ color: ks.border, fontWeight: 600 }}>{KIND_LABELS[kind]}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Node renderer                                                               */
/* -------------------------------------------------------------------------- */

function DagNodeBox({ data }: NodeProps) {
  const { dagNode, selected } = data as NodeData;
  const span = dagNode.span;
  const ks = KIND_STYLES[dagNode.kind];
  const isError = span.status_code === 2;
  const label = span.span_name || span.operation_name || `span:${span.span_id.slice(0, 6)}`;

  return (
    <div
      style={{
        ...nodeStyles.box,
        background: ks.bg,
        borderColor: isError
          ? "var(--color-error-text, #d32f2f)"
          : selected
          ? "var(--color-brand, #0070f2)"
          : ks.border,
        boxShadow: selected ? "0 0 0 2px var(--color-brand, #0070f2)" : nodeStyles.box.boxShadow,
      }}
      title={label}
    >
      <Handle id="in" type="target" position={Position.Top} style={handleHidden} />
      <div style={nodeStyles.top}>
        <span style={nodeStyles.step}>{dagNode.step}</span>
        <span style={nodeStyles.label}>{label}</span>
        <SpanKindBadge span={span} />
      </div>
      <div style={nodeStyles.meta}>
        <span style={nodeStyles.duration}>{formatDuration(span.duration_ms)}</span>
        {isError && <span style={nodeStyles.errorDot} title="ERROR" />}
        {dagNode.overlapsWithSibling && (
          <span style={styles.parallelDot} title="Ran in parallel with a sibling step at the same level" />
        )}
      </div>
      <Handle id="out" type="source" position={Position.Bottom} style={handleHidden} />
    </div>
  );
}

const NODE_TYPES = { dag: DagNodeBox };

/* -------------------------------------------------------------------------- */
/* ELK layout                                                                  */
/* -------------------------------------------------------------------------- */

async function layoutDag(
  dag: ReturnType<typeof buildSpanDag>
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const laidOut = await runLayeredLayout(
    dag.nodes.map((n, idx) => ({
      id: n.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      // modelOrder drives the NODES_AND_EDGES strategy below — lower = earlier.
      layoutOptions: { "elk.position": String(idx) },
      ports: [
        { id: `${n.id}.in`, side: "NORTH" },
        { id: `${n.id}.out`, side: "SOUTH" },
      ],
    })),
    dag.edges.map((e) => ({ id: e.id, sourceId: e.source, targetId: e.target })),
    {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "50",
      "elk.spacing.nodeNode": "36",
      "elk.spacing.edgeNode": "20",
      "elk.spacing.edgeEdge": "12",
      "elk.layered.spacing.edgeNodeBetweenLayers": "20",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
      "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
      // Wrap wide sibling rows so the graph doesn't bleed out of the panel.
      // The value is in ELK units (pixels). With NODE_WIDTH=260 and gap=36,
      // ~3 siblings fit before wrapping — reasonable for most traces.
      "elk.layered.wrapping.strategy": "SINGLE_EDGE",
      "elk.layered.wrapping.additionalEdgeSpacing": "30",
      "elk.layered.wrapping.correctionFactor": "1.0",
      // Wrap threshold: 3 nodes wide + spacing.
      "elk.layered.wrapping.maxEdge.reversal": String((NODE_WIDTH + 36) * 3 + 80),
      // Keep siblings in started_at order (DFS numbering).
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.portConstraints": "FIXED_SIDE",
      "elk.edgeRouting": "ORTHOGONAL",
    },
  );
  const dagNodeById = new Map(dag.nodes.map((n) => [n.id, n]));

  const nodes: Node[] = laidOut.children.map((child) => ({
    id: child.id,
    type: "dag",
    position: { x: child.x, y: child.y },
    data: { dagNode: dagNodeById.get(child.id)!, selected: false } satisfies NodeData,
    draggable: false,
    selectable: false,
    width: child.width || NODE_WIDTH,
    height: child.height || NODE_HEIGHT,
  }));

  const stroke = "#64748b";
  const edges: Edge[] = dag.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: "out",
    targetHandle: "in",
    type: "smoothstep",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: stroke,
      width: 16,
      height: 16,
    },
    style: { stroke, strokeWidth: 2 },
  }));

  return { nodes, edges };
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                      */
/* -------------------------------------------------------------------------- */

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
    borderBottom: "none",
    flexShrink: 0,
  },
  legend: {
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "center",
    gap: "4px 12px",
    padding: "5px 16px 8px",
    borderBottom: "1px solid var(--color-border)",
    flexShrink: 0,
    fontSize: 11,
  },
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  legendSep: {
    width: 1,
    height: 14,
    background: "var(--color-border)",
    flexShrink: 0,
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
  parallelDot: {
    display: "inline-block",
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#f59e0b",
    flexShrink: 0,
  },
};

const nodeStyles: Record<string, React.CSSProperties> = {
  box: {
    width: NODE_WIDTH,
    minHeight: NODE_HEIGHT,
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
    padding: "7px 11px",
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
  top: { display: "flex", alignItems: "center", gap: 5, minWidth: 0 },
  meta: { display: "flex", alignItems: "center", gap: 6, minHeight: 14 },
  step: {
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 700,
    color: "var(--color-text-secondary)",
    background: "var(--color-code-bg)",
    borderRadius: 4,
    padding: "0 5px",
    fontVariantNumeric: "tabular-nums",
    lineHeight: "16px",
  },
  label: {
    flex: 1,
    minWidth: 0,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  duration: {
    fontSize: 10,
    color: "var(--color-text-secondary)",
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  },
  errorDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--color-error-text, #d32f2f)",
  },
};

const handleHidden: React.CSSProperties = {
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  background: "transparent",
  border: "none",
  opacity: 0,
  pointerEvents: "none" as const,
};
