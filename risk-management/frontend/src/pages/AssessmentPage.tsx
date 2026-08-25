import { useState, useEffect } from "react";
import { useToast } from "../App";
import { api } from "../api/client";
import type {
  DemoSummary, Risk, RiskClassification, VulnerableGroupAssessment,
  RelatedIncident, Mitigation, ResidualRiskArgument, Step,
} from "../types";

const STEPS: { key: Step; label: string }[] = [
  { key: "demo",     label: "System" },
  { key: "identify", label: "Identify" },
  { key: "evaluate", label: "Evaluate" },
  { key: "mitigate", label: "Mitigate" },
  { key: "export",   label: "Export" },
];

const SEV_ORDER = ["critical", "high", "medium", "low"];

function sevClass(s: string) {
  const m: Record<string, string> = { critical: "sev-critical", high: "sev-high", medium: "sev-medium", low: "sev-low" };
  return "badge " + (m[s?.toLowerCase()] ?? "badge-unknown");
}

function riskLevelClass(level: string) {
  const m: Record<string, string> = { unacceptable: "badge-prohibited", high: "badge-high", limited: "badge-limited", minimal: "badge-minimal" };
  return "badge " + (m[level?.toLowerCase()] ?? "badge-unknown");
}

function downloadBlob(content: string, filename: string, mime: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
}

/* ── Demo selector step ─────────────────────────────────────────────── */
function DemoStep({
  onSelect,
  useLlm,
  setUseLlm,
  useRiskAtlasNexus,
  setUseRiskAtlasNexus,
}: {
  onSelect: (id: string | null, desc: string, meta: Record<string, unknown>, code?: string) => void;
  useLlm: boolean;
  setUseLlm: (v: boolean) => void;
  useRiskAtlasNexus: boolean;
  setUseRiskAtlasNexus: (v: boolean) => void;
}) {
  const toast = useToast();
  const [demos, setDemos] = useState<DemoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [custom, setCustom] = useState(false);
  const [desc, setDesc] = useState("");
  const [sourceCode, setSourceCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("employment");
  const [inputTab, setInputTab] = useState<"docs" | "code">("docs");

  useEffect(() => {
    api.getDemos()
      .then(r => setDemos(r.demos))
      .catch(e => toast(String(e), true))
      .finally(() => setLoading(false));
  }, []);

  function handleDemo(id: string) {
    api.getDemo(id)
      .then(d => onSelect(id, d.system_description, d.metadata as Record<string, unknown>))
      .catch(e => toast(String(e), true));
  }

  function handleCustom() {
    if (!desc.trim() || !name.trim()) { toast("Enter system name and description", true); return; }
    const meta: Record<string, unknown> = {
      name, version: "1.0", description: desc.slice(0, 120),
      annex_iii_category: category, annex_iii_point: "",
      developer_org: "Custom", intended_purpose: name,
      intended_users: ["analyst"], deployment_context: "custom",
      data_inputs: [], ai_techniques: [],
    };
    onSelect(null, desc, meta, sourceCode);
  }

  return (
    <div className="content">
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>LLM-assisted identification</span>
        <label className="toggle" title={useLlm ? "LLM on" : "LLM off (rule-based)"}>
          <input type="checkbox" checked={useLlm} onChange={e => setUseLlm(e.target.checked)} />
          <span className="slider" />
        </label>
        <span style={{ fontSize: 12, color: useLlm ? "var(--brand)" : "var(--text-secondary)" }}>
          {useLlm ? "Ollama on" : "Rule-based"}
        </span>
        <span style={{ marginLeft: 20, fontSize: 13, color: "var(--text-secondary)" }}>IBM Risk Atlas Nexus</span>
        <label className="toggle" title={useRiskAtlasNexus ? "Risk Atlas Nexus on" : "Risk Atlas Nexus off"}>
          <input type="checkbox" checked={useRiskAtlasNexus} onChange={e => setUseRiskAtlasNexus(e.target.checked)} />
          <span className="slider" />
        </label>
        <span style={{ fontSize: 12, color: useRiskAtlasNexus ? "var(--brand)" : "var(--text-secondary)" }}>
          {useRiskAtlasNexus ? "Atlas on" : "Atlas off"}
        </span>
      </div>

      {loading ? (
        <div className="loading-center"><span className="spinner spinner-lg" /></div>
      ) : (
        <>
          <p className="section-title" style={{ marginBottom: 12 }}>Select a demo system or enter your own</p>
          <div className="card-grid" style={{ marginBottom: 20 }}>
            {demos.map(d => (
              <div key={d.id} className="card" style={{ cursor: "pointer" }} onClick={() => handleDemo(d.id)}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>{d.description}</div>
                <span className="chip">{d.annex_iii_category}</span>
                <span className="chip">Annex III.{d.annex_iii_point}</span>
              </div>
            ))}
            <div className="card" style={{ cursor: "pointer", borderStyle: "dashed" }}
              onClick={() => setCustom(v => !v)}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>+ Custom system</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Paste your own system description</div>
            </div>
          </div>

          {custom && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="section-title" style={{ marginBottom: 12 }}>Custom system</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, display: "block", marginBottom: 4 }}>System name *</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)}
                    style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13 }}
                    placeholder="My AI System" />
                </div>
                <div>
                  <label style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Annex III category</label>
                  <select value={category} onChange={e => setCategory(e.target.value)}
                    style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13 }}>
                    <option value="employment">Employment</option>
                    <option value="essential_services">Essential services</option>
                    <option value="law_enforcement">Law enforcement</option>
                    <option value="education">Education</option>
                    <option value="critical_infrastructure">Critical infrastructure</option>
                    <option value="migration">Migration</option>
                    <option value="administration_of_justice">Administration of justice</option>
                    <option value="biometric">Biometric</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                  <button
                    className={inputTab === "docs" ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
                    onClick={() => setInputTab("docs")}
                    type="button"
                  >Documentation</button>
                  <button
                    className={inputTab === "code" ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
                    onClick={() => setInputTab("code")}
                    type="button"
                  >Source Code (optional)</button>
                </div>
                {inputTab === "docs" ? (
                  <>
                    <label style={{ fontSize: 12, display: "block", marginBottom: 4 }}>System description *</label>
                    <textarea value={desc} onChange={e => setDesc(e.target.value)}
                      style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, minHeight: 100, fontFamily: "inherit" }}
                      placeholder="Describe the AI system, its purpose, data inputs, and deployment context…" />
                  </>
                ) : (
                  <>
                    <label style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Source code snippet (optional — aids risk identification)</label>
                    <textarea value={sourceCode} onChange={e => setSourceCode(e.target.value)}
                      style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 12, minHeight: 120, fontFamily: "monospace" }}
                      placeholder={"# Paste relevant source code here (up to 3000 chars used)\ndef predict(features):\n    ..."} />
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                      First 3000 characters will be analysed alongside the documentation.
                    </div>
                  </>
                )}
              </div>
              <button className="btn-primary" onClick={handleCustom}>Start assessment →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Identify step ───────────────────────────────────────────────────── */
