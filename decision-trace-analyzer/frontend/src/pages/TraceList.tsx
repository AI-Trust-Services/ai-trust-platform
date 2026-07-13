import "@ui5/webcomponents/dist/Table.js";
import "@ui5/webcomponents/dist/TableHeaderRow.js";
import "@ui5/webcomponents/dist/TableHeaderCell.js";
import "@ui5/webcomponents/dist/TableRow.js";
import "@ui5/webcomponents/dist/TableCell.js";
import "@ui5/webcomponents/dist/Button.js";
import "@ui5/webcomponents-icons/dist/navigation-left-arrow.js";
import "@ui5/webcomponents-icons/dist/navigation-right-arrow.js";
import "@ui5/webcomponents-icons/dist/refresh.js";
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchTraces, type Trace, type TracesResponse, type TraceFilters } from "../api/traces";
import { TraceDetail } from "./TraceDetail";
import { FilterBar } from "../components/FilterBar";
import { EmptyState } from "../components/EmptyState";
import { TableSkeleton } from "../components/TableSkeleton";
import { parseBackendDate } from "../lib/dates";

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
          <span style={styles.title}>Trace Explorer</span>
          <div style={styles.toolbarRight}>
            {data && data.items.length > 0 && (
              <span style={styles.meta}>
                {currentPage} of {totalPages} &nbsp;|&nbsp; {data.total} total
              </span>
            )}
            {/* @ts-ignore */}
            <ui5-button
              icon="navigation-left-arrow"
              tooltip="Previous page"
              design="Transparent"
              disabled={offset === 0 || loading || undefined}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            />
            {/* @ts-ignore */}
            <ui5-button
              icon="navigation-right-arrow"
              tooltip="Next page"
              design="Transparent"
              disabled={!data || offset + PAGE_SIZE >= data.total || loading || undefined}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            />
            {/* @ts-ignore */}
            <ui5-button icon="refresh" tooltip="Refresh" design="Transparent" onClick={() => load(offset, filters)} />
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
          // @ts-ignore
          <ui5-table style={{ width: "100%", opacity: loading ? 0.6 : 1 }}>
            {/* @ts-ignore */}
            <ui5-table-header-row slot="headerRow">
              {/* @ts-ignore */}
              <ui5-table-header-cell width="280px">Trace ID</ui5-table-header-cell>
              {/* @ts-ignore */}
              <ui5-table-header-cell>Time</ui5-table-header-cell>
              {/* @ts-ignore */}
              <ui5-table-header-cell>Duration</ui5-table-header-cell>
              {/* @ts-ignore */}
              <ui5-table-header-cell>Service</ui5-table-header-cell>
              {/* @ts-ignore */}
              <ui5-table-header-cell>Operation</ui5-table-header-cell>
              {/* @ts-ignore */}
              <ui5-table-header-cell>Tokens</ui5-table-header-cell>
              {/* @ts-ignore */}
              <ui5-table-header-cell>Model</ui5-table-header-cell>
            {/* @ts-ignore */}
            </ui5-table-header-row>

            {data.items.map((trace: Trace) => (
              // @ts-ignore
              <ui5-table-row key={trace.trace_id} onClick={() => setSelectedTraceId(trace.trace_id)}>
                {/* @ts-ignore */}
                <ui5-table-cell>
                  <span style={styles.idCell} title={trace.trace_id}>
                    {trace.has_error && (
                      <span style={styles.errorDot} title="At least one span in this trace failed">
                        ●
                      </span>
                    )}
                    {shortId(trace.trace_id)}
                  </span>
                {/* @ts-ignore */}
                </ui5-table-cell>
                {/* @ts-ignore */}
                <ui5-table-cell>{formatDate(trace.started_at)}</ui5-table-cell>
                {/* @ts-ignore */}
                <ui5-table-cell>{trace.total_duration_s.toFixed(3)}s</ui5-table-cell>
                {/* @ts-ignore */}
                <ui5-table-cell>{trace.service_name}</ui5-table-cell>
                {/* @ts-ignore */}
                <ui5-table-cell>
                  {trace.root_span_name ? (
                    <span style={styles.opName} title={trace.root_span_name}>
                      {trace.root_span_name}
                    </span>
                  ) : (
                    <span style={styles.opMuted}>—</span>
                  )}
                {/* @ts-ignore */}
                </ui5-table-cell>
                {/* @ts-ignore */}
                <ui5-table-cell>{trace.total_tokens.toLocaleString()}</ui5-table-cell>
                {/* @ts-ignore */}
                <ui5-table-cell>
                  {trace.request_model ? (
                    <span style={styles.modelBadge}>{trace.request_model}</span>
                  ) : "—"}
                {/* @ts-ignore */}
                </ui5-table-cell>
              {/* @ts-ignore */}
              </ui5-table-row>
            ))}
          {/* @ts-ignore */}
          </ui5-table>
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
