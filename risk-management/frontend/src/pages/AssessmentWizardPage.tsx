import { useState, useEffect } from "react";
import { api } from "../api/client";
import type { RiskRegister, RiskEntry, MitigationMeasure, TestReport, PlanTask, LibraryRisk } from "../types";

const SEV_COLORS: Record<string, string> = {
  severe: "#8b0000", significant: "#8b3a00", moderate: "#7a5900", minor: "#1a5c35",
};
const SEV_BG: Record<string, string> = {
  severe: "#ffd5d5", significant: "#fde8d0", moderate: "#fff3c4", minor: "#d5f5e3",
};
const RISK_LEVEL_COLORS: Record<string, string> = {
  unacceptable: "#8b0000", substantial: "#8b3a00", moderate: "#7a5900", acceptable: "#1a5c35",
};
const RISK_LEVEL_BG: Record<string, string> = {
  unacceptable: "#ffd5d5", substantial: "#fde8d0", moderate: "#fff3c4", acceptable: "#d5f5e3",
};
const RISK_LEVEL_DEFINITIONS = [
  { value: "unacceptable", label: "Unacceptable", desc: "Severe or significant impact that is likely or very likely to occur." },
  { value: "substantial",  label: "Substantial",  desc: "Severe impact that may occur, or significant/moderate impact that is likely." },
  { value: "moderate",     label: "Moderate",     desc: "Limited impact or low probability." },
  { value: "acceptable",   label: "Acceptable",   desc: "Minor impact with low or very low probability." },
];

const SEVERITY_DEFINITIONS = [
  { value: "severe",      label: "Severe",      desc: "Irreversible harm: loss of life, permanent injury, serious violation of fundamental rights (dignity, freedom, non-discrimination)." },
  { value: "significant", label: "Significant", desc: "Serious but potentially reversible harm: job loss, denial of access to public services, major financial damage, temporary restriction of rights." },
  { value: "moderate",    label: "Moderate",    desc: "Moderate, remediable harm: limited opportunities, adverse decision with right of appeal, recoverable financial losses." },
  { value: "minor",       label: "Minor",       desc: "Minimal or negligible harm: inconvenience, short-lived negative consequence with no lasting effects." },
];

const LIKELIHOOD_DEFINITIONS = [
  { value: "very_likely", label: "Very likely", desc: "Will occur regularly during normal use of the system." },
  { value: "likely",      label: "Likely",      desc: "Expected under certain conditions or use errors." },
  { value: "possible",    label: "Possible",    desc: "May occur, especially during unexpected or improper use." },
  { value: "unlikely",    label: "Unlikely",    desc: "Would require a particular confluence of circumstances or deliberate misuse." },
];

function InfoTooltip({ definitions }: { definitions: { value: string; label: string; desc: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block", marginLeft: 5, verticalAlign: "middle" }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, color: "var(--text-secondary)", fontSize: 13, fontWeight: 700 }}
        aria-label="Show definitions">ⓘ</button>
      {open && (
        <div style={{
          position: "absolute", zIndex: 100, left: 0, top: "calc(100% + 4px)",
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)", padding: "10px 14px", minWidth: 320, maxWidth: 380,
        }}>
          {definitions.map(d => (
            <div key={d.value} style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 12 }}>{d.label}</span>
              <span style={{ fontSize: 12, color: "var(--text-secondary)", marginLeft: 6 }}>{d.desc}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 13 }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
      style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
  );
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, boxSizing: "border-box" }} />
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 4 }}>
      {children}{required && <span style={{ color: "red", marginLeft: 2 }}>*</span>}
    </label>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "20px 24px", marginBottom: 16, ...style }}>
      {children}
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ background: "#ffd5d5", color: "#8b0000", borderRadius: 6, padding: "8px 12px", fontSize: 12, marginTop: 8 }}>{msg}</div>;
}

const EXPORT_RISK_CATEGORIES: Record<string, string> = {
  health: "Health",
  safety: "Safety",
  fundamental_rights: "Fundamental Rights",
  others: "Others",
};

