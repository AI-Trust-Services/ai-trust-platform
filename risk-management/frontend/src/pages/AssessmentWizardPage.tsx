import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import type { RiskRegister, RiskEntry, MisuseScenario, MitigationMeasure, TestReport, PlanTask, WizardStep } from "../types";

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "scope",    label: "1. Scope" },
  { key: "identify", label: "2. Identify" },
  { key: "evaluate", label: "3. Evaluate" },
  { key: "mitigate", label: "4. Manage risks" },
  { key: "plan",     label: "5. Plan" },
  { key: "approve",  label: "6. Approve" },
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
      {children}{required && <span style={{ color: "#dc2626" }}> *</span>}
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

async function exportReport(systemName: string, register: RiskRegister, risks: RiskEntry[], archived = false, nextRegisterId: string | null = null) {
  const confirmed = risks.filter(r => r.status === "confirmed");
  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const levelBadge = (l?: string | null) => {
    const colors: Record<string, string> = { critical: "#ffd5d5", high: "#fde8d0", medium: "#fff3c4", low: "#d5f5e3" };
    return l ? `<span style="background:${colors[l] ?? "#eef1f4"};padding:2px 8px;border-radius:10px;font-weight:700;font-size:11px;text-transform:uppercase">${l}</span>` : "—";
  };
  const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "—";
  const np = (s: string | null | undefined) => s?.trim() ? s : `<span style="color:#9ca3af;font-style:italic">Not provided</span>`;

  // Fetch plan tasks and incidents for the register
  let planTasks: PlanTask[] = [];
  let incidents: import("../types").Incident[] = [];
  try { planTasks = await api.getPlanTasks(register.id); } catch { /* ignore */ }
  try { incidents = await api.getIncidents(register.id); } catch { /* ignore */ }

  // For archived reports: fetch diff against next version to mark changed fields
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

  const changedBadge = `<span style="background:#ffd5d5;color:#8b0000;font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px;margin-left:6px;text-transform:uppercase">changed in the next version</span>`;

  const risksHtml = confirmed.map((r, idx) => {
    const isRemovedInNext = diffRemovedInNext.has(r.title);
    const entry = diffChangedInNext.get(r.title);
    const hasChanges = entry && ((entry.fields ?? []).length > 0 || (entry.mitigations_added ?? []).length > 0 || (entry.mitigations_removed ?? []).length > 0);
    const riskBorderStyle = isRemovedInNext
      ? "border:2px solid #f87171;background:#fff5f5"
      : hasChanges
        ? "border:2px solid #fbbf24;background:#fffbeb"
        : "border:1px solid #e4e4e7";
    const removedBanner = isRemovedInNext
      ? `<div style="background:#ffd5d5;color:#8b0000;font-size:11px;font-weight:700;padding:6px 10px;border-radius:4px;margin-bottom:10px">⚠ REMOVED IN NEXT VERSION — this risk was not carried forward to the next cycle</div>`
      : "";
    const changesBanner = hasChanges && entry
      ? `<div style="background:#fff3c4;color:#7a5900;font-size:11px;padding:6px 10px;border-radius:4px;margin-bottom:10px">
          <div style="font-weight:700;margin-bottom:4px">⚠ CHANGED IN NEXT VERSION</div>
          <table style="border-collapse:collapse;font-size:11px">
            ${(entry.fields ?? []).map(fc => `<tr>
              <td style="padding:1px 8px 1px 0;font-weight:600;white-space:nowrap">${fc.field}</td>
              <td style="padding:1px 6px 1px 0;text-decoration:line-through;color:#8b0000">${fc.from_value}</td>
              <td style="padding:1px 0;color:#1a5c35">→ ${fc.to_value}</td>
            </tr>`).join("")}
            ${(entry.mitigations_added ?? []).map(t => `<tr>
              <td style="padding:1px 8px 1px 0;font-weight:600;white-space:nowrap;color:#1a5c35">Mitigation added</td>
              <td colspan="2" style="padding:1px 0;color:#1a5c35">${t}</td>
            </tr>`).join("")}
            ${(entry.mitigations_removed ?? []).map(t => `<tr>
              <td style="padding:1px 8px 1px 0;font-weight:600;white-space:nowrap;color:#8b0000">Mitigation removed</td>
              <td colspan="2" style="padding:1px 0;text-decoration:line-through;color:#8b0000">${t}</td>
            </tr>`).join("")}
          </table>
        </div>`
      : "";
    return `
    <div style="${riskBorderStyle};border-radius:8px;padding:18px 20px;margin-bottom:16px;page-break-inside:avoid">
      ${removedBanner}${changesBanner}
      <div style="font-weight:700;font-size:15px;margin-bottom:10px">${idx + 1}. ${r.title}${isRemovedInNext || hasChanges ? changedBadge : ""}</div>

      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px">
        <tr>
          <td style="padding:4px 8px 4px 0;color:#556b82;width:140px">Impact category</td>
          <td style="padding:4px 0">${RISK_CATEGORIES.find(c => c.value === r.category)?.label ?? cap(r.category)}</td>
          <td style="padding:4px 8px 4px 16px;color:#556b82;width:140px">Risk type</td>
          <td style="padding:4px 0">${r.risk_type === "foreseeable" ? "Foreseeable" : r.risk_type === "known" ? "Known" : cap(r.risk_type)}</td>
        </tr>
        <tr>
          <td style="padding:4px 8px 4px 0;color:#556b82">Likelihood</td>
          <td style="padding:4px 0">${cap(r.likelihood)}</td>
          <td style="padding:4px 8px 4px 16px;color:#556b82">Severity</td>
          <td style="padding:4px 0">${cap(r.severity)}</td>
        </tr>
        <tr>
          <td style="padding:4px 8px 4px 0;color:#556b82">Risk level</td>
          <td style="padding:4px 0">${levelBadge(r.risk_level_autocalculated)}</td>
          <td style="padding:4px 8px 4px 16px;color:#556b82">AI lifecycle phase</td>
          <td style="padding:4px 0">${np(r.ai_lifecycle_phase)}</td>
        </tr>
        <tr>
          <td style="padding:4px 8px 4px 0;color:#556b82">Risk owner</td>
          <td style="padding:4px 0" colspan="3"><strong>${np(r.risk_owner)}</strong></td>
        </tr>
      </table>

      <div style="font-size:12px;margin-bottom:6px"><strong>Description:</strong> ${np(r.description)}</div>
      <div style="font-size:12px;margin-bottom:8px"><strong>Impact:</strong> ${np(r.impact)}</div>

      <div style="font-size:12px;margin-bottom:8px">
        <strong>Affects vulnerable groups (Art. 9(9)):</strong>
        ${r.affects_vulnerable_groups
          ? `<span style="color:#92400e">Yes — ${(() => { try { const g = JSON.parse(r.vulnerable_groups); return Array.isArray(g) ? g.join(", ") : r.vulnerable_groups; } catch { return r.vulnerable_groups || "Not specified"; } })()}</span>`
          : `<span style="color:#374151">No</span>`}
      </div>

      <div style="margin-top:10px">
        <div style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Misuse scenarios — Art. 9(2)(a) (${(r.misuse_scenarios ?? []).length})</div>
        ${(r.misuse_scenarios ?? []).length > 0 ? (r.misuse_scenarios ?? []).map(ms => `
          <div style="background:#fff5f5;border-left:3px solid #fca5a5;border-radius:0 6px 6px 0;padding:8px 12px;margin-bottom:6px;font-size:12px">
            <div><strong>Actor:</strong> ${ms.actor || "—"} · <strong>Likelihood:</strong> ${cap(ms.likelihood)}</div>
            <div style="margin-top:3px">${ms.description}</div>
            <div style="margin-top:3px;color:#556b82"><strong>Consequence:</strong> ${np(ms.consequence)}</div>
            <div style="margin-top:3px;color:#92400e"><strong>Vulnerable group:</strong> ${ms.vulnerable_group || `<span style="color:#9ca3af;font-style:italic">Not specified</span>`}</div>
          </div>
        `).join("") : `<div style="color:#9ca3af;font-size:12px;font-style:italic;padding:6px 0">No misuse scenarios documented.</div>`}
      </div>

      <div style="margin-top:10px">
        <div style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Risk management measures — Art. 9(2)(b)+(c) (${(r.mitigations ?? []).length})</div>
        ${(r.mitigations ?? []).length > 0 ? (r.mitigations ?? []).map(m => `
          <div style="background:#f0f4ff;border-left:3px solid #93c5fd;border-radius:0 6px 6px 0;padding:8px 12px;margin-bottom:6px;font-size:12px">
            <div>
              <span style="background:#dbeafe;color:#1e40af;padding:1px 7px;border-radius:8px;font-weight:700;font-size:10px;text-transform:uppercase;margin-right:8px">${m.hierarchy_level}</span>
              <strong>${m.title}</strong>
              ${m.status ? ` · <span style="color:#556b82">${cap(m.status)}</span>` : ""}
            </div>
            <div style="color:#374151;margin-top:4px"><strong>Description:</strong> ${np(m.description)}</div>
            <div style="color:#556b82;margin-top:3px"><strong>Implementation guidance:</strong> ${np(m.implementation_guidance)}</div>
            <div style="color:#556b82;margin-top:3px"><strong>Assigned to:</strong> ${np(m.assigned_to)} ${m.due_date ? `· Due: ${fmtDate(m.due_date)}` : ""}</div>
            ${m.override_notes ? `<div style="color:#92400e;margin-top:3px"><strong>Notes:</strong> ${m.override_notes}</div>` : ""}
          </div>
        `).join("") : r.closure_justification ? `
          <div style="background:#fffbeb;border-radius:6px;padding:8px 12px;font-size:12px;color:#92400e">
            <strong>No risk management measure applied</strong> — justification: ${r.closure_justification}
          </div>` : `<div style="color:#9ca3af;font-size:12px;font-style:italic;padding:6px 0">No risk management measures documented.</div>`}
      </div>

      <div style="margin-top:10px;background:#f8f9fa;border-radius:6px;padding:10px 14px;font-size:12px">
        <div style="font-size:11px;font-weight:700;color:#556b82;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px">Residual risk — Art. 9(2)(d)</div>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:3px 8px 3px 0;color:#556b82;width:140px">Residual likelihood</td>
            <td style="padding:3px 0">${np(r.residual_likelihood)}</td>
            <td style="padding:3px 8px 3px 16px;color:#556b82;width:140px">Residual severity</td>
            <td style="padding:3px 0">${np(r.residual_severity)}</td>
          </tr>
          <tr>
            <td style="padding:3px 8px 3px 0;color:#556b82">Residual level</td>
            <td style="padding:3px 0">${levelBadge(r.final_risk_level)}</td>
            <td style="padding:3px 8px 3px 16px;color:#556b82">Date of assessment</td>
            <td style="padding:3px 0">${fmtDate(r.date_of_assessment)}</td>
          </tr>
        </table>
        <div style="margin-top:6px;color:#374151"><strong>Justification:</strong> ${np(r.review_notes)}</div>
      </div>
    </div>
  `;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Risk Management Report — ${systemName}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 960px; margin: 40px auto; color: #111827; }
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
    ${register.notes ? `<div class="section-title">Assessment notes</div><div class="scope-box">${register.notes}</div>` : ""}
    <div class="stats">
      <div class="stat"><div class="stat-val">${confirmed.length}</div><div class="stat-lbl">Confirmed risks</div></div>
      <div class="stat"><div class="stat-val">${confirmed.reduce((a, r) => a + (r.mitigations ?? []).length, 0)}</div><div class="stat-lbl">Measures</div></div>
      <div class="stat"><div class="stat-val">${confirmed.filter(r => r.affects_vulnerable_groups).length}</div><div class="stat-lbl">Vulnerable group risks</div></div>
      <div class="stat"><div class="stat-val">${confirmed.reduce((a, r) => a + (r.misuse_scenarios ?? []).length, 0)}</div><div class="stat-lbl">Misuse scenarios</div></div>
    </div>
    <div class="section-title">Confirmed risks (${confirmed.length})</div>
    ${risksHtml || "<p style='color:#9ca3af;font-size:13px'>No confirmed risks.</p>"}
    ${diffAddedInNext.size > 0 ? `
      <div style="margin-top:8px">
        ${[...diffAddedInNext].map(title => `
          <div style="border:2px dashed #6ee7b7;background:#f0faf4;border-radius:8px;padding:14px 18px;margin-bottom:12px">
            <div style="font-size:11px;font-weight:700;background:#d5f5e3;color:#1a5c35;display:inline-block;padding:2px 8px;border-radius:6px;margin-bottom:8px;text-transform:uppercase">added in next version</div>
            <div style="font-weight:700;font-size:15px;color:#1a5c35">${title}</div>
            <div style="font-size:12px;color:#556b82;margin-top:4px;font-style:italic">This risk did not exist in this version — it was introduced in the next cycle.</div>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${register.residual_risk_argument ? `
      <div class="section-title">Overall residual risk argument (Art. 9(5))</div>
      <div class="scope-box">${register.residual_risk_argument}</div>
    ` : ""}
    <div class="section-title">Review plan (Art. 9(1))</div>
    <div class="scope-box">
      <strong>Scheduled review date:</strong> ${fmtDate(register.next_review_date)}
    </div>
    ${planTasks.length > 0 ? `
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px">
        <thead>
          <tr style="background:#f4f4f5">
            <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Task</th>
            <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Linked risk</th>
            <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Assigned to</th>
            <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Due</th>
            <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Status</th>
          </tr>
        </thead>
        <tbody>
          ${planTasks.map(t => `
            <tr style="border-bottom:1px solid #e4e4e7">
              <td style="padding:6px 10px;vertical-align:top">
                <div style="font-weight:600">${t.title}</div>
                ${t.description ? `<div style="color:#556b82;margin-top:2px">${t.description}</div>` : ""}
              </td>
              <td style="padding:6px 10px;vertical-align:top;color:#374151">${t.risk_id && riskTitleById[t.risk_id] ? riskTitleById[t.risk_id] : "—"}</td>
              <td style="padding:6px 10px;vertical-align:top;color:#374151">${t.assigned_to || "—"}</td>
              <td style="padding:6px 10px;vertical-align:top;white-space:nowrap">${fmtDate(t.due_date)}</td>
              <td style="padding:6px 10px;vertical-align:top;font-weight:600;text-transform:capitalize">${cap(t.status)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : `<div style="color:#9ca3af;font-size:12px;font-style:italic;padding:4px 0">No tasks recorded.</div>`}
    ${incidents.length > 0 ? `
      <div class="section-title">Incidents (${incidents.length})</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px">
        <thead>
          <tr style="background:#f4f4f5">
            <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Incident</th>
            <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Linked risk</th>
            <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Reported by</th>
            <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Occurred</th>
            <th style="text-align:left;padding:6px 10px;font-weight:700;color:#374151">Status</th>
          </tr>
        </thead>
        <tbody>
          ${incidents.map(inc => {
            const linkedRisk = inc.risk_id && riskTitleById[inc.risk_id] ? riskTitleById[inc.risk_id] : "—";
            return `
            <tr style="border-bottom:1px solid #e4e4e7">
              <td style="padding:6px 10px;vertical-align:top">
                <div style="font-weight:600">${inc.title}</div>
                ${inc.description ? `<div style="color:#556b82;margin-top:2px">${inc.description}</div>` : ""}
              </td>
              <td style="padding:6px 10px;vertical-align:top;color:#374151">${linkedRisk}</td>
              <td style="padding:6px 10px;vertical-align:top;color:#374151">${inc.reported_by || "—"}</td>
              <td style="padding:6px 10px;vertical-align:top;white-space:nowrap">${fmtDate(inc.occurred_at)}</td>
              <td style="padding:6px 10px;vertical-align:top;font-weight:600;text-transform:capitalize">${cap(inc.status)}</td>
            </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    ` : ""}
    <div class="footer">Generated by AI Trust Platform · EU AI Act Art. 9 Risk Management · ${new Date().getFullYear()}</div>
  </body></html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
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
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
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
        style={{ background: "var(--brand)", color: "#fff", border: "none", borderRadius: 6, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
        {saving ? "Saving…" : "Next: Identify risks →"}
      </button>
    </div>
  );
}

// ── Step 2: Identify ──────────────────────────────────────────────────────────
const RISK_CATEGORIES = [
  { value: "health", label: "Health" },
  { value: "safety", label: "Safety" },
  { value: "fundamental_rights", label: "Fundamental Rights" },
];

const RISK_TITLE_SUGGESTIONS = [
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
  assignee: string;
  due_date: string;
  ai_lifecycle_phase: string;
  impact: string;
}

const emptyDraft = (): DraftRisk => ({
  title: "", description: "", category: "health",
  risk_type: "", affects_vulnerable_groups: false, vulnerable_groups: "",
  severity: "medium", likelihood: "possible",
  risk_owner: "", assignee: "", due_date: "", ai_lifecycle_phase: "", impact: "",
});

interface DraftMisuseScenario {
  risk_id: string;
  actor: string;
  description: string;
  likelihood: string;
  consequence: string;
  vulnerable_group: string;
  assignee: string;
  due_date: string;
}

const emptyMsDraft = (): DraftMisuseScenario => ({
  risk_id: "", actor: "", description: "", likelihood: "possible",
  consequence: "", vulnerable_group: "", assignee: "", due_date: "",
});

interface DraftMonitoringRisk {
  title: string;
  description: string;
  category: string;
  observation: string;
  severity: string;
  likelihood: string;
  risk_owner: string;
  assignee: string;
  due_date: string;
}

const emptyMonitoringDraft = (): DraftMonitoringRisk => ({
  title: "", description: "", category: "health", observation: "",
  severity: "medium", likelihood: "possible",
  risk_owner: "", assignee: "", due_date: "",
});

function IdentifyStep({ register, risks, onRisksChange, onNext }: {
  register: RiskRegister;
  risks: RiskEntry[];
  onRisksChange: (risks: RiskEntry[]) => void;
  onNext: () => void;
}) {
  const [activeForm, setActiveForm] = useState<"none" | "risk" | "misuse" | "monitoring">("none");
  const [draft, setDraft] = useState<DraftRisk>(emptyDraft());
  const [msDraft, setMsDraft] = useState<DraftMisuseScenario>(emptyMsDraft());
  const [monDraft, setMonDraft] = useState<DraftMonitoringRisk>(emptyMonitoringDraft());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function openForm(form: "risk" | "misuse" | "monitoring") {
    setActiveForm(prev => prev === form ? "none" : form);
    setErr("");
  }

  async function addRisk() {
    if (!draft.title.trim()) { setErr("Risk title is required."); return; }
    if (!draft.risk_type) { setErr("Risk type is required — select Known or Foreseeable (Art. 9(2)(a))."); return; }
    if (!draft.category) { setErr("Impact category is required — select Health, Safety, or Fundamental Rights."); return; }
    if (draft.affects_vulnerable_groups && !draft.vulnerable_groups.trim()) {
      setErr("Vulnerable groups field is mandatory when 'affects vulnerable groups' is checked (Art. 9(9)).");
      return;
    }
    setSaving(true); setErr("");
    try {
      const created = await api.createRisk(register.id, {
        ...draft,
        vulnerable_groups: JSON.stringify(
          draft.vulnerable_groups ? draft.vulnerable_groups.split(",").map(s => s.trim()).filter(Boolean) : []
        ),
        risk_level_autocalculated: calcRiskLevel(draft.severity, draft.likelihood),
        assigned_to: draft.assignee || null,
        due_date: draft.due_date || null,
        source: "manual",
      });
      onRisksChange([...risks, created]);
      setDraft(emptyDraft());
      setActiveForm("none");
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  }

  async function addMisuseScenario() {
    const d = msDraft;
    if (!d.risk_id) { setErr("Select the risk this scenario belongs to."); return; }
    if (!d.actor.trim() || !d.description.trim()) { setErr("Actor and scenario description are required."); return; }
    setSaving(true); setErr("");
    try {
      const ms = await api.addMisuseScenario(d.risk_id, {
        actor: d.actor,
        description: d.description,
        likelihood: d.likelihood,
        consequence: d.consequence,
        vulnerable_group: d.vulnerable_group || null,
      });
      onRisksChange(risks.map(r => r.id === d.risk_id ? { ...r, misuse_scenarios: [...r.misuse_scenarios, ms] } : r));
      setMsDraft(emptyMsDraft());
      setActiveForm("none");
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  }

  async function addMonitoringRisk() {
    const d = monDraft;
    if (!d.title.trim()) { setErr("Risk title is required."); return; }
    if (!d.category) { setErr("Impact category is required."); return; }
    setSaving(true); setErr("");
    try {
      const created = await api.createRisk(register.id, {
        title: d.title,
        description: `${d.description}${d.observation ? `\n\nObservation: ${d.observation}` : ""}`,
        category: d.category,
        risk_type: "foreseeable",
        source: "monitoring",
        severity: d.severity,
        likelihood: d.likelihood,
        risk_owner: d.risk_owner,
        assigned_to: d.assignee || null,
        due_date: d.due_date || null,
        risk_level_autocalculated: calcRiskLevel(d.severity, d.likelihood),
        affects_vulnerable_groups: false,
        vulnerable_groups: "[]",
        ai_lifecycle_phase: "operation",
        impact: "",
      });
      onRisksChange([...risks, created]);
      setMonDraft(emptyMonitoringDraft());
      setActiveForm("none");
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
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
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>Identified risks or misuse scenarios ({risks.length})</h3>
          {risks.map(r => (
            <div key={r.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {r.title}
                  {r.source === "monitoring" && (
                    <span style={{ marginLeft: 8, fontSize: 10, background: "#dbeafe", color: "#1e40af", padding: "1px 6px", borderRadius: 6, fontWeight: 700, textTransform: "uppercase" }}>monitoring</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>{RISK_CATEGORIES.find(c => c.value === r.category)?.label ?? r.category} · {r.risk_type === "foreseeable" ? "Foreseeable" : r.risk_type === "known" ? "Known" : r.risk_type}</span>
                  {r.risk_level_autocalculated && <RiskLevelBadge level={r.risk_level_autocalculated} />}
                  {r.risk_owner && <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>owner: {r.risk_owner}</span>}
                  {r.assigned_to && <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>assignee: {r.assigned_to}</span>}
                  {r.affects_vulnerable_groups && <span style={{ color: "#8b3a00" }}>⚠ vulnerable groups</span>}
                  {r.misuse_scenarios.length > 0 && <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{r.misuse_scenarios.length} misuse scenario(s)</span>}
                </div>
              </div>
              <button onClick={() => removeRisk(r.id)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", fontSize: 16 }}>×</button>
            </div>
          ))}
        </Card>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          { key: "risk" as const, label: "+ Add risk", desc: "Known or foreseeable risk (Art. 9(2)(a))" },
          { key: "misuse" as const, label: "+ Add misuse scenario", desc: "Foreseeable misuse by third parties (Art. 9(2)(b))" },
          { key: "monitoring" as const, label: "+ Add monitoring risk", desc: "Risk from post-market monitoring (Art. 9(2)(c))" },
        ].map(btn => (
          <button key={btn.key} onClick={() => openForm(btn.key)}
            style={{
              padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: "pointer",
              border: `1px solid ${activeForm === btn.key ? "var(--brand)" : "var(--border)"}`,
              background: activeForm === btn.key ? "var(--brand)" : "var(--surface)",
              color: activeForm === btn.key ? "#fff" : "var(--text)",
            }}>
            {btn.label}
            <div style={{ fontSize: 10, fontWeight: 400, color: activeForm === btn.key ? "rgba(255,255,255,0.8)" : "var(--text-secondary)", marginTop: 1 }}>{btn.desc}</div>
          </button>
        ))}
      </div>

      {/* Form: Add risk */}
      {activeForm === "risk" && (
        <Card>
          <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700 }}>Add risk</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <Label required>Risk title</Label>
              <input list="risk-title-suggestions" value={draft.title}
                onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                placeholder="e.g. Discriminatory outcomes for applicants with employment gaps"
                style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, background: "var(--surface)", color: "var(--text)" }} />
              <datalist id="risk-title-suggestions">{RISK_TITLE_SUGGESTIONS.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <Label required>Impact category (Art. 9)</Label>
              <Select value={draft.category} onChange={v => setDraft(d => ({ ...d, category: v }))} options={RISK_CATEGORIES} />
            </div>
            <div>
              <Label required>Risk type (Art. 9(2)(a))</Label>
              <Select value={draft.risk_type} onChange={v => setDraft(d => ({ ...d, risk_type: v }))}
                options={[{ value: "", label: "— select —" }, { value: "known", label: "Known risk" }, { value: "foreseeable", label: "Foreseeable risk" }]} />
            </div>
            <div>
              <Label>Severity</Label>
              <Select value={draft.severity} onChange={v => setDraft(d => ({ ...d, severity: v }))}
                options={[{ value: "critical", label: "Critical" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
            </div>
            <div>
              <Label>Likelihood</Label>
              <Select value={draft.likelihood} onChange={v => setDraft(d => ({ ...d, likelihood: v }))}
                options={[{ value: "very_likely", label: "Very likely" }, { value: "likely", label: "Likely" }, { value: "possible", label: "Possible" }, { value: "unlikely", label: "Unlikely" }]} />
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Risk level (auto):</span>
              <RiskLevelBadge level={calcRiskLevel(draft.severity, draft.likelihood)} />
            </div>
            <div>
              <Label>Risk owner</Label>
              <Input value={draft.risk_owner} onChange={v => setDraft(d => ({ ...d, risk_owner: v }))} placeholder="e.g. jane.doe@company.com" />
            </div>
            <div>
              <Label>AI lifecycle phase</Label>
              <Select value={draft.ai_lifecycle_phase} onChange={v => setDraft(d => ({ ...d, ai_lifecycle_phase: v }))} options={LIFECYCLE_PHASES} />
            </div>
            <div>
              <Label>Assignee</Label>
              <Input value={draft.assignee} onChange={v => setDraft(d => ({ ...d, assignee: v }))} placeholder="Person responsible for this risk" />
            </div>
            <div>
              <Label>Due date</Label>
              <input type="date" value={draft.due_date} onChange={e => setDraft(d => ({ ...d, due_date: e.target.value }))}
                style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, background: "var(--surface)", color: "var(--text)" }} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Label>Impact description</Label>
              <Textarea value={draft.impact} onChange={v => setDraft(d => ({ ...d, impact: v }))} rows={2} placeholder="Describe the business, operational, or user impact…" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Label>Description</Label>
              <Textarea value={draft.description} onChange={v => setDraft(d => ({ ...d, description: v }))} rows={2} placeholder="Describe the risk, its root cause, and potential impact…" />
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
                </div>
              )}
            </div>
          </div>
          <ErrorMsg msg={err} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addRisk} disabled={saving} className="btn-primary btn-sm">{saving ? "Adding…" : "+ Add risk"}</button>
            <button onClick={() => setActiveForm("none")} className="btn-ghost btn-sm">Cancel</button>
          </div>
        </Card>
      )}

      {/* Form: Add misuse scenario */}
      {activeForm === "misuse" && (
        <Card>
          <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700 }}>Add misuse scenario <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-secondary)" }}>Art. 9(2)(b)</span></h3>
          {risks.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>Add at least one risk first before adding misuse scenarios.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label required>Linked risk</Label>
                <Select value={msDraft.risk_id} onChange={v => setMsDraft(d => ({ ...d, risk_id: v }))}
                  options={[{ value: "", label: "— select risk —" }, ...risks.map(r => ({ value: r.id, label: r.title }))]} />
              </div>
              <div>
                <Label required>Actor</Label>
                <Input value={msDraft.actor} onChange={v => setMsDraft(d => ({ ...d, actor: v }))} placeholder="e.g. Malicious hiring manager" />
              </div>
              <div>
                <Label>Likelihood</Label>
                <Select value={msDraft.likelihood} onChange={v => setMsDraft(d => ({ ...d, likelihood: v }))}
                  options={[{ value: "very_likely", label: "Very likely" }, { value: "likely", label: "Likely" }, { value: "possible", label: "Possible" }, { value: "unlikely", label: "Unlikely" }]} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label required>Scenario description</Label>
                <Textarea value={msDraft.description} onChange={v => setMsDraft(d => ({ ...d, description: v }))} rows={2}
                  placeholder="Describe how this actor could misuse the system…" />
              </div>
              <div>
                <Label>Consequence</Label>
                <Input value={msDraft.consequence} onChange={v => setMsDraft(d => ({ ...d, consequence: v }))} placeholder="e.g. Systematic rejection of qualified candidates" />
              </div>
              <div>
                <Label>Vulnerable group (if applicable)</Label>
                <Input value={msDraft.vulnerable_group} onChange={v => setMsDraft(d => ({ ...d, vulnerable_group: v }))} placeholder="e.g. Pregnant women" />
              </div>
              <div>
                <Label>Assignee</Label>
                <Input value={msDraft.assignee} onChange={v => setMsDraft(d => ({ ...d, assignee: v }))} placeholder="Person responsible" />
              </div>
              <div>
                <Label>Due date</Label>
                <input type="date" value={msDraft.due_date} onChange={e => setMsDraft(d => ({ ...d, due_date: e.target.value }))}
                  style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, background: "var(--surface)", color: "var(--text)" }} />
              </div>
            </div>
          )}
          <ErrorMsg msg={err} />
          {risks.length > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={addMisuseScenario} disabled={saving} className="btn-primary btn-sm">{saving ? "Adding…" : "+ Add scenario"}</button>
              <button onClick={() => setActiveForm("none")} className="btn-ghost btn-sm">Cancel</button>
            </div>
          )}
        </Card>
      )}

      {/* Form: Add monitoring risk */}
      {activeForm === "monitoring" && (
        <Card>
          <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700 }}>Add monitoring risk <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-secondary)" }}>Art. 9(2)(c)</span></h3>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 14 }}>Risk identified from post-market monitoring. Type is automatically set to Foreseeable.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <Label required>Risk title</Label>
              <input list="risk-title-suggestions" value={monDraft.title}
                onChange={e => setMonDraft(d => ({ ...d, title: e.target.value }))}
                placeholder="e.g. Model drift causing biased outcomes in production"
                style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, background: "var(--surface)", color: "var(--text)" }} />
            </div>
            <div>
              <Label required>Impact category (Art. 9)</Label>
              <Select value={monDraft.category} onChange={v => setMonDraft(d => ({ ...d, category: v }))} options={RISK_CATEGORIES} />
            </div>
            <div>
              <Label>Severity</Label>
              <Select value={monDraft.severity} onChange={v => setMonDraft(d => ({ ...d, severity: v }))}
                options={[{ value: "critical", label: "Critical" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
            </div>
            <div>
              <Label>Likelihood</Label>
              <Select value={monDraft.likelihood} onChange={v => setMonDraft(d => ({ ...d, likelihood: v }))}
                options={[{ value: "very_likely", label: "Very likely" }, { value: "likely", label: "Likely" }, { value: "possible", label: "Possible" }, { value: "unlikely", label: "Unlikely" }]} />
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Risk level (auto):</span>
              <RiskLevelBadge level={calcRiskLevel(monDraft.severity, monDraft.likelihood)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Label>Observation</Label>
              <Textarea value={monDraft.observation} onChange={v => setMonDraft(d => ({ ...d, observation: v }))} rows={2}
                placeholder="Describe what was observed in monitoring that triggered this risk…" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Label>Description</Label>
              <Textarea value={monDraft.description} onChange={v => setMonDraft(d => ({ ...d, description: v }))} rows={2}
                placeholder="Describe the risk…" />
            </div>
            <div>
              <Label>Risk owner</Label>
              <Input value={monDraft.risk_owner} onChange={v => setMonDraft(d => ({ ...d, risk_owner: v }))} placeholder="e.g. jane.doe@company.com" />
            </div>
            <div>
              <Label>Assignee</Label>
              <Input value={monDraft.assignee} onChange={v => setMonDraft(d => ({ ...d, assignee: v }))} placeholder="Person responsible for this risk" />
            </div>
            <div>
              <Label>Due date</Label>
              <input type="date" value={monDraft.due_date} onChange={e => setMonDraft(d => ({ ...d, due_date: e.target.value }))}
                style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, background: "var(--surface)", color: "var(--text)" }} />
            </div>
          </div>
          <ErrorMsg msg={err} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addMonitoringRisk} disabled={saving} className="btn-primary btn-sm">{saving ? "Adding…" : "+ Add monitoring risk"}</button>
            <button onClick={() => setActiveForm("none")} className="btn-ghost btn-sm">Cancel</button>
          </div>
        </Card>
      )}

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
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  async function confirmRisk(risk: RiskEntry) {
    const updated = await api.patchRisk(risk.id, { status: "confirmed" });
    onRisksChange(risks.map(r => r.id === risk.id ? { ...r, ...updated, misuse_scenarios: r.misuse_scenarios, mitigations: r.mitigations } : r));
  }

  async function dismissRisk(risk: RiskEntry) {
    const updated = await api.patchRisk(risk.id, { status: "dismissed" });
    onRisksChange(risks.map(r => r.id === risk.id ? { ...r, ...updated, misuse_scenarios: r.misuse_scenarios, mitigations: r.mitigations } : r));
  }

  const confirmed = risks.filter(r => r.status === "confirmed").length;
  const regularRisks = risks.filter(r => r.source !== "monitoring");
  const monitoringRisks = risks.filter(r => r.source === "monitoring");
  const allMisuseScenarios = risks.flatMap(r => r.misuse_scenarios.map(ms => ({ ...ms, riskTitle: r.title })));

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "Total", value: risks.length, color: "#1147E9" },
          { label: "Confirmed", value: confirmed, color: "#16a34a" },
          { label: "Dismissed", value: risks.filter(r => r.status === "dismissed").length, color: "var(--text-secondary)" },
          { label: "Pending", value: risks.filter(r => r.status === "identified").length, color: "#f59e0b" },
        ].map(k => (
          <div key={k.label} style={{ flex: 1, minWidth: 90, background: "var(--bg)", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {risks.map(risk => {
        const sc = { bg: SEV_BG[risk.severity] ?? "#eef1f4", color: SEV_COLORS[risk.severity] ?? "#556b82" };
        return (
          <Card key={risk.id} style={{ borderLeft: `3px solid ${sc.color}`, padding: "0" }}>
            {/* Header — always visible, no collapse */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px" }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{risk.title}</span>
                {risk.source === "monitoring" && (
                  <span style={{ marginLeft: 8, fontSize: 10, background: "#dbeafe", color: "#1e40af", padding: "1px 6px", borderRadius: 6, fontWeight: 700, textTransform: "uppercase" }}>monitoring</span>
                )}
                <span style={{ marginLeft: 8, fontSize: 11, background: sc.bg, color: sc.color, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
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
                  <button onClick={() => confirmRisk(risk)}
                    style={{ fontSize: 11, padding: "4px 10px", background: "#d5f5e3", color: "#1a5c35", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>
                    ✓ Confirm
                  </button>
                )}
                {risk.status !== "dismissed" && (
                  <button onClick={() => dismissRisk(risk)}
                    style={{ fontSize: 11, padding: "4px 10px", background: "var(--bg)", color: "var(--text-secondary)", border: "none", borderRadius: 4, cursor: "pointer" }}>
                    Dismiss
                  </button>
                )}
                {risk.status === "confirmed" && (
                  <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>✓ confirmed</span>
                )}
              </div>
            </div>

            {/* Body — always expanded */}
            <div style={{ padding: "0 20px 16px", borderTop: "1px solid #f4f4f5" }}>
              {/* Risk details */}
              <div style={{ marginTop: 12, marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Risk</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, background: "var(--bg)", color: "var(--text-secondary)", padding: "2px 8px", borderRadius: 10 }}>
                    {risk.risk_type === "foreseeable" ? "⚡ Foreseeable" : "📋 Known"}
                  </span>
                  <span style={{ fontSize: 11, background: "var(--bg)", color: "var(--text-secondary)", padding: "2px 8px", borderRadius: 10 }}>
                    Likelihood: {risk.likelihood}
                  </span>
                  {risk.category && (
                    <span style={{ fontSize: 11, background: "var(--bg)", color: "var(--text-secondary)", padding: "2px 8px", borderRadius: 10 }}>
                      {RISK_CATEGORIES.find(c => c.value === risk.category)?.label ?? risk.category}
                    </span>
                  )}
                </div>
                {risk.description && <p style={{ fontSize: 12, color: "var(--text)", margin: 0 }}>{risk.description}</p>}
              </div>

              {/* Misuse scenarios — only if any exist */}
              {risk.misuse_scenarios.length > 0 && (
                <div style={{ marginBottom: 14, paddingTop: 12, borderTop: "1px solid #f4f4f5" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                    Misuse scenarios
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
                </div>
              )}

              {/* Monitoring observation — only for monitoring risks */}
              {risk.source === "monitoring" && (risk as any).observation && (
                <div style={{ marginBottom: 14, paddingTop: 12, borderTop: "1px solid #f4f4f5" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
                    Monitoring observation
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text)", margin: 0 }}>{(risk as any).observation}</p>
                </div>
              )}
            </div>
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
  const [addMit, setAddMit] = useState<Record<string, boolean>>({});
  const [mitDraft, setMitDraft] = useState<Record<string, Partial<MitigationMeasure>>>({});
  const [residualDraft, setResidualDraft] = useState<Record<string, { residual_likelihood: string; residual_severity: string; date_of_assessment: string; review_notes: string }>>({});
  const [residualSaving, setResidualSaving] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [closureNote, setClosureNote] = useState<Record<string, string>>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const [testReports, setTestReports] = useState<Record<string, TestReport[]>>({});
  const [addTest, setAddTest] = useState<Record<string, boolean>>({});
  const [testDraft, setTestDraft] = useState<Record<string, { title: string; summary: string; findings: string; result: string; author: string }>>({});
  const [testSaving, setTestSaving] = useState<Record<string, boolean>>({});

  async function loadTestReports(riskId: string) {
    const reports = await api.getTestReports(riskId);
    setTestReports(t => ({ ...t, [riskId]: reports }));
  }

  useEffect(() => {
    confirmedRisks.forEach(r => loadTestReports(r.id));
  }, [risks.length]);

  async function saveTestReport(riskId: string) {
    const d = testDraft[riskId] ?? {};
    if (!d.title?.trim()) return;
    setTestSaving(s => ({ ...s, [riskId]: true }));
    try {
      const report = await api.createTestReport(riskId, {
        title: d.title,
        summary: d.summary ?? "",
        findings: d.findings ?? "",
        result: d.result ?? "pass",
        author: d.author || null,
        attachments: "",
        mitigation_id: null,
      });
      setTestReports(t => ({ ...t, [riskId]: [report, ...(t[riskId] ?? [])] }));
      setTestDraft(td => ({ ...td, [riskId]: { title: "", summary: "", findings: "", result: "pass", author: "" } }));
      setAddTest(a => ({ ...a, [riskId]: false }));
    } finally {
      setTestSaving(s => ({ ...s, [riskId]: false }));
    }
  };

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
        review_notes: d.review_notes ?? undefined,
      });
      onRisksChange(risks.map(r => r.id === riskId ? { ...r, ...updated, mitigations: r.mitigations } : r));
    } finally {
      setResidualSaving(s => ({ ...s, [riskId]: false }));
    }
  }

  async function saveMitigation(riskId: string) {
    const d = mitDraft[riskId] ?? {};
    if (!d.title?.trim()) { setErr(e => ({ ...e, [riskId]: "Measure title is required." })); return; }
    if (!d.hierarchy_level) { setErr(e => ({ ...e, [riskId]: "Hierarchy level is required." })); return; }
    setSaving(s => ({ ...s, [riskId]: true }));
    setErr(e => ({ ...e, [riskId]: "" }));
    try {
      const mit = await api.addMitigation(riskId, {
        title: d.title ?? "",
        description: d.description ?? "",
        hierarchy_level: d.hierarchy_level ?? "mitigate",
        implementation_guidance: d.implementation_guidance ?? "",
        status: "planned",
        assigned_to: d.assigned_to ?? null,
        due_date: d.due_date ?? null,
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
      <div style={{ background: "var(--bg)", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "var(--text)" }}>
        <strong>Risk management measures:</strong> Apply measures in order: <strong>Eliminate</strong> (preferred) →
        <strong> Reduce</strong> → <strong>Mitigate</strong> → <strong>Inform</strong>. Every confirmed risk must have at least one measure
        or a documented justification for not applying any.
      </div>

      {confirmedRisks.map(risk => {
        const hasMit = risk.mitigations.length > 0;
        const hasJustification = !!risk.closure_justification?.trim();
        const complete = hasMit || hasJustification;
        return (
          <Card key={risk.id} style={{ borderLeft: `3px solid ${complete ? "#16a34a" : "#f59e0b"}`, padding: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px" }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{risk.title}</span>
                <span style={{ marginLeft: 10, fontSize: 11, color: "var(--text-secondary)" }}>{risk.mitigations.length} measure(s)</span>
                {complete && <span style={{ marginLeft: 8, fontSize: 11, color: "#16a34a", fontWeight: 600 }}>✓</span>}
                {!complete && <span style={{ marginLeft: 8, fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>⚠ needs risk management measure</span>}
              </div>
            </div>

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
                          {m.implementation_guidance && <div style={{ color: "var(--text-secondary)", marginTop: 2 }}>{m.implementation_guidance}</div>}
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
                        : { background: "var(--brand)", color: "#fff" }),
                    }}>
                    + Add risk management measure
                  </button>
                ) : (
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <Label required>Hierarchy level</Label>
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
                    <div>
                      <Label>Assignee</Label>
                      <Input
                        value={mitDraft[risk.id]?.assigned_to ?? risk.risk_owner ?? ""}
                        onChange={v => setMitDraft(d => ({ ...d, [risk.id]: { ...d[risk.id], assigned_to: v } }))}
                        placeholder={risk.risk_owner ? `Default: ${risk.risk_owner}` : "Person responsible"} />
                    </div>
                    <div>
                      <Label>Due date</Label>
                      <input type="date"
                        value={mitDraft[risk.id]?.due_date ?? ""}
                        onChange={e => setMitDraft(d => ({ ...d, [risk.id]: { ...d[risk.id], due_date: e.target.value } }))}
                        style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, background: "var(--surface)", color: "var(--text)" }} />
                    </div>
                    <ErrorMsg msg={err[risk.id] ?? ""} />
                    <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                      <button onClick={() => saveMitigation(risk.id)} disabled={saving[risk.id]}
                        style={{ fontSize: 12, background: "var(--brand)", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                        Save
                      </button>
                      <button onClick={() => setAddMit(a => ({ ...a, [risk.id]: false }))}
                        style={{ fontSize: 12, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Test reports */}
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f4f4f5" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Test reports</span>
                    <button onClick={() => setAddTest(a => ({ ...a, [risk.id]: !addTest[risk.id] }))}
                      style={{ fontSize: 11, fontWeight: 600, background: "#f0f4ff", color: "#1147E9", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}>
                      + Add test report
                    </button>
                  </div>
                  {(testReports[risk.id] ?? []).map(tr => (
                    <div key={tr.id} style={{ fontSize: 12, padding: "8px 0", borderBottom: "1px solid #f4f4f5" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 600 }}>{tr.title}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 6, textTransform: "uppercase",
                          background: tr.result === "pass" ? "#d5f5e3" : tr.result === "fail" ? "#fee2e2" : "#fde8d0",
                          color: tr.result === "pass" ? "#1a5c35" : tr.result === "fail" ? "#991b1b" : "#8b3a00",
                        }}>{tr.result}</span>
                        {tr.author && <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{tr.author}</span>}
                        <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{new Date(tr.created_at).toLocaleDateString()}</span>
                      </div>
                      {tr.summary && <div style={{ color: "var(--text-secondary)", marginTop: 3 }}>{tr.summary}</div>}
                      {tr.findings && <div style={{ marginTop: 3, fontStyle: "italic" }}>{tr.findings}</div>}
                    </div>
                  ))}
                  {(testReports[risk.id] ?? []).length === 0 && !addTest[risk.id] && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" }}>No test reports yet.</div>
                  )}
                  {addTest[risk.id] && (
                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <Label required>Title</Label>
                        <Input value={testDraft[risk.id]?.title ?? ""}
                          onChange={v => setTestDraft(d => ({ ...d, [risk.id]: { ...d[risk.id] ?? { summary: "", findings: "", result: "pass", author: "" }, title: v } }))}
                          placeholder="e.g. Fairness audit — Q3 2026" />
                      </div>
                      <div>
                        <Label>Result</Label>
                        <Select value={testDraft[risk.id]?.result ?? "pass"}
                          onChange={v => setTestDraft(d => ({ ...d, [risk.id]: { ...d[risk.id] ?? { title: "", summary: "", findings: "", author: "" }, result: v } }))}
                          options={[{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }, { value: "inconclusive", label: "Inconclusive" }]} />
                      </div>
                      <div>
                        <Label>Author</Label>
                        <Input value={testDraft[risk.id]?.author ?? ""}
                          onChange={v => setTestDraft(d => ({ ...d, [risk.id]: { ...d[risk.id] ?? { title: "", summary: "", findings: "", result: "pass" }, author: v } }))}
                          placeholder="e.g. jane.doe@company.com" />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <Label required>Summary</Label>
                        <Textarea value={testDraft[risk.id]?.summary ?? ""}
                          onChange={v => setTestDraft(d => ({ ...d, [risk.id]: { ...d[risk.id] ?? { title: "", findings: "", result: "pass", author: "" }, summary: v } }))}
                          rows={2} placeholder="Brief summary of what was tested and how…" />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <Label required>Findings / conclusions</Label>
                        <Textarea value={testDraft[risk.id]?.findings ?? ""}
                          onChange={v => setTestDraft(d => ({ ...d, [risk.id]: { ...d[risk.id] ?? { title: "", summary: "", result: "pass", author: "" }, findings: v } }))}
                          rows={2} placeholder="What did the test reveal? What actions follow?" />
                      </div>
                      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                        <button onClick={() => saveTestReport(risk.id)}
                          disabled={testSaving[risk.id] || !testDraft[risk.id]?.title?.trim() || !testDraft[risk.id]?.summary?.trim() || !testDraft[risk.id]?.findings?.trim()}
                          style={{ fontSize: 12, background: "var(--brand)", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                          {testSaving[risk.id] ? "Saving…" : "Save test report"}
                        </button>
                        <button onClick={() => setAddTest(a => ({ ...a, [risk.id]: false }))}
                          style={{ fontSize: 12, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

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
                <div style={{ marginTop: 14, padding: "10px 14px", background: "var(--bg)", borderRadius: 6, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.4px" }}>
                    Residual risk (post-mitigation)
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
                        style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 13 }} />
                    </div>
                  </div>
                  {(() => {
                    const rl = residualDraft[risk.id]?.residual_likelihood ?? risk.residual_likelihood ?? "";
                    const rs = residualDraft[risk.id]?.residual_severity ?? risk.residual_severity ?? "";
                    return (rl && rs) ? (
                      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "var(--text)" }}>Residual risk level (auto):</span>
                        <RiskLevelBadge level={calcRiskLevel(rs, rl)} />
                      </div>
                    ) : null;
                  })()}
                  <div style={{ marginTop: 8 }}>
                    <Label>Justification / notes</Label>
                    <Textarea
                      value={residualDraft[risk.id]?.review_notes ?? risk.review_notes ?? ""}
                      onChange={v => setResidualDraft(d => ({ ...d, [risk.id]: { ...d[risk.id] ?? { residual_likelihood: "", residual_severity: "", date_of_assessment: "" }, review_notes: v } }))}
                      rows={2}
                      placeholder="Explain why the residual risk level is acceptable…" />
                  </div>
                  <button onClick={() => saveResidual(risk.id)} disabled={residualSaving[risk.id]}
                    style={{ marginTop: 10, fontSize: 11, background: "transparent", color: "var(--text-secondary)", border: "1px solid #d1d5db", borderRadius: 4, padding: "4px 12px", cursor: "pointer" }}>
                    {residualSaving[risk.id] ? "Saving…" : "Save residual risk"}
                  </button>
                </div>
            </div>
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

// ── Step 5: Plan ─────────────────────────────────────────────────────────────
function PlanStep({ register, risks, onRegisterUpdated, onNext }: {
  register: RiskRegister;
  risks: RiskEntry[];
  onRegisterUpdated: (r: RiskRegister) => void;
  onNext: () => void;
}) {
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [addingTask, setAddingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState<Partial<PlanTask>>({});
  const [savingTask, setSavingTask] = useState(false);
  const [taskErr, setTaskErr] = useState("");
  const [reviewDate, setReviewDate] = useState(
    register.next_review_date ? register.next_review_date.slice(0, 10) : ""
  );
  const [reviewDateErr, setReviewDateErr] = useState("");
  const [savingDate, setSavingDate] = useState(false);

  useEffect(() => {
    api.getPlanTasks(register.id).then(setTasks).catch(() => {});
    api.checkOverdueTasks(register.id).catch(() => {});
  }, [register.id]);

  const today = new Date();
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 180);
  const maxDateStr = maxDate.toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  async function saveReviewDate(value: string) {
    if (!value) { setReviewDateErr("Review date is required."); return; }
    if (value > maxDateStr) { setReviewDateErr("Review date must be within 6 months from today."); return; }
    setReviewDateErr("");
    setSavingDate(true);
    try {
      const updated = await api.patchRegister(register.id, { next_review_date: value } as Partial<RiskRegister>);
      onRegisterUpdated(updated);
    } finally {
      setSavingDate(false);
    }
  }

  async function addTask() {
    if (!taskDraft.title?.trim()) { setTaskErr("Task title is required."); return; }
    setTaskErr("");
    setSavingTask(true);
    try {
      const task = await api.createPlanTask(register.id, {
        title: taskDraft.title ?? "",
        risk_id: taskDraft.risk_id ?? null,
        assigned_to: taskDraft.assigned_to ?? null,
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
    await api.deletePlanTask(taskId);
    setTasks(prev => prev.filter(t => t.id !== taskId));
  }

  async function updateTaskStatus(taskId: string, status: string) {
    const updated = await api.patchPlanTask(taskId, { status });
    setTasks(prev => prev.map(t => t.id === taskId ? updated : t));
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

  return (
    <div>
      {/* Review date */}
      <Card>
        <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Scheduled review date</h3>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--text-secondary)" }}>
          Set the date for the next scheduled review of this risk management cycle. Must be within 6 months.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="date"
            value={reviewDate}
            min={todayStr}
            max={maxDateStr}
            onChange={e => { setReviewDate(e.target.value); setReviewDateErr(""); }}
            onBlur={e => saveReviewDate(e.target.value)}
            style={{ fontSize: 13, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
          />
          {savingDate && <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Saving…</span>}
          {reviewDate && !reviewDateErr && !savingDate && (
            <span style={{ fontSize: 12, color: "#1a5c35" }}>✓ Set</span>
          )}
        </div>
        {reviewDateErr && <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626" }}>{reviewDateErr}</div>}
      </Card>

      {/* Tasks */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Tasks</h3>
          {!addingTask && (
            <button onClick={() => setAddingTask(true)}
              style={{ fontSize: 12, background: "var(--brand)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontWeight: 600 }}>
              + Add task
            </button>
          )}
        </div>

        {tasks.length === 0 && !addingTask && (
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>No tasks yet. Add tasks to track actions for this risk management cycle.</p>
        )}

        {tasks.map(task => {
          const sk = taskStatusKey(task);
          const sc = STATUS_COLORS[sk] ?? STATUS_COLORS.open;
          return (
            <div key={task.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
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
                        <td style={{ paddingRight: 8, whiteSpace: "nowrap", fontWeight: 500 }}>👤 Assigned</td>
                        <td>{task.assigned_to}</td>
                      </tr>
                    )}
                    {task.due_date && (
                      <tr>
                        <td style={{ paddingRight: 8, whiteSpace: "nowrap", fontWeight: 500 }}>📅 Due</td>
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
              <button onClick={() => deleteTask(task.id)}
                style={{ fontSize: 11, background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer", padding: "0 4px" }}>✕</button>
            </div>
          );
        })}

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
                  onChange={e => setTaskDraft(d => ({ ...d, risk_id: e.target.value || null }))}
                  style={{ width: "100%", fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                  <option value="">— None —</option>
                  {risks.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              </div>
              <div>
                <Label>Assigned to</Label>
                <Input value={taskDraft.assigned_to ?? ""} onChange={v => setTaskDraft(d => ({ ...d, assigned_to: v }))} placeholder="Username" />
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

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button onClick={onNext}
          style={{ background: "var(--brand)", color: "#fff", border: "none", borderRadius: 6, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Next: Approve →
        </button>
      </div>
    </div>
  );
}

// ── Step 6: Approve ───────────────────────────────────────────────────────────
function ApproveStep({ register, risks, onApprove }: {
  register: RiskRegister;
  risks: RiskEntry[];
  onApprove: (acceptable: boolean, argument: string) => Promise<void>;
}) {
  const [acceptable, setAcceptable] = useState(true);
  const [argument, setArgument] = useState(register.residual_risk_argument ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Incidents state
  const [incidents, setIncidents] = useState<import("../types").Incident[]>([]);
  const [addingIncident, setAddingIncident] = useState(false);
  const [incidentDraft, setIncidentDraft] = useState<Partial<import("../types").Incident>>({});
  const [savingIncident, setSavingIncident] = useState(false);
  const [incidentErr, setIncidentErr] = useState("");

  useEffect(() => {
    api.getIncidents(register.id).then(setIncidents).catch(() => {});
  }, [register.id]);

  const confirmedRisks = risks.filter(r => r.status === "confirmed");
  const totalMitigations = confirmedRisks.reduce((acc, r) => acc + r.mitigations.length, 0);
  const vulnerableGroupRisks = confirmedRisks.filter(r => r.affects_vulnerable_groups);

  async function addIncident() {
    if (!incidentDraft.title?.trim()) { setIncidentErr("Incident title is required."); return; }
    setIncidentErr("");
    setSavingIncident(true);
    try {
      const incident = await api.createIncident(register.id, {
        title: incidentDraft.title ?? "",
        description: incidentDraft.description ?? "",
        status: incidentDraft.status ?? "open",
        risk_id: incidentDraft.risk_id ?? null,
        reported_by: incidentDraft.reported_by ?? null,
        occurred_at: incidentDraft.occurred_at ?? null,
        attachments: incidentDraft.attachments ?? "",
      });
      setIncidents(prev => [incident, ...prev]);
      setIncidentDraft({});
      setAddingIncident(false);
    } finally {
      setSavingIncident(false);
    }
  }

  async function deleteIncident(id: string) {
    await api.deleteIncident(id);
    setIncidents(prev => prev.filter(i => i.id !== id));
  }

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

  const incidentsSection = (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Incidents</h3>
        {!addingIncident && (
          <button onClick={() => setAddingIncident(true)}
            style={{ fontSize: 12, background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontWeight: 600 }}>
            + Report incident
          </button>
        )}
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--text-secondary)" }}>
        Record situations where an identified risk materialized. Each incident should be investigated and linked to a specific risk if applicable.
      </p>
      {incidents.length === 0 && !addingIncident && (
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>No incidents reported.</p>
      )}
      {incidents.map(incident => {
        const INCIDENT_STATUS: Record<string, { bg: string; color: string; label: string }> = {
          open:                { bg: "#ffd5d5", color: "#8b0000", label: "Open" },
          under_investigation: { bg: "#fde8d0", color: "#8b3a00", label: "Under investigation" },
          resolved:            { bg: "#d5f5e3", color: "#1a5c35", label: "Resolved" },
          closed:              { bg: "#f4f4f5", color: "#6b7280", label: "Closed" },
        };
        const sc = INCIDENT_STATUS[incident.status] ?? INCIDENT_STATUS.open;
        const linkedRisk = risks.find(r => r.id === incident.risk_id);
        return (
          <div key={incident.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
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
                      <td style={{ paddingRight: 8, whiteSpace: "nowrap", fontWeight: 500 }}>👤 Reported by</td>
                      <td>{incident.reported_by}</td>
                    </tr>
                  )}
                  {incident.occurred_at && (
                    <tr>
                      <td style={{ paddingRight: 8, whiteSpace: "nowrap", fontWeight: 500 }}>📅 Occurred</td>
                      <td>{incident.occurred_at.slice(0, 10)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <select
              value={incident.status}
              onChange={async e => {
                const updated = await api.patchIncident(incident.id, { status: e.target.value });
                setIncidents(prev => prev.map(i => i.id === incident.id ? updated : i));
              }}
              style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "none", background: sc.bg, color: sc.color, fontWeight: 600, cursor: "pointer" }}>
              <option value="open">Open</option>
              <option value="under_investigation">Under investigation</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
            <button onClick={() => deleteIncident(incident.id)}
              style={{ fontSize: 11, background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer", padding: "0 4px" }}>✕</button>
          </div>
        );
      })}
      {addingIncident && (
        <div style={{ marginTop: 12, padding: "12px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
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
              <select value={incidentDraft.risk_id ?? ""} onChange={e => setIncidentDraft(d => ({ ...d, risk_id: e.target.value || null }))}
                style={{ width: "100%", fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                <option value="">— None —</option>
                {risks.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
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
          {incidentErr && <div style={{ marginBottom: 8, fontSize: 12, color: "#dc2626" }}>{incidentErr}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addIncident} disabled={savingIncident}
              style={{ fontSize: 12, background: savingIncident ? "#9ca3af" : "#dc2626", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", cursor: savingIncident ? "not-allowed" : "pointer", fontWeight: 600 }}>
              {savingIncident ? "Saving…" : "Report incident"}
            </button>
            <button onClick={() => { setAddingIncident(false); setIncidentDraft({}); setIncidentErr(""); }}
              style={{ fontSize: 12, background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 16px", cursor: "pointer", color: "var(--text)" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  );

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
          <div style={{ marginTop: 4, fontSize: 12, color: "var(--text)" }}>{register.residual_risk_argument}</div>
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-secondary)" }}>
            Next re-assessment scheduled in 6 months (automatic trigger created).
          </div>
        </Card>
        {incidentsSection}
      </div>
    );
  }

  return (
    <div>
      {/* Summary */}
      <Card>
        <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700 }}>Cycle summary</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
          {[
            { label: "Confirmed risks", value: confirmedRisks.length },
            { label: "Measures", value: totalMitigations },
            { label: "Vulnerable group risks", value: vulnerableGroupRisks.length },
            { label: "Misuse scenarios", value: confirmedRisks.reduce((a, r) => a + r.misuse_scenarios.length, 0) },
          ].map(k => (
            <div key={k.label} style={{ background: "var(--bg)", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#1147E9" }}>{k.value}</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3 }}>{k.label}</div>
            </div>
          ))}
        </div>

        <h4 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 10px", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
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

      {incidentsSection}

      {/* Residual risk argument */}
      <Card>
        <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700 }}>Residual risk argument</h3>
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
          <Label required>Expert sign-off argument</Label>
          <Textarea value={argument} onChange={setArgument} rows={4}
            placeholder="Describe why the residual risk is acceptable (or not): evidence, assumptions, open issues, safeguards in place…" />
        </div>
        <ErrorMsg msg={err} />
        <div style={{ marginTop: 14 }}>
          <button onClick={handleApprove} disabled={saving}
            style={{ background: saving ? "#9ca3af" : "#1147E9", color: "#fff", border: "none", borderRadius: 6, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Approving…" : "Approve register"}
          </button>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>
            Approving creates a 6-month re-assessment trigger.
          </div>
        </div>
      </Card>
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
  const addedInNext = new Set(diff?.added ?? []);
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
                  <span style={{ marginLeft: 8, fontWeight: 400, color: "var(--text-secondary)" }}>{r.category} · {r.severity}</span>
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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, gap: 12, color: "var(--text-secondary)", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
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
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text)" }}>
            Risk Assessment — {systemName}
          </h1>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "2px 0 0" }}>Art. 9 EU AI Act</p>
        </div>
        {register && (
          <span style={{ fontSize: 11, background: "var(--bg)", color: "var(--text-secondary)", padding: "4px 10px", borderRadius: 8 }}>
            {register.id} · {register.status}
          </span>
        )}
        {register && (
          <button onClick={() => exportReport(systemName, register, risks)}
            style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "var(--text)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
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
        <MitigateStep risks={risks} onRisksChange={setRisks} onNext={() => setStep("plan")} />
      )}
      {step === "plan" && register && (
        <PlanStep register={register} risks={risks} onRegisterUpdated={setRegister} onNext={() => setStep("approve")} />
      )}
      {step === "approve" && register && (
        <ApproveStep register={register} risks={risks} onApprove={handleApprove} />
      )}

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
