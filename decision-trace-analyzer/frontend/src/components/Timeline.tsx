import { useMemo } from "react";
import { type Span } from "../api/traces";
import { SpanKindBadge } from "./SpanKindBadge";
import { buildForest, flattenForest } from "../lib/spanTree";
import { parseBackendDate } from "../lib/dates";
import { formatDuration } from "../lib/duration";
import { classifySpan, type SpanKind } from "../lib/spanAttributes";

interface Props {
  spans: Span[];
  selectedSpanId: string | null;
  onSelect: (span: Span) => void;
}

interface Row {
  span: Span;
  depth: number;
  /** Offset from trace start as a fraction [0, 1]. */
  startFrac: number;
  /** Bar width as a fraction [0, 1]. */
  widthFrac: number;
}

/**
 * Per-kind bar colours. Slightly more saturated than the badge swatches so the
 * bars carry weight against the white panel; the foreground matches the badge
 * accent so coloured borders feel consistent.
 */
const BAR_COLORS: Record<SpanKind, { fill: string; border: string }> = {
  tool:      { fill: "rgba(76, 175, 80, 0.55)",  border: "#2e7d32" },
  llm:       { fill: "rgba(33, 150, 243, 0.55)", border: "#1565c0" },
  agent:     { fill: "rgba(156, 39, 176, 0.55)", border: "#6a1b9a" },
  chain:     { fill: "rgba(255, 152, 0, 0.55)",  border: "#e65100" },
  retriever: { fill: "rgba(0, 188, 212, 0.55)",  border: "#00838f" },
  embedding: { fill: "rgba(63, 81, 181, 0.55)",  border: "#283593" },
  reranker:  { fill: "rgba(121, 85, 72, 0.55)",  border: "#4e342e" },
  guardrail: { fill: "rgba(244, 67, 54, 0.55)",  border: "#c62828" },
  other:     { fill: "rgba(120, 143, 166, 0.45)", border: "#788fa6" },
};

/** Bars narrower than this fraction are stretched to it so 1ms spans stay visible. */
const MIN_BAR_FRAC = 0.005;

/** Number of evenly-spaced ticks on the time axis (including 0 and the end). */
const AXIS_TICK_COUNT = 5;

/** Width of the fixed label column on the left, in pixels. */
const LABEL_COL_WIDTH = 200;

/**
 * Waterfall view of a trace. Each span renders as one row: span name on the
 * left, a coloured bar positioned by `started_at` and sized by `duration_ms`
 * on the right, with a fixed time axis above. Hierarchy is shown by indenting
 * labels per depth (bars are NOT indented — their horizontal position is
 * absolute time).
 */
