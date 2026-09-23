import { useState, useEffect } from "react";
import { api } from "../api/client";
import type { SystemRiskSummary, LibraryRisk, LibraryRiskStats, RiskCandidate } from "../types";
import type { DraftRisk } from "./AssessmentWizardPage";

const TIER_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  high:            { bg: "#fde8d0", color: "#8b3a00", border: "#f5c890" },
  "gpai-systemic": { bg: "#fde8d0", color: "#8b3a00", border: "#f5c890" },
  "gpai-standard": { bg: "#fff3c4", color: "#7a5900", border: "#f5df84" },
  limited:         { bg: "#fff3c4", color: "#7a5900", border: "#f5df84" },
  minimal:         { bg: "#d5f5e3", color: "#1a5c35", border: "#9cdcb8" },
  prohibited:      { bg: "#ffd5d5", color: "#8b0000", border: "#f5b8b8" },
  pending:         { bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" },
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
  if (status !== "approved") {
    if (sys.total_risks === 0) return { label: "No risks added", color: "#d97706" };
    if (sys.open_risks > 0) return { label: "Risks pending review", color: "#d97706" };
    return { label: "Pending approval", color: "#d97706" };
  }
  if (sys.valid_until && new Date(sys.valid_until) < new Date()) return { label: "Overdue", color: "#dc2626" };
  if (sys.unacknowledged_triggers > 0) return { label: "Review due", color: "#dc2626" };
  if (sys.reassessment_needed) return { label: "Overdue", color: "#dc2626" };
  if (sys.unconfirmed_risks > 0) return { label: "Risks unconfirmed", color: "#d97706" };
  return null;
}

type SortKey = "system_name" | "system_tier" | "last_assessment_completed_at" | "valid_until" | "traffic_light";
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
  { key: "last_assessment_completed_at", label: "Last Management Review", sortable: true },
  { key: "valid_until",   label: "Valid Until", sortable: true },
  { key: "",              label: "Status", sortable: false },
  { key: "",              label: "Action", sortable: false },
];

function capFirst(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "—";
}

// ── Risk Library ──────────────────────────────────────────────────────────────

function SeverityBadge({ value }: { value: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    high:     { bg: "#fde8d0", color: "#8b3a00" },
    critical: { bg: "#ffd5d5", color: "#8b0000" },
    medium:   { bg: "#fff3c4", color: "#7a5900" },
    low:      { bg: "#d5f5e3", color: "#1a5c35" },
  };
  const c = colors[value] ?? { bg: "#f3f4f6", color: "#6b7280" };
  return <Badge text={capFirst(value)} style={{ background: c.bg, color: c.color }} />;
}

interface UseSystemModalProps {
  risk: LibraryRisk;
  systems: SystemRiskSummary[];
  onClose: () => void;
  onSelectSystem: (id: string, name: string, prefill: Partial<DraftRisk>) => void;
}

function UseSystemModal({ risk, systems, onClose, onSelectSystem }: UseSystemModalProps) {
  const [selected, setSelected] = useState("");

  const prefill: Partial<DraftRisk> = {
    title: risk.title,
    description: risk.description,
    categories: risk.category ? [risk.category] : [],
    severity: risk.severity,
    likelihood: risk.likelihood,
    affects_vulnerable_groups: risk.affects_vulnerable_groups,
    impact: risk.suggested_mitigation,
    risk_owner: "",
    library_risk_id: risk.id,
  };

  const handleUse = () => {
    if (!selected) return;
    const sys = systems.find(s => s.system_id === selected);
    if (!sys) return;
    onSelectSystem(sys.system_id, sys.system_name, prefill);
    onClose();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "var(--surface)", borderRadius: 12, padding: "28px 28px 24px",
        width: 480, maxWidth: "calc(100vw - 40px)", boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
      }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Use library risk</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
          Select a system to add "<strong>{risk.title}</strong>" to. The Add Risk form will open pre-filled.
        </div>

        <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>AI System</label>
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", fontSize: 13, marginBottom: 20, boxSizing: "border-box" }}
        >
          <option value="">— Select a system —</option>
          {systems.map(s => (
            <option key={s.system_id} value={s.system_id}>{s.system_name}</option>
          ))}
        </select>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 18px", fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
          <button
            onClick={handleUse}
            disabled={!selected}
            style={{
              background: selected ? "#1147E9" : "#c4c4c4", color: "#fff", border: "none",
              borderRadius: 6, padding: "7px 20px", fontSize: 13, fontWeight: 600,
              cursor: selected ? "pointer" : "default",
            }}
          >
            Use risk
          </button>
        </div>
      </div>
    </div>
  );
}

