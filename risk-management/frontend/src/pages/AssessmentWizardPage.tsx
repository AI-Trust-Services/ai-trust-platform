import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import type { RiskRegister, RiskEntry, MisuseScenario, MitigationMeasure, WizardStep } from "../types";

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "scope",    label: "1. Scope" },
  { key: "identify", label: "2. Identify" },
  { key: "evaluate", label: "3. Evaluate" },
  { key: "mitigate", label: "4. Manage risks" },
  { key: "approve",  label: "5. Approve" },
];

const SEV_COLORS: Record<string, string> = {
  critical: "#8b0000", high: "#8b3a00", medium: "#7a5900", low: "#1a5c35",
};
const SEV_BG: Record<string, string> = {
  critical: "#ffd5d5", high: "#fde8d0", medium: "#fff3c4", low: "#d5f5e3",
};

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width: "100%", border: "1px solid #e4e4e7", borderRadius: 6, padding: "6px 8px", fontSize: 13 }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
      style={{ width: "100%", border: "1px solid #e4e4e7", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
  );
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: "100%", border: "1px solid #e4e4e7", borderRadius: 6, padding: "6px 10px", fontSize: 13, boxSizing: "border-box" }} />
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
      {children}{required && <span style={{ color: "#dc2626" }}> *</span>}
    </label>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e4e4e7", borderRadius: 10, padding: "20px 24px", marginBottom: 16, ...style }}>
      {children}
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ background: "#ffd5d5", color: "#8b0000", borderRadius: 6, padding: "8px 12px", fontSize: 12, marginTop: 8 }}>{msg}</div>;
}

