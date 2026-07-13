import { useMemo } from "react";
import { type Span } from "../api/traces";
import { SpanKindBadge } from "./SpanKindBadge";
import { buildForest, type TreeNode } from "../lib/spanTree";

interface Props {
  spans: Span[];
  selectedSpanId: string | null;
  onSelect: (span: Span) => void;
}

export function SpanTree({ spans, selectedSpanId, onSelect }: Props) {
  const forest = useMemo(() => buildForest(spans), [spans]);

  return (
    <div style={styles.root}>
      <div style={styles.header}>Spans ({spans.length})</div>
      <div style={styles.list}>
        {forest.map((node) => (
          <TreeRow
            key={node.span.span_id}
            node={node}
            depth={0}
            selectedSpanId={selectedSpanId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  selectedSpanId,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedSpanId: string | null;
  onSelect: (span: Span) => void;
}) {
  const { span } = node;
  const isSelected = selectedSpanId === span.span_id;
  const isError = span.status_code === 2;
  const label = span.span_name || span.operation_name || "(unnamed)";

  return (
    <>
      <div
        style={{
          ...styles.item,
          ...(isSelected ? styles.itemSelected : {}),
          paddingLeft: 12 + depth * 16,
        }}
        onClick={() => onSelect(span)}
        title={label}
      >
        <div style={styles.itemLeft}>
          {depth > 0 && <span style={styles.connector} aria-hidden>└</span>}
          <span style={styles.label}>{label}</span>
          <SpanKindBadge span={span} />
          {isError && <span style={styles.errorDot} title={span.status_message || "Error"} />}
        </div>
        <span style={styles.duration}>{span.duration_ms.toFixed(0)}ms</span>
      </div>
      {node.children.map((child) => (
        <TreeRow
          key={child.span.span_id}
          node={child}
          depth={depth + 1}
          selectedSpanId={selectedSpanId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    minWidth: 0,
    borderRight: "1px solid var(--color-border)",
    overflowY: "auto" as const,
    background: "var(--color-surface)",
    display: "flex",
    flexDirection: "column" as const,
  },
  header: {
    padding: "10px 16px",
    fontWeight: 600,
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    borderBottom: "1px solid var(--color-border)",
    flexShrink: 0,
  },
  list: { overflowY: "auto" as const, flex: 1 },
  item: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    cursor: "pointer",
    borderBottom: "1px solid var(--color-border)",
    gap: 8,
    minWidth: 0,
  },
  itemSelected: {
    background: "var(--sapList_SelectionBackgroundColor, #e8f0fb)",
    borderLeft: "3px solid var(--color-brand)",
  },
  itemLeft: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    flex: 1,
    overflow: "hidden",
  },
  connector: {
    color: "var(--color-text-secondary)",
    fontSize: 11,
    opacity: 0.5,
    flexShrink: 0,
  },
  label: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text)",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  errorDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--color-error-text, #d32f2f)",
    flexShrink: 0,
  },
  duration: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
};
