import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";

const COLUMNS = [
  { key: "time",            label: "Time Bucket" },
  { key: "service",         label: "Service" },
  { key: "inference_count", label: "Inferences" },
  { key: "avg_latency_ms",  label: "Avg Latency (ms)" },
  { key: "input_tokens",    label: "Input Tokens" },
  { key: "output_tokens",   label: "Output Tokens" },
];

const WINDOWS = [
  { value: "15m", label: "Last 15 min" },
  { value: "1h",  label: "Last 1 hour" },
  { value: "6h",  label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
];

const ROW_PRESETS = ["All", "10", "25", "50", "100", "Custom"];
const PREVIEW_ROWS = 5;

interface ExportModalProps {
  onClose: () => void;
  currentService: string;
  currentWindow: string;
}

export default function ExportModal({ onClose, currentService, currentWindow }: ExportModalProps) {
  const [selectedCols, setSelectedCols] = useState<Set<string>>(
    new Set(COLUMNS.map((c) => c.key))
  );
  const [includeSummary, setIncludeSummary] = useState(true);
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [rowPreset, setRowPreset] = useState("All");
  const [customRows, setCustomRows] = useState("");
  const [timeWindow, setTimeWindow] = useState(currentWindow);
  const [timeseries, setTimeseries] = useState<Record<string, unknown>[]>([]);
  const [kpis, setKpis] = useState<Record<string, unknown>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const fetchData = useCallback(async (w: string) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const data = await api.getSignals(currentService, w);
      setTimeseries(data.timeseries || []);
      setKpis(data.kpis || {});
    } catch (e: unknown) {
      setPreviewError(e instanceof Error ? e.message : "Failed to load preview data.");
    } finally {
      setPreviewLoading(false);
    }
  }, [currentService]);

  useEffect(() => { fetchData(timeWindow); }, [timeWindow, fetchData]);

  function toggleCol(key: string) {
    setSelectedCols((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function getRowLimit(): number | null {
    if (rowPreset === "All") return null;
    if (rowPreset === "Custom") {
      const n = parseInt(customRows, 10);
      return !customRows || isNaN(n) || n < 1 ? null : n;
    }
    return parseInt(rowPreset, 10);
  }

  function buildRows(): unknown[][] {
    const cols = COLUMNS.filter((c) => selectedCols.has(c.key));
    const reversed = [...timeseries].reverse();
    const limit = getRowLimit();
    const sliced = limit != null ? reversed.slice(0, limit) : reversed;

    return sliced.map((r) =>
      cols.map((c) => {
        if (c.key === "time") return r.time;
        if (c.key === "service") return currentService || "All";
        if (c.key === "avg_latency_ms") return r.avg_latency_ms != null ? Number(r.avg_latency_ms).toFixed(0) : "";
        return r[c.key] ?? "";
      })
    );
  }

  function download() {
    const cols = COLUMNS.filter((c) => selectedCols.has(c.key));
    const dataRows = buildRows();
    const date = new Date().toISOString().slice(0, 10);
    const filename = `monitoring-${currentService || "all"}-${timeWindow}-${date}`;

    if (format === "json") {
      const json = dataRows.map((row) =>
        Object.fromEntries(cols.map((c, i) => [c.label, row[i]]))
      );
      const payload: Record<string, unknown> = { data: json };
      if (includeSummary) {
        payload.summary = {
          "Total Inferences": kpis.total_inferences ?? "",
          "Avg Latency (ms)": kpis.avg_latency_ms != null ? Number(kpis.avg_latency_ms).toFixed(0) : "",
          "Total Input Tokens": kpis.total_input_tokens ?? "",
          "Total Output Tokens": kpis.total_output_tokens ?? "",
        };
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      triggerDownload(blob, `${filename}.json`);
    } else {
      const rows: unknown[][] = [cols.map((c) => c.label), ...dataRows];
      if (includeSummary) {
        rows.push([], ["Summary"], ["Total Inferences", kpis.total_inferences ?? ""],
          ["Avg Latency (ms)", kpis.avg_latency_ms != null ? Number(kpis.avg_latency_ms).toFixed(0) : ""],
          ["Total Input Tokens", kpis.total_input_tokens ?? ""],
          ["Total Output Tokens", kpis.total_output_tokens ?? ""]
        );
      }
      const csv = rows.map((r) => (r as unknown[]).map((cell) => {
        const s = String(cell ?? "");
        return `"${s.replace(/"/g, '""')}"`;
      }).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      triggerDownload(blob, `${filename}.csv`);
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.setAttribute("href", url);
    a.setAttribute("download", filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const cols = COLUMNS.filter((c) => selectedCols.has(c.key));
  const previewRows = buildRows().slice(0, PREVIEW_ROWS);
  const totalRows = timeseries.length;
  const limit = getRowLimit();
  const exportCount = limit != null ? Math.min(limit, totalRows) : totalRows;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>Export Data</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* ── Controls ── */}
          <div className="modal-controls">
            <div className="modal-control-group">
              <div className="modal-control-label">Columns</div>
              {COLUMNS.map((c) => (
                <label key={c.key} className="modal-checkbox-row">
                  <input
                    type="checkbox"
                    checked={selectedCols.has(c.key)}
                    onChange={() => toggleCol(c.key)}
                  />
                  {c.label}
                </label>
              ))}
            </div>

            <div className="modal-control-group">
              <div className="modal-toggle-row">
                <span>Include Summary</span>
                <label className="modal-toggle">
                  <input type="checkbox" checked={includeSummary} onChange={(e) => setIncludeSummary(e.target.checked)} />
                  <span className="modal-toggle-slider" />
                </label>
              </div>
            </div>

            <div className="modal-control-group">
              <div className="modal-control-label">Format</div>
              <select className="modal-select" value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")}>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </div>

            <div className="modal-control-group">
              <div className="modal-control-label">Rows</div>
              <select className="modal-select" value={rowPreset} onChange={(e) => setRowPreset(e.target.value)}>
                {ROW_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {rowPreset === "Custom" && (
                <input
                  className="modal-custom-input"
                  type="number"
                  min={1}
                  placeholder="Enter number of rows"
                  value={customRows}
                  onChange={(e) => setCustomRows(e.target.value)}
                />
              )}
            </div>

            <div className="modal-control-group">
              <div className="modal-control-label">Time Window</div>
              <select className="modal-select" value={timeWindow} onChange={(e) => setTimeWindow(e.target.value)}>
                {WINDOWS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </div>
          </div>

          {/* ── Preview ── */}
          <div className="modal-preview">
            <div className="modal-preview-title">Preview</div>
            {previewLoading ? (
              <div className="modal-preview-loading">
                <span className="spinner" /> Loading…
              </div>
            ) : previewError ? (
              <div className="modal-preview-loading" style={{ color: "var(--danger, #bb0000)" }}>
                {previewError}
              </div>
            ) : cols.length === 0 ? (
              <div className="modal-preview-loading">Select at least one column.</div>
            ) : (
              <>
                <div className="table-wrap" style={{ marginBottom: 0 }}>
                  <table>
                    <thead>
                      <tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {previewRows.length === 0 ? (
                        <tr className="empty-row"><td colSpan={cols.length}>No data for this window.</td></tr>
                      ) : previewRows.map((row, i) => (
                        <tr key={i}>
                          {(row as unknown[]).map((cell, j) => <td key={j} style={{ fontSize: 12 }}>{String(cell)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="modal-preview-note">
                  Showing first {Math.min(PREVIEW_ROWS, exportCount)} of {exportCount} rows to export
                  {includeSummary && " + summary"}.
                </div>
              </>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={download}
            disabled={cols.length === 0 || previewLoading || !!previewError}
          >
            ↓ Download {format.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
