import { useState, useEffect, useCallback } from "react";
import { TierBadge, LifecycleBadge, ComplianceBar, FormattedDate } from "../components/Badges";
import { LIFECYCLE_LABELS } from "../utils";
import { api } from "../api/client";
import { useToast } from "../App";

const HIST_BUCKETS = ["0–20", "20–40", "40–60", "60–80", "80–100"];

export default function Analytics() {
  const [stats, setStats] = useState(null);
  const [lifecycleFilter, setLifecycleFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const showToast = useToast();

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getStats(lifecycleFilter || undefined);
      setStats(data);
    } catch (e) {
      showToast(`Failed to load analytics: ${e.message}`, true);
    } finally {
      setLoading(false);
    }
  }, [lifecycleFilter, showToast]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const histMax = stats
    ? Math.max(1, ...HIST_BUCKETS.map((b) => stats.compliance_histogram?.[b] ?? 0))
    : 1;

  return (
    <>
      <div className="toolbar">
        <select
          className="filter-select"
          value={lifecycleFilter}
          onChange={(e) => setLifecycleFilter(e.target.value)}
        >
          <option value="">All Lifecycle States</option>
          {Object.entries(LIFECYCLE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <div className="toolbar-spacer" />
        <button className="btn-ghost" onClick={loadStats} disabled={loading}>
          {loading ? <span className="spinner" /> : "↺"} Refresh
        </button>
      </div>

      <div className="content">
        {/* Summary KPIs */}
        <div className="stat-grid">
          <div className="stat-card">
            <div className="kpi-label">Total Systems</div>
            <div className="kpi-value">{stats?.total_systems ?? "—"}</div>
          </div>
          <div className="stat-card">
            <div className="kpi-label">Avg Compliance</div>
            <div className="kpi-value">{stats?.avg_compliance != null ? `${stats.avg_compliance.toFixed(0)}%` : "—"}</div>
          </div>
          <div className="stat-card">
            <div className="kpi-label">Prohibited</div>
            <div className="kpi-value" style={{ color: stats?.prohibited_count > 0 ? "#bb0000" : "var(--text)" }}>
              {stats?.prohibited_count ?? "—"}
            </div>
          </div>
          <div className="stat-card">
            <div className="kpi-label">High-Risk</div>
            <div className="kpi-value" style={{ color: stats?.high_count > 0 ? "#8b3a00" : "var(--text)" }}>
              {stats?.high_count ?? "—"}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          {/* By-tier breakdown */}
          <div>
            <div className="section-title">Systems by Risk Tier</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Tier</th><th style={{ textAlign: "right" }}>Count</th></tr>
                </thead>
                <tbody>
                  {stats?.by_tier
                    ? Object.entries(stats.by_tier).map(([tier, count]) => (
                        <tr key={tier}>
                          <td><TierBadge tier={tier} /></td>
                          <td style={{ textAlign: "right", fontWeight: 500 }}>{count}</td>
                        </tr>
                      ))
                    : <tr className="empty-row"><td colSpan={2}>No data</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Compliance histogram */}
          <div>
            <div className="section-title">Compliance Distribution</div>
            <div className="chart-card" style={{ padding: "16px 20px" }}>
              {HIST_BUCKETS.map((bucket) => {
                const count = stats?.compliance_histogram?.[bucket] ?? 0;
                return (
                  <div key={bucket} className="hist-row">
                    <span className="hist-label">{bucket}%</span>
                    <div className="hist-bar-wrap">
                      <div className="hist-bar" style={{ width: `${(count / histMax) * 100}%` }} />
                    </div>
                    <span className="hist-count">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Recent systems */}
        <div className="section-title">Recently Registered Systems</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>System</th>
                <th>Risk Tier</th>
                <th>Lifecycle</th>
                <th>Compliance</th>
                <th>Registered</th>
              </tr>
            </thead>
            <tbody>
              {!stats?.recent || stats.recent.length === 0 ? (
                <tr className="empty-row"><td colSpan={5}>No systems registered yet.</td></tr>
              ) : stats.recent.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.id}</div>
                  </td>
                  <td><TierBadge tier={s.tier} /></td>
                  <td><LifecycleBadge lc={s.lifecycle} /></td>
                  <td><ComplianceBar pct={s.compliance} /></td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                    <FormattedDate iso={s.created_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
