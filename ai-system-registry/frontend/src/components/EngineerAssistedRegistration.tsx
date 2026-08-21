import { useState, useEffect, useRef } from "react";
import { TierBadge } from "./Badges";
import { api } from "../api/client";
import { useToast } from "../App";
import type { AISystem, ChatMessage, RationaleItem, ClassificationResult, UserSummary } from "../types";

interface Props {
  open: boolean;
  system: AISystem;
  onClose: () => void;
  onSuccess: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  description:      "Description",
  intended_purpose: "Intended Purpose",
  version:          "Version",
  provider:         "Provider",
  org_name:         "Organisation Name",
  system_type:      "System Type",
  lifecycle:        "Lifecycle State",
  autonomy_level:   "Autonomy Level",
};

const ENUM_OPTIONS: Record<string, { value: string; label: string }[]> = {
  system_type: [
    { value: "application", label: "Application" },
    { value: "model",       label: "Model" },
    { value: "component",   label: "Component" },
    { value: "service",     label: "Service" },
  ],
  lifecycle: [
    { value: "development", label: "Development" },
    { value: "testing",     label: "Testing" },
    { value: "conformity",  label: "Conformity" },
    { value: "market",      label: "On Market" },
  ],
  autonomy_level: [
    { value: "decision_support",   label: "Decision support" },
    { value: "human_in_the_loop",  label: "Human in the loop" },
    { value: "human_on_the_loop",  label: "Human on the loop" },
    { value: "fully_automated",    label: "Fully automated" },
  ],
};

const ALL_FIELD_KEYS = Object.keys(FIELD_LABELS);
const TOTAL_FIELDS = ALL_FIELD_KEYS.length;

const PROHIBITED_FLAGS: [string, string][] = [
  ["subliminal_manipulation",            "Subliminal manipulation"],
  ["exploits_vulnerability",             "Exploits vulnerability"],
  ["social_scoring_public",              "Social scoring (public authority)"],
  ["real_time_biometric_public",         "Real-time biometric ID in public"],
  ["emotion_recognition_workplace",      "Emotion recognition (workplace/education)"],
  ["untargeted_facial_scraping",         "Untargeted facial image scraping"],
  ["predictive_policing",                "Predictive policing"],
  ["biometric_categorisation_sensitive", "Biometric categorisation (sensitive attrs.)"],
];
const ANNEX_III_FLAGS: [string, string][] = [
  ["is_biometric_identification", "Biometric identification"],
  ["is_critical_infrastructure",  "Critical infrastructure"],
  ["is_education_related",        "Education & vocational training"],
  ["is_employment_related",       "Employment & worker management"],
  ["is_credit_scoring",           "Credit scoring"],
  ["is_public_service",           "Public services"],
  ["is_law_enforcement",          "Law enforcement"],
  ["is_migration",                "Migration & border control"],
  ["is_judicial_admin",           "Justice & democratic processes"],
];
const LIMITED_FLAGS: [string, string][] = [
  ["is_chatbot",                  "Chatbot / direct user interaction"],
  ["generates_synthetic_content", "Generates synthetic content"],
];

const GREETING =
  "Hi! I'll help you complete the technical registration. " +
  "You can upload a model card or technical spec, or just describe the system — version, provider, deployment context, and so on.";

function displayName(u: UserSummary) {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return full ? `${full} (${u.username})` : u.username;
}

function IconPaperclip() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
  );
}

function IconSparkle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
    </svg>
  );
}

