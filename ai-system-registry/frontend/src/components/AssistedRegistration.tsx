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

// The 7 descriptive field keys the backend conversation converges on, with
// human-readable labels for the collected-fields summary.
const FIELD_LABELS: Record<string, string> = {
  system_name: "System Name",
  purpose: "Purpose",
  department: "Department",
  use_case: "Use Case",
  people_affected: "People Affected",
  decision_context: "Decision Context",
  human_involvement: "Human Involvement",
};

const GREETING =
  "Hi! I'll help you register your AI system. Just describe what it does in your own words — " +
  "for example \"a tool that screens job applicants\" — and I'll take it from there.";

function displayName(u: UserSummary) {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return full ? `${full} (${u.username})` : u.username;
}

export default function AssistedRegistration({ open, onClose, onSuccess }: Props) {
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [inferredFlags, setInferredFlags] = useState<RationaleItem[]>([]);
  const [classification, setClassification] = useState<ClassificationResult | null>(null);

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

  // Reset everything each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setTranscript([{ role: "assistant", content: GREETING }]);
    setFields({});
    setInput("");
    setBusy(false);
    setComplete(false);
    setDegraded(false);
    setInferredFlags([]);
    setClassification(null);
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

  // Keep the chat scrolled to the latest message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript, busy]);

  if (!open) return null;

  async function runTurn(nextTranscript: ChatMessage[]) {
    setBusy(true);
    try {
      const res = await api.assistTurn(nextTranscript, fields);
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
    if (!text || busy || complete) return;
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
    setTranscript((t) => [...t, { role: "user", content: `📎 Uploaded ${file.name}` }]);
    try {
      const res = await api.assistExtract(file);
      const extracted = res.extracted_fields || {};
      setFields((f) => ({ ...f, ...extracted }));
      const summary = Object.keys(extracted).length
        ? `I read ${file.name}${res.notes ? ` — ${res.notes}` : ""}. Let's continue.`
        : `I couldn't pull much from ${file.name}. Could you describe the system instead?`;
      setTranscript((t) => [...t, { role: "assistant", content: summary }]);
    } catch (err) {
      showToast(`Document extraction failed: ${(err as Error).message}`, true);
      setTranscript((t) => [...t, { role: "assistant", content: `I couldn't process ${file.name}.` }]);
    } finally {
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

  const collectedEntries = Object.entries(FIELD_LABELS)
    .map(([key, label]) => [label, fields[key]] as const)
    .filter(([, v]) => v !== undefined && v !== null && v !== "");

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget && !doneId) onClose(); }}>
      <div className="modal" style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <h2>✨ AI-Assisted Registration</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        {doneId ? (
          <div className="modal-body">
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
        ) : (
          <div className="modal-body">
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

            {!complete && (
              <div className="chat-input-row">
                <input
                  ref={fileRef}
                  type="file"
                  style={{ display: "none" }}
                  accept=".txt,.md,.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                  onChange={handleUpload}
                />
                <button className="btn-ghost" title="Upload a document" disabled={busy} onClick={() => fileRef.current?.click()}>📎</button>
                <input
                  type="text"
                  className="chat-input"
                  placeholder="Describe your AI system…"
                  value={input}
                  disabled={busy}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                />
                <button className="btn-primary" disabled={busy || !input.trim()} onClick={handleSend}>Send</button>
              </div>
            )}

            {collectedEntries.length > 0 && (
              <div className="panel" style={{ marginTop: 16 }}>
                <div className="panel-header">Collected details</div>
                <div className="panel-body">
                  <div className="review-grid">
                    {collectedEntries.map(([label, value]) => (
                      <div key={label} style={{ display: "contents" }}>
                        <span className="review-label">{label}</span>
                        <span className="review-value">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {complete && (
              <>
                {degraded && (
                  <div className="msg-strip warn" style={{ marginTop: 16 }}>
                    We reached the question limit. You can register with what we have, or the assigned
                    engineer can refine the details later.
                  </div>
                )}
                {classification && (
                  <div className="classification-box">
                    <h4>Estimated Classification</h4>
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
                  <div className="panel" style={{ marginTop: 16 }}>
                    <div className="panel-header">Why this classification</div>
                    <div className="panel-body">
                      <ul className="rationale-list">
                        {inferredFlags.map((f) => (
                          <li key={f.flag}>
                            <code>{f.flag}</code> — {f.rationale}
                            <span className="rationale-confidence"> ({Math.round(f.confidence * 100)}% confident)</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                <div className="form-grid single" style={{ marginTop: 16 }}>
                  <div className="form-group">
                    <label className="required" htmlFor="assist_engineer">Assign to AI Engineer</label>
                    <select className="form-select" id="assist_engineer" value={assigneeUsername} onChange={(e) => setAssigneeUsername(e.target.value)}>
                      <option value="">— select an engineer —</option>
                      {engineers.map((u) => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="assist_co">Pre-assign Compliance Officer (optional)</label>
                    <select className="form-select" id="assist_co" value={complianceOfficerUsername} onChange={(e) => setComplianceOfficerUsername(e.target.value)}>
                      <option value="">— let the engineer choose —</option>
                      {complianceOfficers.map((u) => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <div className="modal-footer">
          {doneId ? (
            <button className="btn-primary" onClick={onClose}>Done</button>
          ) : (
            <>
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              {complete && (
                <button className="btn-primary" onClick={handleRegister} disabled={registering}>
                  {registering && <span className="spinner" />} Register System
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
