import { useState, useEffect } from "react";
import { api } from "../api/client";
import type { SystemRiskSummary } from "../types";

const LIFECYCLE_LABELS: Record<string, string> = {
  development:    "Development",
  testing:        "Testing",
  prod_ready:     "Production Ready",
  market:         "On Market",
  service:        "In Service",
  updated:        "Updated",
  decommissioned: "Decommissioned",
};

const LIFECYCLE_COLORS: Record<string, { bg: string; color: string }> = {
  development:    { bg: "#eff6ff", color: "#1147E9" },
  testing:        { bg: "#fff3c4", color: "#7a5900" },
  prod_ready:     { bg: "#fde8d0", color: "#8b3a00" },
  market:         { bg: "#d5f5e3", color: "#1a5c35" },
  service:        { bg: "#c8f0d8", color: "#0d4a28" },
  updated:        { bg: "#e8f0fb", color: "#1147E9" },
  decommissioned: { bg: "#eeeeee", color: "#666666" },
};

const TIER_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  high:            { bg: "#fde8d0", color: "#8b3a00", border: "#f5c890" },
  "gpai-systemic": { bg: "#fde8d0", color: "#8b3a00", border: "#f5c890" },
  "gpai-standard": { bg: "#fff3c4", color: "#7a5900", border: "#f5df84" },
  limited:         { bg: "#fff3c4", color: "#7a5900", border: "#f5df84" },
  minimal:         { bg: "#d5f5e3", color: "#1a5c35", border: "#9cdcb8" },
  prohibited:      { bg: "#ffd5d5", color: "#8b0000", border: "#f5b8b8" },
  pending:         { bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" },
};

const ORG_ROLE_LABELS: Record<string, string> = {
  provider: "Provider",
  deployer: "Deployer",
  both: "Provider + Deployer",
};

function Badge({ text, style }: { text: string; style?: React.CSSProperties }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "2px 8px",
      borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
      background: "#eef1f4", color: "var(--text-secondary)", ...style,
    }}>
      {text}
    </span>
  );
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier || tier === "pending") return <Badge text="—" style={{ background: "#f4f4f5", color: "var(--text-secondary)", border: "1px solid #dde0e4" }} />;
  const c = TIER_COLORS[tier] ?? { bg: "#eef1f4", color: "var(--text-secondary)", border: "#dde0e4" };
  return <Badge text={tier.toUpperCase()} style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }} />;
}

function LifecycleBadge({ lc }: { lc: string }) {
  const c = LIFECYCLE_COLORS[lc] ?? { bg: "#eef1f4", color: "var(--text-secondary)" };
  return <Badge text={LIFECYCLE_LABELS[lc] ?? lc} style={{ background: c.bg, color: c.color }} />;
}

