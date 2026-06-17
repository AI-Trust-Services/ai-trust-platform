import { useState, useEffect, useCallback, useRef } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { api } from "../api/client";
import { useToast } from "../App";
import { fmtDateTime } from "../utils";

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

function saveFilters(filters) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
}

function fmt(t) {
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

  const loadSignals = useCallback(async (service, window) => {
    setLoading(true);
    try {
      const data = await api.getSignals(service, window);
      setSignals(data);
      if (data.timeseries?.length > 0) {
        const last = data.timeseries[data.timeseries.length - 1].time;
        setStale((Date.now() - new Date(last).getTime()) > 5 * 60 * 1000);
      } else {
        setStale(false);
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

  function handleServiceChange(e) {
    const v = e.target.value;
    setSelectedService(v);
    saveFilters({ service: v, window: selectedWindow });
  }

  function handleWindowChange(e) {
    const v = e.target.value;
    setSelectedWindow(v);
    saveFilters({ service: selectedService, window: v });
  }

  const kpis = signals?.kpis || {};
  const timeseries = signals?.timeseries || [];

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
        <button className="btn-ghost" onClick={() => loadSignals(selectedService, selectedWindow)} disabled={loading}>
          {loading ? <span className="spinner" /> : "↺"} Refresh
        </button>
      </div>

      {stale && (
        <div className="stale-banner">
          ⚠ Signal data may be stale — last datapoint was more than 5 minutes ago.
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
            <div className="chart-title">Inference Count over Time</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={timeseries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e6e8" />
                <XAxis dataKey="time" tickFormatter={fmt} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} width={40} />
                <Tooltip labelFormatter={fmt} />
                <Line type="monotone" dataKey="inference_count" stroke="#0a6ed1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-card">
            <div className="chart-title">Avg Latency (ms) over Time</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={timeseries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e6e8" />
                <XAxis dataKey="time" tickFormatter={fmt} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} width={40} />
                <Tooltip labelFormatter={fmt} />
                <Line type="monotone" dataKey="avg_latency_ms" stroke="#e05c00" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="section-title">Services</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Model</th>
                <th>Total Spans</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {services.length === 0 ? (
                <tr className="empty-row"><td colSpan={4}>No services observed yet.</td></tr>
              ) : services.map((s) => (
                <tr key={s.service_name}>
                  <td style={{ fontWeight: 500 }}>{s.service_name}</td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>{s.request_model || "—"}</td>
                  <td style={{ fontSize: 13 }}>{s.total_spans?.toLocaleString()}</td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>{fmtDateTime(s.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