function CheckItem({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check-item">
      <input type="checkbox" id={id} checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function CollapsiblePanel({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="panel">
      <div className="panel-header" onClick={() => setOpen(o => !o)}>
        {title} <span>{open ? "▼" : "▶"}</span>
      </div>
      {open && <div className="panel-body">{children}</div>}
    </div>
  );
}

export default function EngineerAssistedRegistration({ open, system, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<0 | 1>(0);

  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [degraded, setDegraded] = useState(false);

  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [inferredFlags, setInferredFlags] = useState<RationaleItem[]>([]);
  const [classification, setClassification] = useState<ClassificationResult | null>(null);

  const [flagsConfirmed, setFlagsConfirmed] = useState(false);

  const [complianceOfficers, setComplianceOfficers] = useState<UserSummary[]>([]);
  const [complianceOfficerUsername, setComplianceOfficerUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;
    setFields({});
    setStep(0);
    setTranscript([{ role: "assistant", content: GREETING }]);
    setInput("");
    setBusy(false);
    setComplete(false);
    setDegraded(false);
    setFlags({});
    setInferredFlags([]);
    setClassification(null);
    setFlagsConfirmed(false);
    setComplianceOfficerUsername(system.compliance_officer_username ?? "");
    setSubmitting(false);
    api.getUsersByRole("ai_compliance_officer").then(setComplianceOfficers).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript, busy]);

  if (!open) return null;

  const filledCount = ALL_FIELD_KEYS.filter(k => {
    const v = fields[k]; return v !== undefined && v !== null && v !== "";
  }).length;

  async function runTurn(nextTranscript: ChatMessage[], overrideFields?: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await api.engineerAssistTurn(system.id, nextTranscript, overrideFields ?? fields);
      setFields(res.extracted_fields || {});
      if (res.message) setTranscript([...nextTranscript, { role: "assistant", content: res.message }]);
      else setTranscript(nextTranscript);
      if (res.complete) {
        setComplete(true);
        setDegraded(res.degraded);
        setInferredFlags(res.inferred_flags || []);
        setClassification(res.classification);
        const flagMap: Record<string, boolean> = {};
        for (const f of (res.inferred_flags || [])) {
          if (typeof f.value === "boolean") flagMap[f.flag] = f.value;
        }
        setFlags(flagMap);
      }
    } catch (e) {
      showToast(`Assistant unavailable: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  }

  function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const next: ChatMessage[] = [...transcript, { role: "user", content: text }];
    setTranscript(next);
    runTurn(next);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
    setBusy(true);
    const uploadMsg: ChatMessage = { role: "user", content: `Uploaded: ${file.name}` };
    setTranscript(t => [...t, uploadMsg]);
    const currentTranscript = [...transcript, uploadMsg];
    try {
      const res = await api.engineerAssistExtract(system.id, file);
      const extracted = res.extracted_fields || {};
      const merged = { ...fields, ...extracted };
      setFields(merged);
      const notes = res.notes ? ` — ${res.notes}` : "";
      const summary = Object.keys(extracted).length
        ? `Extracted from ${file.name}${notes}.`
        : `Couldn't extract much from ${file.name}. Please describe the system.`;
      const assistMsg: ChatMessage = { role: "assistant", content: summary };
      const nextTranscript = [...currentTranscript, assistMsg];
      setTranscript(nextTranscript);
      if (ALL_FIELD_KEYS.every(k => { const v = merged[k]; return v !== undefined && v !== null && v !== ""; })) setComplete(true);
      setBusy(false);
      if (Object.keys(extracted).length) await runTurn(nextTranscript, merged);
    } catch (err) {
      showToast(`Document extraction failed: ${(err as Error).message}`, true);
      setTranscript(t => [...t, { role: "assistant", content: `Couldn't process ${file.name}.` }]);
      setBusy(false);
    }
  }

  function handleFieldChange(key: string, value: string) {
    setFields(f => ({ ...f, [key]: value }));
    setFlagsConfirmed(false);
  }

  async function handleSubmit() {
    if (submitting) return;
    if (!complianceOfficerUsername) {
      showToast("Please assign a Compliance Officer before submitting", true);
      return;
    }
    setSubmitting(true);
    const payload: Record<string, unknown> = {
      description:      String(fields.description ?? ""),
      intended_purpose: String(fields.intended_purpose ?? ""),
      version:          String(fields.version ?? ""),
      provider:         String(fields.provider ?? ""),
      org_name:         String(fields.org_name ?? ""),
      system_type:      String(fields.system_type ?? "application"),
      lifecycle:        String(fields.lifecycle ?? "development"),
      autonomy_level:   String(fields.autonomy_level ?? "decision_support"),
      compliance_officer_username: complianceOfficerUsername,
      ...flags,
    };
    if (inferredFlags.length) payload.classification_rationale = inferredFlags;
    try {
      await api.updateSystem(system.id, payload);
      await api.submitForReview(system.id, complianceOfficerUsername);
      showToast("Technical details saved. System forwarded to compliance.");
      onSuccess();
    } catch (e) {
      showToast(`Save failed: ${(e as Error).message}`, true);
    } finally {
      setSubmitting(false);
    }
  }

  const STEPS = ["Describe & collect fields", "Risk flags & submit"];

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: step === 0 ? 960 : 720 }}>
        <div className="modal-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <IconSparkle /> AI-Assisted Technical Review
          </h2>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginLeft: 8 }}>
            {system.name} · {system.id}
          </div>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        <div className="wizard-steps">
          {STEPS.map((label, i) => (
            <div key={i} className={`wizard-step${i === step ? " active" : i < step ? " done" : ""}`}>
              <span className="step-num">{i + 1}</span> {label}
            </div>
          ))}
        </div>

        {/* ── STEP 0: Chat + field review ── */}
        {step === 0 && (
          <>
            <div className="assist-progress-strip">
              <div className="assist-progress-bar">
                <div className="assist-progress-fill" style={{
                  width: `${(filledCount / TOTAL_FIELDS) * 100}%`,
                  background: complete ? "#27ae60" : "var(--brand)",
                }} />
              </div>
              <span className="assist-progress-label">
                {complete ? "✓ " : ""}{filledCount} / {TOTAL_FIELDS} fields
              </span>
            </div>

            <div className="modal-body assist-split-wrap">
              <div className="assist-split-body">

                {/* LEFT: conversation */}
                <div className="assist-chat-col">
                  <div className="chat-scroll" ref={scrollRef}>
                    {transcript.filter(m => m.role !== "system").map((m, i) => (
                      <div key={i} className={`chat-bubble chat-${m.role}`}>{m.content}</div>
                    ))}
                    {busy && (
                      <div className="chat-bubble chat-assistant chat-typing">
                        <span className="spinner" /> thinking…
                      </div>
                    )}
                  </div>

                  <div className="chat-input-row">
                    <input ref={fileRef} type="file" style={{ display: "none" }}
                      accept=".txt,.md,.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                      onChange={handleUpload}
                    />
                    <button className="btn-ghost" title="Upload a document" disabled={busy}
                      onClick={() => fileRef.current?.click()} style={{ padding: "7px 10px" }}>
                      <IconPaperclip />
                    </button>
                    <input type="text" className="chat-input"
                      placeholder={busy ? "Thinking…" : "Describe the system technically…"}
                      value={input} disabled={busy}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") handleSend(); }}
                    />
                    <button className="btn-primary" disabled={busy || !input.trim()} onClick={handleSend}>Send</button>
                  </div>

                  {degraded && (
                    <div className="msg-strip warn">
                      Reached the question limit. Review and adjust the fields on the right, then proceed.
                    </div>
                  )}
                </div>

                {/* RIGHT: collected fields */}
                <div className="assist-fields-col">
                  <div className="assist-section-label">Collected Details — review and adjust</div>
                  <div className="assist-fields-grid">
                    {Object.entries(FIELD_LABELS).map(([key, label]) => {
                      const v = fields[key];
                      const strVal = (v !== undefined && v !== null && v !== "") ? String(v) : "";
                      const isWide = key === "description" || key === "intended_purpose";
                      const opts = ENUM_OPTIONS[key];

                      return (
                        <div key={key} className={`assist-field-row${isWide ? " assist-field-wide" : ""}`}>
                          <label htmlFor={`eng_field_${key}`}>{label}</label>
                          {opts ? (
                            <select id={`eng_field_${key}`} className="form-select" value={strVal}
                              onChange={e => handleFieldChange(key, e.target.value)}>
                              <option value="">— not set —</option>
                              {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          ) : isWide ? (
                            <textarea id={`eng_field_${key}`} value={strVal} rows={2}
                              onChange={e => handleFieldChange(key, e.target.value)}
                              placeholder={`Enter ${label.toLowerCase()}…`}
                            />
                          ) : (
                            <input type="text" id={`eng_field_${key}`} value={strVal}
                              onChange={e => handleFieldChange(key, e.target.value)}
                              placeholder={`Enter ${label.toLowerCase()}…`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={() => setStep(1)} disabled={filledCount === 0}
                title={filledCount === 0 ? "Fill at least one field first" : undefined}>
                Next →
              </button>
            </div>
          </>
        )}

        {/* ── STEP 1: Risk flags + assignment + submit ── */}
        {step === 1 && (
          <>
            <div className="modal-body" style={{ padding: 24 }}>

              {classification && (
                <div className="classification-box" style={{ marginBottom: 16 }}>
                  <h4>Inferred Classification</h4>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <TierBadge tier={classification.tier} />
                    <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{classification.basis}</span>
                  </div>
                  {inferredFlags.length > 0 && (
                    <ul className="rationale-list">
                      {inferredFlags.map(f => (
                        <li key={f.flag}>
                          {f.rationale}
                          <span className="rationale-confidence"> ({Math.round(f.confidence * 100)}% confident)</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="msg-strip info" style={{ marginBottom: 12 }}>
                Review the pre-checked risk flags below. Adjust as needed — the tier is recalculated on save.
              </div>

              <CollapsiblePanel title="Art. 5 — Prohibited Practices">
                <div className="check-grid">
                  {PROHIBITED_FLAGS.map(([k, label]) => (
                    <CheckItem key={k} id={k} label={label} checked={!!flags[k]} onChange={v => { setFlags(f => ({ ...f, [k]: v })); setFlagsConfirmed(false); }} />
                  ))}
                </div>
              </CollapsiblePanel>

              <CollapsiblePanel title="Annex III — High-Risk Categories">
                <div className="check-grid">
                  {ANNEX_III_FLAGS.map(([k, label]) => (
                    <CheckItem key={k} id={k} label={label} checked={!!flags[k]} onChange={v => { setFlags(f => ({ ...f, [k]: v })); setFlagsConfirmed(false); }} />
                  ))}
                </div>
              </CollapsiblePanel>

              <CollapsiblePanel title="GPAI — General Purpose AI">
                <div className="check-grid">
                  <CheckItem id="is_gpai" label="General-purpose AI model" checked={!!flags["is_gpai"]} onChange={v => { setFlags(f => ({ ...f, is_gpai: v })); setFlagsConfirmed(false); }} />
                </div>
              </CollapsiblePanel>

              <CollapsiblePanel title="Art. 50 — Limited Risk (Transparency)">
                <div className="check-grid">
                  {LIMITED_FLAGS.map(([k, label]) => (
                    <CheckItem key={k} id={k} label={label} checked={!!flags[k]} onChange={v => { setFlags(f => ({ ...f, [k]: v })); setFlagsConfirmed(false); }} />
                  ))}
                </div>
              </CollapsiblePanel>

              <label style={{
                display: "flex", alignItems: "flex-start", gap: 10, marginTop: 16,
                padding: "12px 14px", borderRadius: 6, cursor: "pointer",
                border: `2px solid ${flagsConfirmed ? "#27ae60" : "#e67e22"}`,
                background: flagsConfirmed ? "#f0faf4" : "#fffaf5",
              }}>
                <input type="checkbox" checked={flagsConfirmed} onChange={e => setFlagsConfirmed(e.target.checked)} style={{ marginTop: 2, flexShrink: 0, accentColor: "#27ae60", width: 16, height: 16 }} />
                <span style={{ fontSize: 13 }}>
                  {flagsConfirmed
                    ? <strong style={{ color: "#27ae60" }}>✓ All details reviewed and confirmed</strong>
                    : <strong style={{ color: "#e67e22" }}>⚠ Please review all details before submitting</strong>
                  }
                  <span style={{ color: "var(--text-secondary)", display: "block", fontSize: 12, marginTop: 2 }}>
                    Any changes after ticking this will reset the confirmation.
                  </span>
                </span>
              </label>

              <div className="assist-section-label" style={{ marginTop: 20 }}>Assignment</div>
              <div className="form-grid single">
                <div className="form-group">
                  <label className="required" htmlFor="eng_co">Assign Compliance Officer</label>
                  <select className="form-select" id="eng_co" value={complianceOfficerUsername} onChange={e => setComplianceOfficerUsername(e.target.value)}>
                    <option value="">Choose Compliance Officer</option>
                    {complianceOfficers.map(u => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
                  </select>
                </div>
              </div>

            </div>

            <div className="modal-footer">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-ghost" onClick={() => setStep(0)}>← Back</button>
              <button className="btn-primary" onClick={handleSubmit} disabled={submitting || !complianceOfficerUsername || !flagsConfirmed}>
                {submitting && <span className="spinner" />} Forward to Compliance
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