function IdentifyStep({
  risks, loading, backendUsed, onNext,
}: {
  risks: Risk[]; loading: boolean; backendUsed: string;
  onNext: () => void;
}) {
  if (loading) return <div className="loading-center"><span className="spinner spinner-lg" /><span>Identifying risks…</span></div>;

  return (
    <div className="content">
      <div className="msg-strip info" style={{ marginBottom: 12 }}>
        Found <strong>{risks.length}</strong> candidate risk(s) via <em>{backendUsed}</em>.
        Proceed to evaluate and confirm each risk.
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Risk</th><th>Category</th><th>Severity</th><th>Art. 9 step</th><th>Source</th>
            </tr>
          </thead>
          <tbody>
            {risks.length === 0 ? (
              <tr className="empty-row"><td colSpan={5}>No risks identified</td></tr>
            ) : risks.map(r => (
              <tr key={r.id}>
                <td>
                  <div className="row-name">{r.title}</div>
                  <div className="row-sub">{r.description.slice(0, 80)}{r.description.length > 80 ? "…" : ""}</div>
                </td>
                <td><span className="chip">{r.category}</span></td>
                <td><span className={sevClass(r.severity)}>{r.severity}</span></td>
                <td style={{ fontSize: 12 }}>{r.article_9_step}</td>
                <td><span className="chip">{r.source}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button className="btn-primary" onClick={onNext} disabled={risks.length === 0}>
          Evaluate risks →
        </button>
      </div>
    </div>
  );
}

/* ── Evaluate step ───────────────────────────────────────────────────── */
function EvaluateStep({
  risks, classification, vgAssessments, incidents, loading, onRisksChange, onNext,
}: {
  risks: Risk[];
  classification: RiskClassification | null;
  vgAssessments: VulnerableGroupAssessment[];
  incidents: RelatedIncident[];
  loading: boolean;
  onRisksChange: (risks: Risk[]) => void;
  onNext: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (loading) return <div className="loading-center"><span className="spinner spinner-lg" /><span>Evaluating risks…</span></div>;

  function toggle(id: string) { setOpen(prev => ({ ...prev, [id]: !prev[id] })); }

  function confirm(id: string, val: boolean) {
    onRisksChange(risks.map(r => r.id === id ? { ...r, confirmed: val, dismissed: val ? false : r.dismissed } : r));
  }

  function dismiss(id: string, val: boolean) {
    onRisksChange(risks.map(r => r.id === id ? { ...r, dismissed: val, confirmed: val ? false : r.confirmed } : r));
  }

  function setNotes(id: string, notes: string) {
    onRisksChange(risks.map(r => r.id === id ? { ...r, review_notes: notes } : r));
  }

  const confirmed = risks.filter(r => r.confirmed).length;
  const dismissed = risks.filter(r => r.dismissed).length;
  const sorted = [...risks].sort((a, b) => SEV_ORDER.indexOf(a.severity.toLowerCase()) - SEV_ORDER.indexOf(b.severity.toLowerCase()));

  return (
    <div className="content">
      {classification && (
        <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>EU AI Act risk level:</span>
          <span className={riskLevelClass(classification.risk_level)}>{classification.risk_level.toUpperCase()}</span>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{classification.rationale}</span>
        </div>
      )}

      <div className="kpi-row" style={{ padding: 0, marginBottom: 14 }}>
        <div className="kpi-card"><div className="kpi-value">{risks.length}</div><div className="kpi-label">Total</div></div>
        <div className="kpi-card"><div className="kpi-value">{confirmed}</div><div className="kpi-label">Confirmed</div></div>
        <div className="kpi-card"><div className="kpi-value">{dismissed}</div><div className="kpi-label">Dismissed</div></div>
        <div className="kpi-card"><div className="kpi-value">{risks.length - confirmed - dismissed}</div><div className="kpi-label">Pending review</div></div>
      </div>

      {sorted.map(r => (
        <div key={r.id} className="accordion">
          <div className="accordion-header" onClick={() => toggle(r.id)}>
            <span style={{ flex: 1 }}>{r.title}</span>
            <span className={sevClass(r.severity)} style={{ marginRight: 8 }}>{r.severity}</span>
            {r.confirmed && <span className="badge badge-minimal">✓ confirmed</span>}
            {r.dismissed && <span className="badge badge-unknown">dismissed</span>}
            <span style={{ color: "var(--text-secondary)", fontSize: 18, marginLeft: 6 }}>{open[r.id] ? "▲" : "▼"}</span>
          </div>
          {open[r.id] && (
            <div className="accordion-body">
              <p style={{ fontSize: 13, marginBottom: 8 }}>{r.description}</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                <span className="chip">Category: {r.category}</span>
                <span className="chip">Likelihood: {r.likelihood}</span>
                <span className="chip">Art. 9: {r.article_9_step}</span>
                {r.affects_vulnerable_groups && <span className="chip" style={{ background: "#fde8d0", color: "#8b3a00" }}>Vulnerable groups</span>}
              </div>
              {r.misuse_scenarios.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div className="section-title" style={{ marginBottom: 6 }}>Misuse scenarios</div>
                  {r.misuse_scenarios.map(s => (
                    <div key={s.id} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                      <strong>{s.actor}</strong>: {s.description}
                      {s.vulnerable_group && <span className="chip" style={{ marginLeft: 6 }}>{s.vulnerable_group}</span>}
                    </div>
                  ))}
                </div>
              )}
              <div className="risk-confirm-row">
                <label>
                  <input type="checkbox" checked={r.confirmed} onChange={e => confirm(r.id, e.target.checked)} />
                  Confirm risk
                </label>
                <label>
                  <input type="checkbox" checked={r.dismissed} onChange={e => dismiss(r.id, e.target.checked)} />
                  Dismiss
                </label>
              </div>
              <textarea className="notes-input" value={r.review_notes}
                onChange={e => setNotes(r.id, e.target.value)}
                placeholder="Reviewer notes…" />
            </div>
          )}
        </div>
      ))}

      {incidents.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div className="section-title" style={{ marginBottom: 10 }}>Related AI incidents (Art. 9(2)(a))</div>
          {incidents.map(i => (
            <div key={i.aiid_id} className="incident-item">
              <div className="incident-id">{i.aiid_id}</div>
              <div className="incident-title">{i.title}</div>
              <div className="incident-summary">{i.summary}</div>
              <a href={i.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--brand)" }}>View incident →</a>
            </div>
          ))}
        </div>
      )}

      {vgAssessments.some(v => v.affected) && (
        <div style={{ marginTop: 20 }}>
          <div className="section-title" style={{ marginBottom: 10 }}>Vulnerable group impacts (Art. 9(9))</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Group</th><th>Affected</th><th>Confidence</th><th>Safeguards</th></tr></thead>
              <tbody>
                {vgAssessments.filter(v => v.affected).map(v => (
                  <tr key={v.group}>
                    <td>{v.group}</td>
                    <td><span className="badge badge-high">yes</span></td>
                    <td><span className="chip">{v.confidence}</span></td>
                    <td style={{ fontSize: 12 }}>{v.recommended_safeguards.slice(0, 2).join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button className="btn-primary" onClick={onNext} disabled={confirmed === 0}>
          Assign mitigations ({confirmed} confirmed) →
        </button>
        {confirmed === 0 && <span style={{ fontSize: 12, color: "var(--text-secondary)", alignSelf: "center" }}>Confirm at least one risk to continue</span>}
      </div>
    </div>
  );
}

/* ── Mitigate step ───────────────────────────────────────────────────── */
function MitigateStep({
  mitigations, residualArg, loading, onNext,
}: {
  mitigations: Mitigation[];
  residualArg: ResidualRiskArgument | null;
  loading: boolean;
  onNext: () => void;
}) {
  if (loading) return <div className="loading-center"><span className="spinner spinner-lg" /><span>Assigning mitigations…</span></div>;

  const byLevel = ["eliminate", "reduce", "mitigate", "inform"];
  const grouped: Record<string, Mitigation[]> = {};
  mitigations.forEach(m => { (grouped[m.hierarchy_level] ??= []).push(m); });

  return (
    <div className="content">
      <div className="kpi-row" style={{ padding: 0, marginBottom: 16 }}>
        <div className="kpi-card"><div className="kpi-value">{mitigations.length}</div><div className="kpi-label">Total measures</div></div>
        {byLevel.map(l => (
          <div key={l} className="kpi-card">
            <div className="kpi-value">{grouped[l]?.length ?? 0}</div>
            <div className="kpi-label" style={{ textTransform: "capitalize" }}>{l}</div>
          </div>
        ))}
      </div>

      {byLevel.map(level => {
        const items = grouped[level] ?? [];
        if (items.length === 0) return null;
        return (
          <div key={level} style={{ marginBottom: 16 }}>
            <div className="section-title" style={{ textTransform: "capitalize", marginBottom: 8 }}>{level}</div>
            {items.map(m => (
              <div key={m.id} className="mit-item">
                <div className="mit-title">{m.title}</div>
                <div className="mit-meta">{m.source} · {m.applicable_risk_categories.join(", ")}</div>
                <div className="mit-guidance">{m.implementation_guidance}</div>
              </div>
            ))}
          </div>
        );
      })}

      {residualArg && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginBottom: 12 }}>Residual risk argument (Art. 9(5))</div>
          <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 14 }}>{residualArg.claim}</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <span className={riskLevelClass(residualArg.overall_verdict === "acceptable" ? "minimal" : residualArg.overall_verdict === "conditional" ? "limited" : "high")}>
              {residualArg.overall_verdict}
            </span>
          </div>
          <div className="arg-section">
            <div className="arg-label">Evidence</div>
            <ul className="arg-list">{residualArg.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
          <div className="arg-section">
            <div className="arg-label">Assumptions</div>
            <ul className="arg-list">{residualArg.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>
          {residualArg.open_issues.length > 0 && (
            <div className="arg-section">
              <div className="arg-label">Open issues</div>
              <ul className="arg-list">{residualArg.open_issues.map((o, i) => <li key={i}>{o}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button className="btn-primary" onClick={onNext}>Export register →</button>
      </div>
    </div>
  );
}

/* ── Report view ─────────────────────────────────────────────────────── */
function ReportView({
  systemMeta, risks, mitigations, classification, residualArg, vgAssessments, incidents,
}: {
  systemMeta: Record<string, unknown>;
  risks: Risk[];
  mitigations: Mitigation[];
  classification: RiskClassification | null;
  residualArg: ResidualRiskArgument | null;
  vgAssessments: VulnerableGroupAssessment[];
  incidents: RelatedIncident[];
}) {
  const confirmed = risks.filter(r => r.confirmed);
  const byLevel = ["eliminate", "reduce", "mitigate", "inform"];
  const grouped: Record<string, Mitigation[]> = {};
  mitigations.forEach(m => { (grouped[m.hierarchy_level] ??= []).push(m); });

  const sevColors: Record<string, { bg: string; color: string; border: string }> = {
    critical: { bg: "#ffd5d5", color: "#8b0000", border: "#f5b8b8" },
    high:     { bg: "#fde8d0", color: "#8b3a00", border: "#f5c890" },
    medium:   { bg: "#fff3c4", color: "#7a5900", border: "#f5df84" },
    low:      { bg: "#d5f5e3", color: "#1a5c35", border: "#9cdcb8" },
  };
  const levelColors: Record<string, { bg: string; color: string; border: string }> = {
    unacceptable: { bg: "#ffd5d5", color: "#8b0000", border: "#f5b8b8" },
    high:         { bg: "#fde8d0", color: "#8b3a00", border: "#f5c890" },
    limited:      { bg: "#fff3c4", color: "#7a5900", border: "#f5df84" },
    minimal:      { bg: "#d5f5e3", color: "#1a5c35", border: "#9cdcb8" },
  };
  const verdictColors: Record<string, { bg: string; color: string }> = {
    acceptable:   { bg: "#d5f5e3", color: "#1a5c35" },
    conditional:  { bg: "#fff3c4", color: "#7a5900" },
    unacceptable: { bg: "#ffd5d5", color: "#8b0000" },
  };

  const S: Record<string, React.CSSProperties> = {
    report: { background: "#fff", borderRadius: 10, border: "1px solid #e4e6e8", overflow: "hidden", boxShadow: "0 2px 12px rgba(34,54,73,.08)" },
    header: { background: "linear-gradient(135deg, #0a6ed1 0%, #084fa3 100%)", color: "#fff", padding: "28px 32px" },
    headerTitle: { fontSize: 22, fontWeight: 700, marginBottom: 6 },
    headerSub: { fontSize: 13, opacity: 0.85 },
    section: { padding: "24px 32px", borderBottom: "1px solid #e4e6e8" },
    sectionLast: { padding: "24px 32px" },
    sectionTitle: { fontSize: 11, fontWeight: 700, color: "#556b82", textTransform: "uppercase" as const, letterSpacing: "0.6px", marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid #e4e6e8" },
    metaGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 },
    metaItem: { background: "#f8f9fa", borderRadius: 8, padding: "10px 14px" },
    metaLabel: { fontSize: 11, color: "#556b82", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.4px", marginBottom: 3 },
    metaValue: { fontSize: 13, color: "#1d2d3e", fontWeight: 500 },
    badge: { display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" as const },
    riskCard: { border: "1px solid #e4e6e8", borderRadius: 8, marginBottom: 12, overflow: "hidden" },
    riskHeader: { display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#f8f9fa", borderBottom: "1px solid #e4e6e8" },
    riskBody: { padding: "14px 16px" },
    riskDesc: { fontSize: 13, color: "#1d2d3e", lineHeight: 1.6, marginBottom: 10 },
    chip: { display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 10, fontSize: 12, background: "#eef1f4", color: "#556b82", marginRight: 4 },
    mitCard: { border: "1px solid #e4e6e8", borderRadius: 8, padding: "12px 16px", marginBottom: 8, background: "#fafbfc" },
    mitTitle: { fontWeight: 600, fontSize: 13, marginBottom: 4 },
    mitMeta: { fontSize: 12, color: "#556b82", marginBottom: 6 },
    mitGuidance: { fontSize: 12, color: "#1d2d3e", lineHeight: 1.5 },
    levelHeader: { fontSize: 13, fontWeight: 700, color: "#1d2d3e", textTransform: "capitalize" as const, marginBottom: 8, marginTop: 16, display: "flex", alignItems: "center", gap: 8 },
    levelDot: { width: 10, height: 10, borderRadius: "50%", display: "inline-block" },
    table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
    th: { background: "#f8f9fa", padding: "8px 12px", textAlign: "left" as const, fontSize: 11, fontWeight: 700, color: "#556b82", textTransform: "uppercase" as const, letterSpacing: "0.5px", borderBottom: "2px solid #e4e6e8" },
    td: { padding: "8px 12px", borderBottom: "1px solid #e4e6e8", verticalAlign: "middle" as const },
    argBox: { background: "#f8f9fa", borderRadius: 8, padding: "16px 20px" },
    argLabel: { fontSize: 11, fontWeight: 700, color: "#556b82", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 6, marginTop: 12 },
    argList: { listStyle: "none", padding: 0 },
    kpiRow: { display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" as const },
    kpiCard: { flex: 1, minWidth: 110, background: "#f8f9fa", borderRadius: 8, padding: "12px 16px", textAlign: "center" as const },
    kpiVal: { fontSize: 24, fontWeight: 700, color: "#0a6ed1" },
    kpiLbl: { fontSize: 11, color: "#556b82", marginTop: 3, fontWeight: 500 },
  };

  const levelDotColor: Record<string, string> = { eliminate: "#8b0000", reduce: "#8b3a00", mitigate: "#0a6ed1", inform: "#1a5c35" };

  return (
    <div style={S.report}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerTitle}>AI Risk Management Register</div>
        <div style={S.headerSub}>
          {String(systemMeta.name ?? "—")} · v{String(systemMeta.version ?? "1.0")} · Generated {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
        </div>
        {classification && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, opacity: 0.9 }}>EU AI Act risk level:</span>
            <span style={{ ...S.badge, ...(levelColors[classification.risk_level?.toLowerCase()] ?? { bg: "#eee", color: "#555", border: "#ccc" }), background: "rgba(255,255,255,0.2)", color: "#fff", border: "1px solid rgba(255,255,255,0.4)" }}>
              {classification.risk_level?.toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div style={{ ...S.section, background: "#fff" }}>
        <div style={S.kpiRow}>
          <div style={S.kpiCard}><div style={S.kpiVal}>{risks.length}</div><div style={S.kpiLbl}>Risks identified</div></div>
          <div style={S.kpiCard}><div style={S.kpiVal}>{confirmed.length}</div><div style={S.kpiLbl}>Confirmed</div></div>
          <div style={S.kpiCard}><div style={{ ...S.kpiVal, color: "#8b0000" }}>{confirmed.filter(r => r.severity.toLowerCase() === "critical" || r.severity.toLowerCase() === "high").length}</div><div style={S.kpiLbl}>Critical / High</div></div>
          <div style={S.kpiCard}><div style={S.kpiVal}>{mitigations.length}</div><div style={S.kpiLbl}>Mitigations</div></div>
          <div style={S.kpiCard}>
            <div style={{ ...S.kpiVal, color: residualArg?.overall_verdict === "acceptable" ? "#1a5c35" : residualArg?.overall_verdict === "conditional" ? "#7a5900" : "#8b0000" }}>
              {residualArg?.overall_verdict ?? "—"}
            </div>
            <div style={S.kpiLbl}>Residual risk</div>
          </div>
        </div>

        {/* System metadata */}
        <div style={S.sectionTitle}>System under assessment</div>
        <div style={S.metaGrid}>
          {[
            ["Name", systemMeta.name],
            ["Version", systemMeta.version],
            ["Developer", systemMeta.developer_org],
            ["Annex III category", systemMeta.annex_iii_category],
            ["Deployment context", systemMeta.deployment_context],
            ["Intended purpose", systemMeta.intended_purpose],
          ].map(([label, value]) => value ? (
            <div key={String(label)} style={S.metaItem}>
              <div style={S.metaLabel}>{String(label)}</div>
              <div style={S.metaValue}>{String(value)}</div>
            </div>
          ) : null)}
        </div>
      </div>

      {/* Confirmed risks */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Confirmed risks ({confirmed.length})</div>
        {confirmed.length === 0 && <div style={{ color: "#556b82", fontSize: 13 }}>No risks confirmed.</div>}
        {confirmed.map(r => {
          const sc = sevColors[r.severity?.toLowerCase()] ?? sevColors.low;
          return (
            <div key={r.id} style={S.riskCard}>
              <div style={S.riskHeader}>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{r.title}</span>
                <span style={{ ...S.badge, background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>{r.severity}</span>
                <span style={S.chip}>{r.category}</span>
              </div>
              <div style={S.riskBody}>
                <p style={S.riskDesc}>{r.description}</p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={S.chip}>Likelihood: {r.likelihood}</span>
                  <span style={S.chip}>Art. 9: {r.article_9_step}</span>
                  {r.affects_vulnerable_groups && <span style={{ ...S.chip, background: "#fde8d0", color: "#8b3a00" }}>Vulnerable groups</span>}
                  {r.taxonomy_mappings.map(t => (
                    <span key={t.taxonomy + t.category} style={S.chip}>{t.taxonomy}: {t.category}</span>
                  ))}
                </div>
                {r.misuse_scenarios.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#556b82", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Misuse scenarios</div>
                    {r.misuse_scenarios.map(s => (
                      <div key={s.id} style={{ fontSize: 12, padding: "4px 0", borderTop: "1px solid #e4e6e8", display: "flex", gap: 8 }}>
                        <span style={{ fontWeight: 600, minWidth: 100 }}>{s.actor}</span>
                        <span style={{ color: "#1d2d3e" }}>{s.description}</span>
                        {s.vulnerable_group && <span style={{ ...S.chip, background: "#fde8d0", color: "#8b3a00" }}>{s.vulnerable_group}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {r.review_notes && (
                  <div style={{ marginTop: 8, padding: "8px 12px", background: "#f8f9fa", borderRadius: 6, fontSize: 12, color: "#556b82" }}>
                    <strong>Reviewer notes:</strong> {r.review_notes}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mitigations */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Mitigation measures ({mitigations.length})</div>
        {byLevel.map(level => {
          const items = grouped[level] ?? [];
          if (items.length === 0) return null;
          return (
            <div key={level}>
              <div style={S.levelHeader}>
                <span style={{ ...S.levelDot, background: levelDotColor[level] ?? "#888" }} />
                {level} ({items.length})
              </div>
              {items.map(m => (
                <div key={m.id} style={S.mitCard}>
                  <div style={S.mitTitle}>{m.title}</div>
                  <div style={S.mitMeta}>{m.source} · {m.applicable_risk_categories.join(", ")}</div>
                  <div style={S.mitGuidance}>{m.implementation_guidance}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Vulnerable groups */}
      {vgAssessments.some(v => v.affected) && (
        <div style={S.section}>
          <div style={S.sectionTitle}>Vulnerable group impacts (Art. 9(9))</div>
          <table style={S.table}>
            <thead>
              <tr>
                {["Group", "Confidence", "Evidence", "Safeguards"].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {vgAssessments.filter(v => v.affected).map(v => (
                <tr key={v.group}>
                  <td style={S.td}><strong>{v.group}</strong></td>
                  <td style={S.td}><span style={S.chip}>{v.confidence}</span></td>
                  <td style={{ ...S.td, fontSize: 12 }}>{v.evidence}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{v.recommended_safeguards.slice(0, 2).join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Related incidents */}
      {incidents.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionTitle}>Related AI incidents (Art. 9(2)(a))</div>
          {incidents.map(i => (
            <div key={i.aiid_id} style={{ ...S.mitCard, marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#0a6ed1", textTransform: "uppercase", marginBottom: 3 }}>{i.aiid_id}</div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{i.title}</div>
              <div style={{ fontSize: 12, color: "#556b82", marginBottom: 6, lineHeight: 1.4 }}>{i.summary}</div>
              <a href={i.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#0a6ed1" }}>View incident →</a>
            </div>
          ))}
        </div>
      )}

      {/* Residual risk */}
      {residualArg && (
        <div style={S.sectionLast}>
          <div style={S.sectionTitle}>Residual risk argument (Art. 9(5))</div>
          <div style={S.argBox}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>{residualArg.claim}</div>
            {(() => {
              const vc = verdictColors[residualArg.overall_verdict] ?? { bg: "#eee", color: "#555" };
              return <span style={{ ...S.badge, background: vc.bg, color: vc.color }}>{residualArg.overall_verdict}</span>;
            })()}
            <div style={S.argLabel}>Evidence</div>
            <ul style={S.argList}>{residualArg.evidence.map((e, i) => <li key={i} style={{ padding: "3px 0", fontSize: 13, display: "flex", gap: 8 }}><span style={{ color: "#0a6ed1" }}>•</span>{e}</li>)}</ul>
            <div style={S.argLabel}>Assumptions</div>
            <ul style={S.argList}>{residualArg.assumptions.map((a, i) => <li key={i} style={{ padding: "3px 0", fontSize: 13, display: "flex", gap: 8 }}><span style={{ color: "#0a6ed1" }}>•</span>{a}</li>)}</ul>
            {residualArg.open_issues.length > 0 && (
              <>
                <div style={S.argLabel}>Open issues</div>
                <ul style={S.argList}>{residualArg.open_issues.map((o, i) => <li key={i} style={{ padding: "3px 0", fontSize: 13, display: "flex", gap: 8 }}><span style={{ color: "#8b0000" }}>•</span>{o}</li>)}</ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Export step ─────────────────────────────────────────────────────── */
function ExportStep({
  jsonOutput, markdownOutput, instructionsForUse, dpiaOutput, loading,
  systemMeta, risks, mitigations, classification, residualArg, vgAssessments, incidents,
}: {
  jsonOutput: string; markdownOutput: string;
  instructionsForUse: string; dpiaOutput: string;
  loading: boolean;
  systemMeta: Record<string, unknown>;
  risks: Risk[];
  mitigations: Mitigation[];
  classification: RiskClassification | null;
  residualArg: ResidualRiskArgument | null;
  vgAssessments: VulnerableGroupAssessment[];
  incidents: RelatedIncident[];
}) {
  const [tab, setTab] = useState<"report" | "ifu" | "dpia" | "json" | "md">("report");

  if (loading) return <div className="loading-center"><span className="spinner spinner-lg" /><span>Generating export…</span></div>;

  return (
    <div className="content">
      <div className="msg-strip success" style={{ marginBottom: 14 }}>
        Assessment complete. View the styled report or download JSON/Markdown.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <button className={tab === "report" ? "btn-primary btn-sm" : "btn-ghost btn-sm"} onClick={() => setTab("report")}>Report</button>
        <button className={tab === "ifu"    ? "btn-primary btn-sm" : "btn-ghost btn-sm"} onClick={() => setTab("ifu")}>Art. 13 IFU</button>
        <button className={tab === "dpia"   ? "btn-primary btn-sm" : "btn-ghost btn-sm"} onClick={() => setTab("dpia")}>DPIA</button>
        <button className={tab === "json"   ? "btn-primary btn-sm" : "btn-ghost btn-sm"} onClick={() => setTab("json")}>JSON</button>
        <button className={tab === "md"     ? "btn-primary btn-sm" : "btn-ghost btn-sm"} onClick={() => setTab("md")}>Markdown</button>
        <div style={{ flex: 1 }} />
        <button className="btn-ghost btn-sm" onClick={() => downloadBlob(jsonOutput, "risk-register.json", "application/json")}>↓ JSON</button>
        <button className="btn-ghost btn-sm" onClick={() => downloadBlob(markdownOutput, "risk-register.md", "text/markdown")}>↓ Markdown</button>
        {instructionsForUse && (
          <button className="btn-ghost btn-sm" onClick={() => downloadBlob(instructionsForUse, "instructions-for-use.md", "text/markdown")}>↓ IFU</button>
        )}
        {dpiaOutput && (
          <button className="btn-ghost btn-sm" onClick={() => downloadBlob(dpiaOutput, "dpia.md", "text/markdown")}>↓ DPIA</button>
        )}
      </div>
      {tab === "report" ? (
        <ReportView
          systemMeta={systemMeta} risks={risks} mitigations={mitigations}
          classification={classification} residualArg={residualArg}
          vgAssessments={vgAssessments} incidents={incidents}
        />
      ) : tab === "ifu" ? (
        <div className="export-block">
          {instructionsForUse || "Instructions for Use document not yet generated."}
        </div>
      ) : tab === "dpia" ? (
        <div className="export-block">
          {dpiaOutput || "DPIA is being generated…"}
        </div>
      ) : (
        <div className="export-block">
          {tab === "json" ? jsonOutput : markdownOutput}
        </div>
      )}
    </div>
  );
}

/* ── Main wizard ─────────────────────────────────────────────────────── */
export default function AssessmentPage() {
  const toast = useToast();
  const [step, setStep] = useState<Step>("demo");
  const [useLlm, setUseLlm] = useState(false);
  const [useRiskAtlasNexus, setUseRiskAtlasNexus] = useState(false);

  const [systemDesc, setSystemDesc] = useState("");
  const [systemMeta, setSystemMeta] = useState<Record<string, unknown>>({});
  const [sourceCode, setSourceCode] = useState("");

  const [risks, setRisks] = useState<Risk[]>([]);
  const [backendUsed, setBackendUsed] = useState("");
  const [classification, setClassification] = useState<RiskClassification | null>(null);
  const [vgAssessments, setVgAssessments] = useState<VulnerableGroupAssessment[]>([]);
  const [incidents, setIncidents] = useState<RelatedIncident[]>([]);

  const [mitigations, setMitigations] = useState<Mitigation[]>([]);
  const [residualArg, setResidualArg] = useState<ResidualRiskArgument | null>(null);

  const [jsonOutput, setJsonOutput] = useState("");
  const [markdownOutput, setMarkdownOutput] = useState("");
  const [instructionsForUse, setInstructionsForUse] = useState("");
  const [dpiaOutput, setDpiaOutput] = useState("");

  const [loading, setLoading] = useState(false);

  function stepIndex(s: Step) { return STEPS.findIndex(x => x.key === s); }

  async function handleDemoSelect(_id: string | null, desc: string, meta: Record<string, unknown>, code?: string) {
    setSystemDesc(desc);
    setSystemMeta(meta);
    if (code !== undefined) setSourceCode(code);
    setLoading(true);
    setStep("identify");
    try {
      const res = await api.identifyRisks({
        system_description: desc,
        source_code: code ?? sourceCode,
        metadata: meta,
        use_llm: useLlm,
        use_stub: _id !== null && !useRiskAtlasNexus,
        use_risk_atlas_nexus: useRiskAtlasNexus,
      });
      setRisks(res.risks);
      setBackendUsed(res.backend_used);
    } catch (e) {
      toast(String(e), true);
    } finally {
      setLoading(false);
    }
  }

  async function handleIdentifyNext() {
    setLoading(true);
    setStep("evaluate");
    try {
      const res = await api.evaluateRisks({
        system_description: systemDesc,
        metadata: systemMeta,
        risks,
        use_llm: useLlm,
      });
      setRisks(res.risks);
      setClassification(res.risk_classification);
      setVgAssessments(res.vulnerable_group_assessments);
      setIncidents(res.related_incidents);
    } catch (e) {
      toast(String(e), true);
    } finally {
      setLoading(false);
    }
  }

  async function handleEvaluateNext() {
    setLoading(true);
    setStep("mitigate");
    try {
      const res = await api.assignMitigations({
        metadata: systemMeta,
        risks,
        use_llm: useLlm,
      });
      setMitigations(res.mitigations);
      setResidualArg(res.residual_risk_argument);
    } catch (e) {
      toast(String(e), true);
    } finally {
      setLoading(false);
    }
  }

  async function handleMitigateNext() {
    setLoading(true);
    setStep("export");
    try {
      const register = {
        id: `RRM-${Date.now()}`,
        created_at: new Date().toISOString(),
        system: systemMeta,
        risks,
        mitigations,
        risk_classification: classification,
        vulnerable_group_assessments: vgAssessments,
        related_incidents: incidents,
        residual_risk_argument: residualArg,
        generation_config: { use_llm: useLlm },
        review_complete: true,
        residual_risk_acceptable: residualArg?.overall_verdict === "acceptable",
        notes: "",
        audit_log: [],
      };
      const res = await api.exportRegister({ register });
      setJsonOutput(res.json_output);
      setMarkdownOutput(res.markdown_output);
      setInstructionsForUse(res.instructions_for_use ?? "");
      // Generate DPIA in parallel (non-blocking — if it fails we don't block the export)
      api.generateDpia({ register })
        .then(d => setDpiaOutput(d.markdown_output))
        .catch(() => setDpiaOutput(""));
    } catch (e) {
      toast(String(e), true);
    } finally {
      setLoading(false);
    }
  }

  function resetWizard() {
    setStep("demo"); setRisks([]); setClassification(null); setVgAssessments([]);
    setIncidents([]); setMitigations([]); setResidualArg(null);
    setJsonOutput(""); setMarkdownOutput(""); setInstructionsForUse(""); setDpiaOutput("");
  }

  const currentIdx = stepIndex(step);

  return (
    <>
      <div className="page-header">
        <h1>⚖ Risk Management — Art. 9 EU AI Act</h1>
        {step !== "demo" && (
          <button className="btn-ghost btn-sm" onClick={resetWizard}>← New assessment</button>
        )}
      </div>

      <div className="stepper">
        {STEPS.map((s, i) => (
          <div key={s.key} className={`step-tab ${step === s.key ? "active" : i < currentIdx ? "done" : ""}`}>
            <span className="step-num">{i < currentIdx ? "✓" : i + 1}</span>
            {s.label}
          </div>
        ))}
      </div>

      {step === "demo" && (
        <DemoStep
          onSelect={handleDemoSelect}
          useLlm={useLlm} setUseLlm={setUseLlm}
          useRiskAtlasNexus={useRiskAtlasNexus} setUseRiskAtlasNexus={setUseRiskAtlasNexus}
        />
      )}
      {step === "identify" && (
        <IdentifyStep risks={risks} loading={loading} backendUsed={backendUsed} onNext={handleIdentifyNext} />
      )}
      {step === "evaluate" && (
        <EvaluateStep
          risks={risks} classification={classification}
          vgAssessments={vgAssessments} incidents={incidents}
          loading={loading} onRisksChange={setRisks} onNext={handleEvaluateNext}
        />
      )}
      {step === "mitigate" && (
        <MitigateStep mitigations={mitigations} residualArg={residualArg} loading={loading} onNext={handleMitigateNext} />
      )}
      {step === "export" && (
        <ExportStep
          jsonOutput={jsonOutput} markdownOutput={markdownOutput}
          instructionsForUse={instructionsForUse} dpiaOutput={dpiaOutput}
          loading={loading}
          systemMeta={systemMeta} risks={risks} mitigations={mitigations}
          classification={classification} residualArg={residualArg}
          vgAssessments={vgAssessments} incidents={incidents}
        />
      )}
    </>
  );
}