async function exportReport(systemName: string, register: RiskRegister, risks: RiskEntry[], archived = false, nextRegisterId: string | null = null) {
  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "—";
  const esc = (s: string | null | undefined) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const np = (s: string | null | undefined) => s?.trim() ? esc(s) : `<span style="color:#9ca3af;font-style:italic">Not provided</span>`;

  // Fetch supporting data
  let planTasks: PlanTask[] = [];
  let incidents: import("../types").Incident[] = [];
  try { planTasks = await api.getPlanTasks(register.id); } catch { /* ignore */ }
  try { incidents = await api.getIncidents(register.id); } catch { /* ignore */ }

  let diffRemovedInNext = new Set<string>();
  let diffChangedInNext = new Map<string, import("../types").RegisterDiffEntry>();
  let diffAddedInNext = new Set<string>();
  if (archived && nextRegisterId) {
    try {
      const d = await api.getRegisterDiff(nextRegisterId);
      diffRemovedInNext = new Set(d.removed);
      diffAddedInNext = new Set(d.added);
      diffChangedInNext = new Map(d.changed.map(c => [c.title, c]));
    } catch { /* ignore */ }
  }

  const riskTitleById: Record<string, string> = {};
  risks.forEach(r => { riskTitleById[r.id] = r.title; });

  const LEVEL_COLORS: Record<string, { bg: string; color: string }> = {
    critical: { bg: "#ffd5d5", color: "#8b0000" },
    high:     { bg: "#fde8d0", color: "#8b3a00" },
    medium:   { bg: "#fff3c4", color: "#7a5900" },
    low:      { bg: "#d5f5e3", color: "#1a5c35" },
  };
  const levelBadge = (l?: string | null) => {
    if (!l) return `<span style="color:#9ca3af">—</span>`;
    const c = LEVEL_COLORS[l] ?? { bg: "#eef1f4", color: "#374151" };
    return `<span style="background:${c.bg};color:${c.color};padding:2px 8px;border-radius:10px;font-weight:700;font-size:11px;text-transform:uppercase">${l}</span>`;
  };
  const residualStatusBadge = (s?: string | null) => {
    if (!s || s === "none") return `<span style="color:#9ca3af;font-style:italic">No residual risk</span>`;
    if (s === "acceptable") return `<span style="background:#d5f5e3;color:#1a5c35;padding:2px 9px;border-radius:10px;font-weight:700;font-size:11px">Acceptable</span>`;
    return `<span style="background:#ffd5d5;color:#8b0000;padding:2px 9px;border-radius:10px;font-weight:700;font-size:11px">Not acceptable</span>`;
  };

  const allRisks = risks.filter(r => r.status !== "dismissed");
  const confirmedRisks = risks.filter(r => r.status === "confirmed");
  const dismissedRisks = risks.filter(r => r.status === "dismissed");

  // ── Status banner ──
  let statusBanner = "";
  if (archived) {
    statusBanner = `<div style="background:#fef9c3;border:2px solid #fde047;border-radius:10px;padding:14px 18px;margin-bottom:20px;font-size:13px;color:#713f12;font-weight:700">
      ⚠ ARCHIVED REPORT — This is a historical record from a previous risk management cycle. It is retained for audit purposes and does not reflect the current state of risk management.
    </div>`;
  } else if (register.status === "approved") {
    const acceptability = register.residual_risk_acceptable === true ? "Acceptable" : register.residual_risk_acceptable === false ? "Not acceptable" : "—";
    statusBanner = `<div style="background:#d5f5e3;border:1.5px solid #9cdcb8;border-radius:10px;padding:14px 18px;margin-bottom:20px;font-size:13px;color:#1a5c35;font-weight:700">
      ✅ APPROVED — by <strong>${esc(register.approver_username ?? "—")}</strong> on ${fmtDate(register.approved_at)}
      <span style="font-weight:400;margin-left:16px">Overall residual risk: <strong>${acceptability}</strong></span>
    </div>`;
  } else {
    statusBanner = `<div style="background:#fff3c4;border:1.5px solid #fde047;border-radius:10px;padding:14px 18px;margin-bottom:20px;font-size:13px;color:#92400e;font-weight:700">
      ⏳ ${esc(register.status.toUpperCase().replace(/_/g, " "))} — This register has not yet been approved.
    </div>`;
  }

  // ── Per-risk HTML ──
  const renderRisk = (r: RiskEntry, idx: number) => {
    const isRemovedInNext = diffRemovedInNext.has(r.title);
    const entry = diffChangedInNext.get(r.title);
    const hasChanges = !!entry && ((entry.fields ?? []).length > 0 || (entry.mitigations_added ?? []).length > 0 || (entry.mitigations_removed ?? []).length > 0);
    const borderStyle = isRemovedInNext ? "border:2px solid #f87171;background:#fff5f5" : hasChanges ? "border:2px solid #fbbf24;background:#fffbeb" : "border:1px solid #e4e4e7";

    let vulnerableGroups = "";
    if (r.affects_vulnerable_groups) {
      try { const g = JSON.parse(r.vulnerable_groups); vulnerableGroups = Array.isArray(g) ? g.join(", ") : r.vulnerable_groups; } catch { vulnerableGroups = r.vulnerable_groups; }
    }

    const mitigationsHtml = (r.mitigations ?? []).length > 0
      ? (r.mitigations ?? []).map(m => `
        <div style="background:#f0f4ff;border-left:3px solid #93c5fd;border-radius:0 6px 6px 0;padding:8px 12px;margin-bottom:6px;font-size:12px">
          <div><span style="background:#dbeafe;color:#1e40af;padding:1px 7px;border-radius:8px;font-weight:700;font-size:10px;text-transform:uppercase;margin-right:8px">${esc(m.hierarchy_level)}</span><strong>${esc(m.title)}</strong>${m.status ? ` · <span style="color:#556b82">${cap(m.status)}</span>` : ""}</div>
          ${m.description ? `<div style="color:#374151;margin-top:4px">${np(m.description)}</div>` : ""}
          ${m.implementation_guidance ? `<div style="color:#556b82;margin-top:3px"><strong>Guidance:</strong> ${np(m.implementation_guidance)}</div>` : ""}
          <div style="color:#556b82;margin-top:3px"><strong>Assigned to:</strong> ${np(m.assigned_to)}${m.due_date ? ` · Due: ${fmtDate(m.due_date)}` : ""}</div>
          ${m.override_notes ? `<div style="color:#92400e;margin-top:3px"><strong>Notes:</strong> ${esc(m.override_notes)}</div>` : ""}
        </div>`).join("")
      : r.closure_justification
        ? `<div style="background:#fffbeb;border-radius:6px;padding:8px 12px;font-size:12px;color:#92400e"><strong>No measure applied</strong> — ${esc(r.closure_justification)}</div>`
        : `<div style="color:#9ca3af;font-size:12px;font-style:italic;padding:4px 0">None documented.</div>`;

    const misusesHtml = (r.misuse_scenarios ?? []).length > 0
      ? (r.misuse_scenarios ?? []).map(ms => `
        <div style="background:#fff5f5;border-left:3px solid #fca5a5;border-radius:0 6px 6px 0;padding:8px 12px;margin-bottom:6px;font-size:12px">
          <div><strong>Actor:</strong> ${esc(ms.actor)} · <strong>Likelihood:</strong> ${cap(ms.likelihood)}</div>
          <div style="margin-top:3px">${esc(ms.description)}</div>
          ${ms.consequence ? `<div style="margin-top:3px;color:#556b82"><strong>Consequence:</strong> ${esc(ms.consequence)}</div>` : ""}
          ${ms.vulnerable_group ? `<div style="margin-top:3px;color:#92400e"><strong>Vulnerable group:</strong> ${esc(ms.vulnerable_group)}</div>` : ""}
        </div>`).join("")
      : `<div style="color:#9ca3af;font-size:12px;font-style:italic;padding:4px 0">None documented.</div>`;

    const residualBg = r.residual_status === "unacceptable" ? "#fff5f5" : r.residual_status === "acceptable" ? "#f0faf4" : "#f8f9fa";

    return `
    <div style="${borderStyle};border-radius:8px;padding:18px 20px;margin-bottom:14px;page-break-inside:avoid">
      ${isRemovedInNext ? `<div style="background:#ffd5d5;color:#8b0000;font-size:11px;font-weight:700;padding:5px 10px;border-radius:4px;margin-bottom:10px">⚠ REMOVED IN NEXT VERSION</div>` : ""}
      ${hasChanges && entry ? `<div style="background:#fff3c4;color:#7a5900;font-size:11px;padding:6px 10px;border-radius:4px;margin-bottom:10px">
        <div style="font-weight:700;margin-bottom:4px">⚠ CHANGED IN NEXT VERSION</div>
        <table style="border-collapse:collapse;font-size:11px">
          ${(entry.fields ?? []).map(fc => `<tr><td style="padding:1px 8px 1px 0;font-weight:600">${esc(fc.field)}</td><td style="text-decoration:line-through;color:#8b0000;padding-right:6px">${esc(fc.from_value)}</td><td style="color:#1a5c35">→ ${esc(fc.to_value)}</td></tr>`).join("")}
          ${(entry.mitigations_added ?? []).map(t => `<tr><td style="color:#1a5c35;font-weight:600">+ Mitigation added</td><td colspan="2" style="color:#1a5c35">${esc(t)}</td></tr>`).join("")}
          ${(entry.mitigations_removed ?? []).map(t => `<tr><td style="color:#8b0000;font-weight:600">− Mitigation removed</td><td colspan="2" style="text-decoration:line-through;color:#8b0000">${esc(t)}</td></tr>`).join("")}
        </table></div>` : ""}

      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px">
        <span style="font-weight:700;font-size:15px">${idx + 1}. ${esc(r.title)}</span>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px">
        <tr>
          <td style="padding:3px 8px 3px 0;color:#556b82;width:150px">Impact category</td>
          <td style="padding:3px 0" colspan="3">${r.category.split(",").map((c: string) => EXPORT_RISK_CATEGORIES[c.trim()] ?? cap(c.trim())).join(", ")}</td>
        </tr>
        <tr>
          <td style="padding:3px 8px 3px 0;color:#556b82">Severity</td><td style="padding:3px 8px 3px 0">${cap(r.severity)}</td>
          <td style="padding:3px 8px 3px 16px;color:#556b82">Likelihood</td><td style="padding:3px 0">${cap(r.likelihood)}</td>
        </tr>
        <tr>
          <td style="padding:3px 8px 3px 0;color:#556b82">Risk level</td>
          <td style="padding:3px 0" colspan="3">${levelBadge(r.risk_level_autocalculated)}</td>
        </tr>
        ${r.risk_owner ? `<tr><td style="padding:3px 8px 3px 0;color:#556b82">Risk owner</td><td style="padding:3px 0" colspan="3"><strong>${esc(r.risk_owner)}</strong></td></tr>` : ""}
        ${r.ai_lifecycle_phase ? `<tr><td style="padding:3px 8px 3px 0;color:#556b82">Lifecycle phase</td><td style="padding:3px 0" colspan="3">${cap(r.ai_lifecycle_phase)}</td></tr>` : ""}
      </table>

      ${r.description ? `<div style="font-size:12px;margin-bottom:6px"><strong>Description:</strong> ${np(r.description)}</div>` : ""}
      ${r.impact ? `<div style="font-size:12px;margin-bottom:8px"><strong>Impact:</strong> ${np(r.impact)}</div>` : ""}
      ${r.affects_vulnerable_groups ? `<div style="font-size:12px;margin-bottom:8px;color:#92400e"><strong>⚠ Affects vulnerable groups:</strong> ${esc(vulnerableGroups) || "Specified"}</div>` : ""}

      <div style="margin-top:10px">
        <div style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Misuse scenarios (${(r.misuse_scenarios ?? []).length})</div>
        ${misusesHtml}
      </div>

      <div style="margin-top:10px">
        <div style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Risk management measures (${(r.mitigations ?? []).length})</div>
        ${mitigationsHtml}
      </div>

      <div style="margin-top:10px;background:${residualBg};border-radius:6px;padding:10px 14px;font-size:12px">
        <div style="font-size:11px;font-weight:700;color:#556b82;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px">Residual risk</div>
        <div style="margin-bottom:6px">${residualStatusBadge(r.residual_status)}</div>
        ${r.residual_status && r.residual_status !== "none" ? `
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:2px 8px 2px 0;color:#556b82;width:150px">Severity</td><td style="padding:2px 8px 2px 0">${cap(r.residual_severity ?? "")}</td>
            <td style="padding:2px 8px 2px 16px;color:#556b82">Likelihood</td><td>${cap(r.residual_likelihood ?? "")}</td>
          </tr>
          <tr>
            <td style="padding:2px 8px 2px 0;color:#556b82">Residual level</td><td colspan="3">${levelBadge(r.final_risk_level)}</td>
          </tr>
          ${r.date_of_assessment ? `<tr><td style="padding:2px 8px 2px 0;color:#556b82">Date of identification</td><td colspan="3">${fmtDate(r.date_of_assessment)}</td></tr>` : ""}
        </table>
        ${r.review_notes ? `<div style="margin-top:6px;color:#374151"><strong>Notes:</strong> ${np(r.review_notes)}</div>` : ""}` : ""}
      </div>
    </div>`;
  };

  const confirmedHtml = confirmedRisks.map((r, i) => renderRisk(r, i)).join("");
  const pendingRisks = allRisks.filter(r => r.status === "pending");
  const pendingHtml = pendingRisks.length > 0
    ? pendingRisks.map((r, i) => renderRisk(r, confirmedRisks.length + i)).join("")
    : "";

  const tasksHtml = planTasks.length > 0 ? `
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f4f4f5">
        <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Task</th>
        <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Linked risk</th>
        <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Assigned to</th>
        <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Due</th>
        <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Status</th>
      </tr></thead>
      <tbody>${planTasks.map(t => `
        <tr style="border-bottom:1px solid #e4e4e7">
          <td style="padding:6px 10px;vertical-align:top"><div style="font-weight:600">${esc(t.title)}</div>${t.description ? `<div style="color:#556b82;margin-top:2px;font-size:11px">${esc(t.description)}</div>` : ""}</td>
          <td style="padding:6px 10px;vertical-align:top;color:#374151">${t.risk_id && riskTitleById[t.risk_id] ? esc(riskTitleById[t.risk_id]) : "—"}</td>
          <td style="padding:6px 10px;vertical-align:top;color:#374151">${t.assigned_to ? esc(t.assigned_to) : "—"}</td>
          <td style="padding:6px 10px;vertical-align:top;white-space:nowrap">${fmtDate(t.due_date)}</td>
          <td style="padding:6px 10px;vertical-align:top;font-weight:600">${cap(t.status)}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : `<div style="color:#9ca3af;font-size:12px;font-style:italic">No tasks recorded.</div>`;

  const incidentsHtml = incidents.length > 0 ? `
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#fff5f5">
        <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Incident</th>
        <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Linked risk</th>
        <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Reported by</th>
        <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Occurred</th>
        <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Status</th>
      </tr></thead>
      <tbody>${incidents.map(inc => `
        <tr style="border-bottom:1px solid #e4e4e7">
          <td style="padding:6px 10px;vertical-align:top"><div style="font-weight:600">${esc(inc.title)}</div>${inc.description ? `<div style="color:#556b82;margin-top:2px;font-size:11px">${esc(inc.description)}</div>` : ""}</td>
          <td style="padding:6px 10px;vertical-align:top;color:#374151">${inc.risk_id && riskTitleById[inc.risk_id] ? esc(riskTitleById[inc.risk_id]) : "—"}</td>
          <td style="padding:6px 10px;vertical-align:top;color:#374151">${inc.reported_by ? esc(inc.reported_by) : "—"}</td>
          <td style="padding:6px 10px;vertical-align:top;white-space:nowrap">${fmtDate(inc.occurred_at)}</td>
          <td style="padding:6px 10px;vertical-align:top;font-weight:600">${cap(inc.status)}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : `<div style="color:#9ca3af;font-size:12px;font-style:italic">No incidents reported.</div>`;

  // ── Register-level residual risk ──
  const regResidualHtml = (() => {
    const s = register.residual_risk_acceptable;
    if (s === null && !register.residual_severity && !register.residual_likelihood) return "";
    const statusLabel = s === true ? "Acceptable" : s === false ? "Not acceptable" : "No residual risk";
    const statusColor = s === true ? "#1a5c35" : s === false ? "#8b0000" : "#6b7280";
    const statusBg = s === true ? "#d5f5e3" : s === false ? "#ffd5d5" : "#f4f4f5";
    return `
      <div style="background:#f8f9fa;border-radius:8px;padding:14px 18px;margin-bottom:16px">
        <div style="margin-bottom:8px"><span style="background:${statusBg};color:${statusColor};padding:3px 12px;border-radius:10px;font-weight:700;font-size:12px">${statusLabel}</span></div>
        ${register.residual_severity || register.residual_likelihood ? `
        <table style="border-collapse:collapse;font-size:12px">
          <tr>
            <td style="padding:2px 8px 2px 0;color:#556b82;width:150px">Severity</td><td style="padding:2px 16px 2px 0">${cap(register.residual_severity ?? "")}</td>
            <td style="padding:2px 8px 2px 0;color:#556b82">Likelihood</td><td>${cap(register.residual_likelihood ?? "")}</td>
          </tr>
          ${register.residual_final_risk_level ? `<tr><td style="padding:2px 8px 2px 0;color:#556b82">Risk level</td><td colspan="3">${levelBadge(register.residual_final_risk_level)}</td></tr>` : ""}
          ${register.residual_date_of_identification ? `<tr><td style="padding:2px 8px 2px 0;color:#556b82">Date of identification</td><td colspan="3">${fmtDate(register.residual_date_of_identification)}</td></tr>` : ""}
        </table>` : ""}
        ${register.residual_risk_argument ? `<div style="margin-top:8px;font-size:12px;color:#374151"><strong>Expert argument:</strong> ${np(register.residual_risk_argument)}</div>` : ""}
      </div>`;
  })();

  // ── JSON / Markdown helpers ──
  const buildJson = () => JSON.stringify({
    generated_at: new Date().toISOString(),
    system_name: systemName,
    register_id: register.id,
    status: register.status,
    archived,
    assessment_scope: register.assessment_scope,
    notes: register.notes,
    approved_at: register.approved_at,
    approver_username: register.approver_username,
    residual_risk_acceptable: register.residual_risk_acceptable,
    residual_risk_argument: register.residual_risk_argument,
    residual_severity: register.residual_severity,
    residual_likelihood: register.residual_likelihood,
    residual_final_risk_level: register.residual_final_risk_level,
    residual_date_of_identification: register.residual_date_of_identification,
    next_review_date: register.next_review_date,
    risks: risks.map(r => ({
      id: r.id, title: r.title, status: r.status, category: r.category,
      severity: r.severity, likelihood: r.likelihood, risk_level: r.risk_level_autocalculated,
      risk_owner: r.risk_owner, ai_lifecycle_phase: r.ai_lifecycle_phase,
      description: r.description, impact: r.impact,
      affects_vulnerable_groups: r.affects_vulnerable_groups, vulnerable_groups: r.vulnerable_groups,
      residual_status: r.residual_status, residual_severity: r.residual_severity,
      residual_likelihood: r.residual_likelihood, final_risk_level: r.final_risk_level,
      date_of_assessment: r.date_of_assessment, review_notes: r.review_notes,
      misuse_scenarios: r.misuse_scenarios, mitigations: r.mitigations,
    })),
    plan_tasks: planTasks,
    incidents,
  }, null, 2);

  const buildMarkdown = () => {
    const lines: string[] = [];
    lines.push(`# Risk Management Report — ${systemName}`);
    lines.push(`\n**Register:** ${register.id}  `);
    lines.push(`**Generated:** ${fmtDate(new Date().toISOString())}  `);
    lines.push(`**Status:** ${register.status.toUpperCase()}`);
    if (archived) lines.push(`\n> ⚠ **ARCHIVED** — historical record from a previous cycle.`);
    if (register.status === "approved") {
      lines.push(`\n> ✅ **APPROVED** by ${register.approver_username ?? "—"} on ${fmtDate(register.approved_at)}`);
      lines.push(`> Overall residual risk: **${register.residual_risk_acceptable === true ? "Acceptable" : register.residual_risk_acceptable === false ? "Not acceptable" : "—"}**`);
    }
    lines.push(`\n## Assessment scope\n\n${register.assessment_scope || "—"}`);
    if (register.notes) lines.push(`\n## Notes\n\n${register.notes}`);
    lines.push(`\n## Summary\n\n- Confirmed risks: ${confirmedRisks.length}\n- Total mitigations: ${confirmedRisks.reduce((a, r) => a + (r.mitigations ?? []).length, 0)}\n- Plan tasks: ${planTasks.length}\n- Incidents: ${incidents.length}`);
    lines.push(`\n## Confirmed risks`);
    confirmedRisks.forEach((r, i) => {
      lines.push(`\n### ${i + 1}. ${r.title}`);
      lines.push(`**Category:** ${r.category} | **Severity:** ${cap(r.severity)} | **Likelihood:** ${cap(r.likelihood)} | **Level:** ${r.risk_level_autocalculated ?? "—"}`);
      if (r.risk_owner) lines.push(`**Owner:** ${r.risk_owner}`);
      if (r.description) lines.push(`\n${r.description}`);
      if (r.impact) lines.push(`\n**Impact:** ${r.impact}`);
      if (r.affects_vulnerable_groups) lines.push(`\n⚠ **Affects vulnerable groups**`);
      if ((r.mitigations ?? []).length > 0) {
        lines.push(`\n**Mitigations:**`);
        r.mitigations.forEach(m => lines.push(`- [${m.hierarchy_level.toUpperCase()}] **${m.title}**${m.assigned_to ? ` (${m.assigned_to})` : ""}`));
      }
      lines.push(`\n**Residual risk:** ${r.residual_status === "none" || !r.residual_status ? "No residual risk" : cap(r.residual_status)}${r.residual_status && r.residual_status !== "none" && r.residual_severity ? ` — ${cap(r.residual_severity ?? "")}/${cap(r.residual_likelihood ?? "")} → ${r.final_risk_level ?? "—"}` : ""}`);
      if (r.review_notes) lines.push(`**Notes:** ${r.review_notes}`);
    });
    if (register.residual_risk_argument) {
      lines.push(`\n## Overall residual risk argument\n\n${register.residual_risk_argument}`);
    }
    if (planTasks.length > 0) {
      lines.push(`\n## Action plan tasks\n`);
      planTasks.forEach(t => lines.push(`- **${t.title}** (${cap(t.status)})${t.assigned_to ? ` — ${t.assigned_to}` : ""}${t.due_date ? ` | due ${fmtDate(t.due_date)}` : ""}`));
    }
    if (incidents.length > 0) {
      lines.push(`\n## Incidents\n`);
      incidents.forEach(inc => lines.push(`- **${inc.title}** (${cap(inc.status)})${inc.reported_by ? ` — ${inc.reported_by}` : ""}${inc.occurred_at ? ` | ${fmtDate(inc.occurred_at)}` : ""}`));
    }
    lines.push(`\n---\n*Generated by AI Trust Platform · EU AI Act Art. 9 Risk Management*`);
    return lines.join("\n");
  };

  const safeFileName = systemName.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
  const dateStamp = new Date().toISOString().slice(0, 10);

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
  <title>Risk Management Report — ${esc(systemName)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 980px; margin: 0 auto; padding: 32px 24px; color: #111827; background: #fff; }
    @media print { .no-print { display: none !important; } body { padding: 0; } }
    h1 { font-size: 24px; font-weight: 800; margin: 0 0 4px; }
    .meta { font-size: 12px; color: #556b82; margin-bottom: 24px; }
    .section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #556b82; margin: 28px 0 10px; border-bottom: 1px solid #e4e4e7; padding-bottom: 6px; }
    .scope-box { background: #f8f9fa; border-radius: 8px; padding: 14px 16px; font-size: 13px; line-height: 1.65; margin-bottom: 12px; }
    .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 20px; }
    .stat { background: #f8f9fa; border-radius: 8px; padding: 10px 12px; text-align: center; }
    .stat-val { font-size: 22px; font-weight: 800; color: #1147E9; }
    .stat-lbl { font-size: 10px; color: #556b82; margin-top: 2px; }
    .toolbar { display: flex; gap: 8px; align-items: center; padding: 12px 0 20px; border-bottom: 1px solid #e4e4e7; margin-bottom: 24px; flex-wrap: wrap; }
    .btn { border: none; border-radius: 6px; padding: 8px 18px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn-primary { background: #1147E9; color: #fff; }
    .btn-secondary { background: #f4f4f5; color: #374151; }
    .btn-green { background: #d5f5e3; color: #1a5c35; }
    .footer { margin-top: 40px; font-size: 11px; color: #9ca3af; border-top: 1px solid #e4e4e7; padding-top: 12px; }
  </style>
  <script>
    function dlJson() {
      const data = document.getElementById('json-data').textContent;
      dl(data, 'report_${safeFileName}_${dateStamp}.json', 'application/json');
    }
    function dlMd() {
      const data = document.getElementById('md-data').textContent;
      dl(data, 'report_${safeFileName}_${dateStamp}.md', 'text/markdown');
    }
    function dl(content, filename, mime) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([content], {type: mime}));
      a.download = filename;
      a.click();
    }
  </script>
  </head><body>

  <div class="no-print toolbar">
    <button class="btn btn-primary" onclick="window.print()">🖨 Print / Save as PDF</button>
    <button class="btn btn-green" onclick="dlJson()">⬇ Download JSON</button>
    <button class="btn btn-secondary" onclick="dlMd()">⬇ Download Markdown</button>
    <button class="btn btn-secondary" onclick="window.close()">✕ Close</button>
  </div>

  <h1>Risk Management Report</h1>
  <div class="meta">System: <strong>${esc(systemName)}</strong> &nbsp;·&nbsp; Register: ${esc(register.id)} &nbsp;·&nbsp; Generated: ${fmtDate(new Date().toISOString())}</div>

  ${statusBanner}

  <div class="section-title">Assessment scope</div>
  <div class="scope-box">${np(register.assessment_scope)}</div>
  ${register.notes ? `<div class="section-title">Notes</div><div class="scope-box">${np(register.notes)}</div>` : ""}

  <div class="stats">
    <div class="stat"><div class="stat-val">${confirmedRisks.length}</div><div class="stat-lbl">Confirmed risks</div></div>
    <div class="stat"><div class="stat-val">${confirmedRisks.reduce((a, r) => a + (r.mitigations ?? []).length, 0)}</div><div class="stat-lbl">Mitigations</div></div>
    <div class="stat"><div class="stat-val">${confirmedRisks.filter(r => r.affects_vulnerable_groups).length}</div><div class="stat-lbl">Vulnerable group risks</div></div>
    <div class="stat"><div class="stat-val">${planTasks.length}</div><div class="stat-lbl">Action tasks</div></div>
    <div class="stat"><div class="stat-val">${incidents.length}</div><div class="stat-lbl">Incidents</div></div>
  </div>

  <div class="section-title">Confirmed risks (${confirmedRisks.length})</div>
  ${confirmedHtml || "<p style='color:#9ca3af;font-size:13px'>No confirmed risks.</p>"}

  ${pendingRisks.length > 0 ? `<div class="section-title">Pending risks (${pendingRisks.length})</div>${pendingHtml}` : ""}

  ${diffAddedInNext.size > 0 ? `
    <div class="section-title">Risks added in next version (${diffAddedInNext.size})</div>
    ${[...diffAddedInNext].map(title => `
      <div style="border:2px dashed #6ee7b7;background:#f0faf4;border-radius:8px;padding:12px 16px;margin-bottom:10px">
        <span style="background:#d5f5e3;color:#1a5c35;font-size:10px;font-weight:700;padding:1px 8px;border-radius:6px;text-transform:uppercase;margin-right:8px">added in next version</span>
        <strong style="color:#1a5c35">${esc(title)}</strong>
      </div>`).join("")}` : ""}

  ${dismissedRisks.length > 0 ? `
    <div class="section-title">Dismissed risks (${dismissedRisks.length})</div>
    ${dismissedRisks.map(r => `<div style="border:1px solid #e4e4e7;border-radius:6px;padding:10px 14px;margin-bottom:6px;opacity:0.6;font-size:12px">
      <strong>${esc(r.title)}</strong>
      ${r.closure_justification ? ` — <span style="color:#556b82">${esc(r.closure_justification)}</span>` : ""}
    </div>`).join("")}` : ""}

  <div class="section-title">Overall residual risk</div>
  ${regResidualHtml || `<div style="color:#9ca3af;font-size:12px;font-style:italic">Not assessed.</div>`}

  <div class="section-title">Action plan</div>
  ${register.next_review_date ? `<div style="font-size:12px;margin-bottom:10px"><strong>Scheduled review date:</strong> ${fmtDate(register.next_review_date)}</div>` : ""}
  ${tasksHtml}

  <div class="section-title">Incidents (${incidents.length})</div>
  ${incidentsHtml}

  <div class="footer">Generated by AI Trust Platform &nbsp;·&nbsp; EU AI Act Art. 9 Risk Management &nbsp;·&nbsp; ${new Date().getFullYear()}</div>

  <script id="json-data" type="application/json">${esc(buildJson())}</script>
  <script id="md-data" type="text/plain">${esc(buildMarkdown())}</script>
  </body></html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener");
  if (!win) {
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ── Step 1: Scope & Risks ─────────────────────────────────────────────────────
const RISK_CATEGORIES = [
  { value: "health", label: "Health" },
  { value: "safety", label: "Safety" },
  { value: "fundamental_rights", label: "Fundamental Rights" },
  { value: "others", label: "Others" },
];

const RISK_LEVEL_MATRIX: Record<string, Record<string, string>> = {
  severe:      { very_likely: "unacceptable", likely: "unacceptable", possible: "substantial", unlikely: "moderate"   },
  significant: { very_likely: "unacceptable", likely: "substantial",  possible: "substantial", unlikely: "moderate"   },
  moderate:    { very_likely: "substantial",  likely: "moderate",     possible: "moderate",    unlikely: "acceptable" },
  minor:       { very_likely: "moderate",     likely: "acceptable",   possible: "acceptable",  unlikely: "acceptable" },
};

function calcRiskLevel(severity: string, likelihood: string): string {
  return RISK_LEVEL_MATRIX[severity]?.[likelihood] ?? "moderate";
}

function RiskLevelBadge({ level }: { level: string }) {
  const c = RISK_LEVEL_COLORS[level] ?? "#556b82";
  const bg = RISK_LEVEL_BG[level] ?? "#eef1f4";
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

export interface DraftRisk {
  title: string;
  description: string;
  categories: string[];
  affects_vulnerable_groups: boolean;
  vulnerable_groups: string;
  vulnerable_group_impact: string;
  severity: string;
  likelihood: string;
  risk_owner: string;
  due_date: string;
  ai_lifecycle_phase: string;
  impact: string;
  responsible_role: string[];
  date_of_identification: string;
  library_risk_id?: string;
  engineer_email: string;
  officer_email: string;
  residual_status: string;
  residual_severity: string;
  residual_likelihood: string;
  review_notes: string;
}

const emptyDraft = (): DraftRisk => ({
  title: "", description: "", categories: [],
  affects_vulnerable_groups: false, vulnerable_groups: "", vulnerable_group_impact: "",
  severity: "moderate", likelihood: "possible",
  risk_owner: "", due_date: "", ai_lifecycle_phase: "", impact: "",
  responsible_role: [], date_of_identification: new Date().toISOString().slice(0, 10),
  engineer_email: "", officer_email: "",
  residual_status: "none", residual_severity: "", residual_likelihood: "", review_notes: "",
});

interface DraftMisuseScenario {
  risk_id: string;
  risk_title: string;
  risk_owner: string;
  description: string;
  categories: string[];
  severity: string;
  likelihood: string;
  consequence: string;
  affects_vulnerable_groups: boolean;
  vulnerable_group: string;
  vulnerable_group_impact: string;
}

const emptyMsDraft = (): DraftMisuseScenario => ({
  risk_id: "", risk_title: "", risk_owner: "", description: "", categories: [], severity: "moderate", likelihood: "possible",
  consequence: "", affects_vulnerable_groups: false, vulnerable_group: "", vulnerable_group_impact: "",
});

const HIERARCHY_LEVELS = [
  { value: "eliminate", label: "Eliminate", desc: "Remove the risk entirely (design change, feature removal)", color: "#8b0000", bg: "#ffd5d5" },
  { value: "reduce",    label: "Reduce",    desc: "Reduce severity or likelihood (technical safeguards)", color: "#8b3a00", bg: "#fde8d0" },
  { value: "mitigate",  label: "Mitigate",  desc: "Detect and contain occurrences (monitoring, human oversight)", color: "#0a6ed1", bg: "#dbeafe" },
  { value: "inform",    label: "Inform",    desc: "Disclosure and transparency measures to affected parties", color: "#1a5c35", bg: "#d5f5e3" },
];

function IdentifyStep({ register, risks, onRisksChange, onRegisterUpdated, onApprove, onReopen, reopening, onEnsureEditable, systemName, systemId, prefillRisk, onBack }: {
  register: RiskRegister | null;
  risks: RiskEntry[];
  onRisksChange: (risks: RiskEntry[]) => void;
  onRegisterUpdated: (r: RiskRegister) => void;
  onApprove: (acceptable: boolean | null, argument: string, registryInfo?: import("../types").RegistrySystemInfo | null) => Promise<void>;
  onReopen: () => void;
  reopening: boolean;
  onEnsureEditable: () => Promise<{ register: RiskRegister; risks: RiskEntry[] } | null>;
  systemName: string;
  systemId: string;
  prefillRisk?: Partial<DraftRisk>;
  onBack: () => void;
}) {
  // ── Scope section state ──
  const [registryInfo, setRegistryInfo] = useState<import("../types").RegistrySystemInfo | null>(null);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [registryErr, setRegistryErr] = useState("");
  const [openTriggers, setOpenTriggers] = useState<import("../types").ReassessmentTrigger[]>([]);

  useEffect(() => {
    api.getTriggers(systemId)
      .then(ts => setOpenTriggers(ts.filter(t => !t.acknowledged && new Date(t.triggered_at) <= new Date())))
      .catch(() => {});
  }, [systemId, register?.status]);

  useEffect(() => {
    api.getRegistryInfo(systemId)
      .then(setRegistryInfo)
      .catch(e => setRegistryErr(String(e)))
      .finally(() => setRegistryLoading(false));
  }, [systemId]);
  // ── Risk section state ──
  const [activeForm, setActiveForm] = useState<"none" | "risk" | "misuse">("none");
  const [expandedRisk, setExpandedRisk] = useState<Record<string, boolean>>({});
  const [addMit, setAddMit] = useState<Record<string, boolean>>({});
  const [mitDraft, setMitDraft] = useState<Record<string, Partial<MitigationMeasure>>>({});
  const [residualDraft, setResidualDraft] = useState<Record<string, { residual_status: string; residual_likelihood: string; residual_severity: string; date_of_assessment: string; review_notes: string }>>({});
  const [residualSaving, setResidualSaving] = useState<Record<string, boolean>>({});
  const [residualErr, setResidualErr] = useState<Record<string, string>>({});
  const [mitSaving, setMitSaving] = useState<Record<string, boolean>>({});
  const [mitErr, setMitErr] = useState<Record<string, string>>({});
  const [testReports, setTestReports] = useState<Record<string, TestReport[]>>({});
  const [addTest, setAddTest] = useState<Record<string, boolean>>({});
  const [addResidual, setAddResidual] = useState<Record<string, boolean>>({});
  const [testDraft, setTestDraft] = useState<Record<string, { title: string; summary: string; findings: string; result: string; author: string }>>({});
  const [testSaving, setTestSaving] = useState<Record<string, boolean>>({});
  // ── Per-risk inline Tasks ──
  const [addRiskTask, setAddRiskTask] = useState<Record<string, boolean>>({});
  const [riskTaskDraft, setRiskTaskDraft] = useState<Record<string, Partial<PlanTask>>>({});
  const [riskTaskSaving, setRiskTaskSaving] = useState<Record<string, boolean>>({});
  const [riskTaskErr, setRiskTaskErr] = useState<Record<string, string>>({});
  // ── Per-risk inline Incidents ──
  const [addRiskIncident, setAddRiskIncident] = useState<Record<string, boolean>>({});
  const [riskIncidentDraft, setRiskIncidentDraft] = useState<Record<string, Partial<import("../types").Incident>>>({});
  const [riskIncidentSaving, setRiskIncidentSaving] = useState<Record<string, boolean>>({});
  const [riskIncidentErr, setRiskIncidentErr] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<DraftRisk>(() => prefillRisk ? { ...emptyDraft(), ...prefillRisk, risk_owner: "" } : emptyDraft());
  const [msDraft, setMsDraft] = useState<DraftMisuseScenario>(emptyMsDraft());
  const [saving, setSaving] = useState(false);
  // ── Add-risk form: inline measures / residual risk / test reports ──
  const [draftMitigations, setDraftMitigations] = useState<Partial<MitigationMeasure>[]>([]);
  const [showDraftMit, setShowDraftMit] = useState(false);
  const [draftMitDraft, setDraftMitDraft] = useState<Partial<MitigationMeasure>>({});
  const [draftMitErr, setDraftMitErr] = useState("");
  const [showDraftResidual, setShowDraftResidual] = useState(false);
  const [draftTestReports, setDraftTestReports] = useState<Partial<TestReport>[]>([]);
  const [showDraftTest, setShowDraftTest] = useState(false);
  const [draftTestDraft, setDraftTestDraft] = useState<Partial<TestReport>>({});
  const [err, setErr] = useState("");
  const [libraryRisks, setLibraryRisks] = useState<LibraryRisk[] | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [editingRiskId, setEditingRiskId] = useState<string | null>(null);
  const [editRiskDraft, setEditRiskDraft] = useState<DraftRisk>(emptyDraft());
  const [editRiskSaving, setEditRiskSaving] = useState(false);
  const [editRiskErr, setEditRiskErr] = useState("");

  useEffect(() => {
    if (prefillRisk) setActiveForm("risk");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Soft-delete state (for approved register) ──
  const [pendingDeleteRisks, setPendingDeleteRisks] = useState<Set<string>>(new Set());
  const [pendingDeleteTasks, setPendingDeleteTasks] = useState<Set<string>>(new Set());
  const [pendingDeleteIncidents, setPendingDeleteIncidents] = useState<Set<string>>(new Set());

  // ── Delete confirmation modal ──
  const [deleteModal, setDeleteModal] = useState<{ label: string; onConfirm: () => void } | null>(null);
  function confirmDelete(label: string, onConfirm: () => void) {
    setDeleteModal({ label, onConfirm });
  }

  // ── Action plan section state ──
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [addingTask, setAddingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState<Partial<PlanTask>>({});
  const [savingTask, setSavingTask] = useState(false);
  const [taskErr, setTaskErr] = useState("");
  const [editingTask, setEditingTask] = useState<string | null>(null);
  const [editTaskDraft, setEditTaskDraft] = useState<Partial<PlanTask>>({});
  const [savingEditTask, setSavingEditTask] = useState(false);

  // ── Review section state ──
  const [reviewDate, setReviewDate] = useState(() => {
    if (register?.next_review_date) return register.next_review_date.slice(0, 10);
    const suggested = new Date();
    suggested.setDate(suggested.getDate() + 180);
    return suggested.toISOString().slice(0, 10);
  });
  const [reviewDateErr, setReviewDateErr] = useState("");
  const [savingDate, setSavingDate] = useState(false);
  const [editingDate, setEditingDate] = useState(!register?.next_review_date);
  const [reviewer, setReviewer] = useState(register?.reviewer_username ?? register?.created_by ?? "");
  const [savingReviewer, setSavingReviewer] = useState(false);
  const [editingReviewer, setEditingReviewer] = useState(!register?.reviewer_username);

  // ── Incidents section state ──
  const [incidents, setIncidents] = useState<import("../types").Incident[]>([]);
  // incidentModal: null = closed, string = locked risk_id (from risk card), "other" = Other (no risk), "free" = Report Incident button (free choice)
  const [incidentModal, setIncidentModal] = useState<null | string | "other" | "free">(null);
  const [incidentDraft, setIncidentDraft] = useState<Partial<import("../types").Incident>>({});
  const [savingIncident, setSavingIncident] = useState(false);
  const [incidentErr, setIncidentErr] = useState("");
  const [editingIncident, setEditingIncident] = useState<string | null>(null);
  const [editIncidentDraft, setEditIncidentDraft] = useState<Partial<import("../types").Incident>>({});
  const [savingEditIncident, setSavingEditIncident] = useState(false);
  const [showAllIncidents, setShowAllIncidents] = useState(false);
  const [showAllTasks, setShowAllTasks] = useState(false);

  // ── Approve section state ──
  const [approveSaving, setApproveSaving] = useState(false);
  const [approveErr, setApproveErr] = useState("");
  const [approveErrModal, setApproveErrModal] = useState(false);
  const [savingForLater, setSavingForLater] = useState(false);

  // ── Register-level residual risk draft ──
  const [regResidualDraft, setRegResidualDraft] = useState<{
    residual_risk_acceptable: boolean | null;
    residual_severity: string;
    residual_likelihood: string;
    residual_date_of_identification: string;
    residual_risk_argument: string;
  }>({
    residual_risk_acceptable: register?.residual_risk_acceptable ?? null,
    residual_severity: register?.residual_severity ?? "",
    residual_likelihood: register?.residual_likelihood ?? "",
    residual_date_of_identification: register?.residual_date_of_identification ? register.residual_date_of_identification.substring(0, 10) : "",
    residual_risk_argument: register?.residual_risk_argument ?? "",
  });
  const [regResidualSaving, setRegResidualSaving] = useState(false);
  const [regResidualSaved, setRegResidualSaved] = useState(false);
  const [regResidualErr, setRegResidualErr] = useState("");

  useEffect(() => {
    if (!register) return;
    api.getPlanTasks(register.id).then(setTasks).catch(() => {});
    api.checkOverdueTasks(register.id).catch(() => {});
    api.getIncidents(register.id).then(setIncidents).catch(() => {});
  }, [register?.id]);

  useEffect(() => {
    if (!register || !registryInfo) return;
    const snapshot: Record<string, unknown> = {
      name: registryInfo.name,
      description: registryInfo.description,
      intended_purpose: registryInfo.intended_purpose,
      tier: registryInfo.tier,
      lifecycle: registryInfo.lifecycle,
      org_role: registryInfo.org_role,
      use_case: registryInfo.use_case,
      department: registryInfo.department,
    };
    api.checkRegistryChanges(register.id, snapshot).catch(() => {});
  }, [register?.id, registryInfo]);

  const today = new Date();
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 180);
  const maxDateStr = maxDate.toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  async function saveReviewDate(value: string) {
    if (!register) return;
    if (!value) { setReviewDateErr("Review date is required."); return; }
    if (value > maxDateStr) { setReviewDateErr("Review date must be within 6 months from today."); return; }
    setReviewDateErr("");
    setSavingDate(true);
    try {
      const editable = await onEnsureEditable();
      const targetRegister = editable?.register ?? register;
      if (editable) { onRisksChange(editable.risks); }
      const updated = await api.patchRegister(targetRegister.id, { next_review_date: value } as Partial<RiskRegister>);
      onRegisterUpdated(updated);
      setEditingDate(false);
    } finally {
      setSavingDate(false);
    }
  }

  async function saveReviewer(value: string) {
    if (!register) return;
    setSavingReviewer(true);
    try {
      const editable = await onEnsureEditable();
      const targetRegister = editable?.register ?? register;
      if (editable) { onRisksChange(editable.risks); }
      const updated = await api.patchRegister(targetRegister.id, { reviewer_username: value } as Partial<RiskRegister>);
      onRegisterUpdated(updated);
      setEditingReviewer(false);
    } finally {
      setSavingReviewer(false);
    }
  }

  async function addTask() {
    if (!register) return;
    if (!taskDraft.title?.trim()) { setTaskErr("Task title is required."); return; }
    setTaskErr("");
    setSavingTask(true);
    try {
      const editable = await onEnsureEditable();
      const targetRegister = editable?.register ?? register;
      if (editable) { onRisksChange(editable.risks); }
      const linkedRisk = risks.find(r => r.id === taskDraft.risk_id);
      const task = await api.createPlanTask(targetRegister.id, {
        title: taskDraft.title ?? "",
        description: taskDraft.description ?? "",
        risk_id: taskDraft.risk_id ?? null,
        mitigation_id: taskDraft.mitigation_id ?? null,
        assigned_to: taskDraft.assigned_to ?? linkedRisk?.risk_owner ?? null,
        due_date: taskDraft.due_date ?? null,
        status: taskDraft.status ?? "open",
      });
      setTasks(prev => [...prev, task]);
      setTaskDraft({});
      setAddingTask(false);
    } finally {
      setSavingTask(false);
    }
  }

  async function deleteTask(taskId: string) {
    if (register?.status === "approved") {
      const task = tasks.find(t => t.id === taskId);
      confirmDelete(`Delete task "${task?.title ?? taskId}"?`, () => {
        setPendingDeleteTasks(s => new Set(s).add(taskId));
      });
      return;
    }
    const task = tasks.find(t => t.id === taskId);
    confirmDelete(`Delete task "${task?.title ?? taskId}"?`, async () => {
      await api.deletePlanTask(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    });
  }

  async function confirmDeleteTask(taskId: string) {
    const originalTask = tasks.find(t => t.id === taskId);
    const editable = await onEnsureEditable();
    if (editable) {
      const allTasks = await api.getPlanTasks(editable.register.id);
      setTasks(allTasks);
      const mapped = allTasks.find(t => t.title === originalTask?.title && t.status === originalTask?.status);
      if (mapped) {
        await api.deletePlanTask(mapped.id);
        setTasks(prev => prev.filter(t => t.id !== mapped.id));
      }
    } else {
      await api.deletePlanTask(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    }
    setPendingDeleteTasks(s => { const n = new Set(s); n.delete(taskId); return n; });
  }

  async function saveEditTask(taskId: string) {
    if (!editTaskDraft.title?.trim()) return;
    setSavingEditTask(true);
    try {
      const originalTask = tasks.find(t => t.id === taskId);
      const editable = await onEnsureEditable();
      let targetId = taskId;
      if (editable) {
        const allTasks = await api.getPlanTasks(editable.register.id);
        setTasks(allTasks);
        const mapped = allTasks.find(t => t.title === originalTask?.title && t.status === originalTask?.status);
        targetId = mapped?.id ?? taskId;
        onRisksChange(editable.risks);
      }
      const updated = await api.patchPlanTask(targetId, {
        title: editTaskDraft.title,
        description: editTaskDraft.description ?? "",
        risk_id: editTaskDraft.risk_id ?? null,
        assigned_to: editTaskDraft.assigned_to ?? null,
        due_date: editTaskDraft.due_date ?? null,
        status: editTaskDraft.status,
      });
      setTasks(prev => prev.map(t => t.id === targetId ? updated : t));
      setEditingTask(null);
      setEditTaskDraft({});
    } finally {
      setSavingEditTask(false);
    }
  }

  async function updateTaskStatus(taskId: string, status: string) {
    const originalTask = tasks.find(t => t.id === taskId);
    const editable = await onEnsureEditable();
    let targetId = taskId;
    if (editable) {
      const allTasks = await api.getPlanTasks(editable.register.id);
      setTasks(allTasks);
      const mapped = allTasks.find(t => t.title === originalTask?.title);
      targetId = mapped?.id ?? taskId;
      onRisksChange(editable.risks);
    }
    const updated = await api.patchPlanTask(targetId, { status });
    setTasks(prev => prev.map(t => t.id === targetId ? updated : t));
  }

  async function saveRiskTask(riskId: string) {
    const d = riskTaskDraft[riskId] ?? {};
    if (!d.title?.trim()) { setRiskTaskErr(e => ({ ...e, [riskId]: "Task title is required." })); return; }
    setRiskTaskErr(e => ({ ...e, [riskId]: "" }));
    setRiskTaskSaving(s => ({ ...s, [riskId]: true }));
    try {
      const savedRisk = risks.find(x => x.id === riskId);
      const editable = await onEnsureEditable();
      const targetRegister = editable?.register ?? register;
      if (!targetRegister) return;
      const currentRisks = editable?.risks ?? risks;
      if (editable) { onRisksChange(editable.risks); }
      const targetRiskId = editable ? (currentRisks.find(r => r.title === savedRisk?.title)?.id ?? riskId) : riskId;
      const risk = currentRisks.find(r => r.id === targetRiskId) ?? savedRisk;
      const task = await api.createPlanTask(targetRegister.id, {
        title: d.title ?? "",
        description: d.description ?? "",
        risk_id: targetRiskId,
        mitigation_id: d.mitigation_id ?? null,
        assigned_to: d.assigned_to ?? risk?.risk_owner ?? null,
        due_date: d.due_date ?? null,
        status: d.status ?? "open",
      });
      setTasks(prev => [...prev, task]);
      setRiskTaskDraft(prev => ({ ...prev, [riskId]: {} }));
      setAddRiskTask(a => ({ ...a, [riskId]: false }));
    } finally {
      setRiskTaskSaving(s => ({ ...s, [riskId]: false }));
    }
  }

  const riskById: Record<string, string> = {};
  risks.forEach(r => { riskById[r.id] = r.title; });

  const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
    open:        { bg: "#f4f4f5", color: "#6b7280" },
    in_progress: { bg: "#eff6ff", color: "#1147E9" },
    done:        { bg: "#d5f5e3", color: "#1a5c35" },
    overdue:     { bg: "#ffd5d5", color: "#8b0000" },
  };

  function taskStatusKey(task: PlanTask): string {
    if (task.status === "done") return "done";
    if (task.due_date && task.due_date.slice(0, 10) < todayStr) return "overdue";
    return task.status;
  }

  function closeForm(form: "risk" | "misuse") {
    setActiveForm("none");
    setErr("");
    setLibraryRisks(null);
    if (form === "risk") {
      setDraft(emptyDraft());
      setDraftMitigations([]);
      setDraftTestReports([]);
      setShowDraftMit(false);
      setShowDraftResidual(false);
      setShowDraftTest(false);
      setDraftMitDraft({});
      setDraftTestDraft({});
      setDraftMitErr("");
    }
    if (form === "misuse") setMsDraft(emptyMsDraft());
  }

  function openForm(form: "risk" | "misuse") {
    if (activeForm === form) { closeForm(form); return; }
    setActiveForm(form);
    setErr("");
  }

  function openIncidentModal(context: string | "other" | "free") {
    setIncidentModal(context);
    // pre-fill risk_id unless free choice
    const riskId = context !== "free" && context !== "other" ? context : null;
    setIncidentDraft({ risk_id: riskId ?? undefined, status: "open" });
    setIncidentErr("");
  }

  function closeIncidentModal() {
    setIncidentModal(null);
    setIncidentDraft({});
    setIncidentErr("");
  }

  async function addIncident() {
    if (!register) return;
    if (!incidentDraft.title?.trim()) { setIncidentErr("Incident title is required."); return; }
    setIncidentErr("");
    setSavingIncident(true);
    try {
      const editable = await onEnsureEditable();
      const targetRegister = editable?.register ?? register;
      if (editable) { onRisksChange(editable.risks); }
      const incident = await api.createIncident(targetRegister.id, {
        title: incidentDraft.title ?? "",
        description: incidentDraft.description ?? "",
        status: incidentDraft.status ?? "open",
        risk_id: incidentDraft.risk_id ?? null,
        reported_by: incidentDraft.reported_by ?? null,
        occurred_at: incidentDraft.occurred_at ?? null,
        attachments: incidentDraft.attachments ?? "",
      });
      setIncidents(prev => [incident, ...prev]);
      closeIncidentModal();
    } finally {
      setSavingIncident(false);
    }
  }

  async function saveRiskIncident(riskId: string) {
    const d = riskIncidentDraft[riskId] ?? {};
    if (!d.title?.trim()) { setRiskIncidentErr(e => ({ ...e, [riskId]: "Incident title is required." })); return; }
    setRiskIncidentErr(e => ({ ...e, [riskId]: "" }));
    setRiskIncidentSaving(s => ({ ...s, [riskId]: true }));
    try {
      const savedRisk = risks.find(x => x.id === riskId);
      const editable = await onEnsureEditable();
      const targetRegister = editable?.register ?? register;
      if (!targetRegister) return;
      const currentRisks = editable?.risks ?? risks;
      if (editable) { onRisksChange(editable.risks); }
      const targetRiskId = editable ? (currentRisks.find(r => r.title === savedRisk?.title)?.id ?? riskId) : riskId;
      const incident = await api.createIncident(targetRegister.id, {
        title: d.title ?? "",
        description: d.description ?? "",
        status: d.status ?? "open",
        risk_id: targetRiskId,
        reported_by: d.reported_by ?? null,
        occurred_at: d.occurred_at ?? null,
        attachments: d.attachments ?? "",
      });
      setIncidents(prev => [incident, ...prev]);
      setRiskIncidentDraft(prev => ({ ...prev, [riskId]: {} }));
      setAddRiskIncident(a => ({ ...a, [riskId]: false }));
    } finally {
      setRiskIncidentSaving(s => ({ ...s, [riskId]: false }));
    }
  }

  async function deleteIncident(incidentId: string) {
    if (register?.status === "approved") {
      const incident = incidents.find(i => i.id === incidentId);
      confirmDelete(`Delete incident "${incident?.title ?? incidentId}"?`, () => {
        setPendingDeleteIncidents(s => new Set(s).add(incidentId));
      });
      return;
    }
    const incident = incidents.find(i => i.id === incidentId);
    confirmDelete(`Delete incident "${incident?.title ?? incidentId}"?`, async () => {
      await api.deleteIncident(incidentId);
      setIncidents(prev => prev.filter(i => i.id !== incidentId));
    });
  }

  async function confirmDeleteIncident(incidentId: string) {
    const originalIncident = incidents.find(i => i.id === incidentId);
    const editable = await onEnsureEditable();
    if (editable) {
      const allInc = await api.getIncidents(editable.register.id);
      setIncidents(allInc);
      const mapped = allInc.find(i => i.title === originalIncident?.title);
      if (mapped) {
        await api.deleteIncident(mapped.id);
        setIncidents(prev => prev.filter(i => i.id !== mapped.id));
      }
    } else {
      await api.deleteIncident(incidentId);
      setIncidents(prev => prev.filter(i => i.id !== incidentId));
    }
    setPendingDeleteIncidents(s => { const n = new Set(s); n.delete(incidentId); return n; });
  }

  async function saveEditIncident(incidentId: string) {
    if (!editIncidentDraft.title?.trim()) return;
    setSavingEditIncident(true);
    try {
      const originalIncident = incidents.find(i => i.id === incidentId);
      const editable = await onEnsureEditable();
      let targetId = incidentId;
      if (editable) {
        const allInc = await api.getIncidents(editable.register.id);
        setIncidents(allInc);
        const mapped = allInc.find(i => i.title === originalIncident?.title);
        targetId = mapped?.id ?? incidentId;
        onRisksChange(editable.risks);
      }
      const updated = await api.patchIncident(targetId, {
        title: editIncidentDraft.title,
        description: editIncidentDraft.description ?? "",
        status: editIncidentDraft.status,
        risk_id: editIncidentDraft.risk_id ?? null,
        reported_by: editIncidentDraft.reported_by ?? null,
        occurred_at: editIncidentDraft.occurred_at ?? null,
        attachments: editIncidentDraft.attachments ?? "",
      });
      setIncidents(prev => prev.map(i => i.id === targetId ? updated : i));
      setEditingIncident(null);
      setEditIncidentDraft({});
    } finally {
      setSavingEditIncident(false);
    }
  }

  function roleRequired(risk: RiskEntry, role: "engineer" | "officer"): boolean {
    const key = role === "engineer" ? "ai_engineer" : "ai_compliance_officer";
    return (risk.responsible_role ?? "").split(",").map(s => s.trim()).filter(Boolean).includes(key);
  }

  function canFullyConfirm(risk: RiskEntry): boolean {
    const engReq = roleRequired(risk, "engineer");
    const offReq = roleRequired(risk, "officer");
    if (!engReq && !offReq) return true;
    const engOk = !engReq || risk.engineer_confirmed || risk.engineer_declined;
    const offOk = !offReq || risk.officer_confirmed || risk.officer_declined;
    return engOk && offOk;
  }

  async function applyRolePatch(risk: RiskEntry, rolePatch: Partial<RiskEntry>) {
    const editable = await onEnsureEditable();
    const currentRisks = editable?.risks ?? risks;
    if (editable) { onRisksChange(editable.risks); }
    const targetId = editable ? (currentRisks.find(r => r.title === risk.title)?.id ?? risk.id) : risk.id;
    const merged = { ...risk, ...rolePatch };
    const patch: Partial<RiskEntry> = { ...rolePatch };
    if (canFullyConfirm(merged) && merged.status !== "confirmed") {
      patch.status = "confirmed";
      if (merged.source === "pending_library" && !merged.library_risk_id) {
        try {
          const libRisk = await api.createLibraryRisk({
            title: merged.title, description: merged.description, category: merged.category,
            severity: merged.severity, likelihood: merged.likelihood,
            affects_vulnerable_groups: merged.affects_vulnerable_groups, affects_children: false,
            suggested_mitigation: merged.impact, source: "manual",
          });
          patch.library_risk_id = libRisk.id;
          patch.source = "manual";
        } catch { /* non-fatal */ }
      }
    }
    const updated = await api.patchRisk(targetId, patch);
    onRisksChange(currentRisks.map(r => r.id === targetId ? { ...r, ...updated, misuse_scenarios: r.misuse_scenarios, mitigations: r.mitigations } : r));
  }

  async function confirmAsRole(risk: RiskEntry, role: "engineer" | "officer") {
    const patch: Partial<RiskEntry> = role === "engineer"
      ? { engineer_confirmed: true, engineer_declined: false }
      : { officer_confirmed: true, officer_declined: false };
    await applyRolePatch(risk, patch);
  }

  async function dismissAsRole(risk: RiskEntry) {
    await applyRolePatch(risk, { status: "dismissed" });
  }

  async function declineAsRole(risk: RiskEntry, role: "engineer" | "officer") {
    const patch: Partial<RiskEntry> = role === "engineer"
      ? { engineer_declined: true, engineer_confirmed: false }
      : { officer_declined: true, officer_confirmed: false };
    await applyRolePatch(risk, patch);
  }

  async function undoDeclineAsRole(risk: RiskEntry, role: "engineer" | "officer") {
    const patch: Partial<RiskEntry> = role === "engineer"
      ? { engineer_declined: false }
      : { officer_declined: false };
    await applyRolePatch(risk, patch);
  }

  async function undoConfirmAsRole(risk: RiskEntry, role: "engineer" | "officer") {
    const patch: Partial<RiskEntry> = role === "engineer"
      ? { engineer_confirmed: false }
      : { officer_confirmed: false };
    if (risk.status === "confirmed") patch.status = "open";
    await applyRolePatch(risk, patch);
  }

  async function undoDismiss(risk: RiskEntry) {
    await applyRolePatch(risk, { status: "open" });
  }

  async function confirmRisk(risk: RiskEntry) {
    // Global override: mark engineer+officer confirmed if required, then confirm
    const patch: Partial<RiskEntry> = { status: "confirmed" };
    if (roleRequired(risk, "engineer")) patch.engineer_confirmed = true;
    if (roleRequired(risk, "officer")) patch.officer_confirmed = true;
    await applyRolePatch(risk, patch);
  }

  async function unconfirmRisk(risk: RiskEntry) {
    const patch: Partial<RiskEntry> = { status: "open" };
    if (roleRequired(risk, "engineer")) patch.engineer_confirmed = false;
    if (roleRequired(risk, "officer")) patch.officer_confirmed = false;
    await applyRolePatch(risk, patch);
  }

  async function dismissRisk(risk: RiskEntry) {
    await applyRolePatch(risk, { status: "dismissed" });
  }

  async function addRisk(uploadToLibrary = false) {
    if (!draft.title.trim()) { setErr("Short description is required."); return; }
    if (draft.categories.length === 0) { setErr("Impact category is required."); return; }
    if (draft.affects_vulnerable_groups && !draft.vulnerable_groups.trim()) {
      setErr("Vulnerable groups field is mandatory when 'affects vulnerable groups' is checked.");
      return;
    }
    setSaving(true); setErr("");
    try {
      const editable = await onEnsureEditable();
      const targetRegister = editable?.register ?? register;
      if (!targetRegister) { setErr("No register available."); return; }
      if (editable) { onRisksChange(editable.risks); }
      const { categories, ...draftRest } = draft;

      let libraryRiskId = draft.library_risk_id;
      const pendingLibraryUpload = uploadToLibrary && !libraryRiskId;

      const hasResidual = draft.residual_status !== "none";
      const created = await api.createRisk(targetRegister.id, {
        ...draftRest,
        category: categories.join(","),
        vulnerable_groups: JSON.stringify(
          draft.vulnerable_groups ? draft.vulnerable_groups.split(",").map(s => s.trim()).filter(Boolean) : []
        ),
        risk_level_autocalculated: calcRiskLevel(draft.severity, draft.likelihood),
        deadline: draft.due_date || null,
        responsible_role: draft.responsible_role.length ? draft.responsible_role.join(",") : null,
        engineer_email: draft.engineer_email || null,
        officer_email: draft.officer_email || null,
        date_of_assessment: draft.date_of_identification || null,
        source: pendingLibraryUpload ? "pending_library" : "manual",
        library_risk_id: libraryRiskId ?? null,
        residual_status: draft.residual_status,
        residual_severity: hasResidual ? (draft.residual_severity || null) : null,
        residual_likelihood: hasResidual ? (draft.residual_likelihood || null) : null,
        final_risk_level: (hasResidual && draft.residual_severity && draft.residual_likelihood)
          ? calcRiskLevel(draft.residual_severity, draft.residual_likelihood)
          : null,
        review_notes: draft.review_notes || undefined,
      });

      const newMitigations: MitigationMeasure[] = [];
      for (const m of draftMitigations) {
        const mit = await api.addMitigation(created.id, {
          title: m.title ?? "",
          description: m.description ?? "",
          hierarchy_level: m.hierarchy_level ?? "mitigate",
          implementation_guidance: m.implementation_guidance ?? "",
          status: "planned",
          assigned_to: m.assigned_to ?? draft.risk_owner ?? null,
          due_date: m.due_date ?? null,
          override_notes: "",
        });
        newMitigations.push(mit);
      }
      for (const t of draftTestReports) {
        await api.createTestReport(created.id, {
          title: t.title ?? "",
          summary: t.summary ?? "",
          findings: t.findings ?? "",
          result: t.result ?? "pass",
          author: t.author || null,
          mitigation_id: null,
          attachments: "",
        });
      }

      const baseRisks = editable?.risks ?? risks;
      onRisksChange([...baseRisks, { ...created, mitigations: newMitigations }]);
      setDraft(emptyDraft());
      setDraftMitigations([]);
      setDraftTestReports([]);
      setShowDraftMit(false);
      setShowDraftResidual(false);
      setShowDraftTest(false);
      setActiveForm("none");
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  }

  function startEditRisk(r: RiskEntry) {
    const roles = (r.responsible_role ?? "").split(",").map(s => s.trim()).filter(Boolean);
    setEditRiskDraft({
      title: r.title,
      description: r.description,
      categories: r.category ? r.category.split(",").map(s => s.trim()).filter(Boolean) : [],
      affects_vulnerable_groups: r.affects_vulnerable_groups,
      vulnerable_groups: (() => { try { return (JSON.parse(r.vulnerable_groups) as string[]).join(", "); } catch { return r.vulnerable_groups; } })(),
      vulnerable_group_impact: "",
      severity: r.severity,
      likelihood: r.likelihood,
      risk_owner: r.risk_owner ?? "",
      due_date: r.deadline ? (typeof r.deadline === "string" ? r.deadline.slice(0, 10) : "") : "",
      ai_lifecycle_phase: r.ai_lifecycle_phase ?? "",
      impact: r.impact ?? "",
      responsible_role: roles,
      date_of_identification: r.date_of_assessment ? (typeof r.date_of_assessment === "string" ? r.date_of_assessment.slice(0, 10) : "") : "",
      library_risk_id: r.library_risk_id ?? undefined,
      engineer_email: r.engineer_email ?? "",
      officer_email: r.officer_email ?? "",
      residual_status: r.residual_status ?? "none",
      residual_severity: r.residual_severity ?? "",
      residual_likelihood: r.residual_likelihood ?? "",
      review_notes: r.review_notes ?? "",
    });
    setEditRiskErr("");
    setEditingRiskId(r.id);
  }

  async function saveEditRisk() {
    if (!editRiskDraft.title.trim()) { setEditRiskErr("Short description is required."); return; }
    if (editRiskDraft.categories.length === 0) { setEditRiskErr("Impact category is required."); return; }
    setEditRiskSaving(true); setEditRiskErr("");
    try {
      const { categories, ...rest } = editRiskDraft;
      const patch: Partial<RiskEntry> = {
        title: rest.title,
        description: rest.description,
        category: categories.join(","),
        affects_vulnerable_groups: rest.affects_vulnerable_groups,
        vulnerable_groups: JSON.stringify(
          rest.vulnerable_groups ? rest.vulnerable_groups.split(",").map(s => s.trim()).filter(Boolean) : []
        ),
        severity: rest.severity,
        likelihood: rest.likelihood,
        risk_level_autocalculated: calcRiskLevel(rest.severity, rest.likelihood),
        risk_owner: rest.risk_owner || null,
        deadline: rest.due_date || null,
        ai_lifecycle_phase: rest.ai_lifecycle_phase || null,
        impact: rest.impact,
        responsible_role: rest.responsible_role.length ? rest.responsible_role.join(",") : null,
        engineer_email: rest.engineer_email || null,
        officer_email: rest.officer_email || null,
        date_of_assessment: rest.date_of_identification || null,
      };
      const updated = await api.patchRisk(editingRiskId!, patch);
      onRisksChange(risks.map(r => r.id === editingRiskId ? { ...r, ...updated, misuse_scenarios: r.misuse_scenarios, mitigations: r.mitigations } : r));
      setEditingRiskId(null);
    } catch (e) { setEditRiskErr(String(e)); }
    finally { setEditRiskSaving(false); }
  }

  async function addMisuseScenario() {
    const d = msDraft;
    if (!d.risk_id) { setErr("Select the risk this scenario belongs to."); return; }
    if (d.risk_id === "other" && !d.risk_title.trim()) { setErr("Short description is required."); return; }
    if (!d.risk_owner.trim() || !d.description.trim()) { setErr("Risk owner and scenario description are required."); return; }
    setSaving(true); setErr("");
    try {
      const editable = await onEnsureEditable();
      const currentRisks = editable?.risks ?? risks;
      if (editable) { onRisksChange(editable.risks); }
      const targetRiskId = d.risk_id === "other" ? currentRisks[0]?.id : d.risk_id;
      const ms = await api.addMisuseScenario(targetRiskId ?? d.risk_id, {
        actor: d.risk_id === "other" ? d.risk_title : d.risk_owner,
        description: d.description,
        likelihood: d.likelihood,
        consequence: d.consequence,
        vulnerable_group: d.affects_vulnerable_groups ? (d.vulnerable_group || null) : null,
      });
      onRisksChange(currentRisks.map(r => r.id === ms.risk_id ? { ...r, misuse_scenarios: [...r.misuse_scenarios, ms] } : r));
      setMsDraft(emptyMsDraft());
      setActiveForm("none");
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  }

  async function removeRisk(id: string) {
    if (register?.status === "approved") {
      const risk = risks.find(r => r.id === id);
      confirmDelete(`Delete risk "${risk?.title ?? id}"?`, () => {
        setPendingDeleteRisks(s => new Set(s).add(id));
      });
      return;
    }
    const risk = risks.find(r => r.id === id);
    confirmDelete(`Delete risk "${risk?.title ?? id}"?`, async () => {
      await api.deleteRisk(id);
      onRisksChange(risks.filter(r => r.id !== id));
    });
  }

  async function confirmDeleteRisk(id: string) {
    const originalRisk = risks.find(r => r.id === id);
    const editable = await onEnsureEditable();
    const currentRisks = editable?.risks ?? risks;
    if (editable) { onRisksChange(editable.risks); }
    const mappedId = editable
      ? (currentRisks.find(r => r.title === originalRisk?.title)?.id ?? id)
      : id;
    await api.deleteRisk(mappedId);
    onRisksChange(currentRisks.filter(r => r.id !== mappedId));
    setPendingDeleteRisks(s => { const n = new Set(s); n.delete(id); return n; });
  }

  async function loadTestReports(riskId: string) {
    const reports = await api.getTestReports(riskId);
    setTestReports(t => ({ ...t, [riskId]: reports }));
  }

  useEffect(() => {
    risks.forEach(r => loadTestReports(r.id));
  }, [risks.length]);

  async function saveTestReport(riskId: string) {
    const d = testDraft[riskId] ?? {};
    if (!d.title?.trim()) return;
    setTestSaving(s => ({ ...s, [riskId]: true }));
    try {
      const editable = await onEnsureEditable();
      const currentRisks = editable?.risks ?? risks;
      if (editable) { onRisksChange(editable.risks); }
      const targetRiskId = editable
        ? (currentRisks.find(r => r.title === risks.find(x => x.id === riskId)?.title)?.id ?? riskId)
        : riskId;
      const report = await api.createTestReport(targetRiskId, {
        title: d.title,
        summary: d.summary ?? "",
        findings: d.findings ?? "",
        result: d.result ?? "pass",
        author: d.author || null,
        attachments: "",
        mitigation_id: null,
      });
      setTestReports(t => ({ ...t, [targetRiskId]: [report, ...(t[targetRiskId] ?? [])] }));
      setTestDraft(td => ({ ...td, [riskId]: { title: "", summary: "", findings: "", result: "pass", author: "" } }));
      setAddTest(a => ({ ...a, [riskId]: false }));
    } finally {
      setTestSaving(s => ({ ...s, [riskId]: false }));
    }
  }

  async function saveResidual(riskId: string) {
    const d = residualDraft[riskId] ?? {};
    const savedRisk = risks.find(x => x.id === riskId);
    const rs_status = d.residual_status ?? savedRisk?.residual_status ?? "none";
    const rl = rs_status !== "none" ? (d.residual_likelihood ?? savedRisk?.residual_likelihood ?? "") : "";
    const rs = rs_status !== "none" ? (d.residual_severity ?? savedRisk?.residual_severity ?? "") : "";
    const prevStatus = savedRisk?.residual_status ?? "none";
    const prevNotes = (savedRisk?.review_notes ?? "").trim();
    const nextNotes = (d.review_notes ?? savedRisk?.review_notes ?? "").trim();
    if (rs_status !== prevStatus && nextNotes === prevNotes) {
      setResidualErr(e => ({ ...e, [riskId]: "Residual risk status changed — the notes field must be updated to explain the change." }));
      return;
    }
    setResidualErr(e => ({ ...e, [riskId]: "" }));
    setResidualSaving(s => ({ ...s, [riskId]: true }));
    try {
      const editable = await onEnsureEditable();
      const currentRisks = editable?.risks ?? risks;
      if (editable) { onRisksChange(editable.risks); }
      const targetRiskId = editable
        ? (currentRisks.find(r => r.title === (savedRisk?.title ?? ""))?.id ?? riskId)
        : riskId;
      const updated = await api.patchRisk(targetRiskId, {
        residual_status: rs_status,
        residual_likelihood: rl || null,
        residual_severity: rs || null,
        final_risk_level: (rl && rs) ? calcRiskLevel(rs, rl) : null,
        date_of_assessment: d.date_of_assessment || null,
        review_notes: d.review_notes ?? undefined,
      });
      onRisksChange(currentRisks.map(r => r.id === targetRiskId ? { ...r, ...updated, mitigations: r.mitigations } : r));
      setAddResidual(a => ({ ...a, [riskId]: false }));
    } finally {
      setResidualSaving(s => ({ ...s, [riskId]: false }));
    }
  }

  async function saveRegResidual() {
    if (!register) return;
    const prevAcceptable = register.residual_risk_acceptable ?? null;
    const prevArgument = (register.residual_risk_argument ?? "").trim();
    const nextArgument = (regResidualDraft.residual_risk_argument ?? "").trim();
    if (regResidualDraft.residual_risk_acceptable !== prevAcceptable && nextArgument === prevArgument) {
      setRegResidualErr("Residual risk status changed — please update the expert sign-off argument to explain the change.");
      return;
    }
    setRegResidualErr("");
    setRegResidualSaving(true);
    try {
      const editable = await onEnsureEditable();
      const targetRegister = editable?.register ?? register;
      if (editable) { onRisksChange(editable.risks); }
      const d = regResidualDraft;
      const patch: Partial<import("../types").RiskRegister> = {
        residual_risk_acceptable: d.residual_risk_acceptable,
        residual_risk_argument: d.residual_risk_argument,
        residual_severity: d.residual_severity || null,
        residual_likelihood: d.residual_likelihood || null,
        residual_final_risk_level: (d.residual_severity && d.residual_likelihood)
          ? calcRiskLevel(d.residual_severity, d.residual_likelihood)
          : null,
        residual_date_of_identification: d.residual_date_of_identification || null,
      } as Partial<import("../types").RiskRegister>;
      const updated = await api.patchRegister(targetRegister.id, patch);
      onRegisterUpdated(updated);
      setRegResidualSaved(true);
      setTimeout(() => setRegResidualSaved(false), 2000);
    } finally {
      setRegResidualSaving(false);
    }
  }

  async function saveMitigation(riskId: string) {
    const d = mitDraft[riskId] ?? {};
    if (!d.title?.trim()) { setMitErr(e => ({ ...e, [riskId]: "Measure title is required." })); return; }
    if (!d.hierarchy_level) { setMitErr(e => ({ ...e, [riskId]: "Hierarchy level is required." })); return; }
    setMitSaving(s => ({ ...s, [riskId]: true }));
    setMitErr(e => ({ ...e, [riskId]: "" }));
    try {
      const editable = await onEnsureEditable();
      const currentRisks = editable?.risks ?? risks;
      if (editable) { onRisksChange(editable.risks); }
      const targetRiskId = editable ? (currentRisks.find(r => r.title === risks.find(x => x.id === riskId)?.title)?.id ?? riskId) : riskId;
      const risk = currentRisks.find(r => r.id === targetRiskId) ?? risks.find(r => r.id === riskId);
      const mit = await api.addMitigation(targetRiskId, {
        title: d.title ?? "",
        description: d.description ?? "",
        hierarchy_level: d.hierarchy_level ?? "mitigate",
        implementation_guidance: d.implementation_guidance ?? "",
        status: "planned",
        assigned_to: d.assigned_to ?? risk?.risk_owner ?? null,
        due_date: d.due_date ?? null,
        override_notes: "",
      });
      onRisksChange(currentRisks.map(r => r.id === targetRiskId ? { ...r, mitigations: [...r.mitigations, mit] } : r));
      setMitDraft(prev => ({ ...prev, [targetRiskId]: {} }));
      setAddMit(prev => ({ ...prev, [targetRiskId]: false }));
    } finally {
      setMitSaving(s => ({ ...s, [riskId]: false }));
    }
  }

  const INCIDENT_STATUS: Record<string, { bg: string; color: string; label: string }> = {
    open:                { bg: "#ffd5d5", color: "#8b0000", label: "Open" },
    under_investigation: { bg: "#fde8d0", color: "#8b3a00", label: "Under investigation" },
    resolved:            { bg: "#d5f5e3", color: "#1a5c35", label: "Resolved" },
    closed:              { bg: "#f4f4f5", color: "#6b7280", label: "Closed" },
  };

  async function handleApproveSubmit() {
    if (risks.length === 0) { setApproveErr("Cannot approve: at least one risk is required."); setApproveErrModal(true); return; }
    // Gate 1: unacceptable residual → must have a plan task linked via risk_id
    const unacceptableWithoutTask = risks.filter(r => r.residual_status === "unacceptable" && !tasks.some(t => t.risk_id === r.id));
    if (unacceptableWithoutTask.length > 0) {
      setApproveErr(`Cannot approve: the following risks have unacceptable residual risk but no linked action plan task: ${unacceptableWithoutTask.map(r => `"${r.title}"`).join(", ")}.`);
      setApproveErrModal(true);
      return;
    }
    // Gate 2: acceptable residual → every mitigation must have a plan task linked via mitigation_id
    const acceptableRisks = risks.filter(r => r.residual_status === "acceptable");
    const mitsMissingTasks = acceptableRisks.flatMap(r => r.mitigations ?? []).filter(m => !tasks.some(t => t.mitigation_id === m.id));
    if (mitsMissingTasks.length > 0) {
      setApproveErr(`Cannot approve: every mitigation on a risk with acceptable residual must have a plan task. Missing tasks for: ${mitsMissingTasks.map(m => `"${m.title}"`).slice(0, 3).join(", ")}${mitsMissingTasks.length > 3 ? "…" : ""}.`);
      setApproveErrModal(true);
      return;
    }
    setApproveSaving(true);
    setApproveErr("");
    try {
      await onApprove(regResidualDraft.residual_risk_acceptable ?? null, regResidualDraft.residual_risk_argument, registryInfo);
    } catch (e) {
      setApproveErr(String(e));
      setApproveErrModal(true);
    } finally {
      setApproveSaving(false);
    }
  }

  async function handleSaveForLater() {
    if (!register) { onBack(); return; }
    setSavingForLater(true);
    setApproveErr("");
    try {
      const patch: Partial<RiskRegister> = {
        residual_risk_acceptable: regResidualDraft.residual_risk_acceptable,
        residual_risk_argument: regResidualDraft.residual_risk_argument,
        residual_severity: regResidualDraft.residual_severity || null,
        residual_likelihood: regResidualDraft.residual_likelihood || null,
        residual_final_risk_level: (regResidualDraft.residual_severity && regResidualDraft.residual_likelihood)
          ? calcRiskLevel(regResidualDraft.residual_severity, regResidualDraft.residual_likelihood)
          : null,
        residual_date_of_identification: regResidualDraft.residual_date_of_identification || null,
      } as Partial<RiskRegister>;
      await api.patchRegister(register.id, patch);
      onBack();
    } catch (e) {
      setApproveErr(String(e));
      setApproveErrModal(true);
    } finally {
      setSavingForLater(false);
    }
  }

  return (
    <div>
      {/* ── Prohibited + Approved banner ── */}
      {register?.status === "approved" && (() => {
        const isProhibited = registryInfo?.tier === "prohibited";
        const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;
        const lastCompleted = register.last_assessment_completed_at ? new Date(register.last_assessment_completed_at).getTime() : null;
        const isStale = lastCompleted === null || (Date.now() - lastCompleted > SIX_MONTHS_MS);
        const reasons: string[] = [
          ...openTriggers.map(t => t.trigger_reason),
          ...(isStale && openTriggers.length === 0 ? ["Scheduled 6-month review due."] : []),
        ];
        const hasIssues = isProhibited || reasons.length > 0;
        const bg = hasIssues ? "#ffd5d5" : "#d5f5e3";
        const border = hasIssues ? "#f5b8b8" : "#9cdcb8";
        const textColor = hasIssues ? "#8b0000" : "#1a5c35";
        const reasonBorder = hasIssues ? "#f5b8b8" : "#9cdcb8";
        const reasonColor = hasIssues ? "#8b0000" : "#1a5c35";
        return (
          <Card style={{ background: bg, border: `1px solid ${border}`, marginBottom: 20 }}>
            {isProhibited && (
              <div style={{ fontSize: 16, fontWeight: 700, color: textColor, marginBottom: 8 }}>
                PROHIBITED SYSTEM
              </div>
            )}
            <div style={{ fontSize: 16, fontWeight: 700, color: textColor, marginBottom: 8 }}>
              {hasIssues ? "⚠ Approval expired" : "✓ Risk Management approved"}
            </div>
            <div style={{ fontSize: 13, color: textColor }}>
              Approved by <strong>{register.approver_username}</strong> on {register.approved_at ? new Date(register.approved_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}.
            </div>
            {register.residual_risk_acceptable !== null && (
              <div style={{ marginTop: 8, fontSize: 13, color: textColor }}>
                Residual risk: <strong>{register.residual_risk_acceptable ? "Acceptable" : "Not acceptable"}</strong>
              </div>
            )}
            {register.residual_risk_argument && (
              <div style={{ marginTop: 4, fontSize: 12, color: "var(--text)" }}>{register.residual_risk_argument}</div>
            )}
            {(isProhibited || reasons.length > 0) && (
              <div style={{ marginTop: 12, borderTop: `1px solid ${reasonBorder}`, paddingTop: 10 }}>
                {isProhibited && (
                  <div style={{ fontSize: 12, color: reasonColor, marginBottom: 4 }}>• This system is classified as prohibited under the EU AI Act. It must not be deployed under any circumstances.</div>
                )}
                {reasons.map((r, i) => (
                  <div key={i} style={{ fontSize: 12, color: reasonColor, marginBottom: 4 }}>• {r}</div>
                ))}
              </div>
            )}
          </Card>
        );
      })()}

      {/* ── Prohibited banner (draft/non-approved) ── */}
      {registryInfo?.tier === "prohibited" && register?.status !== "approved" && (
        <Card style={{ background: "#ffd5d5", border: "1px solid #f5b8b8", marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#8b0000", marginBottom: 4 }}>PROHIBITED SYSTEM</div>
          <div style={{ fontSize: 13, color: "#8b0000" }}>• This system is classified as prohibited under the EU AI Act. It must not be deployed under any circumstances.</div>
        </Card>
      )}

      {/* ── Reopened banner ── */}
      {register?.status !== "approved" && register?.last_assessment_completed_at && (
        <Card style={{ background: "#fff3c4", border: "1px solid #f6c343", marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#92400e", marginBottom: 4 }}>⚠ Risk Management draft</div>
          <div style={{ fontSize: 13, color: "#92400e" }}>
            A change was made after the last approval. The register must be reviewed and approved before it is considered valid.
          </div>
        </Card>
      )}

      {/* ── Action buttons row ── */}
      {register && (
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <button onClick={() => exportReport(systemName, register, risks)}
            style={{ flex: 1, background: "#1147E9", color: "#fff", border: "none", borderRadius: 6, padding: "10px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            Export Report
          </button>
          <button onClick={onReopen} disabled={reopening}
            style={{ flex: 1, background: reopening ? "#9ca3af" : "#d97706", color: "#fff", border: "none", borderRadius: 6, padding: "10px 8px", fontSize: 13, fontWeight: 700, cursor: reopening ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {reopening ? "Opening…" : "Review Risk Management"}
          </button>
          <button onClick={() => openIncidentModal("free")}
            style={{ flex: 1, background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, padding: "10px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            Report Incident
          </button>
        </div>
      )}

      {/* ── Section: Scope ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#556b82", margin: "0 0 10px", borderBottom: "1px solid #e4e4e7", paddingBottom: 6 }}>
          Risk Management Scope
        </div>
        <Card>
          {registryLoading ? (
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Loading system information…</div>
          ) : registryErr ? (
            <div style={{ fontSize: 13, color: "#dc2626" }}>Could not load registry data: {registryErr}</div>
          ) : registryInfo ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {[
                  { label: "System name",       value: registryInfo.name },
                  { label: "Description",        value: registryInfo.description },
                  { label: "Intended purpose",   value: registryInfo.intended_purpose },
                  { label: "Use case",           value: registryInfo.use_case },
                  { label: "Department",         value: registryInfo.department },
                  { label: "People affected",    value: registryInfo.people_affected },
                  { label: "Decision context",   value: registryInfo.decision_context },
                  { label: "Autonomy level",     value: registryInfo.autonomy_level },
                  { label: "Risk tier",          value: registryInfo.tier },
                  { label: "Lifecycle",          value: registryInfo.lifecycle },
                  { label: "Organisation role",  value: registryInfo.org_role },
                  { label: "Provider",           value: registryInfo.provider },
                  { label: "Organisation",       value: registryInfo.org_name },
                  { label: "Version",            value: registryInfo.version },
                ].filter(row => row.value).map(row => (
                  <tr key={row.label} style={{ borderBottom: "1px solid #f4f4f5" }}>
                    <td style={{ padding: "6px 12px 6px 0", color: "var(--text-secondary)", fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top", width: 180 }}>{row.label}</td>
                    <td style={{ padding: "6px 0", color: "var(--text)" }}>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>
      </div>

      {/* ── Section: Risks ── */}
      <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#556b82", margin: "28px 0 10px", borderBottom: "1px solid #e4e4e7", paddingBottom: 6 }}>
        Identified risks
      </div>

      {risks.length > 0 && risks.map(r => {
        const sc = { bg: SEV_BG[r.severity] ?? "#eef1f4", color: SEV_COLORS[r.severity] ?? "#556b82" };
        const hasMit = r.mitigations.length > 0;
        const hasResidual = !!(r.residual_status && r.residual_status !== "none");
        const trCount = (testReports[r.id] ?? []).length;
        const isExpanded = expandedRisk[r.id] ?? false;
        const isPendingDelete = pendingDeleteRisks.has(r.id);

        const summaryParts: string[] = [];
        if (hasMit) summaryParts.push(`${r.mitigations.length} measure${r.mitigations.length !== 1 ? "s" : ""}`);
        if (hasResidual) summaryParts.push(`residual: ${r.residual_status}${r.residual_severity ? ` (${r.residual_severity}/${r.residual_likelihood})` : ""}`);
        if (trCount > 0) summaryParts.push(`${trCount} test report${trCount !== 1 ? "s" : ""}`);

        return (
          <Card key={r.id} style={{ borderLeft: `3px solid ${isPendingDelete ? "#dc2626" : sc.color}`, padding: 0, marginBottom: 8, background: isPendingDelete ? "#fff5f5" : undefined, opacity: isPendingDelete ? 0.85 : 1 }}>
            {/* Soft-delete banner */}
            {isPendingDelete && (
              <div style={{ background: "#dc2626", color: "#fff", fontSize: 12, fontWeight: 700, padding: "6px 16px", display: "flex", alignItems: "center", gap: 12, borderRadius: "10px 10px 0 0" }}>
                <span>Deleted</span>
                <button onClick={() => confirmDeleteRisk(r.id)}
                  style={{ fontSize: 11, background: "#fff", color: "#dc2626", border: "none", borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontWeight: 700 }}>
                  Confirm delete
                </button>
                <button onClick={() => setPendingDeleteRisks(s => { const n = new Set(s); n.delete(r.id); return n; })}
                  style={{ fontSize: 11, background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,0.5)", borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            )}
            {/* Header row — click anywhere to expand */}
            <div
              onClick={() => setExpandedRisk(e => ({ ...e, [r.id]: !e[r.id] }))}
              style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 16px", cursor: "pointer", userSelect: "none" }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  <span style={{ fontSize: 10, color: "var(--text-secondary)", marginRight: 6 }}>{isExpanded ? "▲" : "▼"}</span>
                  {r.title}
                  {r.status === "confirmed" && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: "#16a34a", fontWeight: 600 }}>✓ confirmed</span>
                  )}
                  {r.status === "dismissed" && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>dismissed</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>{r.category.split(",").map(c => RISK_CATEGORIES.find(x => x.value === c.trim())?.label ?? c.trim()).join(", ")}</span>
                  {r.risk_level_autocalculated && <RiskLevelBadge level={r.risk_level_autocalculated} />}
                  {r.affects_vulnerable_groups && <span style={{ color: "#8b3a00" }}>⚠ vulnerable groups</span>}
                  {r.misuse_scenarios.length > 0 && <span>{r.misuse_scenarios.length} misuse scenario(s)</span>}
                </div>

                {/* ── Validation bar — visible even while the risk is collapsed ── */}
                {r.responsible_role && r.responsible_role.trim() && (() => {
                  const roles: Array<{ role: "engineer" | "officer"; label: string; confirmed: boolean; declined: boolean; email: string | null }> = [];
                  if (roleRequired(r, "engineer")) roles.push({ role: "engineer", label: "AI Engineer", confirmed: r.engineer_confirmed, declined: r.engineer_declined, email: r.engineer_email });
                  if (roleRequired(r, "officer")) roles.push({ role: "officer", label: "Compliance Officer", confirmed: r.officer_confirmed, declined: r.officer_declined, email: r.officer_email });
                  if (roles.length === 0) return null;
                  return (
                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }} onClick={e => e.stopPropagation()}>
                      {roles.map(({ role, label, confirmed, declined, email }) => (
                        <div key={role} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12, padding: "8px 12px", background: confirmed ? "#f0fdf4" : declined ? "#f9fafb" : "#f8fafc", borderRadius: 8, border: `1px solid ${confirmed ? "#bbf7d0" : declined ? "#e5e7eb" : "#e2e8f0"}` }}>
                          <span style={{ fontWeight: 600, minWidth: 140 }}>{label}</span>
                          {email && <span style={{ color: "var(--text-secondary)" }}>{email}</span>}
                          {confirmed && (
                            <>
                              <span style={{ color: "#16a34a", fontWeight: 600 }}>✓ Confirmed</span>
                              <button onClick={() => undoConfirmAsRole(r, role)}
                                style={{ fontSize: 11, padding: "3px 10px", background: "#fff", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", color: "var(--text)" }}>
                                Undo
                              </button>
                            </>
                          )}
                          {declined && !confirmed && (
                            <>
                              <span style={{ color: "var(--text-secondary)" }}>⊘ Abstained</span>
                              <button onClick={() => undoDeclineAsRole(r, role)}
                                style={{ fontSize: 11, padding: "3px 10px", background: "#fff", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", color: "var(--text)" }}>
                                Undo
                              </button>
                            </>
                          )}
                          {r.status === "dismissed" && !confirmed && !declined && (
                            <>
                              <span style={{ color: "var(--text-secondary)" }}>⊘ Dismissed</span>
                              <button onClick={() => undoDismiss(r)}
                                style={{ fontSize: 11, padding: "3px 10px", background: "#fff", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", color: "var(--text)" }}>
                                Undo
                              </button>
                            </>
                          )}
                          {!confirmed && !declined && r.status !== "dismissed" && (
                            <>
                              <button onClick={() => confirmAsRole(r, role)}
                                style={{ fontSize: 11, padding: "3px 10px", background: "#d5f5e3", color: "#1a5c35", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>
                                ✓ Confirm as {label}
                              </button>
                              <button onClick={() => dismissAsRole(r)}
                                style={{ fontSize: 11, padding: "3px 10px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 4, cursor: "pointer" }}>
                                Dismiss
                              </button>
                              <button onClick={() => declineAsRole(r, role)}
                                style={{ fontSize: 11, padding: "3px 10px", background: "var(--bg)", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}>
                                Not my decision
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {summaryParts.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3 }}>
                    {summaryParts.join(" · ")}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                {r.status === "confirmed" ? (
                  <button onClick={() => unconfirmRisk(r)}
                    style={{ fontSize: 11, padding: "4px 10px", background: "#fff", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}>
                    ↩ Undo confirm
                  </button>
                ) : (
                  <button onClick={() => confirmRisk(r)}
                    style={{ fontSize: 11, padding: "4px 10px", background: "#d5f5e3", color: "#1a5c35", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>
                    ✓ Confirm
                  </button>
                )}
                {r.status === "dismissed" ? (
                  <button onClick={() => undoDismiss(r)}
                    style={{ fontSize: 11, padding: "4px 10px", background: "#fff", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}>
                    ↩ Undo dismiss
                  </button>
                ) : (
                  <button onClick={() => dismissRisk(r)}
                    style={{ fontSize: 11, padding: "4px 10px", background: "var(--bg)", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}>
                    Dismiss
                  </button>
                )}
                <button onClick={() => { setExpandedRisk(e => ({ ...e, [r.id]: true })); startEditRisk(r); }}
                  style={{ fontSize: 11, padding: "4px 10px", background: "var(--bg)", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}>
                  Edit
                </button>
                <button onClick={() => removeRisk(r.id)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: isPendingDelete ? "#dc2626" : "var(--text-secondary)", fontSize: 16, padding: "0 2px" }}>×</button>
              </div>
            </div>

            {/* Expandable detail + manage section */}
            {isExpanded && (
              <div style={{ padding: "0 16px 16px", borderTop: "1px solid #f4f4f5" }}>

                {/* ── Inline edit form ── */}
                {editingRiskId === r.id && (() => {
                  const ed = editRiskDraft;
                  const setEd = setEditRiskDraft;
                  return (
                    <div style={{ marginTop: 14, marginBottom: 14, padding: 14, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>Edit risk</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <Label required>Short description</Label>
                          <input value={ed.title} onChange={e => setEd(d => ({ ...d, title: e.target.value }))}
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, background: "#fff", boxSizing: "border-box" }} />
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <Label>Description</Label>
                          <Textarea value={ed.description} onChange={v => setEd(d => ({ ...d, description: v }))} rows={2} placeholder="" />
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <Label required>Impact category</Label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                            {RISK_CATEGORIES.map(cat => {
                              const checked = ed.categories.includes(cat.value);
                              return (
                                <button key={cat.value} type="button"
                                  onClick={() => setEd(d => ({ ...d, categories: checked ? d.categories.filter(c => c !== cat.value) : [...d.categories, cat.value] }))}
                                  style={{ padding: "4px 12px", fontSize: 12, borderRadius: 20, cursor: "pointer", border: `1px solid ${checked ? "var(--brand)" : "var(--border)"}`, background: checked ? "var(--brand)" : "#fff", color: checked ? "#fff" : "var(--text)", fontWeight: checked ? 600 : 400 }}>
                                  {cat.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <Label>Severity</Label>
                          <Select value={ed.severity} onChange={v => setEd(d => ({ ...d, severity: v }))}
                            options={[{ value: "severe", label: "Severe" }, { value: "significant", label: "Significant" }, { value: "moderate", label: "Moderate" }, { value: "minor", label: "Minor" }]} />
                        </div>
                        <div>
                          <Label>Likelihood</Label>
                          <Select value={ed.likelihood} onChange={v => setEd(d => ({ ...d, likelihood: v }))}
                            options={[{ value: "very_likely", label: "Very likely" }, { value: "likely", label: "Likely" }, { value: "possible", label: "Possible" }, { value: "unlikely", label: "Unlikely" }]} />
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <Label>Risk owner</Label>
                          <Input value={ed.risk_owner} onChange={v => setEd(d => ({ ...d, risk_owner: v }))} placeholder="e.g. jane.doe@company.com" />
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <Label>Impact description</Label>
                          <Textarea value={ed.impact} onChange={v => setEd(d => ({ ...d, impact: v }))} rows={2} placeholder="" />
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <Label>Risk validator</Label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                            {[{ value: "ai_engineer", label: "AI Engineer" }, { value: "ai_compliance_officer", label: "Compliance Officer" }].map(opt => {
                              const checked = ed.responsible_role.includes(opt.value);
                              return (
                                <button key={opt.value} type="button"
                                  onClick={() => setEd(d => ({ ...d, responsible_role: checked ? d.responsible_role.filter(r2 => r2 !== opt.value) : [...d.responsible_role, opt.value] }))}
                                  style={{ padding: "4px 12px", fontSize: 12, borderRadius: 20, cursor: "pointer", border: `1px solid ${checked ? "var(--brand)" : "var(--border)"}`, background: checked ? "var(--brand)" : "#fff", color: checked ? "#fff" : "var(--text)", fontWeight: checked ? 600 : 400 }}>
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                          {ed.responsible_role.includes("ai_engineer") && (
                            <div style={{ marginTop: 8 }}>
                              <Label>AI Engineer e-mail</Label>
                              <Input value={ed.engineer_email} onChange={v => setEd(d => ({ ...d, engineer_email: v }))} placeholder="engineer@company.com" />
                            </div>
                          )}
                          {ed.responsible_role.includes("ai_compliance_officer") && (
                            <div style={{ marginTop: 8 }}>
                              <Label>Compliance Officer e-mail</Label>
                              <Input value={ed.officer_email} onChange={v => setEd(d => ({ ...d, officer_email: v }))} placeholder="officer@company.com" />
                            </div>
                          )}
                        </div>
                      </div>
                      {editRiskErr && <div style={{ color: "#dc2626", fontSize: 12, marginTop: 8 }}>{editRiskErr}</div>}
                      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button onClick={saveEditRisk} disabled={editRiskSaving} className="btn-primary btn-sm">{editRiskSaving ? "Saving…" : "Save changes"}</button>
                        <button onClick={() => setEditingRiskId(null)} className="btn-ghost btn-sm">Cancel</button>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Risk details ── */}
                <div style={{ marginTop: 12, marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Risk details</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12 }}>
                    {r.description && (
                      <div style={{ gridColumn: "1 / -1" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Description: </span>{r.description}
                      </div>
                    )}
                    {r.impact && (
                      <div style={{ gridColumn: "1 / -1" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Impact: </span>{r.impact}
                      </div>
                    )}
                    {r.risk_owner && <div><span style={{ color: "var(--text-secondary)" }}>Risk owner: </span>{r.risk_owner}</div>}
                    {r.ai_lifecycle_phase && <div><span style={{ color: "var(--text-secondary)" }}>Lifecycle phase: </span>{r.ai_lifecycle_phase}</div>}
                    {r.responsible_role && <div><span style={{ color: "var(--text-secondary)" }}>Risk validator: </span>{r.responsible_role.split(",").map(v => v === "ai_engineer" ? "AI Engineer" : "Compliance Officer").join(", ")}</div>}
                    {r.deadline && (
                      <div>
                        <span style={{ color: "var(--text-secondary)" }}>Deadline: </span>
                        <span style={{ color: new Date(r.deadline) < new Date() ? "#dc2626" : "inherit" }}>
                          {new Date(r.deadline).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                      </div>
                    )}
                    {r.affects_vulnerable_groups && r.vulnerable_groups && (
                      <div style={{ gridColumn: "1 / -1" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Vulnerable groups: </span>
                        {(() => {
                          try { return (JSON.parse(r.vulnerable_groups) as string[]).join(", "); }
                          catch { return r.vulnerable_groups; }
                        })()}
                      </div>
                    )}
                  </div>
                  {r.misuse_scenarios.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Misuse scenarios</div>
                      {r.misuse_scenarios.map(ms => (
                        <div key={ms.id} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid #f4f4f5" }}>
                          <span style={{ fontWeight: 600 }}>{ms.actor}</span>: {ms.description}
                          {ms.vulnerable_group && <span style={{ marginLeft: 8, fontSize: 11, background: "#fde8d0", color: "#8b3a00", padding: "1px 6px", borderRadius: 8 }}>{ms.vulnerable_group}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Mitigations ── */}
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                    Risk management measures
                  </div>
                  {HIERARCHY_LEVELS.map(level => {
                    const items = r.mitigations.filter(m => m.hierarchy_level === level.value);
                    if (items.length === 0) return null;
                    return (
                      <div key={level.value} style={{ marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, background: level.bg, color: level.color, padding: "2px 8px", borderRadius: 6, textTransform: "uppercase" }}>
                          {level.label}
                        </span>
                        {items.map(m => (
                          <div key={m.id} style={{ fontSize: 12, padding: "5px 0 4px", borderBottom: "1px solid #f4f4f5" }}>
                            <div style={{ fontWeight: 600 }}>{m.title}</div>
                            {m.implementation_guidance && <div style={{ color: "var(--text-secondary)", marginTop: 2 }}><span style={{ fontWeight: 500 }}>Implementation guidance: </span>{m.implementation_guidance}</div>}
                            <div style={{ display: "flex", gap: 12, marginTop: 2, flexWrap: "wrap" }}>
                              {m.assigned_to && <div><span style={{ color: "var(--text-secondary)" }}>Assignee: </span>{m.assigned_to}</div>}
                              {m.due_date && <div><span style={{ color: "var(--text-secondary)" }}>Due date: </span>{m.due_date.slice(0, 10)}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {!addMit[r.id] ? (
                    <button onClick={() => setAddMit(a => ({ ...a, [r.id]: true }))}
                      style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: 6, padding: "6px 14px", border: "none", background: hasMit ? "#f0f4ff" : "var(--brand)", color: hasMit ? "#1147E9" : "#fff" }}>
                      + Add risk management measure
                    </button>
                  ) : (
                    <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <Label required>Hierarchy level</Label>
                        <Select value={mitDraft[r.id]?.hierarchy_level ?? ""}
                          onChange={v => setMitDraft(d => ({ ...d, [r.id]: { ...d[r.id], hierarchy_level: v } }))}
                          options={[{ value: "", label: "Select…" }, ...HIERARCHY_LEVELS.map(l => ({ value: l.value, label: `${l.label} — ${l.desc}` }))]} />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <Label required>Measure title</Label>
                        <Input value={mitDraft[r.id]?.title ?? ""}
                          onChange={v => setMitDraft(d => ({ ...d, [r.id]: { ...d[r.id], title: v } }))}
                          placeholder="e.g. Implement fairness-aware post-processing" />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <Label>Implementation guidance</Label>
                        <Textarea value={mitDraft[r.id]?.implementation_guidance ?? ""}
                          onChange={v => setMitDraft(d => ({ ...d, [r.id]: { ...d[r.id], implementation_guidance: v } }))}
                          rows={2} placeholder="How to implement this measure…" />
                      </div>
                      <div>
                        <Label>Assignee</Label>
                        <Input value={mitDraft[r.id]?.assigned_to ?? r.risk_owner ?? ""}
                          onChange={v => setMitDraft(d => ({ ...d, [r.id]: { ...d[r.id], assigned_to: v } }))}
                          placeholder={r.risk_owner ? `Default: ${r.risk_owner}` : "Person responsible"} />
                      </div>
                      <div>
                        <Label>Due date</Label>
                        <input type="date" value={mitDraft[r.id]?.due_date ?? ""}
                          onChange={e => setMitDraft(d => ({ ...d, [r.id]: { ...d[r.id], due_date: e.target.value } }))}
                          style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, background: "var(--surface)", color: "var(--text)" }} />
                      </div>
                      {mitErr[r.id] && <ErrorMsg msg={mitErr[r.id]} />}
                      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                        <button onClick={() => saveMitigation(r.id)} disabled={mitSaving[r.id]}
                          style={{ fontSize: 12, background: "var(--brand)", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                          {mitSaving[r.id] ? "Saving…" : "Save"}
                        </button>
                        <button onClick={() => setAddMit(a => ({ ...a, [r.id]: false }))}
                          style={{ fontSize: 12, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Residual risk ── */}
                {(() => {
                  const rDraft = residualDraft[r.id] ?? {};
                  const curStatus = rDraft.residual_status ?? r.residual_status ?? "none";
                  const curLikelihood = rDraft.residual_likelihood ?? r.residual_likelihood ?? "";
                  const curSeverity = rDraft.residual_severity ?? r.residual_severity ?? "";
                  const curDate = rDraft.date_of_assessment ?? (r.date_of_assessment ? r.date_of_assessment.substring(0, 10) : "");
                  const curNotes = rDraft.review_notes ?? r.review_notes ?? "";
                  const hasMatrix = curStatus !== "none" && curStatus !== "";
                  const defaults = { residual_status: curStatus, residual_likelihood: curLikelihood, residual_severity: curSeverity, date_of_assessment: curDate, review_notes: curNotes };
                  const setRD = (patch: Partial<typeof rDraft>) =>
                    setResidualDraft(d => ({ ...d, [r.id]: { ...defaults, ...(d[r.id] ?? {}), ...patch } }));

                  const statusColors: Record<string, { bg: string; color: string; label: string }> = {
                    none:          { bg: "#f4f4f5",  color: "#6b7280",  label: "No residual risk" },
                    acceptable:    { bg: "#d5f5e3",  color: "#1a5c35",  label: "Acceptable" },
                    unacceptable:  { bg: "#ffd5d5",  color: "#8b0000",  label: "Not acceptable" },
                  };
                  const sc2 = statusColors[r.residual_status] ?? statusColors.none;

                  return (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f4f4f5" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Residual risk</span>
                        {r.residual_status && r.residual_status !== "none" && (
                          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 8, background: sc2.bg, color: sc2.color }}>{sc2.label}</span>
                        )}
                        {r.final_risk_level && r.residual_status !== "none" && <RiskLevelBadge level={r.final_risk_level} />}
                        {!addResidual[r.id] && (
                          <button onClick={() => setAddResidual(a => ({ ...a, [r.id]: true }))}
                            style={{ fontSize: 11, fontWeight: 600, background: "#f0f4ff", color: "#1147E9", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}>
                            {r.residual_status && r.residual_status !== "none" ? "Edit" : "+ Add residual risk"}
                          </button>
                        )}
                      </div>

                      {/* Summary (read mode) */}
                      {r.residual_status && r.residual_status !== "none" && !addResidual[r.id] && (
                        <div style={{ fontSize: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                          {r.residual_severity && <div><span style={{ color: "var(--text-secondary)" }}>Severity: </span>{r.residual_severity}</div>}
                          {r.residual_likelihood && <div><span style={{ color: "var(--text-secondary)" }}>Likelihood: </span>{r.residual_likelihood}</div>}
                          {r.date_of_assessment && <div><span style={{ color: "var(--text-secondary)" }}>Date of identification: </span>{new Date(r.date_of_assessment).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>}
                          {r.review_notes && <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--text-secondary)" }}>Notes: </span>{r.review_notes}</div>}
                        </div>
                      )}

                      {/* Edit form */}
                      {addResidual[r.id] && (
                        <div>
                          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                            {[
                              { value: "none",         label: "No residual risk",  bg: "#f4f4f5",  color: "#6b7280" },
                              { value: "acceptable",   label: "Acceptable",         bg: "#d5f5e3",  color: "#1a5c35" },
                              { value: "unacceptable", label: "Not acceptable",     bg: "#ffd5d5",  color: "#8b0000" },
                            ].map(opt => (
                              <button key={opt.value} type="button"
                                onClick={() => setRD({ residual_status: opt.value })}
                                style={{
                                  fontSize: 12, padding: "5px 14px", borderRadius: 20, cursor: "pointer", fontWeight: 600,
                                  border: `2px solid ${curStatus === opt.value ? opt.color : "var(--border)"}`,
                                  background: curStatus === opt.value ? opt.bg : "var(--surface)",
                                  color: curStatus === opt.value ? opt.color : "var(--text-secondary)",
                                }}>
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          {hasMatrix && (
                            <>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                <div>
                                  <Label>Severity<InfoTooltip definitions={SEVERITY_DEFINITIONS} /></Label>
                                  <Select value={curSeverity} onChange={v => setRD({ residual_severity: v })}
                                    options={[{ value: "", label: "— select —" }, { value: "severe", label: "Severe" }, { value: "significant", label: "Significant" }, { value: "moderate", label: "Moderate" }, { value: "minor", label: "Minor" }]} />
                                </div>
                                <div>
                                  <Label>Likelihood<InfoTooltip definitions={LIKELIHOOD_DEFINITIONS} /></Label>
                                  <Select value={curLikelihood} onChange={v => setRD({ residual_likelihood: v })}
                                    options={[{ value: "", label: "— select —" }, { value: "very_likely", label: "Very likely" }, { value: "likely", label: "Likely" }, { value: "possible", label: "Possible" }, { value: "unlikely", label: "Unlikely" }]} />
                                </div>
                                <div>
                                  <Label>Date of identification</Label>
                                  <input type="date" value={curDate} onChange={e => setRD({ date_of_assessment: e.target.value })}
                                    style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 13 }} />
                                </div>
                              </div>
                              {curSeverity && curLikelihood && (
                                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontSize: 12 }}>Residual risk level (auto):</span>
                                  <RiskLevelBadge level={calcRiskLevel(curSeverity, curLikelihood)} />
                                </div>
                              )}
                              <div style={{ marginTop: 8 }}>
                                <Label>Notes</Label>
                                <Textarea value={curNotes} onChange={v => setRD({ review_notes: v })}
                                  rows={2} placeholder="Explain the residual risk and why it is / is not acceptable…" />
                              </div>
                            </>
                          )}
                          {residualErr[r.id] && <ErrorMsg msg={residualErr[r.id]} />}
                          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                            <button onClick={() => saveResidual(r.id)} disabled={residualSaving[r.id]}
                              style={{ fontSize: 12, background: "var(--brand)", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                              {residualSaving[r.id] ? "Saving…" : "Save residual risk"}
                            </button>
                            <button onClick={() => setAddResidual(a => ({ ...a, [r.id]: false }))}
                              style={{ fontSize: 12, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── Test reports ── */}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f4f4f5" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Test reports</span>
                    <button onClick={() => setAddTest(a => ({ ...a, [r.id]: !addTest[r.id] }))}
                      style={{ fontSize: 11, fontWeight: 600, background: "#f0f4ff", color: "#1147E9", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}>
                      + Add test report
                    </button>
                  </div>
                  {(testReports[r.id] ?? []).map(tr => (
                    <div key={tr.id} style={{ fontSize: 12, padding: "6px 0", borderBottom: "1px solid #f4f4f5" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 600 }}>{tr.title}</span>
                        {tr.author && <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{tr.author}</span>}
                        <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{new Date(tr.created_at).toLocaleDateString()}</span>
                      </div>
                      {tr.summary && <div style={{ color: "var(--text-secondary)", marginTop: 2 }}>{tr.summary}</div>}
                      {tr.findings && <div style={{ marginTop: 2, fontStyle: "italic", fontSize: 12 }}>{tr.findings}</div>}
                    </div>
                  ))}
                  {trCount === 0 && !addTest[r.id] && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" }}>No test reports yet.</div>
                  )}
                  {addTest[r.id] && (
                    <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <Label required>Title</Label>
                        <Input value={testDraft[r.id]?.title ?? ""}
                          onChange={v => setTestDraft(d => ({ ...d, [r.id]: { ...d[r.id] ?? { summary: "", findings: "", result: "pass", author: "" }, title: v } }))}
                          placeholder="e.g. Fairness audit — Q3 2026" />
                      </div>
                      <div>
                        <Label>Author</Label>
                        <Input value={testDraft[r.id]?.author ?? ""}
                          onChange={v => setTestDraft(d => ({ ...d, [r.id]: { ...d[r.id] ?? { title: "", summary: "", findings: "", result: "pass" }, author: v } }))}
                          placeholder="e.g. jane.doe@company.com" />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <Label required>Summary</Label>
                        <Textarea value={testDraft[r.id]?.summary ?? ""}
                          onChange={v => setTestDraft(d => ({ ...d, [r.id]: { ...d[r.id] ?? { title: "", findings: "", result: "pass", author: "" }, summary: v } }))}
                          rows={2} placeholder="Brief summary of what was tested and how…" />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <Label required>Findings</Label>
                        <Textarea value={testDraft[r.id]?.findings ?? ""}
                          onChange={v => setTestDraft(d => ({ ...d, [r.id]: { ...d[r.id] ?? { title: "", summary: "", result: "pass", author: "" }, findings: v } }))}
                          rows={2} placeholder="What did the test reveal? What actions follow?" />
                      </div>
                      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                        <button onClick={() => saveTestReport(r.id)}
                          disabled={testSaving[r.id] || !testDraft[r.id]?.title?.trim() || !testDraft[r.id]?.summary?.trim() || !testDraft[r.id]?.findings?.trim()}
                          style={{ fontSize: 12, background: "var(--brand)", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                          {testSaving[r.id] ? "Saving…" : "Save test report"}
                        </button>
                        <button onClick={() => setAddTest(a => ({ ...a, [r.id]: false }))}
                          style={{ fontSize: 12, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Tasks ── */}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f4f4f5" }}>
                  {(() => {
                    const riskTasks = tasks.filter(t => t.risk_id === r.id);
                    const td = riskTaskDraft[r.id] ?? {};
                    return (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Tasks</span>
                          {!addRiskTask[r.id] && (
                            <button
                              onClick={() => setAddRiskTask(a => ({ ...a, [r.id]: true }))}
                              style={{ fontSize: 11, fontWeight: 600, background: "#f0f4ff", color: "#1147E9", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}>
                              + Add task
                            </button>
                          )}
                        </div>
                        {riskTasks.length === 0 && !addRiskTask[r.id] && (
                          <div style={{ fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" }}>No tasks yet.</div>
                        )}
                        {riskTasks.map(task => {
                          const sk = taskStatusKey(task);
                          const sc = STATUS_COLORS[sk] ?? STATUS_COLORS.open;
                          return (
                            <div key={task.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0", borderBottom: "1px solid #f4f4f5", fontSize: 12 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontWeight: 600 }}>{task.title}</span>
                                {task.description && <div style={{ color: "var(--text-secondary)", marginTop: 2 }}>{task.description}</div>}
                                {task.assigned_to && <div style={{ color: "var(--text-secondary)", fontSize: 11, marginTop: 2 }}>Assigned to: {task.assigned_to}</div>}
                                {task.due_date && <div style={{ color: "var(--text-secondary)", fontSize: 11 }}>Due: {task.due_date.slice(0, 10)}</div>}
                              </div>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 6, background: sc.bg, color: sc.color, whiteSpace: "nowrap" }}>{sk.replace("_", " ")}</span>
                              <button onClick={() => { setEditingTask(task.id); setEditTaskDraft({ ...task }); }}
                                style={{ fontSize: 11, background: "#f0f4ff", color: "#1147E9", border: "none", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontWeight: 600 }}>Edit</button>
                              <button onClick={() => deleteTask(task.id)}
                                style={{ fontSize: 11, background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer", padding: "0 2px" }}>✕</button>
                            </div>
                          );
                        })}
                        {addRiskTask[r.id] && (
                          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <Label required>Task title</Label>
                              <Input value={td.title ?? ""} onChange={v => setRiskTaskDraft(d => ({ ...d, [r.id]: { ...d[r.id], title: v } }))}
                                placeholder="e.g. Conduct bias audit" />
                            </div>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <Label>Description</Label>
                              <Textarea value={td.description ?? ""} onChange={v => setRiskTaskDraft(d => ({ ...d, [r.id]: { ...d[r.id], description: v } }))}
                                rows={2} placeholder="What needs to be done and why…" />
                            </div>
                            {r.mitigations.length > 0 && (
                              <div style={{ gridColumn: "1 / -1" }}>
                                <Label>Linked measure (optional)</Label>
                                <select value={td.mitigation_id ?? ""} onChange={e => setRiskTaskDraft(d => ({ ...d, [r.id]: { ...d[r.id], mitigation_id: e.target.value || null } }))}
                                  style={{ width: "100%", fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                                  <option value="">— None —</option>
                                  {r.mitigations.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                                </select>
                              </div>
                            )}
                            <div>
                              <Label>Assignee</Label>
                              <Input value={td.assigned_to ?? r.risk_owner ?? ""}
                                onChange={v => setRiskTaskDraft(d => ({ ...d, [r.id]: { ...d[r.id], assigned_to: v } }))}
                                placeholder="Person responsible" />
                            </div>
                            <div>
                              <Label>Due date</Label>
                              <input type="date" value={td.due_date ?? ""}
                                onChange={e => setRiskTaskDraft(d => ({ ...d, [r.id]: { ...d[r.id], due_date: e.target.value } }))}
                                style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, background: "var(--surface)", color: "var(--text)" }} />
                            </div>
                            {riskTaskErr[r.id] && <div style={{ gridColumn: "1 / -1" }}><ErrorMsg msg={riskTaskErr[r.id]} /></div>}
                            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                              <button onClick={() => saveRiskTask(r.id)} disabled={riskTaskSaving[r.id]}
                                style={{ fontSize: 12, background: "var(--brand)", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                                {riskTaskSaving[r.id] ? "Saving…" : "Save task"}
                              </button>
                              <button onClick={() => { setAddRiskTask(a => ({ ...a, [r.id]: false })); setRiskTaskDraft(d => ({ ...d, [r.id]: {} })); setRiskTaskErr(e => ({ ...e, [r.id]: "" })); }}
                                style={{ fontSize: 12, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* ── Incidents ── */}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f4f4f5" }}>
                  {(() => {
                    const riskIncidents = incidents.filter(i => i.risk_id === r.id);
                    const id_ = riskIncidentDraft[r.id] ?? {};
                    return (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Incidents</span>
                          {!addRiskIncident[r.id] && (
                            <button
                              onClick={() => setAddRiskIncident(a => ({ ...a, [r.id]: true }))}
                              style={{ fontSize: 11, fontWeight: 600, background: "#fff0f0", color: "#dc2626", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}>
                              + Add incident
                            </button>
                          )}
                        </div>
                        {riskIncidents.length === 0 && !addRiskIncident[r.id] && (
                          <div style={{ fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" }}>No incidents reported.</div>
                        )}
                        {riskIncidents.map(inc => {
                          const isc = INCIDENT_STATUS[inc.status] ?? INCIDENT_STATUS.open;
                          return (
                            <div key={inc.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0", borderBottom: "1px solid #f4f4f5", fontSize: 12 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontWeight: 600 }}>{inc.title}</span>
                                {inc.description && <div style={{ color: "var(--text-secondary)", marginTop: 2 }}>{inc.description}</div>}
                                {inc.reported_by && <div style={{ color: "var(--text-secondary)", fontSize: 11, marginTop: 2 }}>Reported by: {inc.reported_by}</div>}
                                {inc.occurred_at && <div style={{ color: "var(--text-secondary)", fontSize: 11 }}>{inc.occurred_at.slice(0, 10)}</div>}
                              </div>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 6, background: isc.bg, color: isc.color, whiteSpace: "nowrap" }}>{isc.label}</span>
                              <button onClick={() => { setEditingIncident(inc.id); setEditIncidentDraft({ ...inc }); }}
                                style={{ fontSize: 11, background: "#f0f4ff", color: "#1147E9", border: "none", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontWeight: 600 }}>Edit</button>
                              <button onClick={() => deleteIncident(inc.id)}
                                style={{ fontSize: 11, background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer", padding: "0 2px" }}>✕</button>
                            </div>
                          );
                        })}
                        {addRiskIncident[r.id] && (
                          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <Label required>Incident title</Label>
                              <Input value={id_.title ?? ""} onChange={v => setRiskIncidentDraft(d => ({ ...d, [r.id]: { ...d[r.id], title: v } }))}
                                placeholder="e.g. Biased output causing incorrect decision" />
                            </div>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <Label>Description</Label>
                              <Textarea value={id_.description ?? ""} onChange={v => setRiskIncidentDraft(d => ({ ...d, [r.id]: { ...d[r.id], description: v } }))}
                                rows={2} placeholder="Describe what happened, the impact, and context…" />
                            </div>
                            <div>
                              <Label>Reported by</Label>
                              <Input value={id_.reported_by ?? ""} onChange={v => setRiskIncidentDraft(d => ({ ...d, [r.id]: { ...d[r.id], reported_by: v } }))}
                                placeholder="Username" />
                            </div>
                            <div>
                              <Label>Date occurred</Label>
                              <input type="date" value={id_.occurred_at?.slice(0, 10) ?? ""}
                                onChange={e => setRiskIncidentDraft(d => ({ ...d, [r.id]: { ...d[r.id], occurred_at: e.target.value || null } }))}
                                style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, background: "var(--surface)", color: "var(--text)" }} />
                            </div>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <Label>Attachments / document references</Label>
                              <Textarea value={id_.attachments ?? ""} onChange={v => setRiskIncidentDraft(d => ({ ...d, [r.id]: { ...d[r.id], attachments: v } }))}
                                rows={2} placeholder="List document names or URLs (one per line)…" />
                            </div>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <Label>Status</Label>
                              <select value={id_.status ?? "open"} onChange={e => setRiskIncidentDraft(d => ({ ...d, [r.id]: { ...d[r.id], status: e.target.value } }))}
                                style={{ width: "100%", fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                                <option value="open">Open</option>
                                <option value="under_investigation">Under investigation</option>
                                <option value="resolved">Resolved</option>
                                <option value="closed">Closed</option>
                              </select>
                            </div>
                            {riskIncidentErr[r.id] && <div style={{ gridColumn: "1 / -1" }}><ErrorMsg msg={riskIncidentErr[r.id]} /></div>}
                            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                              <button onClick={() => saveRiskIncident(r.id)} disabled={riskIncidentSaving[r.id]}
                                style={{ fontSize: 12, background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                                {riskIncidentSaving[r.id] ? "Saving…" : "Report incident"}
                              </button>
                              <button onClick={() => { setAddRiskIncident(a => ({ ...a, [r.id]: false })); setRiskIncidentDraft(d => ({ ...d, [r.id]: {} })); setRiskIncidentErr(e => ({ ...e, [r.id]: "" })); }}
                                style={{ fontSize: 12, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

              </div>
            )}
          </Card>
        );
      })}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[
          { key: "risk" as const, label: "+ Add risk" },
          { key: "misuse" as const, label: "+ Add misuse scenario" },
        ].map(btn => (
          <button key={btn.key} onClick={() => openForm(btn.key)}
            style={{
              flex: 1, padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: "pointer",
              border: `1px solid ${activeForm === btn.key ? "var(--brand)" : "var(--border)"}`,
              background: activeForm === btn.key ? "var(--brand)" : "var(--surface)",
              color: activeForm === btn.key ? "#fff" : "var(--text)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
            {btn.label}
          </button>
        ))}
      </div>

      {/* Form: Add risk */}
      {activeForm === "risk" && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Add risk</h3>
            <button
              onClick={() => {
                if (libraryRisks === null && !libraryLoading) {
                  setLibraryLoading(true);
                  api.getRiskLibrary()
                    .then(rs => setLibraryRisks(rs))
                    .catch(() => setLibraryRisks([]))
                    .finally(() => setLibraryLoading(false));
                }
              }}
              style={{
                fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)",
              }}
            >
              {libraryLoading ? "Loading…" : "Import from library"}
            </button>
          </div>

          {/* Library import picker */}
          {(libraryRisks !== null || libraryLoading) && (
            <div style={{ marginBottom: 14, padding: "10px 12px", background: "#f0f4ff", border: "1px solid #c7d7f5", borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1147E9", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Import from Risk Library
              </div>
              {libraryLoading ? (
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Loading library…</div>
              ) : libraryRisks && libraryRisks.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>No risks in the library yet.</div>
              ) : (
                <select
                  defaultValue=""
                  onChange={e => {
                    const r = libraryRisks?.find(r => r.id === e.target.value);
                    if (!r) return;
                    setDraft(d => ({
                      ...d,
                      title: r.title,
                      description: r.description,
                      categories: r.category ? [r.category] : d.categories,
                      severity: r.severity,
                      likelihood: r.likelihood,
                      affects_vulnerable_groups: r.affects_vulnerable_groups,
                      impact: r.suggested_mitigation,
                      library_risk_id: r.id,
                    }));
                    setLibraryRisks(null);
                  }}
                  style={{ width: "100%", border: "1px solid #c7d7f5", borderRadius: 6, padding: "6px 10px", fontSize: 12, background: "#fff", boxSizing: "border-box" }}
                >
                  <option value="">— Select a library risk to pre-fill —</option>
                  {libraryRisks?.map(r => (
                    <option key={r.id} value={r.id}>{r.title}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <Label required>Short description</Label>
              <input value={draft.title}
                onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                placeholder="e.g. Discriminatory outcomes for applicants with employment gaps"
                style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, background: "var(--surface)", color: "var(--text)" }} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Label>Description</Label>
              <Textarea value={draft.description} onChange={v => setDraft(d => ({ ...d, description: v }))} rows={2} placeholder="Describe the risk, its root cause, and potential impact…" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Label>Risk owner<InfoTooltip definitions={[{ value: "risk_owner", label: "Risk owner", desc: "Person accountable for managing this risk: assigns mitigation tasks, sets deadlines, monitors progress, and decides on escalation." }]} /></Label>
              <Input value={draft.risk_owner} onChange={v => setDraft(d => ({ ...d, risk_owner: v }))} placeholder="e.g. jane.doe@company.com" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Label>Potential risk occurrence phase</Label>
              <Select value={draft.ai_lifecycle_phase} onChange={v => setDraft(d => ({ ...d, ai_lifecycle_phase: v }))} options={LIFECYCLE_PHASES} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Label required>Impact category</Label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {RISK_CATEGORIES.map(cat => {
                  const checked = draft.categories.includes(cat.value);
                  return (
                    <button key={cat.value} type="button"
                      onClick={() => setDraft(d => ({
                        ...d,
                        categories: checked
                          ? d.categories.filter(c => c !== cat.value)
                          : [...d.categories, cat.value],
                      }))}
                      style={{
                        padding: "5px 14px", fontSize: 13, borderRadius: 20, cursor: "pointer",
                        border: `1px solid ${checked ? "var(--brand)" : "var(--border)"}`,
                        background: checked ? "var(--brand)" : "var(--surface)",
                        color: checked ? "#fff" : "var(--text)",
                        fontWeight: checked ? 600 : 400,
                        transition: "all 0.1s",
                      }}>
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label>Severity<InfoTooltip definitions={SEVERITY_DEFINITIONS} /></Label>
              <Select value={draft.severity} onChange={v => setDraft(d => ({ ...d, severity: v }))}
                options={[{ value: "severe", label: "Severe" }, { value: "significant", label: "Significant" }, { value: "moderate", label: "Moderate" }, { value: "minor", label: "Minor" }]} />
            </div>
            <div>
              <Label>Likelihood<InfoTooltip definitions={LIKELIHOOD_DEFINITIONS} /></Label>
              <Select value={draft.likelihood} onChange={v => setDraft(d => ({ ...d, likelihood: v }))}
                options={[{ value: "very_likely", label: "Very likely" }, { value: "likely", label: "Likely" }, { value: "possible", label: "Possible" }, { value: "unlikely", label: "Unlikely" }]} />
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Risk level:<InfoTooltip definitions={RISK_LEVEL_DEFINITIONS} /></span>
              <RiskLevelBadge level={calcRiskLevel(draft.severity, draft.likelihood)} />
            </div>
            <div>
              <Label>Risk validator<InfoTooltip definitions={[{ value: "approver_role", label: "Risk validator", desc: "Role responsible for reviewing and confirming that this risk is valid and correctly assessed." }]} /></Label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {[{ value: "ai_engineer", label: "AI Engineer" }, { value: "ai_compliance_officer", label: "Compliance Officer" }].map(opt => {
                  const checked = draft.responsible_role.includes(opt.value);
                  return (
                    <button key={opt.value} type="button"
                      onClick={() => setDraft(d => ({
                        ...d,
                        responsible_role: checked
                          ? d.responsible_role.filter(r => r !== opt.value)
                          : [...d.responsible_role, opt.value],
                      }))}
                      style={{
                        padding: "5px 14px", fontSize: 13, borderRadius: 20, cursor: "pointer",
                        border: `1px solid ${checked ? "var(--brand)" : "var(--border)"}`,
                        background: checked ? "var(--brand)" : "var(--surface)",
                        color: checked ? "#fff" : "var(--text)",
                        fontWeight: checked ? 600 : 400,
                        transition: "all 0.1s",
                      }}>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {draft.responsible_role.includes("ai_engineer") && (
                <div style={{ marginTop: 8 }}>
                  <Label>AI Engineer e-mail</Label>
                  <Input value={draft.engineer_email}
                    onChange={v => setDraft(d => ({ ...d, engineer_email: v }))}
                    placeholder="engineer@company.com" />
                </div>
              )}
              {draft.responsible_role.includes("ai_compliance_officer") && (
                <div style={{ marginTop: 8 }}>
                  <Label>Compliance Officer e-mail</Label>
                  <Input value={draft.officer_email}
                    onChange={v => setDraft(d => ({ ...d, officer_email: v }))}
                    placeholder="officer@company.com" />
                </div>
              )}
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Label>Impact description</Label>
              <Textarea value={draft.impact} onChange={v => setDraft(d => ({ ...d, impact: v }))} rows={2} placeholder="Describe the business, operational, or user impact…" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Label>Vulnerable groups / children</Label>
              <button type="button"
                onClick={() => setDraft(d => ({ ...d, affects_vulnerable_groups: !d.affects_vulnerable_groups }))}
                style={{
                  padding: "5px 14px", fontSize: 13, borderRadius: 20, cursor: "pointer",
                  border: `1px solid ${draft.affects_vulnerable_groups ? "var(--brand)" : "var(--border)"}`,
                  background: draft.affects_vulnerable_groups ? "var(--brand)" : "var(--surface)",
                  color: draft.affects_vulnerable_groups ? "#fff" : "var(--text)",
                  fontWeight: draft.affects_vulnerable_groups ? 600 : 400,
                  transition: "all 0.1s",
                }}>
                ⚠ Affects vulnerable groups or children
              </button>
              {draft.affects_vulnerable_groups && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
                    <Label required>Vulnerable groups affected</Label>
                    <Input value={draft.vulnerable_groups} onChange={v => setDraft(d => ({ ...d, vulnerable_groups: v }))}
                      placeholder="e.g. Children, elderly persons, people with disabilities (comma-separated)" />
                  </div>
                  <div>
                    <Label>Impact on these groups</Label>
                    <Textarea value={draft.vulnerable_group_impact} onChange={v => setDraft(d => ({ ...d, vulnerable_group_impact: v }))}
                      rows={2} placeholder="Describe how the risk specifically impacts these groups…" />
                  </div>
                </div>
              )}
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Label>Date of identification</Label>
              <input type="date" value={draft.date_of_identification} onChange={e => setDraft(d => ({ ...d, date_of_identification: e.target.value }))}
                style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, background: "var(--surface)", color: "var(--text)" }} />
            </div>
          </div>

          {/* ── Risk management measures ── */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f4f4f5" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Risk management measures
              </span>
              {!showDraftMit && (
                <button onClick={() => setShowDraftMit(true)} type="button"
                  style={{ fontSize: 11, fontWeight: 600, background: "#f0f4ff", color: "#1147E9", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}>
                  + Add measure
                </button>
              )}
            </div>
            {draftMitigations.map((m, i) => {
              const level = HIERARCHY_LEVELS.find(l => l.value === m.hierarchy_level);
              return (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, padding: "5px 0", borderBottom: "1px solid #f4f4f5" }}>
                  <div style={{ flex: 1 }}>
                    {level && <span style={{ fontSize: 11, fontWeight: 700, background: level.bg, color: level.color, padding: "2px 8px", borderRadius: 6, textTransform: "uppercase", marginRight: 6 }}>{level.label}</span>}
                    <span style={{ fontWeight: 600 }}>{m.title}</span>
                    {m.implementation_guidance && <div style={{ color: "var(--text-secondary)", marginTop: 2 }}>{m.implementation_guidance}</div>}
                  </div>
                  <button onClick={() => setDraftMitigations(prev => prev.filter((_, idx) => idx !== i))}
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", fontSize: 14, padding: "0 2px" }}>×</button>
                </div>
              );
            })}
            {showDraftMit && (
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Label required>Hierarchy level</Label>
                  <Select value={draftMitDraft.hierarchy_level ?? ""}
                    onChange={v => setDraftMitDraft(d => ({ ...d, hierarchy_level: v }))}
                    options={[{ value: "", label: "Select…" }, ...HIERARCHY_LEVELS.map(l => ({ value: l.value, label: `${l.label} — ${l.desc}` }))]} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Label required>Measure title</Label>
                  <Input value={draftMitDraft.title ?? ""}
                    onChange={v => setDraftMitDraft(d => ({ ...d, title: v }))}
                    placeholder="e.g. Implement fairness-aware post-processing" />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Label>Implementation guidance</Label>
                  <Textarea value={draftMitDraft.implementation_guidance ?? ""}
                    onChange={v => setDraftMitDraft(d => ({ ...d, implementation_guidance: v }))}
                    rows={2} placeholder="How to implement this measure…" />
                </div>
                <div>
                  <Label>Assignee</Label>
                  <Input value={draftMitDraft.assigned_to ?? draft.risk_owner ?? ""}
                    onChange={v => setDraftMitDraft(d => ({ ...d, assigned_to: v }))}
                    placeholder="Person responsible" />
                </div>
                <div>
                  <Label>Due date</Label>
                  <input type="date" value={draftMitDraft.due_date ?? ""}
                    onChange={e => setDraftMitDraft(d => ({ ...d, due_date: e.target.value }))}
                    style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, background: "var(--surface)", color: "var(--text)" }} />
                </div>
                {draftMitErr && <div style={{ gridColumn: "1 / -1" }}><ErrorMsg msg={draftMitErr} /></div>}
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                  <button onClick={() => {
                    if (!draftMitDraft.title?.trim()) { setDraftMitErr("Measure title is required."); return; }
                    if (!draftMitDraft.hierarchy_level) { setDraftMitErr("Hierarchy level is required."); return; }
                    setDraftMitErr("");
                    setDraftMitigations(prev => [...prev, draftMitDraft]);
                    setDraftMitDraft({});
                    setShowDraftMit(false);
                  }} style={{ fontSize: 12, background: "var(--brand)", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                    Add measure
                  </button>
                  <button onClick={() => { setShowDraftMit(false); setDraftMitDraft({}); setDraftMitErr(""); }}
                    style={{ fontSize: 12, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Residual risk ── */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f4f4f5" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Residual risk</span>
              {!showDraftResidual && draft.residual_status === "none" && (
                <button onClick={() => setShowDraftResidual(true)} type="button"
                  style={{ fontSize: 11, fontWeight: 600, background: "#f0f4ff", color: "#1147E9", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}>
                  + Add residual risk
                </button>
              )}
            </div>
            {(showDraftResidual || draft.residual_status !== "none") && (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  {[
                    { value: "none",         label: "No residual risk",  bg: "#f4f4f5",  color: "#6b7280" },
                    { value: "acceptable",   label: "Acceptable",         bg: "#d5f5e3",  color: "#1a5c35" },
                    { value: "unacceptable", label: "Not acceptable",     bg: "#ffd5d5",  color: "#8b0000" },
                  ].map(opt => (
                    <button key={opt.value} type="button"
                      onClick={() => setDraft(d => ({ ...d, residual_status: opt.value }))}
                      style={{
                        fontSize: 12, padding: "5px 14px", borderRadius: 20, cursor: "pointer", fontWeight: 600,
                        border: `2px solid ${draft.residual_status === opt.value ? opt.color : "var(--border)"}`,
                        background: draft.residual_status === opt.value ? opt.bg : "var(--surface)",
                        color: draft.residual_status === opt.value ? opt.color : "var(--text-secondary)",
                      }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {draft.residual_status !== "none" && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <Label>Severity<InfoTooltip definitions={SEVERITY_DEFINITIONS} /></Label>
                        <Select value={draft.residual_severity} onChange={v => setDraft(d => ({ ...d, residual_severity: v }))}
                          options={[{ value: "", label: "— select —" }, { value: "severe", label: "Severe" }, { value: "significant", label: "Significant" }, { value: "moderate", label: "Moderate" }, { value: "minor", label: "Minor" }]} />
                      </div>
                      <div>
                        <Label>Likelihood<InfoTooltip definitions={LIKELIHOOD_DEFINITIONS} /></Label>
                        <Select value={draft.residual_likelihood} onChange={v => setDraft(d => ({ ...d, residual_likelihood: v }))}
                          options={[{ value: "", label: "— select —" }, { value: "very_likely", label: "Very likely" }, { value: "likely", label: "Likely" }, { value: "possible", label: "Possible" }, { value: "unlikely", label: "Unlikely" }]} />
                      </div>
                    </div>
                    {draft.residual_severity && draft.residual_likelihood && (
                      <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12 }}>Residual risk level (auto):</span>
                        <RiskLevelBadge level={calcRiskLevel(draft.residual_severity, draft.residual_likelihood)} />
                      </div>
                    )}
                    <div style={{ marginTop: 8 }}>
                      <Label>Notes</Label>
                      <Textarea value={draft.review_notes} onChange={v => setDraft(d => ({ ...d, review_notes: v }))}
                        rows={2} placeholder="Explain the residual risk and why it is / is not acceptable…" />
                    </div>
                  </>
                )}
                {showDraftResidual && (
                  <div style={{ marginTop: 8 }}>
                    <button onClick={() => setShowDraftResidual(false)} type="button"
                      style={{ fontSize: 12, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                      Done
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Test reports ── */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f4f4f5" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Test reports</span>
              <button onClick={() => setShowDraftTest(s => !s)} type="button"
                style={{ fontSize: 11, fontWeight: 600, background: "#f0f4ff", color: "#1147E9", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}>
                + Add test report
              </button>
            </div>
            {draftTestReports.map((tr, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, padding: "6px 0", borderBottom: "1px solid #f4f4f5" }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600 }}>{tr.title}</span>
                  {tr.author && <span style={{ color: "var(--text-secondary)", fontSize: 11, marginLeft: 8 }}>{tr.author}</span>}
                  {tr.summary && <div style={{ color: "var(--text-secondary)", marginTop: 2 }}>{tr.summary}</div>}
                </div>
                <button onClick={() => setDraftTestReports(prev => prev.filter((_, idx) => idx !== i))}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", fontSize: 14, padding: "0 2px" }}>×</button>
              </div>
            ))}
            {showDraftTest && (
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Label required>Title</Label>
                  <Input value={draftTestDraft.title ?? ""}
                    onChange={v => setDraftTestDraft(d => ({ ...d, title: v }))}
                    placeholder="e.g. Fairness audit — Q3 2026" />
                </div>
                <div>
                  <Label>Author</Label>
                  <Input value={draftTestDraft.author ?? ""}
                    onChange={v => setDraftTestDraft(d => ({ ...d, author: v }))}
                    placeholder="e.g. jane.doe@company.com" />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Label required>Summary</Label>
                  <Textarea value={draftTestDraft.summary ?? ""}
                    onChange={v => setDraftTestDraft(d => ({ ...d, summary: v }))}
                    rows={2} placeholder="Brief summary of what was tested and how…" />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Label required>Findings</Label>
                  <Textarea value={draftTestDraft.findings ?? ""}
                    onChange={v => setDraftTestDraft(d => ({ ...d, findings: v }))}
                    rows={2} placeholder="What did the test reveal? What actions follow?" />
                </div>
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                  <button onClick={() => {
                    if (!draftTestDraft.title?.trim() || !draftTestDraft.summary?.trim() || !draftTestDraft.findings?.trim()) return;
                    setDraftTestReports(prev => [...prev, { ...draftTestDraft, result: draftTestDraft.result ?? "pass" }]);
                    setDraftTestDraft({});
                    setShowDraftTest(false);
                  }}
                    disabled={!draftTestDraft.title?.trim() || !draftTestDraft.summary?.trim() || !draftTestDraft.findings?.trim()}
                    style={{ fontSize: 12, background: "var(--brand)", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                    Add test report
                  </button>
                  <button onClick={() => { setShowDraftTest(false); setDraftTestDraft({}); }}
                    style={{ fontSize: 12, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 14 }}><ErrorMsg msg={err} /></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => addRisk(false)} disabled={saving} className="btn-primary btn-sm">{saving ? "Saving…" : "Save"}</button>
            {!draft.library_risk_id && (
              <button onClick={() => addRisk(true)} disabled={saving} className="btn-secondary btn-sm" title="Save this risk and also add it to the shared Risk Library">
                {saving ? "Saving…" : "Save & upload to library"}
              </button>
            )}
            <button onClick={() => closeForm("risk")} className="btn-ghost btn-sm">Cancel</button>
          </div>
        </Card>
      )}

      {/* Form: Add misuse scenario */}
      {activeForm === "misuse" && (
        <Card>
          <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700 }}>Add misuse scenario</h3>
          {risks.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>Add at least one risk first before adding misuse scenarios.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label required>Linked risk</Label>
                <Select value={msDraft.risk_id} onChange={v => setMsDraft(d => ({ ...d, risk_id: v }))}
                  options={[{ value: "", label: "— select risk —" }, ...risks.map(r => ({ value: r.id, label: r.title })), { value: "other", label: "Other" }]} />
              </div>
              {msDraft.risk_id === "other" && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <Label required>Short description</Label>
                  <Input value={msDraft.risk_title} onChange={v => setMsDraft(d => ({ ...d, risk_title: v }))} placeholder="e.g. Social engineering via AI assistant" />
                </div>
              )}
              <div style={{ gridColumn: "1 / -1" }}>
                <Label required>Description</Label>
                <Textarea value={msDraft.description} onChange={v => setMsDraft(d => ({ ...d, description: v }))} rows={2}
                  placeholder="Describe how this actor could misuse the system…" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label>Impact category</Label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                  {RISK_CATEGORIES.map(cat => {
                    const checked = msDraft.categories.includes(cat.value);
                    return (
                      <button key={cat.value} type="button"
                        onClick={() => setMsDraft(d => ({
                          ...d,
                          categories: checked
                            ? d.categories.filter(c => c !== cat.value)
                            : [...d.categories, cat.value],
                        }))}
                        style={{
                          padding: "5px 14px", fontSize: 13, borderRadius: 20, cursor: "pointer",
                          border: `1px solid ${checked ? "var(--brand)" : "var(--border)"}`,
                          background: checked ? "var(--brand)" : "var(--surface)",
                          color: checked ? "#fff" : "var(--text)",
                          fontWeight: checked ? 600 : 400,
                          transition: "all 0.1s",
                        }}>
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label required>Risk owner<InfoTooltip definitions={[{ value: "risk_owner", label: "Risk owner", desc: "Person accountable for managing this risk: assigns mitigation tasks, sets deadlines, monitors progress, and decides on escalation." }]} /></Label>
                <Input value={msDraft.risk_owner} onChange={v => setMsDraft(d => ({ ...d, risk_owner: v }))} placeholder="e.g. Malicious hiring manager" />
              </div>
              <div>
                <Label>Severity<InfoTooltip definitions={SEVERITY_DEFINITIONS} /></Label>
                <Select value={msDraft.severity} onChange={v => setMsDraft(d => ({ ...d, severity: v }))}
                  options={[{ value: "severe", label: "Severe" }, { value: "significant", label: "Significant" }, { value: "moderate", label: "Moderate" }, { value: "minor", label: "Minor" }]} />
              </div>
              <div>
                <Label>Likelihood<InfoTooltip definitions={LIKELIHOOD_DEFINITIONS} /></Label>
                <Select value={msDraft.likelihood} onChange={v => setMsDraft(d => ({ ...d, likelihood: v }))}
                  options={[{ value: "very_likely", label: "Very likely" }, { value: "likely", label: "Likely" }, { value: "possible", label: "Possible" }, { value: "unlikely", label: "Unlikely" }]} />
              </div>
              <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Risk level:<InfoTooltip definitions={RISK_LEVEL_DEFINITIONS} /></span>
                <RiskLevelBadge level={calcRiskLevel(msDraft.severity, msDraft.likelihood)} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label>Consequence</Label>
                <Input value={msDraft.consequence} onChange={v => setMsDraft(d => ({ ...d, consequence: v }))} placeholder="e.g. Systematic rejection of qualified candidates" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={msDraft.affects_vulnerable_groups}
                    onChange={e => setMsDraft(d => ({ ...d, affects_vulnerable_groups: e.target.checked }))} />
                  <span>Affects vulnerable groups or children</span>
                </label>
                {msDraft.affects_vulnerable_groups && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div>
                      <Label>Vulnerable groups affected</Label>
                      <Input value={msDraft.vulnerable_group} onChange={v => setMsDraft(d => ({ ...d, vulnerable_group: v }))} placeholder="e.g. Pregnant women, people with disabilities" />
                    </div>
                    <div>
                      <Label>Impact on these groups</Label>
                      <Textarea value={msDraft.vulnerable_group_impact} onChange={v => setMsDraft(d => ({ ...d, vulnerable_group_impact: v }))}
                        rows={2} placeholder="Describe how the misuse specifically impacts these groups…" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <ErrorMsg msg={err} />
          {risks.length > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={addMisuseScenario} disabled={saving} className="btn-primary btn-sm">{saving ? "Adding…" : "+ Add scenario"}</button>
              <button onClick={() => closeForm("misuse")} className="btn-ghost btn-sm">Cancel</button>
            </div>
          )}
        </Card>
      )}

      {/* ── Section: Action plan ── */}
      <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#556b82", margin: "28px 0 10px", borderBottom: "1px solid #e4e4e7", paddingBottom: 6 }}>
        Action plan
      </div>

      <Card>
        {(() => {
          const otherTasks = tasks.filter(t => !t.risk_id || !risks.find(r => r.id === t.risk_id));
          const displayedTasks = showAllTasks ? tasks : otherTasks;
          const cardTitle = showAllTasks ? "All tasks" : "Other tasks";
          return (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{cardTitle}</h3>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={() => setShowAllTasks(s => !s)}
                    style={{ fontSize: 12, background: showAllTasks ? "#f4f4f5" : "#f0f4ff", color: showAllTasks ? "#374151" : "#1147E9", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontWeight: 600 }}>
                    {showAllTasks ? "Show other tasks" : "Show all tasks"}
                  </button>
                  {!addingTask && register && (
                    <button onClick={() => setAddingTask(true)}
                      style={{ fontSize: 12, background: "var(--brand)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontWeight: 600 }}>
                      + Add task
                    </button>
                  )}
                </div>
              </div>
              <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--text-secondary)" }}>
                {showAllTasks
                  ? "All tasks for this risk management cycle."
                  : "Tasks not linked to a specific risk, or linked to a risk not in this register."}
              </p>

              {displayedTasks.length === 0 && !addingTask && (
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>No tasks here yet.</p>
              )}

              {displayedTasks.map(task => {
          const sk = taskStatusKey(task);
          const sc = STATUS_COLORS[sk] ?? STATUS_COLORS.open;
          if (editingTask === task.id) {
            return (
              <div key={task.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ padding: "12px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <Label required>Task title</Label>
                      <Input value={editTaskDraft.title ?? ""} onChange={v => setEditTaskDraft(d => ({ ...d, title: v }))} placeholder="e.g. Conduct bias audit" />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <Label>Description</Label>
                      <Textarea value={editTaskDraft.description ?? ""} onChange={v => setEditTaskDraft(d => ({ ...d, description: v }))} rows={2} />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <Label>Linked risk</Label>
                      <select value={editTaskDraft.risk_id ?? ""} onChange={e => setEditTaskDraft(d => ({ ...d, risk_id: e.target.value || null }))}
                        style={{ width: "100%", fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                        <option value="">— None —</option>
                        {risks.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label>Assigned to</Label>
                      <Input value={editTaskDraft.assigned_to ?? ""} onChange={v => setEditTaskDraft(d => ({ ...d, assigned_to: v }))} placeholder="Username" />
                    </div>
                    <div>
                      <Label>Due date</Label>
                      <input type="date" value={editTaskDraft.due_date?.slice(0, 10) ?? ""}
                        onChange={e => setEditTaskDraft(d => ({ ...d, due_date: e.target.value || null }))}
                        style={{ width: "100%", fontSize: 13, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", boxSizing: "border-box" }} />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <Label>Status</Label>
                      <select value={editTaskDraft.status ?? "open"} onChange={e => setEditTaskDraft(d => ({ ...d, status: e.target.value }))}
                        style={{ width: "100%", fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                        <option value="open">Open</option>
                        <option value="in_progress">In progress</option>
                        <option value="done">Done</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => saveEditTask(task.id)} disabled={savingEditTask}
                      style={{ fontSize: 12, background: savingEditTask ? "#9ca3af" : "var(--brand)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", cursor: savingEditTask ? "not-allowed" : "pointer", fontWeight: 600 }}>
                      {savingEditTask ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => { setEditingTask(null); setEditTaskDraft({}); }}
                      style={{ fontSize: 12, background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 16px", cursor: "pointer", color: "var(--text)" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div key={task.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13, background: pendingDeleteTasks.has(task.id) ? "#fff5f5" : undefined, borderRadius: pendingDeleteTasks.has(task.id) ? 6 : undefined, paddingLeft: pendingDeleteTasks.has(task.id) ? 8 : undefined }}>
              {pendingDeleteTasks.has(task.id) ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 600, color: "#dc2626", textDecoration: "line-through", fontSize: 13 }}>{task.title}</span>
                  <span style={{ fontSize: 11, background: "#dc2626", color: "#fff", borderRadius: 4, padding: "2px 8px", fontWeight: 700 }}>Deleted</span>
                  <button onClick={() => confirmDeleteTask(task.id)}
                    style={{ fontSize: 11, background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontWeight: 700 }}>
                    Confirm delete
                  </button>
                  <button onClick={() => setPendingDeleteTasks(s => { const n = new Set(s); n.delete(task.id); return n; })}
                    style={{ fontSize: 11, background: "#f4f4f5", color: "#374151", border: "1px solid var(--border)", borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              ) : (
              <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{task.title}</div>
                {task.description && <div style={{ fontSize: 12, color: "var(--text)", marginBottom: 2 }}>{task.description}</div>}
                <table style={{ fontSize: 11, color: "var(--text-secondary)", borderCollapse: "collapse", marginTop: 2 }}>
                  <tbody>
                    {task.risk_id && riskById[task.risk_id] && (
                      <tr>
                        <td style={{ paddingRight: 8, whiteSpace: "nowrap", fontWeight: 500 }}>Risk</td>
                        <td>{riskById[task.risk_id]}</td>
                      </tr>
                    )}
                    {task.assigned_to && (
                      <tr>
                        <td style={{ paddingRight: 8, whiteSpace: "nowrap", fontWeight: 500 }}>Assigned to</td>
                        <td>{task.assigned_to}</td>
                      </tr>
                    )}
                    {task.due_date && (
                      <tr>
                        <td style={{ paddingRight: 8, whiteSpace: "nowrap", fontWeight: 500 }}>Due date</td>
                        <td>{task.due_date.slice(0, 10)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <select
                value={task.status}
                onChange={e => updateTaskStatus(task.id, e.target.value)}
                style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "none", background: sc.bg, color: sc.color, fontWeight: 600, cursor: "pointer" }}>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
              </select>
              <button onClick={() => { setEditingTask(task.id); setEditTaskDraft({ ...task }); }}
                style={{ fontSize: 11, background: "#f0f4ff", color: "#1147E9", border: "none", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontWeight: 600 }}>
                Edit
              </button>
              <button onClick={() => deleteTask(task.id)}
                style={{ fontSize: 11, background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer", padding: "0 4px" }}>✕</button>
              </>
              )}
            </div>
          );
              })}
            </>
          );
        })()}

        {addingTask && (
          <div style={{ marginTop: 12, padding: "12px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label required>Task title</Label>
                <Input value={taskDraft.title ?? ""} onChange={v => setTaskDraft(d => ({ ...d, title: v }))} placeholder="e.g. Conduct bias audit" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label>Description</Label>
                <Textarea value={taskDraft.description ?? ""} onChange={v => setTaskDraft(d => ({ ...d, description: v }))} rows={2} placeholder="What needs to be done and why…" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label>Linked risk</Label>
                <select
                  value={taskDraft.risk_id ?? ""}
                  onChange={e => setTaskDraft(d => ({ ...d, risk_id: e.target.value || null, mitigation_id: null }))}
                  style={{ width: "100%", fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                  <option value="">— None —</option>
                  {risks.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              </div>
              {taskDraft.risk_id && (() => {
                const riskMits = risks.find(r => r.id === taskDraft.risk_id)?.mitigations ?? [];
                return riskMits.length > 0 ? (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <Label>Linked measure (optional)</Label>
                    <select value={taskDraft.mitigation_id ?? ""} onChange={e => setTaskDraft(d => ({ ...d, mitigation_id: e.target.value || null }))}
                      style={{ width: "100%", fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                      <option value="">— None —</option>
                      {riskMits.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                    </select>
                  </div>
                ) : null;
              })()}
              <div>
                <Label>Assigned to</Label>
                <Input value={taskDraft.assigned_to ?? risks.find(r => r.id === taskDraft.risk_id)?.risk_owner ?? ""}
                  onChange={v => setTaskDraft(d => ({ ...d, assigned_to: v }))} placeholder="Username" />
              </div>
              <div>
                <Label>Due date</Label>
                <input type="date" value={taskDraft.due_date?.slice(0, 10) ?? ""}
                  onChange={e => setTaskDraft(d => ({ ...d, due_date: e.target.value || null }))}
                  style={{ width: "100%", fontSize: 13, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", boxSizing: "border-box" }} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label>Status</Label>
                <select
                  value={taskDraft.status ?? "open"}
                  onChange={e => setTaskDraft(d => ({ ...d, status: e.target.value }))}
                  style={{ width: "100%", fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="done">Done</option>
                </select>
              </div>
            </div>
            {taskErr && <div style={{ marginBottom: 8, fontSize: 12, color: "#dc2626" }}>{taskErr}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={addTask} disabled={savingTask}
                style={{ fontSize: 12, background: savingTask ? "#9ca3af" : "var(--brand)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", cursor: savingTask ? "not-allowed" : "pointer", fontWeight: 600 }}>
                {savingTask ? "Saving…" : "Save task"}
              </button>
              <button onClick={() => { setAddingTask(false); setTaskDraft({}); setTaskErr(""); }}
                style={{ fontSize: 12, background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 16px", cursor: "pointer", color: "var(--text)" }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Section: Review ── */}
      <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#556b82", margin: "28px 0 10px", borderBottom: "1px solid #e4e4e7", paddingBottom: 6 }}>
        Review
      </div>

      <Card>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Reviewer<InfoTooltip definitions={[{ value: "reviewer", label: "Reviewer", desc: "Person responsible for conducting the periodic management review of the entire risk register when it comes due." }]} /></h3>
          {!editingReviewer && reviewer && (
            <button onClick={() => setEditingReviewer(true)}
              style={{ fontSize: 12, background: "#f0f4ff", color: "#1147E9", border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer", fontWeight: 600 }}>
              Edit
            </button>
          )}
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--text-secondary)" }}>
          Designate the person responsible for reviewing this risk management cycle.
        </p>
        {!editingReviewer && reviewer ? (
          <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>{reviewer}</div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="text"
              value={reviewer}
              onChange={e => setReviewer(e.target.value)}
              placeholder="e.g. jane.doe@company.com"
              style={{ flex: 1, fontSize: 13, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
            />
            <button onClick={() => saveReviewer(reviewer)} disabled={savingReviewer}
              style={{ fontSize: 12, background: savingReviewer ? "#9ca3af" : "var(--brand)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: savingReviewer ? "not-allowed" : "pointer", fontWeight: 600 }}>
              {savingReviewer ? "Saving…" : "Save"}
            </button>
            {register?.reviewer_username && (
              <button onClick={() => { setReviewer(register!.reviewer_username!); setEditingReviewer(false); }}
                style={{ fontSize: 12, background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 14px", cursor: "pointer", color: "var(--text-secondary)" }}>
                Cancel
              </button>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Scheduled review date</h3>
          {!editingDate && reviewDate && (
            <button onClick={() => setEditingDate(true)}
              style={{ fontSize: 12, background: "#f0f4ff", color: "#1147E9", border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer", fontWeight: 600 }}>
              Edit
            </button>
          )}
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--text-secondary)" }}>
          Set the date for the next scheduled review of this risk management cycle. Must be within 6 months.
        </p>
        {!editingDate && reviewDate ? (
          <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>
            {new Date(reviewDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input
                type="date"
                value={reviewDate}
                min={todayStr}
                max={maxDateStr}
                onChange={e => { setReviewDate(e.target.value); setReviewDateErr(""); }}
                style={{ fontSize: 13, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
              />
              <button onClick={() => saveReviewDate(reviewDate)} disabled={savingDate}
                style={{ fontSize: 12, background: savingDate ? "#9ca3af" : "var(--brand)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: savingDate ? "not-allowed" : "pointer", fontWeight: 600 }}>
                {savingDate ? "Saving…" : "Save"}
              </button>
              {register?.next_review_date && (
                <button onClick={() => { setReviewDate(register!.next_review_date!.slice(0, 10)); setReviewDateErr(""); setEditingDate(false); }}
                  style={{ fontSize: 12, background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 14px", cursor: "pointer", color: "var(--text-secondary)" }}>
                  Cancel
                </button>
              )}
            </div>
            {reviewDateErr && <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626" }}>{reviewDateErr}</div>}
          </>
        )}
      </Card>

      {/* ── Section: Register-level residual risk ── */}
      <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#556b82", margin: "28px 0 10px", borderBottom: "1px solid #e4e4e7", paddingBottom: 6 }}>
        Overall residual risk
      </div>
      <Card>
        <div style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>Overall residual risk</h3>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
            Overall residual risk for this entire risk register, after all individual risk mitigations have been applied.
          </p>
        </div>

        {/* Status radio */}
        <div style={{ marginBottom: 14 }}>
          <Label>Residual risk status</Label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            {[
              { value: "none",   label: "No residual risk",  bg: "#f4f4f5", color: "#6b7280" },
              { value: "true",   label: "Acceptable",        bg: "#d5f5e3", color: "#1a5c35" },
              { value: "false",  label: "Not acceptable",    bg: "#ffd5d5", color: "#8b0000" },
            ].map(opt => {
              const curVal = regResidualDraft.residual_risk_acceptable === null ? "none"
                           : regResidualDraft.residual_risk_acceptable === true ? "true" : "false";
              const isActive = curVal === opt.value;
              return (
                <button key={opt.value} type="button"
                  onClick={() => {
                    const v = opt.value === "none" ? null : opt.value === "true";
                    setRegResidualDraft(d => ({ ...d, residual_risk_acceptable: v }));
                  }}
                  style={{
                    fontSize: 12, padding: "5px 14px", borderRadius: 20, cursor: "pointer", fontWeight: 600,
                    border: `2px solid ${isActive ? opt.color : "var(--border)"}`,
                    background: isActive ? opt.bg : "var(--surface)",
                    color: isActive ? opt.color : "var(--text-secondary)",
                  }}>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Matrix + date — only when not "no residual risk" */}
        {regResidualDraft.residual_risk_acceptable !== null && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div>
                <Label>Severity<InfoTooltip definitions={SEVERITY_DEFINITIONS} /></Label>
                <Select value={regResidualDraft.residual_severity} onChange={v => setRegResidualDraft(d => ({ ...d, residual_severity: v }))}
                  options={[{ value: "", label: "— select —" }, { value: "severe", label: "Severe" }, { value: "significant", label: "Significant" }, { value: "moderate", label: "Moderate" }, { value: "minor", label: "Minor" }]} />
              </div>
              <div>
                <Label>Likelihood<InfoTooltip definitions={LIKELIHOOD_DEFINITIONS} /></Label>
                <Select value={regResidualDraft.residual_likelihood} onChange={v => setRegResidualDraft(d => ({ ...d, residual_likelihood: v }))}
                  options={[{ value: "", label: "— select —" }, { value: "very_likely", label: "Very likely" }, { value: "likely", label: "Likely" }, { value: "possible", label: "Possible" }, { value: "unlikely", label: "Unlikely" }]} />
              </div>
              <div>
                <Label>Date of identification</Label>
                <input type="date" value={regResidualDraft.residual_date_of_identification}
                  onChange={e => setRegResidualDraft(d => ({ ...d, residual_date_of_identification: e.target.value }))}
                  style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 13 }} />
              </div>
            </div>
            {regResidualDraft.residual_severity && regResidualDraft.residual_likelihood && (
              <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12 }}>Overall residual risk level (auto):</span>
                <RiskLevelBadge level={calcRiskLevel(regResidualDraft.residual_severity, regResidualDraft.residual_likelihood)} />
              </div>
            )}
            <div>
              <Label>Expert sign-off argument</Label>
              <Textarea value={regResidualDraft.residual_risk_argument} onChange={v => setRegResidualDraft(d => ({ ...d, residual_risk_argument: v }))}
                rows={3} placeholder="Describe why the overall residual risk is or is not acceptable: evidence, assumptions, open issues, safeguards in place…" />
            </div>
          </>
        )}

        {regResidualErr && <div style={{ marginBottom: 8, fontSize: 12, color: "#dc2626" }}>{regResidualErr}</div>}
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={saveRegResidual} disabled={regResidualSaving}
            style={{ background: regResidualSaving ? "#9ca3af" : "var(--brand)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: regResidualSaving ? "not-allowed" : "pointer" }}>
            {regResidualSaving ? "Saving…" : "Save"}
          </button>
          {regResidualSaved && <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>Saved ✓</span>}
        </div>
      </Card>

      {/* ── Section: Incidents ── */}
      <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#556b82", margin: "28px 0 10px", borderBottom: "1px solid #e4e4e7", paddingBottom: 6 }}>
        Incidents
      </div>

      <Card>
        {(() => {
          const otherIncidents = incidents.filter(i => !i.risk_id || !risks.find(r => r.id === i.risk_id));
          const displayedIncidents = showAllIncidents ? incidents : otherIncidents;
          const cardTitle = showAllIncidents ? "All incidents" : "Other incidents";
          return (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{cardTitle}</h3>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={() => setShowAllIncidents(s => !s)}
                    style={{ fontSize: 12, background: showAllIncidents ? "#f4f4f5" : "#f0f4ff", color: showAllIncidents ? "#374151" : "#1147E9", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontWeight: 600 }}>
                    {showAllIncidents ? "Show other incidents" : "Show all incidents"}
                  </button>
                  {register && (
                    <button onClick={() => openIncidentModal("other")}
                      style={{ fontSize: 12, background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontWeight: 600 }}>
                      + Report incident
                    </button>
                  )}
                </div>
              </div>
              <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--text-secondary)" }}>
                {showAllIncidents
                  ? "All incidents reported for this risk register."
                  : "Incidents not linked to a specific risk, or linked to a risk not in this register."}
              </p>
              {displayedIncidents.length === 0 && (
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>No incidents reported.</p>
              )}
              {displayedIncidents.map(incident => {
                const isc = INCIDENT_STATUS[incident.status] ?? INCIDENT_STATUS.open;
                const linkedRisk = risks.find(r => r.id === incident.risk_id);
                if (editingIncident === incident.id) {
                  return (
                    <div key={incident.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ padding: "12px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <Label required>Incident title</Label>
                            <Input value={editIncidentDraft.title ?? ""} onChange={v => setEditIncidentDraft(d => ({ ...d, title: v }))} placeholder="e.g. Biased output causing incorrect decision" />
                          </div>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <Label>Description</Label>
                            <Textarea value={editIncidentDraft.description ?? ""} onChange={v => setEditIncidentDraft(d => ({ ...d, description: v }))} rows={3} />
                          </div>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <Label>Linked risk</Label>
                            <select value={editIncidentDraft.risk_id ?? ""} onChange={e => setEditIncidentDraft(d => ({ ...d, risk_id: e.target.value || null }))}
                              style={{ width: "100%", fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                              <option value="">— Other —</option>
                              {risks.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                            </select>
                          </div>
                          <div>
                            <Label>Reported by</Label>
                            <Input value={editIncidentDraft.reported_by ?? ""} onChange={v => setEditIncidentDraft(d => ({ ...d, reported_by: v }))} placeholder="Username" />
                          </div>
                          <div>
                            <Label>Date occurred</Label>
                            <input type="date" value={editIncidentDraft.occurred_at?.slice(0, 10) ?? ""}
                              onChange={e => setEditIncidentDraft(d => ({ ...d, occurred_at: e.target.value || null }))}
                              style={{ width: "100%", fontSize: 13, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", boxSizing: "border-box" }} />
                          </div>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <Label>Attachments / document references</Label>
                            <Textarea value={editIncidentDraft.attachments ?? ""} onChange={v => setEditIncidentDraft(d => ({ ...d, attachments: v }))} rows={2} placeholder="List document names or URLs (one per line)…" />
                          </div>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <Label>Status</Label>
                            <select value={editIncidentDraft.status ?? "open"} onChange={e => setEditIncidentDraft(d => ({ ...d, status: e.target.value }))}
                              style={{ width: "100%", fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                              <option value="open">Open</option>
                              <option value="under_investigation">Under investigation</option>
                              <option value="resolved">Resolved</option>
                              <option value="closed">Closed</option>
                            </select>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => saveEditIncident(incident.id)} disabled={savingEditIncident}
                            style={{ fontSize: 12, background: savingEditIncident ? "#9ca3af" : "var(--brand)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", cursor: savingEditIncident ? "not-allowed" : "pointer", fontWeight: 600 }}>
                            {savingEditIncident ? "Saving…" : "Save"}
                          </button>
                          <button onClick={() => { setEditingIncident(null); setEditIncidentDraft({}); }}
                            style={{ fontSize: 12, background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 16px", cursor: "pointer", color: "var(--text)" }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={incident.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13, background: pendingDeleteIncidents.has(incident.id) ? "#fff5f5" : undefined, borderRadius: pendingDeleteIncidents.has(incident.id) ? 6 : undefined, paddingLeft: pendingDeleteIncidents.has(incident.id) ? 8 : undefined }}>
                    {pendingDeleteIncidents.has(incident.id) ? (
                      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontWeight: 600, color: "#dc2626", textDecoration: "line-through", fontSize: 13 }}>{incident.title}</span>
                        <span style={{ fontSize: 11, background: "#dc2626", color: "#fff", borderRadius: 4, padding: "2px 8px", fontWeight: 700 }}>Deleted</span>
                        <button onClick={() => confirmDeleteIncident(incident.id)}
                          style={{ fontSize: 11, background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontWeight: 700 }}>
                          Confirm delete
                        </button>
                        <button onClick={() => setPendingDeleteIncidents(s => { const n = new Set(s); n.delete(incident.id); return n; })}
                          style={{ fontSize: 11, background: "#f4f4f5", color: "#374151", border: "1px solid var(--border)", borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                    <>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>{incident.title}</div>
                      {incident.description && <div style={{ fontSize: 12, color: "var(--text)", marginBottom: 2 }}>{incident.description}</div>}
                      <table style={{ fontSize: 11, color: "var(--text-secondary)", borderCollapse: "collapse", marginTop: 2 }}>
                        <tbody>
                          {linkedRisk && (
                            <tr>
                              <td style={{ paddingRight: 8, whiteSpace: "nowrap", fontWeight: 500 }}>Risk</td>
                              <td>{linkedRisk.title}</td>
                            </tr>
                          )}
                          {incident.reported_by && (
                            <tr>
                              <td style={{ paddingRight: 8, whiteSpace: "nowrap", fontWeight: 500 }}>Reported by</td>
                              <td>{incident.reported_by}</td>
                            </tr>
                          )}
                          {incident.occurred_at && (
                            <tr>
                              <td style={{ paddingRight: 8, whiteSpace: "nowrap", fontWeight: 500 }}>Date occurred</td>
                              <td>{incident.occurred_at.slice(0, 10)}</td>
                            </tr>
                          )}
                          {incident.attachments && (
                            <tr>
                              <td style={{ paddingRight: 8, whiteSpace: "nowrap", fontWeight: 500 }}>Attachments</td>
                              <td style={{ whiteSpace: "pre-wrap" }}>{incident.attachments}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: isc.bg, color: isc.color, whiteSpace: "nowrap" }}>{isc.label}</span>
                    <button onClick={() => { setEditingIncident(incident.id); setEditIncidentDraft({ ...incident }); }}
                      style={{ fontSize: 11, background: "#f0f4ff", color: "#1147E9", border: "none", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontWeight: 600 }}>
                      Edit
                    </button>
                    <button onClick={() => deleteIncident(incident.id)}
                      style={{ fontSize: 11, background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer", padding: "0 4px" }}>✕</button>
                    </>
                    )}
                  </div>
                );
              })}
            </>
          );
        })()}
      </Card>

      {/* ── Approve / Review Risk Management ── */}
      {register?.status !== "approved" ? (
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <button onClick={handleApproveSubmit} disabled={approveSaving}
            style={{ background: approveSaving ? "#9ca3af" : "#1147E9", color: "#fff", border: "none", borderRadius: 6, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: approveSaving ? "not-allowed" : "pointer" }}>
            {approveSaving ? "Approving…" : "Approve"}
          </button>
          <button onClick={handleSaveForLater} disabled={savingForLater}
            title="Save your progress and return to the systems list without approving this cycle"
            style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: savingForLater ? "not-allowed" : "pointer" }}>
            {savingForLater ? "Saving…" : "Save for later"}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 24 }}>
          <button onClick={onReopen} disabled={reopening}
            style={{ background: reopening ? "#9ca3af" : "#d97706", color: "#fff", border: "none", borderRadius: 6, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: reopening ? "not-allowed" : "pointer" }}>
            {reopening ? "Opening…" : "Review Risk Management"}
          </button>
        </div>
      )}

      {/* ── Incident modal ── */}
      {incidentModal !== null && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={e => { if (e.target === e.currentTarget) closeIncidentModal(); }}>
          <div style={{
            background: "var(--surface)", borderRadius: 12, boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
            padding: "24px 28px", width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Report incident</h3>
              <button onClick={closeIncidentModal} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--text-secondary)", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label required>Incident title</Label>
                <Input value={incidentDraft.title ?? ""} onChange={v => setIncidentDraft(d => ({ ...d, title: v }))} placeholder="e.g. Biased output causing incorrect decision" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label>Description</Label>
                <Textarea value={incidentDraft.description ?? ""} onChange={v => setIncidentDraft(d => ({ ...d, description: v }))} rows={3} placeholder="Describe what happened, the impact, and context…" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label>Linked risk</Label>
                {incidentModal !== "free" ? (
                  <div style={{
                    width: "100%", fontSize: 13, padding: "7px 10px", borderRadius: 6,
                    border: "1px solid var(--border)", background: "#f4f4f5", color: "var(--text-secondary)",
                    boxSizing: "border-box",
                  }}>
                    {incidentModal === "other"
                      ? "— Other —"
                      : (risks.find(r => r.id === incidentModal)?.title ?? incidentModal)}
                  </div>
                ) : (
                  <select
                    value={incidentDraft.risk_id ?? ""}
                    onChange={e => setIncidentDraft(d => ({ ...d, risk_id: e.target.value || null }))}
                    style={{ width: "100%", fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                    <option value="">— Other —</option>
                    {risks.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                  </select>
                )}
              </div>
              <div>
                <Label>Reported by</Label>
                <Input value={incidentDraft.reported_by ?? ""} onChange={v => setIncidentDraft(d => ({ ...d, reported_by: v }))} placeholder="Username" />
              </div>
              <div>
                <Label>Date occurred</Label>
                <input type="date" value={incidentDraft.occurred_at?.slice(0, 10) ?? ""}
                  onChange={e => setIncidentDraft(d => ({ ...d, occurred_at: e.target.value || null }))}
                  style={{ width: "100%", fontSize: 13, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", boxSizing: "border-box" }} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label>Attachments / document references</Label>
                <Textarea value={incidentDraft.attachments ?? ""} onChange={v => setIncidentDraft(d => ({ ...d, attachments: v }))} rows={2} placeholder="List document names or URLs (one per line)…" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label>Status</Label>
                <select value={incidentDraft.status ?? "open"} onChange={e => setIncidentDraft(d => ({ ...d, status: e.target.value }))}
                  style={{ width: "100%", fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                  <option value="open">Open</option>
                  <option value="under_investigation">Under investigation</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
            {incidentErr && <div style={{ marginTop: 8, fontSize: 12, color: "#dc2626" }}>{incidentErr}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={addIncident} disabled={savingIncident}
                style={{ fontSize: 13, background: savingIncident ? "#9ca3af" : "#dc2626", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", cursor: savingIncident ? "not-allowed" : "pointer", fontWeight: 600 }}>
                {savingIncident ? "Saving…" : "Report incident"}
              </button>
              <button onClick={closeIncidentModal}
                style={{ fontSize: 13, background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 20px", cursor: "pointer", color: "var(--text)" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Approval error modal ── */}
      {approveErrModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1100,
          background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setApproveErrModal(false)}>
          <div style={{
            background: "var(--surface)", borderRadius: 12, boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
            padding: "24px 28px", width: "100%", maxWidth: 480,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#8b0000" }}>Cannot approve register</h3>
              <button onClick={() => setApproveErrModal(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--text-secondary)", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ fontSize: 13, color: "#374151", background: "#ffd5d5", borderRadius: 6, padding: "10px 14px" }}>{approveErr}</div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setApproveErrModal(false)}
                style={{ fontSize: 13, background: "#1147E9", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", cursor: "pointer", fontWeight: 600 }}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation modal ── */}
      {deleteModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: "28px 32px", maxWidth: 400, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Confirm deletion</div>
            <div style={{ fontSize: 14, color: "#374151", marginBottom: 24 }}>{deleteModal.label}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setDeleteModal(null)}
                style={{ padding: "8px 18px", borderRadius: 6, border: "1px solid var(--border)", background: "#fff", cursor: "pointer", fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={() => { deleteModal.onConfirm(); setDeleteModal(null); }}
                style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "#dc2626", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
// ── Archived register summary card ───────────────────────────────────────────
function ArchivedRegisterCard({ reg, systemName, nextRegisterId }: { reg: RiskRegister; systemName: string; nextRegisterId: string | null }) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<import("../types").RegisterDiff | null>(null);
  const confirmed = reg.risks.filter(r => r.status === "confirmed");
  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  useEffect(() => {
    if (!nextRegisterId) return;
    api.getRegisterDiff(nextRegisterId).then(setDiff).catch(() => {});
  }, [reg.id, nextRegisterId]);

  // Build sets for quick lookup
  const removedInNext = new Set(diff?.removed ?? []);
  const changedInNext = new Map((diff?.changed ?? []).map(c => [c.title, c]));
  const hasChanges = (diff?.added.length ?? 0) > 0 || (diff?.removed.length ?? 0) > 0 || (diff?.changed.length ?? 0) > 0;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, marginBottom: 12, overflow: "hidden", opacity: 0.85 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", background: "var(--bg)", cursor: "pointer" }}
        onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>v{reg.id}</span>
        <span style={{ fontSize: 11, background: "#d5f5e3", color: "#1a5c35", padding: "2px 8px", borderRadius: 8, fontWeight: 600 }}>
          ✓ APPROVED
        </span>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          Approved: {fmtDate(reg.approved_at)} · {confirmed.length} risk(s) · {confirmed.reduce((a, r) => a + r.mitigations.length, 0)} measure(s)
        </span>
        {reg.residual_risk_acceptable !== null && (
          <span style={{ fontSize: 11, color: reg.residual_risk_acceptable ? "#1a5c35" : "#8b0000", fontWeight: 600 }}>
            Residual: {reg.residual_risk_acceptable ? "Acceptable" : "Not acceptable"}
          </span>
        )}
        {nextRegisterId && hasChanges && (() => {
          const n = (diff?.added.length ?? 0) + (diff?.removed.length ?? 0) + (diff?.changed.length ?? 0);
          return (
            <span style={{ fontSize: 10, background: "#fde8d0", color: "#7a3000", padding: "2px 9px", borderRadius: 8, fontWeight: 600, marginLeft: 4 }}>
              {n} {n === 1 ? "change was" : "changes were"} made
            </span>
          );
        })()}
        <button
          onClick={e => { e.stopPropagation(); exportReport(systemName, reg, reg.risks, true, nextRegisterId).catch(err => alert("Export failed: " + err)); }}
          style={{ marginLeft: "auto", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
        >
          📄 Export
        </button>
        <span style={{ color: "var(--text-secondary)" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 12, color: "var(--text)", marginBottom: 10 }}>
            <strong>Scope:</strong> {reg.assessment_scope || "—"}
          </div>
          {confirmed.map(r => {
            const wasRemoved = removedInNext.has(r.title);
            const entry = changedInNext.get(r.title);
            const hasFieldChanges = entry && (entry.fields.length > 0 || entry.mitigations_added.length > 0 || entry.mitigations_removed.length > 0);
            return (
              <div key={r.id} style={{
                padding: "8px 10px",
                borderBottom: "1px solid #f4f4f5",
                fontSize: 12,
                borderRadius: 4,
                marginBottom: 2,
                background: wasRemoved ? "#fff0f0" : hasFieldChanges ? "#fffbeb" : "transparent",
                borderLeft: wasRemoved ? "3px solid #f87171" : hasFieldChanges ? "3px solid #fbbf24" : "none",
              }}>
                <div style={{ fontWeight: 600, marginBottom: hasFieldChanges ? 4 : 0 }}>
                  {r.title}
                  <span style={{ marginLeft: 8, fontWeight: 400, color: "var(--text-secondary)" }}>{r.category.split(",").map(c => RISK_CATEGORIES.find(x => x.value === c.trim())?.label ?? c.trim()).join(", ")} · {r.severity}</span>
                  {wasRemoved && <span style={{ marginLeft: 8, fontSize: 11, color: "#8b0000", fontWeight: 600 }}>removed in next version</span>}
                  {r.mitigations.length > 0 && <span style={{ marginLeft: 8, color: "#1a5c35", fontWeight: 400 }}>{r.mitigations.length} measure(s)</span>}
                </div>
                {hasFieldChanges && entry && (
                  <table style={{ fontSize: 11, color: "var(--text-secondary)", borderCollapse: "collapse", marginTop: 2 }}>
                    <tbody>
                      {entry.fields.map(fc => (
                        <tr key={fc.field}>
                          <td style={{ paddingRight: 8, whiteSpace: "nowrap", fontWeight: 500, color: "#7a5900" }}>{fc.field}</td>
                          <td style={{ paddingRight: 6, color: "#8b0000", textDecoration: "line-through" }}>{fc.from_value}</td>
                          <td style={{ color: "#1a5c35" }}>→ {fc.to_value}</td>
                        </tr>
                      ))}
                      {entry.mitigations_added.map(t => (
                        <tr key={"a-" + t}>
                          <td style={{ paddingRight: 8, whiteSpace: "nowrap", fontWeight: 500, color: "#1a5c35" }}>Mitigation added</td>
                          <td colSpan={2} style={{ color: "#1a5c35" }}>{t}</td>
                        </tr>
                      ))}
                      {entry.mitigations_removed.map(t => (
                        <tr key={"r-" + t}>
                          <td style={{ paddingRight: 8, whiteSpace: "nowrap", fontWeight: 500, color: "#8b0000" }}>Mitigation removed</td>
                          <td colSpan={2} style={{ color: "#8b0000", textDecoration: "line-through" }}>{t}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
          {/* Risks added in the next cycle (present in next but not here) */}
          {nextRegisterId && (diff?.added.length ?? 0) > 0 && (
            <div style={{ marginTop: 8 }}>
              {diff!.added.map(title => (
                <div key={title} style={{
                  padding: "8px 10px", borderBottom: "1px solid #f4f4f5", fontSize: 12, borderRadius: 4, marginBottom: 2,
                  background: "#f0faf4", borderLeft: "3px solid #6ee7b7", color: "#374151",
                }}>
                  <span style={{ fontWeight: 600 }}>{title}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: "#1a5c35", fontWeight: 600 }}>added in next cycle</span>
                </div>
              ))}
            </div>
          )}
          {reg.residual_risk_argument && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text)" }}>
              <strong>Residual risk argument:</strong> {reg.residual_risk_argument}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────
export default function AssessmentWizardPage({ systemId, systemName, onBack, prefillRisk }: {
  systemId: string;
  systemName: string;
  onBack: () => void;
  prefillRisk?: Partial<DraftRisk>;
}) {
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
        }
      })
      .catch(() => { /* start fresh */ })
      .finally(() => setLoading(false));
  }, [systemId]);

  async function handleApprove(acceptable: boolean | null, argument: string, registryInfo?: import("../types").RegistrySystemInfo | null) {
    if (!register) return;
    const updated = await api.approveRegister(register.id, {
      residual_risk_acceptable: acceptable ?? undefined,
      residual_risk_argument: argument,
      registry_snapshot: registryInfo ? JSON.stringify(registryInfo) : undefined,
    });
    setRegister(updated);
  }

  async function handleReopen() {
    if (!register) return;
    setReopening(true);
    setErr("");
    try {
      const { new_register_id } = await api.cloneRegister(register.id);
      const allRegs = await api.getRegisters(systemId);
      const newActive = allRegs.find(r => r.id === new_register_id) ?? allRegs.find(r => r.status !== "archived");
      const archived = allRegs.filter(r => r.status === "archived").sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setArchivedRegisters(archived);
      if (newActive) {
        setRegister(newActive);
        setRisks(newActive.risks);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setReopening(false);
    }
  }

  async function handleEnsureEditable() {
    if (!register) {
      const created = await api.createRegister(systemId, {});
      setRegister(created);
      setRisks(created.risks);
      return { register: created, risks: created.risks };
    }
    if (register.status !== "approved") return null;
    const { new_register_id } = await api.cloneRegister(register.id);
    const allRegs = await api.getRegisters(systemId);
    const newActive = allRegs.find(r => r.id === new_register_id) ?? allRegs.find(r => r.status !== "archived");
    const archived = allRegs.filter(r => r.status === "archived").sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    setArchivedRegisters(archived);
    if (newActive) {
      setRegister(newActive);
      setRisks(newActive.risks);
      return { register: newActive, risks: newActive.risks };
    }
    return null;
  }

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, gap: 12, color: "var(--text-secondary)", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <span style={{ width: 20, height: 20, border: "2px solid #1147E9", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
      Loading…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", maxWidth: 900, margin: "0 auto", padding: "24px 20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button onClick={onBack}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "#1147E9", fontSize: 13, padding: 0 }}>
          ← All systems
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text)" }}>
            Risk Management — {systemName}
          </h1>
        </div>
        {register && (
          <span style={{ fontSize: 11, background: "var(--bg)", color: "var(--text-secondary)", padding: "4px 10px", borderRadius: 8 }}>
            {register.id} · {register.status}
          </span>
        )}
      </div>

      {err && <ErrorMsg msg={err} />}

      <IdentifyStep
        register={register}
        risks={risks}
        onRisksChange={setRisks}
        onRegisterUpdated={setRegister}
        onApprove={handleApprove}
        onReopen={handleReopen}
        reopening={reopening}
        onEnsureEditable={handleEnsureEditable}
        systemName={systemName}
        systemId={systemId}
        prefillRisk={prefillRisk}
        onBack={onBack}
      />

      {/* Previous cycles */}
      {archivedRegisters.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12, borderTop: "1px solid var(--border)", paddingTop: 20 }}>
            Previous cycles ({archivedRegisters.length})
          </div>
          {archivedRegisters.map((r, i) => {
            const nextId = i === 0 ? (register?.id ?? null) : archivedRegisters[i - 1].id;
            return <ArchivedRegisterCard key={r.id} reg={r} systemName={systemName} nextRegisterId={nextId} />;
          })}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
