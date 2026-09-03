import { useState, useEffect } from "react";
import { api } from "../api/client";
import type { SystemRiskSummary } from "../types";

const TIER_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  high:            { bg: "#fde8d0", color: "#8b3a00", border: "#f5c890" },
  "gpai-systemic": { bg: "#fde8d0", color: "#8b3a00", border: "#f5c890" },
  "gpai-standard": { bg: "#fff3c4", color: "#7a5900", border: "#f5df84" },
  limited:         { bg: "#fff3c4", color: "#7a5900", border: "#f5df84" },
  minimal:         { bg: "#d5f5e3", color: "#1a5c35", border: "#9cdcb8" },
  prohibited:      { bg: "#ffd5d5", color: "#8b0000", border: "#f5b8b8" },
};

function Badge({ text, style }: { text: string; style?: React.CSSProperties }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "2px 8px",
      borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
      background: "#eef1f4", color: "#556b82", ...style,
    }}>
      {text}
    </span>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const c = TIER_COLORS[tier] ?? { bg: "#eef1f4", color: "#556b82", border: "#dde0e4" };
  return <Badge text={tier.toUpperCase()} style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }} />;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function StatusDot({ reassessmentNeeded, tier }: { reassessmentNeeded: boolean; tier: string }) {
  const isHigh = tier === "high" || tier === "prohibited";
  const color = !reassessmentNeeded ? "#16a34a" : isHigh ? "#dc2626" : "#d97706";
  const label = !reassessmentNeeded ? "Risk management up to date"
    : isHigh ? "Action required" : "Risk management in progress (optional)";
  return (
    <span style={{
      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
      background: color, display: "inline-block",
    }} title={label} />
  );
}

function InfoTooltip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", marginLeft: 4, verticalAlign: "middle" }}
      onMouseEnter={e => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setPos({ x: r.left + r.width / 2, y: r.top });
      }}
      onMouseLeave={() => setPos(null)}>
      <span style={{
        width: 14, height: 14, borderRadius: "50%", background: "#6b7280", color: "#fff",
        fontSize: 9, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center",
        cursor: "default", userSelect: "none", flexShrink: 0,
      }}>i</span>
      {pos && (
        <span style={{
          position: "fixed",
          left: Math.min(pos.x - 130, window.innerWidth - 280),
          top: pos.y - 8,
          transform: "translateY(-100%)",
          background: "#1f2937", color: "#fff", borderRadius: 6, padding: "8px 12px",
          fontSize: 11, lineHeight: 1.5, width: 260, zIndex: 9999, whiteSpace: "normal",
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          pointerEvents: "none",
        }}>
          {text}
        </span>
      )}
    </span>
  );
}

function actionBtn(sys: SystemRiskSummary): { label: string; color: string } {
  if (!sys.active_register_id) {
    return { label: "Start", color: "#16a34a" };
  }
  const status = sys.active_register_status ?? "";
  if (status === "approved") {
    return sys.reassessment_needed
      ? { label: "Restart", color: "#dc2626" }
      : { label: "Open", color: "#1147E9" };
  }
  // draft / submitted / anything in-progress
  return { label: "Resume", color: "#d97706" };
}