function TrafficLight({ value }: { value: "red" | "orange" | "green" }) {
  const config = {
    red:    { color: "#dc2626", label: "Action required" },
    orange: { color: "#d97706", label: "In progress / Pending classification" },
    green:  { color: "#16a34a", label: "Up to date" },
  }[value];
  return (
    <span
      title={config.label}
      style={{
        width: 12, height: 12, borderRadius: "50%", display: "inline-block",
        background: config.color, flexShrink: 0,
        boxShadow: `0 0 0 2px ${config.color}33`,
      }}
    />
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function actionBtn(sys: SystemRiskSummary): { label: string; color: string } {
  if (!sys.active_register_id) {
    return { label: "Start", color: "#16a34a" };
  }
  const status = sys.active_register_status ?? "";
  if (status === "approved") {
    if (sys.traffic_light === "red") {
      return { label: "Review", color: "#dc2626" };
    }
    return { label: "Open", color: "#1147E9" };
  }
  return { label: "Resume", color: "#d97706" };
}

function statusHint(sys: SystemRiskSummary): { label: string; color: string } | null {
  if (!sys.active_register_id) return null;
  const status = sys.active_register_status ?? "";
  if (status !== "approved") return { label: "In progress", color: "#d97706" };
  if (sys.valid_until && new Date(sys.valid_until) < new Date()) return { label: "Overdue", color: "#dc2626" };
  if (sys.unacknowledged_triggers > 0) return { label: "Reassessment due", color: "#dc2626" };
  if (sys.reassessment_needed) return { label: "Overdue", color: "#dc2626" };
  if (sys.unconfirmed_risks > 0) return { label: "Risks unconfirmed", color: "#d97706" };
  return null;
}

type SortKey = "system_name" | "system_tier" | "system_lifecycle" | "system_org_role" | "last_assessment_completed_at" | "valid_until" | "traffic_light";
type SortDir = "asc" | "desc";
type KpiKey = "total" | "high" | "red" | "orange" | "green";

const TRAFFIC_ORDER = { red: 0, orange: 1, green: 2 };

function sortSystems(systems: SystemRiskSummary[], key: SortKey, dir: SortDir): SystemRiskSummary[] {
  return [...systems].sort((a, b) => {
    let cmp = 0;
    if (key === "traffic_light") {
      cmp = TRAFFIC_ORDER[a.traffic_light] - TRAFFIC_ORDER[b.traffic_light];
    } else if (key === "last_assessment_completed_at" || key === "valid_until") {
      const av = a[key] ?? "";
      const bv = b[key] ?? "";
      cmp = av.localeCompare(bv);
    } else {
      cmp = (a[key] ?? "").localeCompare(b[key] ?? "");
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

const COLUMNS: { key: SortKey | ""; label: string; sortable: boolean }[] = [
  { key: "traffic_light", label: "Status", sortable: true },
  { key: "system_name",   label: "System", sortable: true },
  { key: "system_tier",   label: "Risk Classification", sortable: true },
  { key: "system_lifecycle", label: "Lifecycle", sortable: true },
  { key: "system_org_role",  label: "Organisation Role", sortable: true },
  { key: "last_assessment_completed_at", label: "Last Management Review", sortable: true },
  { key: "valid_until",   label: "Valid Until", sortable: true },
  { key: "",              label: "Action", sortable: false },
];

export default function SystemsListPage({ onSelectSystem }: { onSelectSystem: (id: string, name: string) => void }) {
  const [systems, setSystems] = useState<SystemRiskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [tlFilter, setTlFilter] = useState<"red" | "orange" | "green" | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("traffic_light");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    api.getSystems()
      .then(setSystems)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const countTl = (v: "red" | "orange" | "green") => systems.filter(s => s.traffic_light === v).length;
  const highRisk = systems.filter(s => s.system_tier === "high").length;

  const kpis = [
    { key: "total" as const,    label: "Total",           value: systems.length, color: "#1147E9" },
    { key: "high" as const,     label: "High Risk",        value: highRisk,       color: "#7c3aed" },
    { key: "red" as const,      label: "Action Required",  value: countTl("red"),    color: "#dc2626" },
    { key: "orange" as const,   label: "In Progress",      value: countTl("orange"), color: "#d97706" },
    { key: "green" as const,    label: "Completed",        value: countTl("green"),  color: "#16a34a" },
  ];

  const [activeKpi, setActiveKpi] = useState<KpiKey>("total");  const [highFilter, setHighFilter] = useState(false);

  const handleKpi = (key: KpiKey) => {
    setActiveKpi(key);
    setHighFilter(key === "high");
    if (key === "total" || key === "high") {
      setTlFilter(null);
    } else {
      setTlFilter(key as "red" | "orange" | "green");
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const clearAll = () => { setSearch(""); setTlFilter(null); setHighFilter(false); setActiveKpi("total"); setSortKey("traffic_light"); setSortDir("asc"); };
  const hasFilters = search !== "" || tlFilter !== null || sortKey !== "traffic_light" || sortDir !== "asc";

  let filtered = systems.filter(s => {
    const matchesSearch = !search ||
      s.system_name.toLowerCase().includes(search.toLowerCase()) ||
      (s.system_tier ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesTl = !tlFilter || s.traffic_light === tlFilter;
    const matchesHigh = !highFilter || s.system_tier === "high";
    return matchesSearch && matchesTl && matchesHigh;
  });
  filtered = sortSystems(filtered, sortKey, sortDir);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, gap: 12, color: "var(--text-secondary)" }}>
      <span style={{ width: 20, height: 20, border: "2px solid var(--brand)", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
      Loading systems…
    </div>
  );

  if (error) return (
    <div style={{ padding: 20, background: "#ffd5d5", borderRadius: 8, color: "#8b0000", fontSize: 13 }}>
      Failed to load systems: {error}
    </div>
  );

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0 }}>Risk Management</h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>Iterative risk management for all registered AI systems</p>
      </div>

      {/* KPI row — clickable for filtering */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {kpis.map(kpi => {
          const isActive = activeKpi === kpi.key;
          return (
            <button
              key={kpi.label}
              onClick={() => handleKpi(kpi.key)}
              style={{
                flex: 1, minWidth: 100,
                background: isActive ? kpi.color : "#fff",
                borderRadius: 8, padding: "12px 16px", textAlign: "center",
                border: `2px solid ${kpi.color}`,
                cursor: "pointer",
                transition: "all 0.15s",
                boxShadow: isActive ? `0 2px 8px ${kpi.color}44` : "none",
              }}
            >
              <div style={{ fontSize: 24, fontWeight: 700, color: isActive ? "#fff" : kpi.color }}>{kpi.value}</div>
              <div style={{ fontSize: 11, color: isActive ? "rgba(255,255,255,0.9)" : kpi.color, marginTop: 3, fontWeight: 600 }}>{kpi.label}</div>
            </button>
          );
        })}
      </div>

      {/* Search + clear filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Filter by name or tier…"
          style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 13, boxSizing: "border-box" }}
        />
        {hasFilters && (
          <button
            onClick={clearAll}
            style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 14px", fontSize: 13, background: "var(--bg)", cursor: "pointer", whiteSpace: "nowrap", color: "var(--text-secondary)" }}
          >
            Clear filters &amp; sorting
          </button>
        )}
      </div>

      {/* Systems table */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--bg)" }}>
              {COLUMNS.map(col => (
                <th
                  key={col.label}
                  onClick={() => col.sortable && col.key && handleSort(col.key as SortKey)}
                  style={{
                    padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700,
                    color: col.sortable && sortKey === col.key ? "var(--brand)" : "var(--text-secondary)",
                    textTransform: "uppercase", letterSpacing: "0.5px",
                    borderBottom: "2px solid var(--border)",
                    cursor: col.sortable ? "pointer" : "default",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {col.label}
                  {col.sortable && col.key && sortKey === col.key && (
                    <span style={{ marginLeft: 4, fontSize: 10 }}>{sortDir === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} style={{ padding: "32px", textAlign: "center", color: "var(--text-secondary)" }}>
                  {search || tlFilter ? "No systems match the filter." : "No AI systems registered yet."}
                </td>
              </tr>
            )}
            {filtered.map(sys => {
              const btn = actionBtn(sys);
              const rowBg = sys.traffic_light === "red" ? "#fff5f5" : "#fff";
              return (
                <tr key={sys.system_id} style={{ borderBottom: "1px solid var(--border)", background: rowBg, transition: "background 0.1s" }}>
                  {/* Status (traffic light) */}
                  <td style={{ padding: "12px 14px" }}>
                    <TrafficLight value={sys.traffic_light} />
                  </td>
                  {/* System name */}
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ fontWeight: 600, color: "var(--text)" }}>{sys.system_name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{sys.system_id}</div>
                  </td>
                  {/* Risk Classification */}
                  <td style={{ padding: "12px 14px" }}>
                    <TierBadge tier={sys.system_tier} />
                  </td>
                  {/* Lifecycle */}
                  <td style={{ padding: "12px 14px" }}>
                    <LifecycleBadge lc={sys.system_lifecycle} />
                  </td>
                  {/* Organisation Role */}
                  <td style={{ padding: "12px 14px", color: "var(--text-secondary)" }}>
                    {sys.system_org_role ? (ORG_ROLE_LABELS[sys.system_org_role] ?? sys.system_org_role) : <span style={{ color: "#d1d5db" }}>—</span>}
                  </td>
                  {/* Last Assessment */}
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ color: "var(--text-secondary)" }}>{formatDate(sys.last_assessment_completed_at)}</div>
                    {sys.registry_changed && (
                      <div style={{ fontSize: 11, color: "#dc2626", fontWeight: 600, marginTop: 2 }}>Changes pending review</div>
                    )}
                  </td>
                  {/* Valid Until */}
                  <td style={{ padding: "12px 14px" }}>
                    {sys.valid_until
                      ? <div style={{ color: new Date(sys.valid_until) < new Date() ? "#dc2626" : "var(--text-secondary)" }}>{formatDate(sys.valid_until)}</div>
                      : <span style={{ color: "var(--text-secondary)" }}>—</span>}
                    {(() => { const h = statusHint(sys); return h ? <div style={{ fontSize: 11, color: h.color, fontWeight: 600, marginTop: 2 }}>{h.label}</div> : null; })()}
                  </td>
                  {/* Action */}
                  <td style={{ padding: "12px 14px" }}>
                    <button
                      onClick={() => onSelectSystem(sys.system_id, sys.system_name)}
                      style={{
                        background: btn.color, color: "#fff", border: "none", borderRadius: 6,
                        padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}
                    >
                      {btn.label}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