export function Timeline({ spans, selectedSpanId, onSelect }: Props) {
  const { rows, traceDuration } = useMemo(() => computeRows(spans), [spans]);

  if (spans.length === 0) {
    return <div style={styles.empty}>No spans in this trace.</div>;
  }

  return (
    <div style={styles.root}>
      <div style={styles.header}>Spans ({spans.length})</div>
      <div style={styles.axisRow}>
        <div style={styles.axisLabelGutter} />
        <TimeAxis duration={traceDuration} />
      </div>
      <div style={styles.list}>
        {rows.map((row) => (
          <TimelineRow
            key={row.span.span_id}
            row={row}
            isSelected={selectedSpanId === row.span.span_id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function TimelineRow({
  row,
  isSelected,
  onSelect,
}: {
  row: Row;
  isSelected: boolean;
  onSelect: (span: Span) => void;
}) {
  const { span, depth, startFrac, widthFrac } = row;
  const label = span.span_name || span.operation_name || "(unnamed)";
  const isError = span.status_code === 2;
  const kind = classifySpan(span);
  const color = BAR_COLORS[kind];

  const leftPct = `${(startFrac * 100).toFixed(3)}%`;
  const widthPct = `${(Math.max(widthFrac, MIN_BAR_FRAC) * 100).toFixed(3)}%`;
  // Duration label sits to the right of the bar; push it inward if the bar
  // already extends past ~85% so it doesn't overflow the row.
  const durationOnRight = startFrac + widthFrac < 0.85;

  return (
    <div
      style={{ ...styles.row, ...(isSelected ? styles.rowSelected : {}) }}
      onClick={() => onSelect(span)}
      title={`${label} · ${formatDuration(span.duration_ms)}`}
    >
      <div style={{ ...styles.labelCell, paddingLeft: 12 + depth * 14 }}>
        {depth > 0 && <span style={styles.connector} aria-hidden>└</span>}
        <span style={styles.labelText}>{label}</span>
        <SpanKindBadge span={span} />
        {isError && <span style={styles.errorDot} title={span.status_message || "Error"} />}
      </div>
      <div style={styles.barCell}>
        <div
          style={{
            ...styles.bar,
            left: leftPct,
            width: widthPct,
            background: color.fill,
            borderColor: isError ? "var(--color-error-text)" : color.border,
          }}
        />
        <div
          style={{
            ...styles.barDuration,
            ...(durationOnRight
              ? { left: `calc(${leftPct} + ${widthPct} + 6px)` }
              : { right: `calc(100% - ${leftPct} + 6px)` }),
          }}
        >
          {formatDuration(span.duration_ms)}
        </div>
      </div>
    </div>
  );
}

function TimeAxis({ duration }: { duration: number }) {
  const ticks = Array.from({ length: AXIS_TICK_COUNT }, (_, i) => {
    const frac = i / (AXIS_TICK_COUNT - 1);
    return { frac, label: formatDuration(duration * frac) };
  });
  return (
    <div style={styles.axis}>
      {ticks.map((t, i) => (
        <div
          key={i}
          style={{
            ...styles.axisTick,
            left: `${(t.frac * 100).toFixed(3)}%`,
            // Last tick anchors to the right so its label doesn't overflow.
            transform: i === ticks.length - 1
              ? "translateX(-100%)"
              : i === 0
                ? "translateX(0)"
                : "translateX(-50%)",
          }}
        >
          {t.label}
        </div>
      ))}
    </div>
  );
}

/**
 * Build the per-row layout from a flat span list. Hierarchy via buildForest +
 * flattenForest, position via parseBackendDate. Returns rows in DFS order and
 * the total wall-clock duration as denominator.
 */
function computeRows(spans: Span[]): { rows: Row[]; traceDuration: number } {
  if (spans.length === 0) return { rows: [], traceDuration: 0 };

  let traceStart = Infinity;
  let traceEnd = -Infinity;
  const starts = new Map<string, number>();
  for (const s of spans) {
    const start = parseBackendDate(s.started_at).getTime();
    const end = start + (s.duration_ms || 0);
    starts.set(s.span_id, start);
    if (start < traceStart) traceStart = start;
    if (end > traceEnd) traceEnd = end;
  }
  const traceDuration = Math.max(traceEnd - traceStart, 0);

  const forest = buildForest(spans);
  const flat = flattenForest(forest);

  const rows: Row[] = flat.map(({ span, depth }) => {
    const start = starts.get(span.span_id) ?? traceStart;
    // Guard against zero-duration trace (all spans at the same instant).
    const startFrac = traceDuration === 0 ? 0 : (start - traceStart) / traceDuration;
    const widthFrac = traceDuration === 0 ? 1 : (span.duration_ms || 0) / traceDuration;
    return { span, depth, startFrac, widthFrac };
  });

  return { rows, traceDuration };
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    minWidth: 0,
    borderRight: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  },
  header: {
    padding: "10px 16px",
    fontWeight: 600,
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    borderBottom: "1px solid var(--color-border)",
    flexShrink: 0,
  },
  axisRow: {
    display: "flex",
    alignItems: "stretch",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    flexShrink: 0,
  },
  axisLabelGutter: {
    width: LABEL_COL_WIDTH,
    flexShrink: 0,
    borderRight: "1px solid var(--color-border)",
  },
  axis: {
    position: "relative" as const,
    flex: 1,
    height: 28,
    fontSize: 11,
    color: "var(--color-text-secondary)",
    fontVariantNumeric: "tabular-nums",
  },
  axisTick: {
    position: "absolute" as const,
    top: "50%",
    transform: "translateY(-50%)",
    whiteSpace: "nowrap" as const,
    padding: "0 4px",
  },
  list: { overflowY: "auto" as const, flex: 1 },
  row: {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    borderBottom: "1px solid var(--color-border)",
    minHeight: 32,
  },
  rowSelected: {
    background: "var(--sapList_SelectionBackgroundColor, #e8f0fb)",
    borderLeft: "3px solid var(--color-brand)",
  },
  labelCell: {
    width: LABEL_COL_WIDTH,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px 6px 0",
    borderRight: "1px solid var(--color-border)",
    overflow: "hidden",
    minWidth: 0,
  },
  connector: {
    color: "var(--color-text-secondary)",
    fontSize: 11,
    opacity: 0.5,
    flexShrink: 0,
  },
  labelText: {
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
  barCell: {
    flex: 1,
    position: "relative" as const,
    height: 32,
    minWidth: 0,
  },
  bar: {
    position: "absolute" as const,
    top: 8,
    height: 16,
    borderRadius: 3,
    border: "1px solid transparent",
    boxSizing: "border-box" as const,
  },
  barDuration: {
    position: "absolute" as const,
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: 11,
    color: "var(--color-text-secondary)",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap" as const,
    pointerEvents: "none" as const,
  },
  empty: {
    padding: "32px 16px",
    textAlign: "center" as const,
    color: "var(--color-text-secondary)",
    fontSize: "var(--font-size-sm)",
  },
};