export default function SystemsListPage({ onSelectSystem }: { onSelectSystem: (id: string, name: string) => void }) {
  const [systems, setSystems] = useState<SystemRiskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.getSystems()
      .then(setSystems)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = systems.filter(s =>
    s.system_name.toLowerCase().includes(search.toLowerCase()) ||
    s.system_tier.toLowerCase().includes(search.toLowerCase())
  );

  const needsReassessment = systems.filter(s => s.reassessment_needed).length;
  const highRisk = systems.filter(s => s.system_tier === "high" || s.system_tier === "prohibited").length;

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, gap: 12, color: "#556b82" }}>
      <span style={{ width: 20, height: 20, border: "2px solid #1147E9", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
      Loading systems…
    </div>
  );

  if (error) return (
    <div style={{ padding: 20, background: "#ffd5d5", borderRadius: 8, color: "#8b0000", fontSize: 13 }}>
      Failed to load systems: {error}
    </div>
  );

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Risk Management</h1>
        <p style={{ fontSize: 13, color: "#556b82", marginTop: 4 }}>Art. 9 EU AI Act — iterative risk assessment for all registered AI systems</p>
      </div>

      {/* KPI row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Total systems", value: systems.length, color: "#1147E9" },
          { label: "High risk", value: highRisk, color: "#dc2626" },
          { label: "Re-assessment needed", value: needsReassessment, color: "#f59e0b" },
          { label: "Up to date", value: systems.length - needsReassessment, color: "#16a34a" },
        ].map(kpi => (
          <div key={kpi.label} style={{ flex: 1, minWidth: 120, background: "#f8f9fa", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
            <div style={{ fontSize: 11, color: "#556b82", marginTop: 3, fontWeight: 500 }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <input
        type="text" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Filter systems…"
        style={{ width: "100%", border: "1px solid #e4e4e7", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 16, boxSizing: "border-box" }}
      />

      {/* Systems table */}
      <div style={{ background: "#fff", border: "1px solid #e4e4e7", borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f8f9fa" }}>
              {["", "System", "Tier", "Lifecycle", "Last assessment", "Status", "Action"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#556b82", textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "2px solid #e4e4e7" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: "32px", textAlign: "center", color: "#556b82" }}>
                  {search ? "No systems match the filter." : "No AI systems registered yet."}
                </td>
              </tr>
            )}
            {filtered.map(sys => {
              const isHighRisk = sys.system_tier === "high" || sys.system_tier === "prohibited";
              const btn = actionBtn(sys);
              const triggerTooltip = `Re-assessment triggers are events that require a new risk management cycle under EU AI Act Art. 9(1). They are created automatically when: (1) 6 months have passed since the last approved cycle, or (2) a significant change was detected in the AI system. Each unacknowledged trigger must be addressed by starting a new risk management cycle.`;
              const triggerLabel = sys.unacknowledged_triggers === 1
                ? "Risk review required"
                : `${sys.unacknowledged_triggers} risk reviews required`;
              return (
                <tr key={sys.system_id} style={{
                  borderBottom: "1px solid #e4e4e7",
                  background: isHighRisk && sys.reassessment_needed ? "#fff5f5" : "#fff",
                  transition: "background 0.1s",
                }}>
                  <td style={{ padding: "12px 14px" }}>
                    <StatusDot reassessmentNeeded={sys.reassessment_needed} tier={sys.system_tier} />
                  </td>
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ fontWeight: 600, color: "#111827" }}>{sys.system_name}</div>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{sys.system_id}</div>
                  </td>
                  <td style={{ padding: "12px 14px" }}>
                    <TierBadge tier={sys.system_tier} />
                  </td>
                  <td style={{ padding: "12px 14px", color: "#556b82" }}>
                    {sys.system_lifecycle}
                  </td>
                  <td style={{ padding: "12px 14px", color: "#556b82" }}>
                    {formatDate(sys.last_assessment_completed_at)}
                    {sys.reassessment_needed && isHighRisk && (
                      <div style={{ fontSize: 11, color: "#dc2626", marginTop: 2, display: "flex", alignItems: "center" }}>
                        {sys.unacknowledged_triggers > 0
                          ? <><span>{triggerLabel}</span><InfoTooltip text={triggerTooltip} /></>
                          : sys.last_assessment_completed_at
                            ? <><span>Overdue (&gt;6 months)</span><InfoTooltip text="EU AI Act Art. 9(1) requires iterative risk management throughout the AI system lifecycle, but does not specify a fixed interval. This platform recommends reviewing risk management at least every 6 months as good practice. The last completed cycle was more than 6 months ago — a risk review is recommended." /></>
                            : sys.active_register_id
                              ? <><span>Risk management not completed</span><InfoTooltip text="A risk management process has been started but not yet approved. Complete and approve it to fulfil EU AI Act Art. 9(2) obligations before putting this system into service." /></>
                              : <><span>No risk management</span><InfoTooltip text="EU AI Act Art. 9(2) requires that a risk management system be established before a high-risk AI system is put into service. This system has no completed risk management record." /></>}
                      </div>
                    )}
                    {!isHighRisk && sys.active_register_id && !sys.last_assessment_completed_at && (
                      <div style={{ fontSize: 11, color: "#d97706", marginTop: 2, display: "flex", alignItems: "center" }}>
                        <span>Risk management in progress</span>
                        <InfoTooltip text="Risk management is optional for this tier under EU AI Act. A process has been started but not yet approved." />
                      </div>
                    )}
                    {!isHighRisk && !sys.active_register_id && (
                      <div style={{ fontSize: 11, color: "#16a34a", marginTop: 2, display: "flex", alignItems: "center" }}>
                        <span>Risk management optional</span>
                        <InfoTooltip text="EU AI Act does not require formal risk management for this tier. Starting a voluntary risk management process is good practice and can support internal governance." />
                      </div>
                    )}
                    {!isHighRisk && sys.last_assessment_completed_at && (
                      <div style={{ fontSize: 11, color: "#16a34a", marginTop: 2, display: "flex", alignItems: "center" }}>
                        <span>Risk management optional</span>
                        <InfoTooltip text="EU AI Act does not require formal risk management for this tier. This record was created voluntarily as a good governance practice." />
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "12px 14px" }}>
                    {sys.active_register_status ? (
                      <Badge text={sys.active_register_status} />
                    ) : (
                      <Badge text="no register" style={{ background: "#fde8d0", color: "#8b3a00" }} />
                    )}
                  </td>
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