interface AddToLibraryModalProps {
  onClose: () => void;
  onCreated: (risk: LibraryRisk) => void;
}

const EMPTY_FORM = {
  title: "",
  description: "",
  category: "",
  severity: "medium",
  likelihood: "possible",
  affects_vulnerable_groups: false,
  affects_children: false,
  suggested_mitigation: "",
  source: "",
};

function AddToLibraryModal({ onClose, onCreated }: AddToLibraryModalProps) {
  const [mode, setMode] = useState<"scratch" | "import">("scratch");
  const [candidates, setCandidates] = useState<RiskCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const switchToImport = () => {
    setMode("import");
    if (candidates.length === 0) {
      setCandidatesLoading(true);
      api.getRiskCandidates()
        .then(setCandidates)
        .catch(() => {})
        .finally(() => setCandidatesLoading(false));
    }
  };

  const handleCandidateSelect = (riskId: string) => {
    setSelectedCandidate(riskId);
    const c = candidates.find(c => c.risk_id === riskId);
    if (c) {
      setForm({
        title: c.title,
        description: c.description,
        category: c.category,
        severity: c.severity,
        likelihood: c.likelihood,
        affects_vulnerable_groups: c.affects_vulnerable_groups,
        affects_children: false,
        suggested_mitigation: c.suggested_mitigation,
        source: "",
      });
    }
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    setSaveError("");
    try {
      const created = await api.createLibraryRisk(form);
      onCreated(created);
      onClose();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", border: "1px solid var(--border)", borderRadius: 6,
    padding: "7px 10px", fontSize: 13, boxSizing: "border-box",
    background: "var(--surface)", color: "var(--text)",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4,
  };
  const fieldStyle: React.CSSProperties = { marginBottom: 12 };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "var(--surface)", borderRadius: 12, padding: "28px 28px 24px",
        width: 560, maxWidth: "calc(100vw - 40px)", boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
        maxHeight: "90vh", overflowY: "auto",
      }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Add risk to library</div>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 0, marginBottom: 20, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {(["scratch", "import"] as const).map(m => (
            <button key={m} onClick={() => m === "import" ? switchToImport() : setMode("scratch")}
              style={{
                flex: 1, padding: "8px", fontSize: 12, fontWeight: 600,
                border: "none", cursor: "pointer",
                background: mode === m ? "#1147E9" : "var(--surface)",
                color: mode === m ? "#fff" : "var(--text-secondary)",
              }}
            >
              {m === "scratch" ? "From scratch" : "From risk management"}
            </button>
          ))}
        </div>

        {/* Import selector */}
        {mode === "import" && (
          <div style={fieldStyle}>
            <label style={labelStyle}>Select an existing risk</label>
            {candidatesLoading ? (
              <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "8px 0" }}>Loading risks…</div>
            ) : candidates.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "8px 0" }}>No unlinked risks found in risk management.</div>
            ) : (
              <select value={selectedCandidate} onChange={e => handleCandidateSelect(e.target.value)} style={inputStyle}>
                <option value="">— Select a risk —</option>
                {candidates.map(c => (
                  <option key={c.risk_id} value={c.risk_id}>
                    {c.title} ({c.system_name})
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Form fields */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Title <span style={{ color: "#c00" }}>*</span></label>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Short risk title" style={inputStyle} />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Description</label>
          <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={3} placeholder="What is this risk about?" style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Category</label>
            <input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              placeholder="e.g. fairness, safety" style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Source</label>
            <input value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
              placeholder="e.g. NIST AI RMF" style={inputStyle} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Severity</label>
            <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} style={inputStyle}>
              {["low", "medium", "high", "critical"].map(v => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Likelihood</label>
            <select value={form.likelihood} onChange={e => setForm(f => ({ ...f, likelihood: e.target.value }))} style={inputStyle}>
              {["rare", "unlikely", "possible", "likely", "almost_certain"].map(v => (
                <option key={v} value={v}>{v.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase())}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Suggested mitigation</label>
          <textarea value={form.suggested_mitigation}
            onChange={e => setForm(f => ({ ...f, suggested_mitigation: e.target.value }))}
            rows={3} placeholder="What can be done to mitigate this risk?" style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={form.affects_vulnerable_groups}
              onChange={e => setForm(f => ({ ...f, affects_vulnerable_groups: e.target.checked }))} />
            Affects vulnerable groups
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={form.affects_children}
              onChange={e => setForm(f => ({ ...f, affects_children: e.target.checked }))} />
            Affects children
          </label>
        </div>

        {saveError && (
          <div style={{ fontSize: 12, color: "#8b0000", marginBottom: 12 }}>{saveError}</div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 18px", fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !form.title.trim()}
            style={{
              background: (saving || !form.title.trim()) ? "#c4c4c4" : "#1147E9",
              color: "#fff", border: "none", borderRadius: 6,
              padding: "7px 20px", fontSize: 13, fontWeight: 600,
              cursor: (saving || !form.title.trim()) ? "default" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Add to library"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface RiskLibraryCardProps {
  systems: SystemRiskSummary[];
  onSelectSystem: (id: string, name: string, prefill: Partial<DraftRisk>) => void;
}

function RiskLibraryCard({ systems, onSelectSystem }: RiskLibraryCardProps) {
  const [risks, setRisks] = useState<LibraryRisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState<Record<string, LibraryRiskStats>>({});
  const [statsLoading, setStatsLoading] = useState<Record<string, boolean>>({});
  const [useModal, setUseModal] = useState<LibraryRisk | null>(null);
  const [addModal, setAddModal] = useState(false);

  useEffect(() => {
    api.getRiskLibrary()
      .then(setRisks)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const toggleExpand = (id: string) => {
    const next = !expanded[id];
    setExpanded(prev => ({ ...prev, [id]: next }));
    if (next && !stats[id] && !statsLoading[id]) {
      setStatsLoading(prev => ({ ...prev, [id]: true }));
      api.getRiskLibraryStats(id)
        .then(s => setStats(prev => ({ ...prev, [id]: s })))
        .catch(() => {})
        .finally(() => setStatsLoading(prev => ({ ...prev, [id]: false })));
    }
  };

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
      overflow: "hidden",
    }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => setAddModal(true)}
          style={{
            background: "#1147E9", color: "#fff", border: "none", borderRadius: 7,
            padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}
        >
          + Add risk to library
        </button>
      </div>
      {loading && (
        <div style={{ padding: "24px", textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>Loading…</div>
      )}
      {error && (
        <div style={{ padding: "16px 20px", color: "#8b0000", fontSize: 13 }}>Failed to load: {error}</div>
      )}
      {!loading && !error && risks.length === 0 && (
        <div style={{ padding: "24px", textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>No library risks defined yet.</div>
      )}

      {!loading && !error && risks.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--bg)" }}>
              {["Title", "Category", "Incidents", ""].map(h => (
                <th key={h} style={{
                  padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 700,
                  color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.4px",
                  borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {risks.map(r => (
              <>
                <tr
                  key={r.id}
                  onClick={() => toggleExpand(r.id)}
                  style={{
                    borderBottom: expanded[r.id] ? "none" : "1px solid var(--border)",
                    cursor: "pointer",
                    background: expanded[r.id] ? "#f9f9fb" : "var(--surface)",
                  }}
                >
                  <td style={{ padding: "10px 12px", maxWidth: 300 }}>
                    <div style={{ fontWeight: 600, color: "var(--text)" }}>{r.title}</div>
                    {r.description && (
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.4 }}>
                        {r.description.length > 110 ? r.description.slice(0, 110) + "…" : r.description}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: 11, background: "#eef1f4", padding: "2px 7px", borderRadius: 8 }}>
                      {r.category ? capFirst(r.category) : "—"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    {r.incidents.length > 0 ? (
                      <span style={{ fontSize: 11, background: "#fde8d0", color: "#8b3a00", padding: "2px 7px", borderRadius: 8, fontWeight: 600 }}>
                        {r.incidents.length} {r.incidents.length === 1 ? "incident" : "incidents"}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        onClick={e => { e.stopPropagation(); setUseModal(r); }}
                        style={{
                          background: "#1147E9", color: "#fff", border: "none", borderRadius: 6,
                          padding: "5px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                        }}
                      >
                        Use
                      </button>
                      <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{expanded[r.id] ? "▲" : "▼"}</span>
                    </div>
                  </td>
                </tr>
                {expanded[r.id] && (
                  <tr key={`${r.id}-detail`} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td colSpan={4} style={{ padding: "12px 16px 16px 28px", background: "#f9f9fb" }}>
                      {statsLoading[r.id] && (
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>Loading stats…</div>
                      )}

                      {/* Suggested severity / likelihood */}
                      {stats[r.id] && (
                        <div style={{ display: "flex", gap: 24, marginBottom: 14, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>Suggested severity</div>
                            {stats[r.id].dominant_severity
                              ? <SeverityBadge value={stats[r.id].dominant_severity!} />
                              : <span style={{ fontSize: 12, background: "#eef1f4", padding: "2px 7px", borderRadius: 8 }}>{capFirst(r.severity)}</span>
                            }
                            {stats[r.id].dominant_severity && (
                              <span style={{ fontSize: 10, color: "var(--text-secondary)", marginLeft: 6 }}>
                                (from {stats[r.id].linked_systems.length} {stats[r.id].linked_systems.length === 1 ? "system" : "systems"})
                              </span>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>Suggested likelihood</div>
                            {stats[r.id].dominant_likelihood
                              ? <span style={{ fontSize: 11, background: "#eef1f4", padding: "2px 7px", borderRadius: 8 }}>{capFirst(stats[r.id].dominant_likelihood!)}</span>
                              : <span style={{ fontSize: 11, background: "#eef1f4", padding: "2px 7px", borderRadius: 8 }}>{capFirst(r.likelihood)}</span>
                            }
                          </div>
                        </div>
                      )}
                      {!stats[r.id] && !statsLoading[r.id] && (
                        <div style={{ display: "flex", gap: 24, marginBottom: 14 }}>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>Suggested severity</div>
                            <SeverityBadge value={r.severity} />
                          </div>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>Suggested likelihood</div>
                            <span style={{ fontSize: 11, background: "#eef1f4", padding: "2px 7px", borderRadius: 8 }}>{capFirst(r.likelihood)}</span>
                          </div>
                        </div>
                      )}

                      {/* Linked systems */}
                      {stats[r.id] && (
                        <div style={{ marginBottom: r.incidents.length > 0 ? 14 : 0 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 6 }}>
                            Linked systems ({stats[r.id].linked_systems.length})
                          </div>
                          {stats[r.id].linked_systems.length === 0 ? (
                            <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Not used in any system yet.</span>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {stats[r.id].linked_systems.map(ls => (
                                <span key={ls.risk_id} style={{
                                  fontSize: 11, background: "var(--surface)", border: "1px solid var(--border)",
                                  borderRadius: 6, padding: "3px 8px",
                                }}>
                                  {ls.system_name}
                                  <span style={{ marginLeft: 6, color: "var(--text-secondary)" }}>
                                    {capFirst(ls.severity)} · {capFirst(ls.status)}
                                  </span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Affected groups */}
                      {(r.affects_vulnerable_groups || r.affects_children) && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 6 }}>
                            Affected groups
                          </div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {r.affects_vulnerable_groups && (
                              <span style={{ fontSize: 11, background: "#fef3c7", color: "#78350f", border: "1px solid #fde68a", padding: "2px 8px", borderRadius: 6 }}>
                                Vulnerable groups
                              </span>
                            )}
                            {r.affects_children && (
                              <span style={{ fontSize: 11, background: "#fef3c7", color: "#78350f", border: "1px solid #fde68a", padding: "2px 8px", borderRadius: 6 }}>
                                Children
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Known incidents */}
                      {r.incidents.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 6 }}>
                            Known incidents
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {r.incidents.map(inc => (
                              <div key={inc.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px" }}>
                                <div style={{ fontWeight: 600, fontSize: 12 }}>
                                  {inc.source_url ? (
                                    <a href={inc.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "#1147E9", textDecoration: "none" }}>{inc.title}</a>
                                  ) : inc.title}
                                  {inc.occurred_at && (
                                    <span style={{ fontWeight: 400, color: "var(--text-secondary)", marginLeft: 8, fontSize: 11 }}>
                                      {formatDate(inc.occurred_at)}
                                    </span>
                                  )}
                                </div>
                                {inc.description && (
                                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3, lineHeight: 1.5 }}>{inc.description}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}

      {useModal && (
        <UseSystemModal
          risk={useModal}
          systems={systems}
          onClose={() => setUseModal(null)}
          onSelectSystem={onSelectSystem}
        />
      )}

      {addModal && (
        <AddToLibraryModal
          onClose={() => setAddModal(false)}
          onCreated={newRisk => setRisks(prev => [newRisk, ...prev])}
        />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: "systems",  title: "Risk Management",  desc: "Iterative risk management for all registered AI systems" },
  { key: "library",  title: "Risk Library",      desc: "Predefined risks you can add to any system" },
] as const;
type TabKey = typeof TABS[number]["key"];

export default function SystemsListPage({ onSelectSystem }: {
  onSelectSystem: (id: string, name: string, prefill?: Partial<DraftRisk>) => void;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("systems");
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

  const [activeKpi, setActiveKpi] = useState<KpiKey>("total");
  const [highFilter, setHighFilter] = useState(false);

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

  const currentTab = TABS.find(t => t.key === activeTab)!;

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>
      {/* Header with tabs */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 0, borderBottom: "2px solid var(--border)", marginBottom: 12 }}>
          {TABS.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: "10px 20px 12px",
                  borderBottom: isActive ? "2px solid var(--brand, #1147E9)" : "2px solid transparent",
                  marginBottom: -2,
                  fontWeight: isActive ? 700 : 500,
                  fontSize: 14,
                  color: isActive ? "var(--brand, #1147E9)" : "var(--text-secondary)",
                  transition: "all 0.15s",
                }}
              >
                {tab.title}
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>{currentTab.desc}</p>
      </div>

      {activeTab === "library" && (
        <RiskLibraryCard systems={systems} onSelectSystem={onSelectSystem} />
      )}

      {activeTab === "systems" && (<>

      {/* KPI row */}
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
                  </td>
                  {/* Assessment Status */}
                  <td style={{ padding: "12px 14px" }}>
                    {(() => {
                      const h = statusHint(sys);
                      const isNonHigh = sys.system_tier && sys.system_tier !== "high" && sys.system_tier !== "pending";
                      const voluntaryNote = isNonHigh
                        ? <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>Risk management voluntary</div>
                        : null;
                      if (h) return <><span style={{ fontSize: 12, color: h.color, fontWeight: 600 }}>{h.label}</span>{voluntaryNote}</>;
                      if (sys.active_register_id && sys.active_register_status === "approved") {
                        return <><span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>Completed</span>{voluntaryNote}</>;
                      }
                      return <><span style={{ fontSize: 12, color: "#6b7280" }}>Not initiated</span>{voluntaryNote}</>;
                    })()}
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

      </>)}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
