import "@ui5/webcomponents/dist/Button.js";
import { useState, useEffect, lazy, Suspense } from "react";
import {
  fetchTraceDetail,
  fetchTraceSummary,
  type DecisionRecord,
  type Span,
  type TraceDetail as TraceDetailType,
} from "../api/traces";
import { SpanTree } from "../components/SpanTree";
import { Timeline } from "../components/Timeline";
import { SpanDetail } from "../components/SpanDetail";
import { TraceHeader } from "../components/TraceHeader";
import { TraceSummary } from "../components/TraceSummary";
import { ViewTabs, type TraceView } from "../components/ViewTabs";
import { ResizableSidebar } from "../components/ResizableSidebar";

// SpanGraph (generic DAG) and ConversationGraph both pull in elkjs (~700KB)
// and React Flow — lazy-load so the Tree/Timeline tabs stay fast.
const SpanGraph = lazy(() =>
  import("../components/SpanGraph").then((m) => ({ default: m.SpanGraph }))
);
const ConversationGraph = lazy(() =>
  import("../components/ConversationGraph").then((m) => ({ default: m.ConversationGraph }))
);

interface Props {
  traceId: string;
  onClose: () => void;
}

/** Pick the natural starting span — the root if any, otherwise the first one. */
function pickInitialSpan(spans: Span[]): Span | null {
  if (spans.length === 0) return null;
  const root = spans.find((s) => !s.parent_span_id);
  return root ?? spans[0];
}

/** Shared sidebar sizing for all four views — same initialWidth, min/max bounds,
 *  and storageKey, so the layout stays consistent when switching tabs and a
 *  resize in one view persists across all of them. */
const SIDEBAR_INITIAL_WIDTH = 520;
const SIDEBAR_MIN_WIDTH = 360;
const SIDEBAR_STORAGE_KEY = "trace.sidebar.width.v2";

export function TraceDetail({ traceId, onClose }: Props) {
  const [data, setData] = useState<TraceDetailType | null>(null);
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const [view, setView] = useState<TraceView>("conversation");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Summary state is independent from spans so a backend regression in the
  // analyzer doesn't block span inspection (and the spinner unblocks early
  // when only one of the two requests is still in flight).
  const [summary, setSummary] = useState<DecisionRecord | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchTraceDetail(traceId)
      .then((d) => {
        setData(d);
        setSelectedSpan(pickInitialSpan(d.spans));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    // Parallel fetch — summary doesn't depend on the span list at the UI level
    // (the backend uses the same ClickHouse query, two requests is acceptable
    // for v1; if load shows up we add a small TTL cache on the helper).
    setSummaryLoading(true);
    setSummaryError(null);
    setSummary(null);
    fetchTraceSummary(traceId)
      .then(setSummary)
      .catch((e) => setSummaryError(e.message))
      .finally(() => setSummaryLoading(false));
  }, [traceId]);

  // Esc closes the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={styles.overlay}>
      <div style={styles.topBar}>
        <span style={styles.topTitle}>Trace</span>
        {/* @ts-ignore */}
        <ui5-button design="Transparent" onClick={onClose} title="Close (Esc)">✕</ui5-button>
      </div>

      <ViewTabs active={view} onChange={setView} />

      <div style={styles.body}>
        {loading && <div style={styles.center}>Loading…</div>}
        {error && <div style={styles.error}>{error}</div>}
        {data && (
          <>
            {view === "tree" && (
              <ResizableSidebar
                initialWidth={SIDEBAR_INITIAL_WIDTH}
                minWidth={SIDEBAR_MIN_WIDTH}
                maxWidth={900}
                storageKey={SIDEBAR_STORAGE_KEY}
              >
                <SpanTree
                  spans={data.spans}
                  selectedSpanId={selectedSpan?.span_id ?? null}
                  onSelect={setSelectedSpan}
                />
              </ResizableSidebar>
            )}
            {view === "timeline" && (
              <ResizableSidebar
                initialWidth={SIDEBAR_INITIAL_WIDTH}
                minWidth={SIDEBAR_MIN_WIDTH}
                maxWidth={900}
                storageKey={SIDEBAR_STORAGE_KEY}
              >
                <Timeline
                  spans={data.spans}
                  selectedSpanId={selectedSpan?.span_id ?? null}
                  onSelect={setSelectedSpan}
                />
              </ResizableSidebar>
            )}
            {(view === "graph" || view === "conversation") && (
              <ResizableSidebar
                initialWidth={SIDEBAR_INITIAL_WIDTH}
                minWidth={SIDEBAR_MIN_WIDTH}
                maxWidth={900}
                storageKey={SIDEBAR_STORAGE_KEY}
              >
                <Suspense fallback={<div style={styles.center}>Loading graph…</div>}>
                  {view === "graph" && (
                    <SpanGraph
                      spans={data.spans}
                      selectedSpanId={selectedSpan?.span_id ?? null}
                      onSelect={setSelectedSpan}
                    />
                  )}
                  {view === "conversation" && (
                    <ConversationGraph
                      spans={data.spans}
                      selectedSpanId={selectedSpan?.span_id ?? null}
                      onSelect={setSelectedSpan}
                    />
                  )}
                </Suspense>
              </ResizableSidebar>
            )}
            <div style={styles.right}>
              <TraceHeader traceId={traceId} spans={data.spans} />
              <TraceSummary
                summary={summary}
                loading={summaryLoading}
                error={summaryError}
              />
              <div style={styles.detail}>
                {selectedSpan
                  ? <SpanDetail span={selectedSpan} />
                  : <div style={styles.center}>Select a span</div>
                }
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "var(--color-bg)",
    zIndex: 100,
    display: "flex",
    flexDirection: "column" as const,
    fontFamily: "var(--font-family)",
    fontSize: "var(--font-size)",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 16px",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    flexShrink: 0,
  },
  topTitle: { fontWeight: 600, fontSize: "var(--font-size-lg)" },
  body: { display: "flex", flex: 1, overflow: "hidden" },
  right: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    minWidth: 0,
    overflow: "hidden",
  },
  // Detail pane gets the page-background colour explicitly so the white
  // "card" surfaces inside (StatBar, ToolCalls, Bubbles, IO blocks) actually
  // contrast against it. Without this the pane inherits a neutral colour
  // depending on the host shell and everything looks flat.
  detail: { flex: 1, overflowY: "auto" as const, background: "var(--color-bg)" },
  center: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    width: "100%",
    color: "var(--color-text-secondary)",
  },
  error: {
    margin: 16,
    padding: "10px 14px",
    background: "var(--color-error-bg)",
    color: "var(--color-error-text)",
    border: "1px solid var(--color-error-border)",
    borderRadius: 6,
    fontSize: "var(--font-size)",
  },
};
