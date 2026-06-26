import { useState, useEffect, useCallback, useRef } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { api } from "../api/client";
import { useToast } from "../App";
import { fmtDateTime } from "../utils";
import ExportModal from "../components/ExportModal";

const STORAGE_KEY = "ai_trust_monitoring_filters_v1";
const WINDOWS = [
  { value: "15m", label: "Last 15 min" },
  { value: "1h",  label: "Last 1 hour" },
  { value: "6h",  label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
];

function loadFilters() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}

function saveFilters(filters: Record<string, string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
}

function fmt(t: string) {
  return t ? t.slice(11, 16) : "";
}

export default function LiveSignals() {
  const saved = loadFilters();
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(saved.service || "");
  const [selectedWindow, setSelectedWindow] = useState(saved.window || "1h");
  const [signals, setSignals] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [staleThresholdMin, setStaleThresholdMin] = useState(3);
  const [page, setPage] = useState(0);
  const [showExport, setShowExport] = useState(false);
  const ROWS_PER_PAGE = 10;
  const filtersRef = useRef({ service: saved.service || "", window: saved.window || "1h" });
  const showToast = useToast();

  // Keep ref in sync so the interval always reads the latest filters without restarting
  useEffect(() => {
    filtersRef.current = { service: selectedService, window: selectedWindow };
  }, [selectedService, selectedWindow]);

  const loadServices = useCallback(async () => {
    try {
      const data = await api.getServices();
      setServices(data);
    } catch (e) {
      showToast(`Failed to load services: ${e.message}`, true);
    }
  }, [showToast]);

  const loadSignals = useCallback(async (service: string, window: string) => {
    setLoading(true);
    try {
      const data = await api.getSignals(service, window);
      setSignals(data);
      if (data.timeseries?.length > 0) {
        const last = data.timeseries[data.timeseries.length - 1].time;
        // ClickHouse returns timestamps without timezone suffix — treat as UTC.
        const lastUtcMs = new Date(last.replace(" ", "T") + "Z").getTime();
        const staleMs: Record<string, number> = { "15m": 3, "1h": 3, "6h": 10, "24h": 20 };
        const thresholdMin = staleMs[window] ?? 5;
        setStaleThresholdMin(thresholdMin);
        setStale((Date.now() - lastUtcMs) > thresholdMin * 60 * 1000);
      } else {
        setStale(false);
        setStaleThresholdMin(3);
      }
    } catch (e) {
      showToast(`Failed to load signals: ${e.message}`, true);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // Initial load + stable interval — never restarts when filters change
  useEffect(() => {
    loadServices();
  }, [loadServices]);

  useEffect(() => {
    loadSignals(filtersRef.current.service, filtersRef.current.window);
    const id = setInterval(
      () => loadSignals(filtersRef.current.service, filtersRef.current.window),
      5000,
    );
    return () => clearInterval(id);
  }, [loadSignals]); // loadSignals is stable (no filter deps); interval never restarts

  // Reload immediately when filters change
  useEffect(() => {
    loadSignals(selectedService, selectedWindow);
  }, [selectedService, selectedWindow, loadSignals]);

  function handleServiceChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    setSelectedService(v);
    setPage(0);
    saveFilters({ service: v, window: selectedWindow });
  }

  function handleWindowChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    setSelectedWindow(v);
    setPage(0);
    saveFilters({ service: selectedService, window: v });
  }

  const kpis = signals?.kpis || {};
  const timeseries = signals?.timeseries || [];

  function copyChartData(dataKey: string, header: string) {
    const tsv = [header, ...timeseries.map((r: Record<string, unknown>) => `${r.time}\t${r[dataKey] ?? ""}`)].join("\n");
    navigator.clipboard.writeText(tsv).then(() => showToast("Copied to clipboard")).catch(() => showToast("Failed to copy to clipboard", true));
  }

  return (
    <>
      <div className="toolbar">
        <select className="filter-select" value={selectedService} onChange={handleServiceChange}>
          <option value="">All Services</option>
          {services.map((s) => (
            <option key={s.service_name} value={s.service_name}>{s.service_name}</option>
          ))}
        </select>
        <select className="filter-select" value={selectedWindow} onChange={handleWindowChange}>
          {WINDOWS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
        </select>
        <div className="toolbar-spacer" />
        <button className="btn-ghost" onClick={() => setShowExport(true)} disabled={timeseries.length === 0}>
          ↓ Export
        </button>
        <button className="btn-ghost" onClick={() => loadSignals(selectedService, selectedWindow)} disabled={loading}>
          {loading ? <span className="spinner" /> : "↺"} Refresh
        </button>
      </div>

      {stale && (
        <div className="stale-banner">
          ⚠ Signal data may be stale — last datapoint was more than {staleThresholdMin} minutes ago.
        </div>
      )}

      <div className="content">
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Total Inferences</div>
            <div className="kpi-value">{kpis.total_inferences != null ? kpis.total_inferences.toLocaleString() : "—"}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Avg Latency</div>
            <div className="kpi-value">{kpis.avg_latency_ms != null ? `${kpis.avg_latency_ms.toFixed(0)} ms` : "—"}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Input Tokens</div>
            <div className="kpi-value">{kpis.total_input_tokens != null ? kpis.total_input_tokens.toLocaleString() : "—"}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Output Tokens</div>
            <div className="kpi-value">{kpis.total_output_tokens != null ? kpis.total_output_tokens.toLocaleString() : "—"}</div>
          </div>
        </div>

        <div className="chart-grid">
          <div className="chart-card">
            <div className="chart-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              Inference Count over Time
              <button className="btn-ghost" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => copyChartData("inference_count", "Time\tInference Count")}>⎘ Copy</button>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={timeseries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e6e8" />
                <XAxis dataKey="time" tickFormatter={fmt} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} width={40} />
                <Tooltip labelFormatter={fmt} />
                <Line type="monotone" dataKey="inference_count" name="Inference Count" stroke="#0a6ed1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-card">
            <div className="chart-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              Avg Latency (ms) over Time
              <button className="btn-ghost" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => copyChartData("avg_latency_ms", "Time\tAvg Latency (ms)")}>⎘ Copy</button>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={timeseries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e6e8" />
                <XAxis dataKey="time" tickFormatter={fmt} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} width={40} />
                <Tooltip labelFormatter={fmt} />
                <Line type="monotone" dataKey="avg_latency_ms" name="Avg Latency (ms)" stroke="#e05c00" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="section-title">Inference Breakdown</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time Bucket</th>
                <th>Service</th>
                <th>Inferences</th>
                <th>Avg Latency (ms)</th>
                <th>Input Tokens</th>
                <th>Output Tokens</th>
              </tr>
            </thead>
            <tbody>
              {timeseries.length === 0 ? (
                <tr className="empty-row"><td colSpan={6}>No inference data for this window.</td></tr>
              ) : [...timeseries].reverse().slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE).map((row, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{row.time}</td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>{selectedService || "All"}</td>
                  <td style={{ fontSize: 13 }}>{row.inference_count?.toLocaleString()}</td>
                  <td style={{ fontSize: 13 }}>{row.avg_latency_ms != null ? `${Number(row.avg_latency_ms).toFixed(0)} ms` : "—"}</td>
                  <td style={{ fontSize: 13 }}>{row.input_tokens?.toLocaleString()}</td>
                  <td style={{ fontSize: 13 }}>{row.output_tokens?.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {timeseries.length > ROWS_PER_PAGE && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 4px", fontSize: 13, color: "var(--text-secondary)" }}>
              <span>{page * ROWS_PER_PAGE + 1}–{Math.min((page + 1) * ROWS_PER_PAGE, timeseries.length)} of {timeseries.length}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost" onClick={() => setPage(p => p - 1)} disabled={page === 0}>← Prev</button>
                <button className="btn-ghost" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * ROWS_PER_PAGE >= timeseries.length}>Next →</button>
              </div>
            </div>
          )}
        </div>

        <div className="section-title">Services</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Total Spans</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {services.length === 0 ? (
                <tr className="empty-row"><td colSpan={3}>No services observed yet.</td></tr>
              ) : services.map((s) => (
                <tr key={s.service_name}>
                  <td style={{ fontWeight: 500 }}>{s.service_name}</td>
                  <td style={{ fontSize: 13 }}>{s.total_spans?.toLocaleString()}</td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>{fmtDateTime(s.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showExport && (
        <ExportModal
          onClose={() => setShowExport(false)}
          currentService={selectedService}
          currentWindow={selectedWindow}
        />
      )}
    </>
  );
}
