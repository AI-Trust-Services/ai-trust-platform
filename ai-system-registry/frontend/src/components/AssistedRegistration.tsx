import { useState, useEffect, useRef } from "react";
import { TierBadge } from "./Badges";
import { api } from "../api/client";
import { useToast } from "../App";
import type {
  ChatMessage, RationaleItem, ClassificationResult, UserSummary,
} from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  system_name: "System Name",
  purpose: "Purpose",
  department: "Department",
  use_case: "Use Case",
  people_affected: "People Affected",
  decision_context: "Decision Context",
  human_involvement: "Human Involvement",
};

const TOTAL_FIELDS = Object.keys(FIELD_LABELS).length;

const GREETING =
  "Hi! I'll help you register your AI system. Just describe what it does in your own words — " +
  "for example \"a tool that screens job applicants\" — and I'll take it from there.";

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

export default function AssistedRegistration({ open, onClose, onSuccess }: Props) {
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [inferredFlags, setInferredFlags] = useState<RationaleItem[]>([]);
  const [flagsConfirmed, setFlagsConfirmed] = useState(false);
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [wizardStep, setWizardStep] = useState<0 | 1>(0);

  const [engineers, setEngineers] = useState<UserSummary[]>([]);
  const [complianceOfficers, setComplianceOfficers] = useState<UserSummary[]>([]);
  const [assigneeUsername, setAssigneeUsername] = useState("");
  const [complianceOfficerUsername, setComplianceOfficerUsername] = useState("");
  const [registering, setRegistering] = useState(false);
  const [doneId, setDoneId] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;
    setTranscript([{ role: "assistant", content: GREETING }]);
    setFields({});
    setInput("");
    setBusy(false);
    setComplete(false);
    setDegraded(false);
    setInferredFlags([]);
    setFlagsConfirmed(false);
    setClassification(null);
    setWizardStep(0);
    setAssigneeUsername("");
    setComplianceOfficerUsername("");
    setRegistering(false);
    setDoneId(null);
    submitting.current = false;
    Promise.all([
      api.getUsersByRole("ai_engineer"),
      api.getUsersByRole("ai_compliance_officer"),
    ]).then(([eng, co]) => { setEngineers(eng); setComplianceOfficers(co); }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript, busy]);

  if (!open) return null;

  const filledCount = Object.keys(FIELD_LABELS).filter(k => {
    const v = fields[k];
    return v !== undefined && v !== null && v !== "";
  }).length;

  function handleFieldChange(key: string, value: string) {
    setFields(f => ({ ...f, [key]: value }));
    setFlagsConfirmed(false);
  }

  async function runTurn(nextTranscript: ChatMessage[], overrideFields?: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await api.assistTurn(nextTranscript, overrideFields ?? fields);
      setFields(res.extracted_fields || {});
      if (res.message) {
        setTranscript([...nextTranscript, { role: "assistant", content: res.message }]);
      } else {
        setTranscript(nextTranscript);
      }
      if (res.complete) {
        setComplete(true);
        setDegraded(res.degraded);
        setInferredFlags(res.inferred_flags || []);
        setClassification(res.classification);
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
      const res = await api.assistExtract(file);
      const extracted = res.extracted_fields || {};
      const merged = { ...fields, ...extracted };
      setFields(merged);
      const notes = res.notes ? ` — ${res.notes}` : "";
      const summary = Object.keys(extracted).length
        ? `I read ${file.name}${notes}.`
        : `I couldn't pull much from ${file.name}. Could you describe the system instead?`;
      const assistMsg: ChatMessage = { role: "assistant", content: summary };
      const nextTranscript = [...currentTranscript, assistMsg];
      setTranscript(nextTranscript);
      const allFilled = Object.keys(FIELD_LABELS).every(k => {
        const v = merged[k];
        return v !== undefined && v !== null && v !== "";
      });
      if (allFilled) setComplete(true);
      setBusy(false);
      if (Object.keys(extracted).length) {
        await runTurn(nextTranscript, merged);
      }
    } catch (err) {
      showToast(`Document extraction failed: ${(err as Error).message}`, true);
      setTranscript(t => [...t, { role: "assistant", content: `I couldn't process ${file.name}.` }]);
      setBusy(false);
    }
  }

  async function handleRegister() {
    if (!fields.system_name) { showToast("A system name is required", true); return; }
    if (!assigneeUsername) { showToast("Please assign an AI Engineer", true); return; }
    if (submitting.current) return;
    submitting.current = true;
    setRegistering(true);

    const payload: Record<string, unknown> = {
      name: fields.system_name,
      description: (fields.purpose as string) || "",
      intended_purpose: fields.purpose ?? null,
      department: fields.department ?? null,
      use_case: fields.use_case ?? null,
      people_affected: fields.people_affected ?? null,
      decision_context: fields.decision_context ?? null,
      autonomy_level: fields.human_involvement ?? null,
      assignee_username: assigneeUsername,
      compliance_officer_username: complianceOfficerUsername || null,
    };
    for (const f of inferredFlags) payload[f.flag] = f.value;
    if (inferredFlags.length) payload.classification_rationale = inferredFlags;

    try {
      const res = await api.intakeAssisted(payload);
      setDoneId(res.system.id);
      showToast("AI system registered and engineer notified");
      onSuccess();
    } catch (e) {
      showToast(`Registration failed: ${(e as Error).message}`, true);
    } finally {
      submitting.current = false;
      setRegistering(false);
    }
  }

  const canRegister = !!fields.system_name && !!assigneeUsername && !registering && flagsConfirmed;

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget && !doneId) onClose(); }}>
      <div className="modal" style={{ maxWidth: 960 }}>
        <div className="modal-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <IconSparkle /> AI-Assisted Registration
          </h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        {!doneId && (
          <div className="wizard-steps">
            <div className={`wizard-step${wizardStep === 0 ? " active" : " done"}`}>
              <span className="step-num">1</span> Describe your system
            </div>
            <div className={`wizard-step${wizardStep === 1 ? " active" : ""}`}>
              <span className="step-num">2</span> Assign &amp; Register
            </div>
          </div>
        )}

        {!doneId && wizardStep === 0 && (
          <div className="assist-progress-strip">
            <div className="assist-progress-bar">
              <div
                className="assist-progress-fill"
                style={{
                  width: `${(filledCount / TOTAL_FIELDS) * 100}%`,
                  background: complete ? "#27ae60" : "var(--brand)",
                }}
              />
            </div>
            <span className="assist-progress-label">
              {complete ? "✓ " : ""}{filledCount} / {TOTAL_FIELDS} fields
            </span>
          </div>
        )}

        {doneId ? (
          <div className="modal-body" style={{ padding: 24 }}>
            <div className="msg-strip info" style={{ marginBottom: 16 }}>
              AI system registered ({doneId}). The assigned engineer has been notified by email.
            </div>
            {classification && (
              <div className="classification-box">
                <h4>Classification</h4>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <TierBadge tier={classification.tier} />
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{classification.basis}</span>
                </div>
              </div>
            )}
          </div>
        ) : wizardStep === 0 ? (
          <div className="modal-body assist-split-wrap">
            <div className="assist-split-body">

              {/* LEFT: conversation */}
              <div className="assist-chat-col">
                <div className="chat-scroll" ref={scrollRef}>
                  {transcript.filter((m) => m.role !== "system").map((m, i) => (
                    <div key={i} className={`chat-bubble chat-${m.role}`}>{m.content}</div>
                  ))}
                  {busy && (
                    <div className="chat-bubble chat-assistant chat-typing">
                      <span className="spinner" /> thinking…
                    </div>
                  )}
                </div>

                <div className="chat-input-row">
                  <input
                    ref={fileRef}
                    type="file"
                    style={{ display: "none" }}
                    accept=".txt,.md,.pdf,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                    onChange={handleUpload}
                  />
                  <button
                    className="btn-ghost"
                    title="Upload a document"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                    style={{ padding: "7px 10px" }}
                  >
                    <IconPaperclip />
                  </button>
                  <input
                    type="text"
                    className="chat-input"
                    placeholder={busy ? "Thinking…" : "Your turn — describe your AI system…"}
                    value={input}
                    disabled={busy}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                  />
                  <button className="btn-primary" disabled={busy || !input.trim()} onClick={handleSend}>Send</button>
                </div>

                {degraded && (
                  <div className="msg-strip warn">
                    We reached the question limit. You can register with what we have, or the
                    assigned engineer can refine the details later.
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
                    const isWide = key === "purpose" || key === "decision_context";
                    return (
                      <div key={key} className={`assist-field-row${isWide ? " assist-field-wide" : ""}`}>
                        <label htmlFor={`assist_field_${key}`} className={key === "system_name" ? "required" : ""}>{label}</label>
                        {isWide ? (
                          <textarea
                            id={`assist_field_${key}`}
                            value={strVal}
                            onChange={(e) => handleFieldChange(key, e.target.value)}
                            placeholder={`Enter ${label.toLowerCase()}…`}
                            rows={2}
                          />
                        ) : (
                          <input
                            type="text"
                            id={`assist_field_${key}`}
                            value={strVal}
                            onChange={(e) => handleFieldChange(key, e.target.value)}
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
        ) : (
          /* STEP 2: classification summary + assignment */
          <div className="modal-body" style={{ padding: 24 }}>
            {classification && (
              <div className="classification-box" style={{ marginBottom: 16 }}>
                <h4>Preliminary Classification</h4>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <TierBadge tier={classification.tier} />
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{classification.basis}</span>
                </div>
                {classification.obligations.length > 0 ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Obligations:</div>
                    <ul className="obligation-list">
                      {classification.obligations.map((o) => <li key={o}>{o}</li>)}
                    </ul>
                  </>
                ) : (
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>No mandatory obligations.</span>
                )}
              </div>
            )}

            {inferredFlags.length > 0 && (
              <div className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-header">Why this classification</div>
                <div className="panel-body">
                  <ul className="rationale-list">
                    {inferredFlags.map((f) => (
                      <li key={f.flag}>
                        {f.rationale}
                        <span className="rationale-confidence"> ({Math.round(f.confidence * 100)}% confident)</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", borderRadius: 8,
              border: `2px solid ${flagsConfirmed ? "#27ae60" : "#e67e22"}`,
              background: flagsConfirmed ? "#f0faf4" : "#fffaf5",
            }}>
              <input type="checkbox" checked={flagsConfirmed} onChange={e => setFlagsConfirmed(e.target.checked)} style={{ marginTop: 2, flexShrink: 0, accentColor: "#27ae60", width: 16, height: 16 }} />
              <div>
                {flagsConfirmed
                  ? <strong style={{ color: "#27ae60" }}>✓ All details reviewed and confirmed</strong>
                  : <strong style={{ color: "#e67e22" }}>⚠ Please review all details before registering</strong>
                }
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                  Any changes after ticking this will reset the confirmation.
                </div>
              </div>
            </div>

            <div className="assist-section-label">Assignment</div>
            <div className="form-grid single">
              <div className="form-group">
                <label className="required" htmlFor="assist_engineer">Assign to AI Engineer</label>
                <select className="form-select" id="assist_engineer" value={assigneeUsername} onChange={(e) => setAssigneeUsername(e.target.value)}>
                  <option value="">Choose AI Engineer</option>
                  {engineers.map((u) => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="assist_co">Pre-assign Compliance Officer (optional)</label>
                <select className="form-select" id="assist_co" value={complianceOfficerUsername} onChange={(e) => setComplianceOfficerUsername(e.target.value)}>
                  <option value="">Choose Compliance Officer (optional)</option>
                  {complianceOfficers.map((u) => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        <div className="modal-footer">
          {doneId ? (
            <button className="btn-primary" onClick={onClose}>Done</button>
          ) : wizardStep === 0 ? (
            <>
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={() => setWizardStep(1)} disabled={!fields.system_name}>Next →</button>
            </>
          ) : (
            <>
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-ghost" onClick={() => setWizardStep(0)}>← Back</button>
              <span
                title={!fields.system_name ? "Enter a system name" : !assigneeUsername ? "Assign an AI Engineer first" : undefined}
                style={{ display: "inline-flex", cursor: canRegister ? undefined : "not-allowed" }}
              >
                <button
                  className="btn-primary"
                  onClick={handleRegister}
                  disabled={!canRegister}
                  style={{ pointerEvents: canRegister ? undefined : "none" }}
                >
                  {registering && <span className="spinner" />} Register System
                </button>
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