function ApprovedBanner({ register }: { register: { approver_username?: string | null; approved_at?: string | null } }) {
  return (
    <div style={{ background: "#d5f5e3", border: "1px solid #9cdcb8", borderRadius: 8, padding: "10px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
      <span style={{ fontSize: 18 }}>✅</span>
      <span style={{ color: "#1a5c35", fontWeight: 700 }}>
        Approved by {register.approver_username ?? "—"} on {register.approved_at ? new Date(register.approved_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
      </span>
      <span style={{ color: "#1a5c35", marginLeft: 4 }}>— viewing in read-only mode 🔒</span>
    </div>
  );
}

function exportReport(systemName: string, register: RiskRegister, risks: RiskEntry[], archived = false) {
  const confirmed = risks.filter(r => r.status === "confirmed");
  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const levelBadge = (l?: string | null) => {
    const colors: Record<string, string> = { critical: "#ffd5d5", high: "#fde8d0", medium: "#fff3c4", low: "#d5f5e3" };
    return l ? `<span style="background:${colors[l] ?? "#eef1f4"};padding:2px 8px;border-radius:10px;font-weight:700;font-size:11px;text-transform:uppercase">${l}</span>` : "—";
  };

  const risksHtml = confirmed.map(r => `
    <div style="border:1px solid #e4e4e7;border-radius:8px;padding:16px;margin-bottom:12px;page-break-inside:avoid">
      <div style="font-weight:700;font-size:14px;margin-bottom:6px">${r.title}</div>
      <div style="font-size:12px;color:#556b82;margin-bottom:8px">
        Category: ${r.category} · Type: ${r.risk_type} · Severity: ${levelBadge(r.severity)} · Likelihood: ${r.likelihood} · Risk level: ${levelBadge(r.risk_level_autocalculated)}
        ${r.risk_owner ? ` · Owner: ${r.risk_owner}` : ""}
      </div>
      ${r.description ? `<div style="font-size:13px;margin-bottom:8px">${r.description}</div>` : ""}
      ${r.impact ? `<div style="font-size:12px;color:#374151;margin-bottom:8px"><strong>Impact:</strong> ${r.impact}</div>` : ""}
      ${r.affects_vulnerable_groups ? `<div style="font-size:12px;color:#8b3a00;margin-bottom:8px">⚠ Affects vulnerable groups: ${r.vulnerable_groups}</div>` : ""}
      ${r.mitigations.length > 0 ? `
        <div style="margin-top:8px">
          <div style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Risk management measures (${r.mitigations.length})</div>
          ${r.mitigations.map(m => `
            <div style="background:#f8f9fa;border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:12px">
              <span style="font-weight:600">[${m.hierarchy_level.toUpperCase()}]</span> ${m.title}
              ${m.description ? `<div style="color:#556b82;margin-top:3px">${m.description}</div>` : ""}
            </div>
          `).join("")}
        </div>
      ` : r.closure_justification ? `<div style="background:#fffbeb;border-radius:6px;padding:8px 12px;font-size:12px;color:#92400e"><strong>No measure:</strong> ${r.closure_justification}</div>` : ""}
      ${(r.residual_likelihood || r.residual_severity) ? `
        <div style="margin-top:8px;font-size:12px;color:#1147E9">
          <strong>Residual risk:</strong> likelihood: ${r.residual_likelihood ?? "—"} · severity: ${r.residual_severity ?? "—"} · level: ${levelBadge(r.final_risk_level)}
          ${r.date_of_assessment ? ` · assessed: ${fmtDate(r.date_of_assessment)}` : ""}
        </div>
      ` : ""}
    </div>
  `).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Risk Management Report — ${systemName}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 40px auto; color: #111827; }
      @media print { body { margin: 20px; } .no-print { display: none; } }
      h1 { font-size: 22px; margin-bottom: 4px; }
      .meta { font-size: 12px; color: #556b82; margin-bottom: 24px; }
      .archived-banner { background: #fef9c3; border: 2px solid #fde047; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; font-size: 13px; color: #713f12; font-weight: 700; }
      .approved-badge { background: #d5f5e3; border: 1px solid #9cdcb8; border-radius: 8px; padding: 10px 16px; margin-bottom: 20px; font-size: 13px; color: #1a5c35; font-weight: 700; }
      .section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #556b82; margin: 20px 0 10px; border-bottom: 1px solid #e4e4e7; padding-bottom: 6px; }
      .scope-box { background: #f8f9fa; border-radius: 8px; padding: 14px 16px; font-size: 13px; line-height: 1.6; margin-bottom: 16px; }
      .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
      .stat { background: #f8f9fa; border-radius: 8px; padding: 12px; text-align: center; }
      .stat-val { font-size: 24px; font-weight: 700; color: #1147E9; }
      .stat-lbl { font-size: 11px; color: #556b82; margin-top: 3px; }
      .footer { margin-top: 32px; font-size: 11px; color: #9ca3af; border-top: 1px solid #e4e4e7; padding-top: 12px; }
    </style>
  </head><body>
    <div class="no-print" style="margin-bottom:16px">
      <button onclick="window.print()" style="background:#1147E9;color:#fff;border:none;border-radius:6px;padding:8px 20px;font-size:13px;cursor:pointer;margin-right:8px">🖨 Print / Save as PDF</button>
      <button onclick="window.close()" style="background:#f4f4f5;color:#374151;border:none;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer">Close</button>
    </div>
    <h1>Risk Management Report</h1>
    <div class="meta">System: <strong>${systemName}</strong> · Register: ${register.id} · Generated: ${fmtDate(new Date().toISOString())}</div>
    ${archived ? `<div class="archived-banner">⚠ ARCHIVED — This report is from a previous risk management cycle. It is retained for audit purposes only and does not reflect the current state of risk management for this system.</div>` : ""}
    ${register.status === "approved" ? `
      <div class="approved-badge">✅ APPROVED — by ${register.approver_username ?? "—"} on ${fmtDate(register.approved_at)} · Residual risk: ${register.residual_risk_acceptable ? "Acceptable" : "Not acceptable"}</div>
    ` : `<div style="background:#fff3c4;border-radius:8px;padding:10px 16px;margin-bottom:20px;font-size:13px;color:#92400e">⚠ Status: ${register.status.toUpperCase()} — not yet approved</div>`}
    <div class="section-title">Assessment scope</div>
    <div class="scope-box">${register.assessment_scope || "—"}</div>
    <div class="stats">
      <div class="stat"><div class="stat-val">${confirmed.length}</div><div class="stat-lbl">Confirmed risks</div></div>
      <div class="stat"><div class="stat-val">${confirmed.reduce((a, r) => a + r.mitigations.length, 0)}</div><div class="stat-lbl">Measures</div></div>
      <div class="stat"><div class="stat-val">${confirmed.filter(r => r.affects_vulnerable_groups).length}</div><div class="stat-lbl">Vulnerable group risks</div></div>
      <div class="stat"><div class="stat-val">${confirmed.reduce((a, r) => a + r.misuse_scenarios.length, 0)}</div><div class="stat-lbl">Misuse scenarios</div></div>
    </div>
    <div class="section-title">Confirmed risks (${confirmed.length})</div>
    ${risksHtml || "<p style='color:#9ca3af;font-size:13px'>No confirmed risks.</p>"}
    ${register.residual_risk_argument ? `
      <div class="section-title">Residual risk argument (Art. 9(5))</div>
      <div class="scope-box">${register.residual_risk_argument}</div>
    ` : ""}
    <div class="footer">Generated by AI Trust Platform · EU AI Act Art. 9 Risk Management · ${new Date().getFullYear()}</div>
  </body></html>`;

  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

// ── Step 1: Scope ─────────────────────────────────────────────────────────────
function ScopeStep({ register, onNext, onPatch }: {
  register: RiskRegister | null;
  onNext: (scope: string, notes: string) => Promise<void>;
  onPatch: (scope: string, notes: string) => void;
}) {
  const [scope, setScope] = useState(register?.assessment_scope ?? "");
  const [notes, setNotes] = useState(register?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function handleNext() {
    if (!scope.trim()) { setErr("Assessment scope is required."); return; }
    setSaving(true);
    try {
      onPatch(scope, notes);
      await onNext(scope, notes);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Card>
        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Assessment scope (Art. 9(2)(a))</h3>
        <div style={{ marginBottom: 14 }}>
          <Label required>Scope description</Label>
          <Textarea value={scope} onChange={setScope} rows={4}
            placeholder="Describe what is in scope for this risk assessment: intended purpose, deployment context, data inputs, affected populations, operational environment…" />
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
            Include both known risks (already documented) and foreseeable risks (reasonably anticipatable misuse or failure modes).
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea value={notes} onChange={setNotes} rows={2} placeholder="Optional internal notes…" />
        </div>
      </Card>
      <ErrorMsg msg={err} />
      <button onClick={handleNext} disabled={saving}
        style={{ background: "#1147E9", color: "#fff", border: "none", borderRadius: 6, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
        {saving ? "Saving…" : "Next: Identify risks →"}
      </button>
    </div>
  );
}

// ── Step 2: Identify ──────────────────────────────────────────────────────────
const RISK_CATEGORIES = [
  "Discrimination / unfair treatment",
  "Privacy violation",
  "Safety / physical harm",
  "Security / misuse",
  "Transparency / explainability",
  "Human oversight failure",
  "Data quality / bias",
  "Robustness / reliability",
  "Legal / regulatory non-compliance",
  "Vulnerable group impact",
  "Other",
];

const RISK_LEVEL_MATRIX: Record<string, Record<string, string>> = {
  critical: { very_likely: "critical", likely: "critical", possible: "high",   unlikely: "medium" },
  high:     { very_likely: "critical", likely: "high",     possible: "high",   unlikely: "medium" },
  medium:   { very_likely: "high",     likely: "medium",   possible: "medium", unlikely: "low"    },
  low:      { very_likely: "medium",   likely: "low",      possible: "low",    unlikely: "low"    },
};

function calcRiskLevel(severity: string, likelihood: string): string {
  return RISK_LEVEL_MATRIX[severity]?.[likelihood] ?? "medium";
}

function RiskLevelBadge({ level }: { level: string }) {
  const c = SEV_COLORS[level] ?? "#556b82";
  const bg = SEV_BG[level] ?? "#eef1f4";
  return (
    <span style={{ fontSize: 11, background: bg, color: c, padding: "2px 10px", borderRadius: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
      {level}
    </span>
  );
}

const LIFECYCLE_PHASES = [
  { value: "", label: "— select —" },
  { value: "development", label: "Development" },
  { value: "testing", label: "Testing" },
  { value: "deployment", label: "Deployment" },
  { value: "operation", label: "Operation" },
  { value: "decommissioning", label: "Decommissioning" },
];

interface DraftRisk {
  title: string;
  description: string;
  category: string;
  risk_type: string;
  affects_vulnerable_groups: boolean;
  vulnerable_groups: string;
  severity: string;
  likelihood: string;
  risk_owner: string;
  ai_lifecycle_phase: string;
  impact: string;
}

const emptyDraft = (): DraftRisk => ({
  title: "", description: "", category: "Discrimination / unfair treatment",
  risk_type: "known", affects_vulnerable_groups: false, vulnerable_groups: "",
  severity: "medium", likelihood: "possible",
  risk_owner: "", ai_lifecycle_phase: "", impact: "",
});

function IdentifyStep({ register, risks, onRisksChange, onNext }: {
  register: RiskRegister;
  risks: RiskEntry[];
  onRisksChange: (risks: RiskEntry[]) => void;
  onNext: () => void;
}) {
  const [draft, setDraft] = useState<DraftRisk>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function addRisk() {
    if (!draft.title.trim()) { setErr("Risk title is required."); return; }
    if (draft.affects_vulnerable_groups && !draft.vulnerable_groups.trim()) {
      setErr("Vulnerable groups field is mandatory when 'affects vulnerable groups' is checked (Art. 9(9)).");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const created = await api.createRisk(register.id, {
        ...draft,
        vulnerable_groups: JSON.stringify(
          draft.vulnerable_groups ? draft.vulnerable_groups.split(",").map(s => s.trim()).filter(Boolean) : []
        ),
        risk_level_autocalculated: calcRiskLevel(draft.severity, draft.likelihood),
      });
      onRisksChange([...risks, created]);
      setDraft(emptyDraft());
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function removeRisk(id: string) {
    await api.deleteRisk(id);
    onRisksChange(risks.filter(r => r.id !== id));
  }

  return (
    <div>
      {/* Existing risks */}
      {risks.length > 0 && (
        <Card>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>Identified risks ({risks.length})</h3>
          {risks.map(r => (
            <div key={r.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: "1px solid #e4e4e7" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.title}</div>
                <div style={{ fontSize: 12, color: "#556b82", marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>{r.category} · {r.risk_type}</span>
                  {r.risk_level_autocalculated && <RiskLevelBadge level={r.risk_level_autocalculated} />}
                  {r.ai_lifecycle_phase && <span style={{ background: "#eef1f4", padding: "1px 6px", borderRadius: 8, fontSize: 11 }}>{r.ai_lifecycle_phase}</span>}
                  {r.risk_owner && <span style={{ fontSize: 11, color: "#9ca3af" }}>owner: {r.risk_owner}</span>}
                  {r.affects_vulnerable_groups && <span style={{ color: "#8b3a00" }}>⚠ vulnerable groups</span>}
                </div>
              </div>
              <button onClick={() => removeRisk(r.id)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 16 }}>×</button>
            </div>
          ))}
        </Card>
      )}

      {/* Add risk form */}
      <Card>
        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Add risk</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <Label required>Risk title</Label>
            <Input value={draft.title} onChange={v => setDraft(d => ({ ...d, title: v }))}
              placeholder="e.g. Discriminatory outcomes for applicants with employment gaps" />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={draft.category} onChange={v => setDraft(d => ({ ...d, category: v }))}
              options={RISK_CATEGORIES.map(c => ({ value: c, label: c }))} />
          </div>
          <div>
            <Label>Risk type (Art. 9(2)(a))</Label>
            <Select value={draft.risk_type} onChange={v => setDraft(d => ({ ...d, risk_type: v }))}
              options={[{ value: "known", label: "Known risk" }, { value: "foreseeable", label: "Foreseeable risk" }]} />
          </div>
          <div>
            <Label>Severity</Label>
            <Select value={draft.severity} onChange={v => setDraft(d => ({ ...d, severity: v }))}
              options={[
                { value: "critical", label: "Critical" }, { value: "high", label: "High" },
                { value: "medium", label: "Medium" }, { value: "low", label: "Low" },
              ]} />
          </div>
          <div>
            <Label>Likelihood</Label>
            <Select value={draft.likelihood} onChange={v => setDraft(d => ({ ...d, likelihood: v }))}
              options={[
                { value: "very_likely", label: "Very likely" }, { value: "likely", label: "Likely" },
                { value: "possible", label: "Possible" }, { value: "unlikely", label: "Unlikely" },
              ]} />
          </div>
          <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Risk level (auto):</span>
            <RiskLevelBadge level={calcRiskLevel(draft.severity, draft.likelihood)} />
          </div>
          <div>
            <Label>Risk owner</Label>
            <Input value={draft.risk_owner} onChange={v => setDraft(d => ({ ...d, risk_owner: v }))}
              placeholder="e.g. jane.doe@company.com" />
          </div>
          <div>
            <Label>AI lifecycle phase</Label>
            <Select value={draft.ai_lifecycle_phase} onChange={v => setDraft(d => ({ ...d, ai_lifecycle_phase: v }))}
              options={LIFECYCLE_PHASES} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <Label>Impact description</Label>
            <Textarea value={draft.impact} onChange={v => setDraft(d => ({ ...d, impact: v }))} rows={2}
              placeholder="Describe the business, operational, or user impact if this risk materialises…" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <Label>Description</Label>
            <Textarea value={draft.description} onChange={v => setDraft(d => ({ ...d, description: v }))} rows={2}
              placeholder="Describe the risk, its root cause, and potential impact…" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={draft.affects_vulnerable_groups}
                onChange={e => setDraft(d => ({ ...d, affects_vulnerable_groups: e.target.checked }))} />
              <span>Affects vulnerable groups or children (Art. 9(9)) <span style={{ color: "#dc2626" }}>*</span></span>
            </label>
            {draft.affects_vulnerable_groups && (
              <div style={{ marginTop: 8 }}>
                <Label required>Vulnerable groups affected</Label>
                <Input value={draft.vulnerable_groups} onChange={v => setDraft(d => ({ ...d, vulnerable_groups: v }))}
                  placeholder="e.g. Children, elderly persons, people with disabilities (comma-separated)" />
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                  Mandatory per Art. 9(9) — EU AI Act requires special attention for these groups.
                </div>
              </div>
            )}
          </div>
        </div>
        <ErrorMsg msg={err} />
        <button onClick={addRisk} disabled={saving}
          style={{ background: "#1147E9", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Adding…" : "+ Add risk"}
        </button>
      </Card>

      <button onClick={onNext} disabled={risks.length === 0}
        style={{ background: risks.length === 0 ? "#9ca3af" : "#1147E9", color: "#fff", border: "none", borderRadius: 6, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: risks.length === 0 ? "not-allowed" : "pointer" }}>
        Next: Evaluate ({risks.length} risk{risks.length !== 1 ? "s" : ""}) →
      </button>
    </div>
  );
}

// ── Step 3: Evaluate ──────────────────────────────────────────────────────────
function EvaluateStep({ risks, onRisksChange, onNext }: {
  risks: RiskEntry[];
  onRisksChange: (r: RiskEntry[]) => void;
  onNext: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [addMisuse, setAddMisuse] = useState<Record<string, boolean>>({});
  const [msDraft, setMsDraft] = useState<Record<string, Partial<MisuseScenario>>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  async function confirmRisk(risk: RiskEntry) {
    const updated = await api.patchRisk(risk.id, { status: "confirmed" });
    onRisksChange(risks.map(r => r.id === risk.id ? { ...r, ...updated, misuse_scenarios: r.misuse_scenarios, mitigations: r.mitigations } : r));
  }

  async function dismissRisk(risk: RiskEntry) {
    const updated = await api.patchRisk(risk.id, { status: "dismissed" });
    onRisksChange(risks.map(r => r.id === risk.id ? { ...r, ...updated, misuse_scenarios: r.misuse_scenarios, mitigations: r.mitigations } : r));
  }

  async function addMisuseScenario(riskId: string) {
    const d = msDraft[riskId] ?? {};
    if (!d.actor?.trim() || !d.description?.trim()) return;
    setSaving(s => ({ ...s, [riskId]: true }));
    try {
      const ms = await api.addMisuseScenario(riskId, {
        actor: d.actor ?? "",
        description: d.description ?? "",
        likelihood: d.likelihood ?? "possible",
        consequence: d.consequence ?? "",
        vulnerable_group: d.vulnerable_group ?? null,
      });
      onRisksChange(risks.map(r => r.id === riskId ? { ...r, misuse_scenarios: [...r.misuse_scenarios, ms] } : r));
      setMsDraft(prev => ({ ...prev, [riskId]: {} }));
      setAddMisuse(prev => ({ ...prev, [riskId]: false }));
    } finally {
      setSaving(s => ({ ...s, [riskId]: false }));
    }
  }

  const confirmed = risks.filter(r => r.status === "confirmed").length;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "Total", value: risks.length, color: "#1147E9" },
          { label: "Confirmed", value: confirmed, color: "#16a34a" },
          { label: "Dismissed", value: risks.filter(r => r.status === "dismissed").length, color: "#9ca3af" },
          { label: "Pending", value: risks.filter(r => r.status === "identified").length, color: "#f59e0b" },
        ].map(k => (
          <div key={k.label} style={{ flex: 1, minWidth: 90, background: "#f8f9fa", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 11, color: "#556b82", marginTop: 2 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {risks.map(risk => {
        const sc = { bg: SEV_BG[risk.severity] ?? "#eef1f4", color: SEV_COLORS[risk.severity] ?? "#556b82" };
        return (
          <Card key={risk.id} style={{ borderLeft: `3px solid ${sc.color}`, padding: "0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", cursor: "pointer" }}
              onClick={() => setOpen(o => ({ ...o, [risk.id]: !o[risk.id] }))}>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{risk.title}</span>
                <span style={{ marginLeft: 10, fontSize: 11, background: sc.bg, color: sc.color, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
                  {risk.severity}
                </span>
                {risk.affects_vulnerable_groups && (
                  <span style={{ marginLeft: 6, fontSize: 11, background: "#fde8d0", color: "#8b3a00", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
                    vulnerable groups
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {risk.status !== "confirmed" && (
                  <button onClick={e => { e.stopPropagation(); confirmRisk(risk); }}
                    style={{ fontSize: 11, padding: "4px 10px", background: "#d5f5e3", color: "#1a5c35", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>
                    ✓ Confirm
                  </button>
                )}
                {risk.status !== "dismissed" && (
                  <button onClick={e => { e.stopPropagation(); dismissRisk(risk); }}
                    style={{ fontSize: 11, padding: "4px 10px", background: "#f4f4f5", color: "#556b82", border: "none", borderRadius: 4, cursor: "pointer" }}>
                    Dismiss
                  </button>
                )}
                {risk.status === "confirmed" && (
                  <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>✓ confirmed</span>
                )}
              </div>
              <span style={{ color: "#9ca3af" }}>{open[risk.id] ? "▲" : "▼"}</span>
            </div>

            {open[risk.id] && (
              <div style={{ padding: "0 20px 16px", borderTop: "1px solid #f4f4f5" }}>
                {risk.description && <p style={{ fontSize: 13, color: "#374151", marginTop: 12 }}>{risk.description}</p>}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  <span style={{ fontSize: 11, background: "#eef1f4", color: "#556b82", padding: "2px 8px", borderRadius: 10 }}>
                    {risk.risk_type === "foreseeable" ? "⚡ Foreseeable" : "📋 Known"} (Art. 9(2)(a))
                  </span>
                  <span style={{ fontSize: 11, background: "#eef1f4", color: "#556b82", padding: "2px 8px", borderRadius: 10 }}>
                    Likelihood: {risk.likelihood}
                  </span>
                  {risk.category && (
                    <span style={{ fontSize: 11, background: "#eef1f4", color: "#556b82", padding: "2px 8px", borderRadius: 10 }}>
                      {risk.category}
                    </span>
                  )}
                </div>

                {/* Misuse scenarios */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#556b82", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                    Misuse scenarios (Art. 9(2)(a))
                  </div>
                  {risk.misuse_scenarios.map(ms => (
                    <div key={ms.id} style={{ fontSize: 12, padding: "6px 0", borderBottom: "1px solid #f4f4f5" }}>
                      <span style={{ fontWeight: 600 }}>{ms.actor}</span>: {ms.description}
                      {ms.vulnerable_group && (
                        <span style={{ marginLeft: 8, fontSize: 11, background: "#fde8d0", color: "#8b3a00", padding: "1px 6px", borderRadius: 8 }}>
                          {ms.vulnerable_group}
                        </span>
                      )}
                    </div>
                  ))}
                  {!addMisuse[risk.id] ? (
                    <button onClick={() => setAddMisuse(a => ({ ...a, [risk.id]: true }))}
                      style={{ fontSize: 12, color: "#1147E9", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginTop: 6 }}>
                      + Add misuse scenario
                    </button>
                  ) : (
                    <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <Label required>Actor</Label>
                        <Input value={msDraft[risk.id]?.actor ?? ""} onChange={v => setMsDraft(d => ({ ...d, [risk.id]: { ...d[risk.id], actor: v } }))}
                          placeholder="e.g. Malicious hiring manager" />
                      </div>
                      <div>
                        <Label>Likelihood</Label>
                        <Select value={msDraft[risk.id]?.likelihood ?? "possible"}
                          onChange={v => setMsDraft(d => ({ ...d, [risk.id]: { ...d[risk.id], likelihood: v } }))}
                          options={[
                            { value: "very_likely", label: "Very likely" }, { value: "likely", label: "Likely" },
                            { value: "possible", label: "Possible" }, { value: "unlikely", label: "Unlikely" },
                          ]} />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <Label required>Scenario description</Label>
                        <Input value={msDraft[risk.id]?.description ?? ""} onChange={v => setMsDraft(d => ({ ...d, [risk.id]: { ...d[risk.id], description: v } }))}
                          placeholder="Describe how this actor could misuse the system…" />
                      </div>
                      <div>
                        <Label>Consequence</Label>
                        <Input value={msDraft[risk.id]?.consequence ?? ""} onChange={v => setMsDraft(d => ({ ...d, [risk.id]: { ...d[risk.id], consequence: v } }))}
                          placeholder="e.g. Systematic rejection of qualified candidates" />
                      </div>
                      <div>
                        <Label>Vulnerable group (if applicable)</Label>
                        <Input value={msDraft[risk.id]?.vulnerable_group ?? ""} onChange={v => setMsDraft(d => ({ ...d, [risk.id]: { ...d[risk.id], vulnerable_group: v || null } }))}
                          placeholder="e.g. Pregnant women" />
                      </div>
                      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                        <button onClick={() => addMisuseScenario(risk.id)} disabled={saving[risk.id]}
                          style={{ fontSize: 12, background: "#1147E9", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                          Save
                        </button>
                        <button onClick={() => setAddMisuse(a => ({ ...a, [risk.id]: false }))}
                          style={{ fontSize: 12, background: "transparent", color: "#556b82", border: "1px solid #e4e4e7", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        );
      })}

      <button onClick={onNext} disabled={confirmed === 0}
        style={{ background: confirmed === 0 ? "#9ca3af" : "#1147E9", color: "#fff", border: "none", borderRadius: 6, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: confirmed === 0 ? "not-allowed" : "pointer" }}>
        Next: Add risk management measures ({confirmed} confirmed) →
      </button>
    </div>
  );
}

// ── Step 4: Mitigate ──────────────────────────────────────────────────────────
const HIERARCHY_LEVELS = [
  { value: "eliminate", label: "Eliminate", desc: "Remove the risk entirely (design change, feature removal)", color: "#8b0000", bg: "#ffd5d5" },
  { value: "reduce",    label: "Reduce",    desc: "Reduce severity or likelihood (technical safeguards)", color: "#8b3a00", bg: "#fde8d0" },
  { value: "mitigate",  label: "Mitigate",  desc: "Detect and contain occurrences (monitoring, human oversight)", color: "#0a6ed1", bg: "#dbeafe" },
  { value: "inform",    label: "Inform",    desc: "Disclosure and transparency measures to affected parties", color: "#1a5c35", bg: "#d5f5e3" },
];

function MitigateStep({ risks, onRisksChange, onNext }: {
  risks: RiskEntry[];
  onRisksChange: (r: RiskEntry[]) => void;
  onNext: () => void;
}) {
  const confirmedRisks = risks.filter(r => r.status === "confirmed");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [addMit, setAddMit] = useState<Record<string, boolean>>({});
  const [mitDraft, setMitDraft] = useState<Record<string, Partial<MitigationMeasure>>>({});
  const [residualDraft, setResidualDraft] = useState<Record<string, { residual_likelihood: string; residual_severity: string; date_of_assessment: string }>>({});
  const [residualSaving, setResidualSaving] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [closureNote, setClosureNote] = useState<Record<string, string>>({});
  const [err, setErr] = useState<Record<string, string>>({});

  async function saveResidual(riskId: string) {
    const d = residualDraft[riskId] ?? {};
    const rl = d.residual_likelihood ?? "";
    const rs = d.residual_severity ?? "";
    setResidualSaving(s => ({ ...s, [riskId]: true }));
    try {
      const updated = await api.patchRisk(riskId, {
        residual_likelihood: rl || null,
        residual_severity: rs || null,
        final_risk_level: (rl && rs) ? calcRiskLevel(rs, rl) : null,
        date_of_assessment: d.date_of_assessment || null,
      });
      onRisksChange(risks.map(r => r.id === riskId ? { ...r, ...updated, mitigations: r.mitigations } : r));
    } finally {
      setResidualSaving(s => ({ ...s, [riskId]: false }));
    }
  }

  async function saveMitigation(riskId: string) {
    const d = mitDraft[riskId] ?? {};
    if (!d.title?.trim()) { setErr(e => ({ ...e, [riskId]: "Measure title is required." })); return; }
    if (!d.hierarchy_level) { setErr(e => ({ ...e, [riskId]: "Hierarchy level is required (Art. 9(2)(c))." })); return; }
    setSaving(s => ({ ...s, [riskId]: true }));
    setErr(e => ({ ...e, [riskId]: "" }));
    try {
      const mit = await api.addMitigation(riskId, {
        title: d.title ?? "",
        description: d.description ?? "",
        hierarchy_level: d.hierarchy_level ?? "mitigate",
        implementation_guidance: d.implementation_guidance ?? "",
        status: "planned",
        assigned_to: null,
        due_date: null,
        override_notes: "",
      });
      onRisksChange(risks.map(r => r.id === riskId ? { ...r, mitigations: [...r.mitigations, mit] } : r));
      setMitDraft(prev => ({ ...prev, [riskId]: {} }));
      setAddMit(prev => ({ ...prev, [riskId]: false }));
    } finally {
      setSaving(s => ({ ...s, [riskId]: false }));
    }
  }

  async function saveClosureJustification(riskId: string) {
    const note = closureNote[riskId] ?? "";
    if (!note.trim()) { setErr(e => ({ ...e, [riskId]: "Closure justification is required when no risk management measure is provided." })); return; }
    await api.patchRisk(riskId, { closure_justification: note });
    onRisksChange(risks.map(r => r.id === riskId ? { ...r, closure_justification: note } : r));
    setErr(e => ({ ...e, [riskId]: "" }));
  }

  // Completeness: every confirmed risk must have mitigation OR closure justification
  const incomplete = confirmedRisks.filter(r => r.mitigations.length === 0 && !r.closure_justification?.trim());

  return (
    <div>
      <div style={{ background: "#eef1f4", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "#374151" }}>
        <strong>Art. 9(2)(b)+(c) — Risk management measures:</strong> Apply measures in order: <strong>Eliminate</strong> (preferred) →
        <strong> Reduce</strong> → <strong>Mitigate</strong> → <strong>Inform</strong>. Every confirmed risk must have at least one measure
        or a documented justification for not applying any.
      </div>

      {confirmedRisks.map(risk => {
        const hasMit = risk.mitigations.length > 0;
        const hasJustification = !!risk.closure_justification?.trim();
        const complete = hasMit || hasJustification;
        return (
          <Card key={risk.id} style={{ borderLeft: `3px solid ${complete ? "#16a34a" : "#f59e0b"}`, padding: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", cursor: "pointer" }}
              onClick={() => setOpen(o => ({ ...o, [risk.id]: !o[risk.id] }))}>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{risk.title}</span>
                <span style={{ marginLeft: 10, fontSize: 11, color: "#9ca3af" }}>{risk.mitigations.length} measure(s)</span>
                {complete && <span style={{ marginLeft: 8, fontSize: 11, color: "#16a34a", fontWeight: 600 }}>✓</span>}
                {!complete && <span style={{ marginLeft: 8, fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>⚠ needs risk management measure</span>}
              </div>
              <span style={{ color: "#9ca3af" }}>{open[risk.id] ? "▲" : "▼"}</span>
            </div>

            {open[risk.id] && (
              <div style={{ padding: "0 20px 16px", borderTop: "1px solid #f4f4f5" }}>
                {/* Existing mitigations grouped by level */}
                {HIERARCHY_LEVELS.map(level => {
                  const items = risk.mitigations.filter(m => m.hierarchy_level === level.value);
                  if (items.length === 0) return null;
                  return (
                    <div key={level.value} style={{ marginBottom: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, background: level.bg, color: level.color, padding: "2px 8px", borderRadius: 6, textTransform: "uppercase" }}>
                        {level.label}
                      </span>
                      {items.map(m => (
                        <div key={m.id} style={{ fontSize: 12, padding: "6px 0 4px", borderBottom: "1px solid #f4f4f5" }}>
                          <div style={{ fontWeight: 600 }}>{m.title}</div>
                          {m.implementation_guidance && <div style={{ color: "#556b82", marginTop: 2 }}>{m.implementation_guidance}</div>}
                        </div>
                      ))}
                    </div>
                  );
                })}

                {/* Add mitigation */}
                {!addMit[risk.id] ? (
                  <button onClick={() => setAddMit(a => ({ ...a, [risk.id]: true }))}
                    style={{
                      fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: 6,
                      padding: "7px 16px", border: "none",
                      ...(hasMit
                        ? { background: "#f0f4ff", color: "#1147E9" }
                        : { background: "#1147E9", color: "#fff" }),
                    }}>
                    + Add measure
                  </button>
                ) : (
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <Label required>Hierarchy level (Art. 9(2)(c))</Label>
                      <Select value={mitDraft[risk.id]?.hierarchy_level ?? ""}
                        onChange={v => setMitDraft(d => ({ ...d, [risk.id]: { ...d[risk.id], hierarchy_level: v } }))}
                        options={[{ value: "", label: "Select…" }, ...HIERARCHY_LEVELS.map(l => ({ value: l.value, label: `${l.label} — ${l.desc}` }))]} />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <Label required>Measure title</Label>
                      <Input value={mitDraft[risk.id]?.title ?? ""} onChange={v => setMitDraft(d => ({ ...d, [risk.id]: { ...d[risk.id], title: v } }))}
                        placeholder="e.g. Implement fairness-aware post-processing" />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <Label>Implementation guidance</Label>
                      <Textarea value={mitDraft[risk.id]?.implementation_guidance ?? ""}
                        onChange={v => setMitDraft(d => ({ ...d, [risk.id]: { ...d[risk.id], implementation_guidance: v } }))}
                        rows={2} placeholder="How to implement this measure…" />
                    </div>
                    <ErrorMsg msg={err[risk.id] ?? ""} />
                    <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                      <button onClick={() => saveMitigation(risk.id)} disabled={saving[risk.id]}
                        style={{ fontSize: 12, background: "#1147E9", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                        Save
                      </button>
                      <button onClick={() => setAddMit(a => ({ ...a, [risk.id]: false }))}
                        style={{ fontSize: 12, background: "transparent", color: "#556b82", border: "1px solid #e4e4e7", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Closure justification (alternative to mitigation) */}
                {!hasMit && (
                  <div style={{ marginTop: 12, padding: "10px 14px", background: "#fffbeb", borderRadius: 6, border: "1px solid #fde68a" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#92400e", marginBottom: 6 }}>
                      No measure provided — document justification (completeness check)
                    </div>
                    <Textarea value={closureNote[risk.id] ?? risk.closure_justification ?? ""}
                      onChange={v => setClosureNote(n => ({ ...n, [risk.id]: v }))}
                      rows={2} placeholder="Explain why no mitigation is required or possible for this risk…" />
                    <button onClick={() => saveClosureJustification(risk.id)}
                      style={{ marginTop: 6, fontSize: 12, background: "#92400e", color: "#fff", border: "none", borderRadius: 4, padding: "5px 12px", cursor: "pointer" }}>
                      Save justification
                    </button>
                  </div>
                )}

                {/* Residual risk (post-mitigation) */}
                <div style={{ marginTop: 14, padding: "10px 14px", background: "#f8f9fa", borderRadius: 6, border: "1px solid #e4e4e7" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#556b82", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.4px" }}>
                    Residual risk (post-mitigation) — Art. 9(2)(d)
                    {risk.final_risk_level && (
                      <span style={{ marginLeft: 10 }}><RiskLevelBadge level={risk.final_risk_level} /></span>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <div>
                      <Label>Residual likelihood</Label>
                      <Select
                        value={residualDraft[risk.id]?.residual_likelihood ?? risk.residual_likelihood ?? ""}
                        onChange={v => setResidualDraft(d => ({ ...d, [risk.id]: { ...d[risk.id] ?? { residual_severity: "", date_of_assessment: "" }, residual_likelihood: v } }))}
                        options={[
                          { value: "", label: "— select —" },
                          { value: "very_likely", label: "Very likely" }, { value: "likely", label: "Likely" },
                          { value: "possible", label: "Possible" }, { value: "unlikely", label: "Unlikely" },
                        ]} />
                    </div>
                    <div>
                      <Label>Residual severity</Label>
                      <Select
                        value={residualDraft[risk.id]?.residual_severity ?? risk.residual_severity ?? ""}
                        onChange={v => setResidualDraft(d => ({ ...d, [risk.id]: { ...d[risk.id] ?? { residual_likelihood: "", date_of_assessment: "" }, residual_severity: v } }))}
                        options={[
                          { value: "", label: "— select —" },
                          { value: "critical", label: "Critical" }, { value: "high", label: "High" },
                          { value: "medium", label: "Medium" }, { value: "low", label: "Low" },
                        ]} />
                    </div>
                    <div>
                      <Label>Date of assessment</Label>
                      <input type="date"
                        value={residualDraft[risk.id]?.date_of_assessment ?? (risk.date_of_assessment ? risk.date_of_assessment.substring(0, 10) : "")}
                        onChange={e => setResidualDraft(d => ({ ...d, [risk.id]: { ...d[risk.id] ?? { residual_likelihood: "", residual_severity: "" }, date_of_assessment: e.target.value } }))}
                        style={{ width: "100%", border: "1px solid #e4e4e7", borderRadius: 6, padding: "6px 8px", fontSize: 13 }} />
                    </div>
                  </div>
                  {(() => {
                    const rl = residualDraft[risk.id]?.residual_likelihood ?? risk.residual_likelihood ?? "";
                    const rs = residualDraft[risk.id]?.residual_severity ?? risk.residual_severity ?? "";
                    return (rl && rs) ? (
                      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "#374151" }}>Residual risk level (auto):</span>
                        <RiskLevelBadge level={calcRiskLevel(rs, rl)} />
                      </div>
                    ) : null;
                  })()}
                  <button onClick={() => saveResidual(risk.id)} disabled={residualSaving[risk.id]}
                    style={{ marginTop: 10, fontSize: 11, background: "transparent", color: "#556b82", border: "1px solid #d1d5db", borderRadius: 4, padding: "4px 12px", cursor: "pointer" }}>
                    {residualSaving[risk.id] ? "Saving…" : "Save residual risk"}
                  </button>
                </div>
              </div>
            )}
          </Card>
        );
      })}

      {incomplete.length > 0 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#92400e" }}>
          ⚠ {incomplete.length} risk(s) still need a risk management measure or documented justification before you can approve.
        </div>
      )}

      <button onClick={onNext} disabled={incomplete.length > 0}
        style={{ background: incomplete.length > 0 ? "#9ca3af" : "#1147E9", color: "#fff", border: "none", borderRadius: 6, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: incomplete.length > 0 ? "not-allowed" : "pointer" }}>
        Next: Approve register →
      </button>
    </div>
  );
}

// ── Step 5: Approve ───────────────────────────────────────────────────────────
function ApproveStep({ register, risks, onApprove }: {
  register: RiskRegister;
  risks: RiskEntry[];
  onApprove: (acceptable: boolean, argument: string) => Promise<void>;
}) {
  const [acceptable, setAcceptable] = useState(true);
  const [argument, setArgument] = useState(register.residual_risk_argument ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const confirmedRisks = risks.filter(r => r.status === "confirmed");
  const totalMitigations = confirmedRisks.reduce((acc, r) => acc + r.mitigations.length, 0);
  const vulnerableGroupRisks = confirmedRisks.filter(r => r.affects_vulnerable_groups);

  async function handleApprove() {
    if (!argument.trim()) { setErr("Residual risk argument is required (Art. 9(5))."); return; }
    setSaving(true);
    setErr("");
    try {
      await onApprove(acceptable, argument);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (register.status === "approved") {
    return (
      <div>
        <Card style={{ background: "#d5f5e3", border: "1px solid #9cdcb8" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a5c35", marginBottom: 8 }}>✓ Register approved</div>
          <div style={{ fontSize: 13, color: "#1a5c35" }}>
            Approved by <strong>{register.approver_username}</strong> on {register.approved_at ? new Date(register.approved_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}.
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: "#1a5c35" }}>
            Residual risk: <strong>{register.residual_risk_acceptable ? "Acceptable" : "Not acceptable"}</strong>
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: "#374151" }}>{register.residual_risk_argument}</div>
          <div style={{ marginTop: 10, fontSize: 12, color: "#556b82" }}>
            Next re-assessment scheduled in 6 months (automatic trigger created — Art. 9(1)).
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      {/* Summary */}
      <Card>
        <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700 }}>Assessment summary</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
          {[
            { label: "Confirmed risks", value: confirmedRisks.length },
            { label: "Measures", value: totalMitigations },
            { label: "Vulnerable group risks", value: vulnerableGroupRisks.length },
            { label: "Misuse scenarios", value: confirmedRisks.reduce((a, r) => a + r.misuse_scenarios.length, 0) },
          ].map(k => (
            <div key={k.label} style={{ background: "#f8f9fa", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#1147E9" }}>{k.value}</div>
              <div style={{ fontSize: 11, color: "#556b82", marginTop: 3 }}>{k.label}</div>
            </div>
          ))}
        </div>

        <h4 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 10px", color: "#556b82", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Confirmed risks
        </h4>
        {confirmedRisks.map(r => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f4f4f5", fontSize: 13 }}>
            <span style={{ flex: 1 }}>{r.title}</span>
            <span style={{ fontSize: 11, background: SEV_BG[r.severity] ?? "#eef1f4", color: SEV_COLORS[r.severity] ?? "#556b82", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
              {r.severity}
            </span>
            <span style={{ fontSize: 11, color: "#16a34a" }}>{r.mitigations.length} mit.</span>
          </div>
        ))}
      </Card>

      {/* Residual risk argument (Art. 9(5)) */}
      <Card>
        <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700 }}>Residual risk argument (Art. 9(5))</h3>
        <div style={{ marginBottom: 14 }}>
          <Label>Residual risk acceptability</Label>
          <div style={{ display: "flex", gap: 12 }}>
            {[true, false].map(v => (
              <label key={String(v)} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input type="radio" checked={acceptable === v} onChange={() => setAcceptable(v)} />
                {v ? "✓ Acceptable" : "✗ Not acceptable"}
              </label>
            ))}
          </div>
        </div>
        <div>
          <Label required>Argument (Art. 9(5) — expert sign-off)</Label>
          <Textarea value={argument} onChange={setArgument} rows={4}
            placeholder="Describe why the residual risk is acceptable (or not): evidence, assumptions, open issues, safeguards in place…" />
        </div>
        <ErrorMsg msg={err} />
        <div style={{ marginTop: 14 }}>
          <button onClick={handleApprove} disabled={saving}
            style={{ background: saving ? "#9ca3af" : "#1147E9", color: "#fff", border: "none", borderRadius: 6, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Approving…" : "Approve register"}
          </button>
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>
            Approving creates a 6-month re-assessment trigger (Art. 9(1)).
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Archived register summary card ───────────────────────────────────────────
function ArchivedRegisterCard({ reg, systemName }: { reg: RiskRegister; systemName: string }) {
  const [open, setOpen] = useState(false);
  const confirmed = reg.risks.filter(r => r.status === "confirmed");
  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  return (
    <div style={{ border: "1px solid #e4e4e7", borderRadius: 10, marginBottom: 12, overflow: "hidden", opacity: 0.85 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", background: "#f8f9fa", cursor: "pointer" }}
        onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#556b82" }}>v{reg.id}</span>
        <span style={{ fontSize: 11, background: "#d5f5e3", color: "#1a5c35", padding: "2px 8px", borderRadius: 8, fontWeight: 600 }}>
          ✓ APPROVED
        </span>
        <span style={{ fontSize: 12, color: "#556b82" }}>
          Approved: {fmtDate(reg.approved_at)} · {confirmed.length} risk(s) · {confirmed.reduce((a, r) => a + r.mitigations.length, 0)} measure(s)
        </span>
        {reg.residual_risk_acceptable !== null && (
          <span style={{ fontSize: 11, color: reg.residual_risk_acceptable ? "#1a5c35" : "#8b0000", fontWeight: 600 }}>
            Residual: {reg.residual_risk_acceptable ? "Acceptable" : "Not acceptable"}
          </span>
        )}
        <button
          onClick={e => { e.stopPropagation(); exportReport(systemName, reg, reg.risks, true); }}
          style={{ marginLeft: "auto", background: "#f4f4f5", color: "#374151", border: "1px solid #e4e4e7", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
        >
          📄 Export
        </button>
        <span style={{ color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 12, color: "#374151", marginBottom: 10 }}>
            <strong>Scope:</strong> {reg.assessment_scope || "—"}
          </div>
          {confirmed.map(r => (
            <div key={r.id} style={{ padding: "8px 0", borderBottom: "1px solid #f4f4f5", fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{r.title}</span>
              <span style={{ marginLeft: 8, color: "#556b82" }}>{r.category} · {r.severity}</span>
              {r.mitigations.length > 0 && (
                <span style={{ marginLeft: 8, color: "#1a5c35" }}>{r.mitigations.length} measure(s)</span>
              )}
            </div>
          ))}
          {reg.residual_risk_argument && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#374151" }}>
              <strong>Residual risk argument:</strong> {reg.residual_risk_argument}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────
export default function AssessmentWizardPage({ systemId, systemName, onBack }: {
  systemId: string;
  systemName: string;
  onBack: () => void;
}) {
  const [step, setStep] = useState<WizardStep>("scope");
  const [register, setRegister] = useState<RiskRegister | null>(null);
  const [archivedRegisters, setArchivedRegisters] = useState<RiskRegister[]>([]);
  const [risks, setRisks] = useState<RiskEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [reopening, setReopening] = useState(false);
  const [err, setErr] = useState("");

  // Load all registers on mount
  useEffect(() => {
    api.getRegisters(systemId)
      .then(regs => {
        const active = regs.find(r => r.status !== "archived");
        const archived = regs.filter(r => r.status === "archived").sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setArchivedRegisters(archived);
        if (active) {
          setRegister(active);
          setRisks(active.risks);
          if (active.status === "approved") setStep("approve");
          else if (active.risks.some(r => r.mitigations.length > 0)) setStep("mitigate");
          else if (active.risks.some(r => r.status === "confirmed")) setStep("evaluate");
          else if (active.risks.length > 0) setStep("identify");
          else setStep("scope");
        }
      })
      .catch(() => { /* start fresh */ })
      .finally(() => setLoading(false));
  }, [systemId]);

  async function handleScopeNext(scope: string, notes: string) {
    if (register && register.status !== "approved") {
      const updated = await api.patchRegister(register.id, { assessment_scope: scope, notes });
      setRegister(updated);
    } else {
      const created = await api.createRegister(systemId, { assessment_scope: scope, notes });
      setRegister(created);
      setRisks([]);
    }
    setStep("identify");
  }

  const handlePatchScope = useCallback((scope: string, notes: string) => {
    if (register) setRegister(r => r ? { ...r, assessment_scope: scope, notes } : r);
  }, [register]);

  async function handleApprove(acceptable: boolean, argument: string) {
    if (!register) return;
    const updated = await api.approveRegister(register.id, {
      residual_risk_acceptable: acceptable,
      residual_risk_argument: argument,
    });
    setRegister(updated);
    setStep("approve");
  }

  async function handleReopen() {
    if (!register) return;
    setReopening(true);
    setErr("");
    try {
      // Archive current register by creating new one (backend archives the old one automatically)
      const prev = register;
      const created = await api.createRegister(systemId, {
        assessment_scope: prev.assessment_scope,
        notes: prev.notes,
      });
      // Pre-fill risks from previous register
      for (const r of prev.risks.filter(r => r.status === "confirmed")) {
        await api.createRisk(created.id, {
          title: r.title,
          description: r.description,
          category: r.category,
          risk_type: r.risk_type,
          severity: r.severity,
          likelihood: r.likelihood,
          risk_owner: r.risk_owner ?? undefined,
          ai_lifecycle_phase: r.ai_lifecycle_phase ?? undefined,
          impact: r.impact,
          affects_vulnerable_groups: r.affects_vulnerable_groups,
          vulnerable_groups: r.vulnerable_groups,
          risk_level_autocalculated: r.risk_level_autocalculated ?? undefined,
        });
      }
      // Reload all registers
      const allRegs = await api.getRegisters(systemId);
      const newActive = allRegs.find(r => r.status !== "archived");
      const archived = allRegs.filter(r => r.status === "archived").sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setArchivedRegisters(archived);
      if (newActive) {
        setRegister(newActive);
        setRisks(newActive.risks);
      }
      setStep("scope");
    } catch (e) {
      setErr(String(e));
    } finally {
      setReopening(false);
    }
  }

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, gap: 12, color: "#556b82", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <span style={{ width: 20, height: 20, border: "2px solid #1147E9", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
      Loading…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  const currentIdx = STEPS.findIndex(s => s.key === step);

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", maxWidth: 900, margin: "0 auto", padding: "24px 20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button onClick={onBack}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "#1147E9", fontSize: 13, padding: 0 }}>
          ← All systems
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#111827" }}>
            Risk Assessment — {systemName}
          </h1>
          <p style={{ fontSize: 12, color: "#9ca3af", margin: "2px 0 0" }}>Art. 9 EU AI Act</p>
        </div>
        {register && (
          <span style={{ fontSize: 11, background: "#eef1f4", color: "#556b82", padding: "4px 10px", borderRadius: 8 }}>
            {register.id} · {register.status}
          </span>
        )}
        {register && (
          <button onClick={() => exportReport(systemName, register, risks)}
            style={{ background: "#fff", border: "1px solid #e4e4e7", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "#374151", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            📄 Export report
          </button>
        )}
        {register?.status === "approved" && (
          <button onClick={handleReopen} disabled={reopening}
            style={{ background: reopening ? "#9ca3af" : "#dc2626", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: reopening ? "not-allowed" : "pointer" }}>
            {reopening ? "Opening…" : "🔄 Restart"}
          </button>
        )}
      </div>

      {/* Stepper */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24 }}>
        {STEPS.map((s, i) => {
          const isApproved = register?.status === "approved";
          const isActive = step === s.key;
          const isPast = i < currentIdx;
          const clickable = (isPast || isApproved) && !!register;
          return (
            <div key={s.key} style={{
              flex: 1, textAlign: "center", padding: "8px 4px", fontSize: 12, fontWeight: 600, borderRadius: 6,
              background: isActive ? "#1147E9" : (isPast || isApproved) ? "#d5f5e3" : "#f4f4f5",
              color: isActive ? "#fff" : (isPast || isApproved) ? "#1a5c35" : "#9ca3af",
              cursor: clickable ? "pointer" : "default",
            }}
            onClick={() => { if (clickable) setStep(s.key); }}>
              {(isPast || (isApproved && !isActive)) ? "✓ " : ""}{s.label}
            </div>
          );
        })}
      </div>

      {err && <ErrorMsg msg={err} />}

      {register?.status === "approved" && step !== "approve" && (
        <ApprovedBanner register={register} />
      )}

      {step === "scope" && (
        <ScopeStep register={register} onNext={handleScopeNext} onPatch={handlePatchScope} />
      )}
      {step === "identify" && register && (
        <IdentifyStep register={register} risks={risks} onRisksChange={setRisks} onNext={() => setStep("evaluate")} />
      )}
      {step === "evaluate" && (
        <EvaluateStep risks={risks} onRisksChange={setRisks} onNext={() => setStep("mitigate")} />
      )}
      {step === "mitigate" && (
        <MitigateStep risks={risks} onRisksChange={setRisks} onNext={() => setStep("approve")} />
      )}
      {step === "approve" && register && (
        <ApproveStep register={register} risks={risks} onApprove={handleApprove} />
      )}

      {/* Previous assessment versions */}
      {archivedRegisters.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#556b82", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12, borderTop: "1px solid #e4e4e7", paddingTop: 20 }}>
            Previous assessment versions ({archivedRegisters.length})
          </div>
          {archivedRegisters.map(r => <ArchivedRegisterCard key={r.id} reg={r} systemName={systemName} />)}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
