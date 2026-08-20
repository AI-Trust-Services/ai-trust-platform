import { ChevronLeft, ChevronRight, RefreshCw, Network } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchTraces, type Trace, type TracesResponse, type TraceFilters } from "../api/traces";
import { TraceDetail } from "./TraceDetail";
import { FilterBar } from "../components/FilterBar";
import { EmptyState } from "../components/EmptyState";
import { TableSkeleton } from "../components/TableSkeleton";
import { parseBackendDate } from "../lib/dates";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 50;

function formatDate(iso: string): string {
  return parseBackendDate(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function shortId(id: string): string {
  return id.length > 32 ? id.slice(0, 32) + "…" : id;
}

export function TraceList() {
  const [data, setData] = useState<TracesResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [filters, setFilters] = useState<TraceFilters>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Accumulate known services/models from loaded data for filter dropdowns
  const knownServices = useRef<Set<string>>(new Set());
  const knownModels = useRef<Set<string>>(new Set());

  const load = useCallback(async (off: number, f: TraceFilters) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTraces({ limit: PAGE_SIZE, offset: off, ...f });
      result.items.forEach((t) => {
        if (t.service_name) knownServices.current.add(t.service_name);
        if (t.request_model) knownModels.current.add(t.request_model);
      });
      setData(result);
    } catch (e) {
      // Log the full error so it shows up in the console (the rendered banner
      // only gets the message — stack traces are easy to lose otherwise).
      console.error("[fetchTraces] failed:", e);
      setError(e instanceof Error ? `${e.message} — see console for stack` : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(offset, filters);
  }, [load, offset, filters]);

  function handleFiltersChange(next: TraceFilters) {
    setOffset(0);
    setFilters(next);
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const isFirstLoad = loading && !data;
  const isEmpty = !loading && !error && data && data.items.length === 0;
  const hasFilters = !!(filters.from || filters.service_name || filters.model || filters.errors_only);

  return (
    <>
      {selectedTraceId && (
        <TraceDetail traceId={selectedTraceId} onClose={() => setSelectedTraceId(null)} />
      )}

      <div style={{ padding: "16px 24px", fontFamily: "var(--font-family)", fontSize: "var(--font-size)" }}>
        {/* Toolbar */}
        <div style={styles.toolbar}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
              <Network className="size-5" />
            </span>
            <span style={styles.title}>Trace Explorer</span>
          </div>
          <div style={styles.toolbarRight}>
            {data && data.items.length > 0 && (
              <span style={styles.meta}>
                {currentPage} of {totalPages} &nbsp;|&nbsp; {data.total} total
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              title="Previous page"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Next page"
              disabled={!data || offset + PAGE_SIZE >= data.total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              <ChevronRight />
            </Button>
            <Button variant="ghost" size="icon" title="Refresh" onClick={() => load(offset, filters)}>
              <RefreshCw />
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <FilterBar
          filters={filters}
          services={Array.from(knownServices.current).sort()}
          models={Array.from(knownModels.current).sort()}
          onChange={handleFiltersChange}
        />

        {/* Error */}
        {error && <div style={styles.errorBanner}>{error}</div>}

        {/* First-time loading: skeleton rows */}
        {isFirstLoad && <TableSkeleton />}

        {/* Empty state — context-aware message */}
        {isEmpty && (
          <EmptyState
            title={hasFilters ? "No traces match the current filters" : "No traces yet"}
            description={
              hasFilters
                ? "Try a wider timeframe, or clear the filters to see all traces."
                : "Once your applications send GenAI telemetry to the OTel collector, traces will appear here."
            }
            action={hasFilters ? { label: "Reset filters", onClick: () => handleFiltersChange({}) } : undefined}
          />
        )}

        {/* Table */}
        {data && data.items.length > 0 && (
          <div style={styles.tableWrap}>
            <table style={{ ...styles.table, opacity: loading ? 0.6 : 1 }}>
              <thead>
                <tr>
                  <th style={styles.th}>Trace ID</th>
                  <th style={styles.th}>Time</th>
                  <th style={styles.th}>Duration</th>
                  <th style={styles.th}>Service</th>
                  <th style={styles.th}>Operation</th>
                  <th style={styles.th}>Tokens</th>
                  <th style={styles.th}>Model</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((trace: Trace) => (
                  <tr
                    key={trace.trace_id}
                    style={{ ...styles.tr, background: hoveredId === trace.trace_id ? "var(--color-hover-bg)" : undefined }}
                    onClick={() => setSelectedTraceId(trace.trace_id)}
                    onMouseEnter={() => setHoveredId(trace.trace_id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <td style={styles.td}>
                      <span style={styles.idCell} title={trace.trace_id}>
                        {trace.has_error && (
                          <span style={styles.errorDot} title="At least one span in this trace failed">
                            ●
                          </span>
                        )}
                        {shortId(trace.trace_id)}
                      </span>
                    </td>
                    <td style={styles.td}>{formatDate(trace.started_at)}</td>
                    <td style={styles.td}>{trace.total_duration_s.toFixed(3)}s</td>
                    <td style={styles.td}>{trace.service_name}</td>
                    <td style={styles.td}>
                      {trace.root_span_name ? (
                        <span style={styles.opName} title={trace.root_span_name}>
                          {trace.root_span_name}
                        </span>
                      ) : (
                        <span style={styles.opMuted}>—</span>
                      )}
                    </td>
                    <td style={styles.td}>{trace.total_tokens.toLocaleString()}</td>
                    <td style={styles.td}>
                      {trace.request_model ? (
                        <span style={styles.modelBadge}>{trace.request_model}</span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  toolbarRight: { display: "flex", alignItems: "center", gap: 4 },
  title: { fontWeight: 600, fontSize: "var(--font-size-lg)", color: "var(--color-text)" },
  meta: { fontSize: "var(--font-size)", color: "var(--color-text-secondary)", marginRight: 8 },
  errorBanner: {
    background: "var(--color-error-bg)",
    color: "var(--color-error-text)",
    border: "1px solid var(--color-error-border)",
    borderRadius: 6,
    padding: "10px 14px",
    marginBottom: 12,
    fontSize: "var(--font-size)",
  },
  tableWrap: {
    border: "1px solid var(--color-border)",
    borderRadius: 6,
    overflow: "hidden",
    background: "var(--color-surface)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "var(--font-size)",
    fontFamily: "var(--font-family)",
  },
  th: {
    textAlign: "left" as const,
    padding: "10px 16px",
    fontWeight: 600,
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    background: "var(--color-code-bg)",
    borderBottom: "1px solid var(--color-border)",
    whiteSpace: "nowrap" as const,
  },
  tr: {
    cursor: "pointer",
    borderBottom: "1px solid var(--color-border)",
  },
  td: {
    padding: "10px 16px",
    color: "var(--color-text)",
    verticalAlign: "middle" as const,
  },
  idCell: {
    fontFamily: "monospace",
    fontSize: "var(--font-size-sm)",
    color: "var(--color-link)",
    cursor: "pointer",
  },
  errorDot: {
    color: "var(--color-error-text, #c00)",
    marginRight: 6,
    fontSize: "0.9em",
  },
  opName: {
    fontFamily: "var(--font-family-mono, monospace)",
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text)",
  },
  opMuted: {
    color: "var(--color-text-secondary)",
    fontSize: "var(--font-size-sm)",
  },
  modelBadge: {
    background: "var(--color-info-bg)",
    color: "var(--color-info-text)",
    borderRadius: 4,
    padding: "2px 7px",
    fontSize: "var(--font-size-sm)",
    fontWeight: 500,
  },
};
