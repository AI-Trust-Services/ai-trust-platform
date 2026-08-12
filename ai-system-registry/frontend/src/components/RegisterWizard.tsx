import { useState, useEffect, useRef, Fragment } from "react";
import { TierBadge } from "./Badges";
import { previewClassify, copyToClipboard } from "../utils";
import { api } from "../api/client";
import { useToast } from "../App";
import type { AISystem, AISystemFormData, UserSummary } from "../types";

const EMPTY_FORM: AISystemFormData = {
  name: "", version: "1.0.0", provider: "", org_name: "",
  org_role: "provider", provider_country: "DE", system_type: "application",
  autonomy_level: "decision_support", application_url: "",
  description: "", intended_purpose: "", lifecycle: "development",
  subliminal_manipulation: false, exploits_vulnerability: false,
  social_scoring_public: false, real_time_biometric_public: false,
  emotion_recognition_workplace: false, untargeted_facial_scraping: false,
  predictive_policing: false, biometric_categorisation_sensitive: false,
  is_biometric_identification: false, is_critical_infrastructure: false,
  is_education_related: false, is_employment_related: false,
  is_credit_scoring: false, is_public_service: false,
  is_law_enforcement: false, is_migration: false, is_judicial_admin: false,
  is_gpai: false, training_compute_flops: 0,
  is_chatbot: false, generates_synthetic_content: false,
};

const ENGINEER_STEPS = ["Purpose & Lifecycle", "Risk Flags", "Review"];
const OWNER_STEPS = ["System Details", "Assign & Register"];

function CollapsiblePanel({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="panel">
      <div className="panel-header" onClick={() => setOpen((o) => !o)}>
        {title} <span>{open ? "▼" : "▶"}</span>
      </div>
      {open && <div className="panel-body">{children}</div>}
    </div>
  );
}

function CheckItem({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: React.ChangeEventHandler<HTMLInputElement> }) {
  return (
    <label className="check-item">
      <input type="checkbox" id={id} checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  system?: AISystem;
}

export default function RegisterWizard({ open, onClose, onSuccess, system }: Props) {
  const isEngineerMode = !!system;
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<AISystemFormData>(EMPTY_FORM);
  const [assigneeUsername, setAssigneeUsername] = useState("");
  const [complianceOfficerUsername, setComplianceOfficerUsername] = useState("");
  const [engineers, setEngineers] = useState<UserSummary[]>([]);
  const [complianceOfficers, setComplianceOfficers] = useState<UserSummary[]>([]);
  const [ownerExtra, setOwnerExtra] = useState({ department: "", use_case: "", people_affected: "", decision_context: "" });
  const setOwnerField = (key: string, value: string) => { setOwnerExtra(x => ({ ...x, [key]: value })); setFlagsConfirmed(false); };
  const [loading, setLoading] = useState(false);
  const [flagsConfirmed, setFlagsConfirmed] = useState(false);
  const submitting = useRef(false);
  const [doneId, setDoneId] = useState<string | null>(null);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setDoneId(null);
    setFlagsConfirmed(false);
    submitting.current = false;
    if (isEngineerMode) {
      setForm({
        name: system.name || "",
        version: system.version || "1.0.0",
        provider: system.provider || "",
        org_name: system.org_name || "",
        org_role: system.org_role || "provider",
        provider_country: system.provider_country || "DE",
        system_type: system.system_type || "application",
        autonomy_level: system.autonomy_level || "decision_support",
        application_url: system.application_url || "",
        description: system.description || "",
        intended_purpose: system.intended_purpose || "",
        lifecycle: system.lifecycle || "development",
        subliminal_manipulation: system.subliminal_manipulation,
        exploits_vulnerability: system.exploits_vulnerability,
        social_scoring_public: system.social_scoring_public,
        real_time_biometric_public: system.real_time_biometric_public,
        emotion_recognition_workplace: system.emotion_recognition_workplace,
        untargeted_facial_scraping: system.untargeted_facial_scraping,
        predictive_policing: system.predictive_policing,
        biometric_categorisation_sensitive: system.biometric_categorisation_sensitive,
        is_biometric_identification: system.is_biometric_identification,
        is_critical_infrastructure: system.is_critical_infrastructure,
        is_education_related: system.is_education_related,
        is_employment_related: system.is_employment_related,
        is_credit_scoring: system.is_credit_scoring,
        is_public_service: system.is_public_service,
        is_law_enforcement: system.is_law_enforcement,
        is_migration: system.is_migration,
        is_judicial_admin: system.is_judicial_admin,
        is_gpai: system.is_gpai,
        training_compute_flops: system.training_compute_flops,
        is_chatbot: system.is_chatbot,
        generates_synthetic_content: system.generates_synthetic_content,
      });
      setComplianceOfficerUsername(system.compliance_officer_username || "");
      api.getUsersByRole("ai_compliance_officer")
        .then(setComplianceOfficers)
        .catch(() => {});
    } else {
      setForm(EMPTY_FORM);
      setAssigneeUsername("");
      setComplianceOfficerUsername("");
      setOwnerExtra({ department: "", use_case: "", people_affected: "", decision_context: "" });
      Promise.all([
        api.getUsersByRole("ai_engineer"),
        api.getUsersByRole("ai_compliance_officer"),
      ]).then(([eng, co]) => { setEngineers(eng); setComplianceOfficers(co); }).catch(() => {});
    }
  }, [open, isEngineerMode, system]);

  if (!open) return null;

  const set = (k: keyof AISystemFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const isCheckbox = (e.target as HTMLInputElement).type === "checkbox";
    setForm((f) => ({ ...f, [k]: isCheckbox ? (e.target as HTMLInputElement).checked : e.target.value }));
    setFlagsConfirmed(false);
  };
  const setNum = (k: keyof AISystemFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: parseFloat(e.target.value) || 0 }));
    setFlagsConfirmed(false);
  };

  const maxStep = isEngineerMode ? 2 : 1;

  function handleNext() {
    if (!isEngineerMode && step === 0 && !form.name.trim()) { showToast("System name is required", true); return; }
    setStep((s) => Math.min(s + 1, maxStep));
  }

  async function handleOwnerSubmit() {
    if (!form.name.trim()) { showToast("System name is required", true); return; }
    if (!assigneeUsername) { showToast("Please assign an AI Engineer", true); return; }
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      const result = await api.intake({ name: form.name, description: form.description, intended_purpose: form.intended_purpose || null, department: ownerExtra.department || null, use_case: ownerExtra.use_case || null, people_affected: ownerExtra.people_affected || null, decision_context: ownerExtra.decision_context || null, autonomy_level: form.autonomy_level || null, assignee_username: assigneeUsername, compliance_officer_username: complianceOfficerUsername || null } as never);
      setDoneId(result.id);
      showToast("AI system registered and engineer notified");
      onSuccess();
    } catch (e) {
      showToast(`Registration failed: ${(e as Error).message}`, true);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  async function handleEngineerSubmit() {
    if (!assigneeUsername) { showToast("Please assign a Compliance Officer", true); return; }
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      await api.updateSystem(system!.id, { ...form });
      await api.submitForReview(system!.id, assigneeUsername);
      setDoneId(system!.id);
      showToast("System details saved and submitted for review");
      onSuccess();
    } catch (e) {
      showToast(`Submission failed: ${(e as Error).message}`, true);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  function handleCopyId() {
    copyToClipboard(doneId!)
      .then(() => showToast("System ID copied"))
      .catch(() => showToast("Copy failed", true));
  }

  const preview = previewClassify(form, form.training_compute_flops);

  function displayName(u: UserSummary) {
    const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
    return full ? `${full} (${u.username})` : u.username;
  }

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget && !doneId) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>{isEngineerMode ? `Fill in details — ${system!.name}` : "Register AI System"}</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        {doneId ? (
          <div className="modal-body">
            <div className="msg-strip info" style={{ marginBottom: 16 }}>
              {isEngineerMode
                ? "System details saved and submitted for review. The compliance officer has been notified."
                : "AI system registered. The assigned engineer has been notified by email."}
            </div>
            {!isEngineerMode && (
              <div className="panel">
                <div className="panel-header">Telemetry Configuration</div>
                <div className="panel-body">
                  <p style={{ fontSize: 13, marginBottom: 12 }}>
                    Use this system ID as the telemetry service name
                    (e.g. <code style={{ fontFamily: "monospace" }}>OTEL_SERVICE_NAME</code>):
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{ background: "var(--bg)", border: "1px solid var(--border)", padding: "6px 12px", borderRadius: 6, fontSize: 13, fontFamily: "monospace", flex: 1 }}>
                      {doneId}
                    </code>
                    <button className="btn-ghost" onClick={handleCopyId} style={{ flexShrink: 0 }}>⎘ Copy ID</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {isEngineerMode && (
              <div className="wizard-steps">
                {ENGINEER_STEPS.map((label, i) => (
                  <div key={i} className={`wizard-step${i === step ? " active" : i < step ? " done" : ""}`}>
                    <span className="step-num">{i + 1}</span> {label}
                  </div>
                ))}
              </div>
            )}
            {!isEngineerMode && (
              <div className="wizard-steps">
                {OWNER_STEPS.map((label, i) => (
                  <div key={i} className={`wizard-step${i === step ? " active" : i < step ? " done" : ""}`}>
                    <span className="step-num">{i + 1}</span> {label}
                  </div>
                ))}
              </div>
            )}

            <div className="modal-body">
              {/* OWNER MODE step 0: System Details */}
              {!isEngineerMode && step === 0 && (
                <div className="wizard-page">
                  <div className="msg-strip info" style={{ marginBottom: 16 }}>
                    Provide a name and optionally a description, then assign an AI Engineer who will fill in the technical details.
                  </div>
                  <div className="form-grid">
                    <div className="form-group span2">
                      <label className="required" htmlFor="reg_name">System Name</label>
                      <input type="text" id="reg_name" value={form.name} onChange={set("name")} placeholder="e.g. Fraud Detection Model" />
                    </div>
                    <div className="form-group span2">
                      <label htmlFor="reg_description">Description (optional)</label>
                      <textarea id="reg_description" rows={2} value={form.description} onChange={set("description")} placeholder="Brief description of the AI system…" />
                    </div>
                    <div className="form-group span2">
                      <label htmlFor="reg_purpose">Purpose / Intended Use (optional)</label>
                      <textarea id="reg_purpose" rows={2} value={form.intended_purpose} onChange={set("intended_purpose")} placeholder="Describe the intended purpose and deployment context…" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="reg_dept">Department (optional)</label>
                      <input type="text" id="reg_dept" value={ownerExtra.department} onChange={(e) => setOwnerField("department", e.target.value)} placeholder="e.g. HR, Finance, Operations" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="reg_use_case">Use Case (optional)</label>
                      <input type="text" id="reg_use_case" value={ownerExtra.use_case} onChange={(e) => setOwnerField("use_case", e.target.value)} placeholder="e.g. candidate screening" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="reg_people">People Affected (optional)</label>
                      <input type="text" id="reg_people" value={ownerExtra.people_affected} onChange={(e) => setOwnerField("people_affected", e.target.value)} placeholder="e.g. job applicants, employees" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="reg_autonomy">Human Involvement</label>
                      <select className="form-select" id="reg_autonomy" value={form.autonomy_level} onChange={set("autonomy_level")}>
                        <option value="decision_support">Decision support</option>
                        <option value="human_in_the_loop">Human in the loop</option>
                        <option value="human_on_the_loop">Human on the loop</option>
                        <option value="fully_automated">Fully automated</option>
                      </select>
                    </div>
                    <div className="form-group span2">
                      <label htmlFor="reg_context">Decision Context (optional)</label>
                      <textarea id="reg_context" rows={2} value={ownerExtra.decision_context} onChange={(e) => setOwnerField("decision_context", e.target.value)} placeholder="Describe how and where decisions are made by this system…" />
                    </div>
                  </div>
                </div>
              )}

              {/* OWNER MODE step 1: Assign & Register */}
              {!isEngineerMode && step === 1 && (
                <div className="wizard-page">
                  <div className="msg-strip info" style={{ marginBottom: 16 }}>
                    Assign an AI Engineer who will fill in the technical details for <strong>{form.name}</strong>.
                  </div>
                  <div className="form-grid single">
                    <div className="form-group">
                      <label className="required" htmlFor="reg_engineer">Assign to AI Engineer</label>
                      <select className="form-select" id="reg_engineer" value={assigneeUsername} onChange={(e) => setAssigneeUsername(e.target.value)}>
                        <option value="">Choose AI Engineer</option>
                        {engineers.map((u) => (
                          <option key={u.username} value={u.username}>{displayName(u)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="reg_co">Pre-assign Compliance Officer (optional)</label>
                      <select className="form-select" id="reg_co" value={complianceOfficerUsername} onChange={(e) => setComplianceOfficerUsername(e.target.value)}>
                        <option value="">Choose Compliance Officer (optional)</option>
                        {complianceOfficers.map((u) => (
                          <option key={u.username} value={u.username}>{displayName(u)}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* ENGINEER MODE step 0: Purpose & Lifecycle */}
              {isEngineerMode && step === 0 && (
                <div className="wizard-page">
                  <div className="form-grid single">
                    <div className="form-group">
                      <label htmlFor="eng_description">Description</label>
                      <textarea id="eng_description" rows={3} value={form.description} onChange={set("description")} placeholder="Brief description of the AI system…" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="eng_purpose">Intended Purpose</label>
                      <textarea id="eng_purpose" rows={3} value={form.intended_purpose} onChange={set("intended_purpose")} placeholder="Describe the intended purpose and deployment context…" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="eng_lifecycle">Lifecycle State</label>
                      <select className="form-select" id="eng_lifecycle" value={form.lifecycle} onChange={set("lifecycle")}>
                        <option value="development">Development</option>
                        <option value="testing">Testing</option>
                        <option value="conformity">Conformity</option>
                        <option value="market">On Market</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="eng_version">Version</label>
                      <input type="text" id="eng_version" value={form.version} onChange={set("version")} placeholder="1.0.0" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="eng_provider">Provider Name</label>
                      <input type="text" id="eng_provider" value={form.provider} onChange={set("provider")} />
                    </div>
                    <div className="form-group">
                      <label htmlFor="eng_org_name">Organisation Name</label>
                      <input type="text" id="eng_org_name" value={form.org_name} onChange={set("org_name")} />
                    </div>
                    <div className="form-group">
                      <label htmlFor="eng_system_type">System Type</label>
                      <select className="form-select" id="eng_system_type" value={form.system_type} onChange={set("system_type")}>
                        <option value="application">Application</option>
                        <option value="model">Model</option>
                        <option value="component">Component</option>
                        <option value="service">Service</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="eng_autonomy">Autonomy Level</label>
                      <select className="form-select" id="eng_autonomy" value={form.autonomy_level} onChange={set("autonomy_level")}>
                        <option value="decision_support">Decision support</option>
                        <option value="human_in_the_loop">Human in the loop</option>
                        <option value="human_on_the_loop">Human on the loop</option>
                        <option value="fully_automated">Fully automated</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* ENGINEER MODE step 1: Risk Flags */}
              {isEngineerMode && step === 1 && (
                <div className="wizard-page">
                  <div className="msg-strip info">
                    Check all applicable flags. The risk tier will be determined automatically from these flags.
                  </div>
                  <CollapsiblePanel title="Art. 5 — Prohibited Practices">
                    <div className="check-grid">
                      {[
                        ["subliminal_manipulation", "Subliminal manipulation"],
                        ["exploits_vulnerability", "Exploits vulnerability"],
                        ["social_scoring_public", "Social scoring (public authority)"],
                        ["real_time_biometric_public", "Real-time biometric ID in public"],
                        ["emotion_recognition_workplace", "Emotion recognition (workplace/education)"],
                        ["untargeted_facial_scraping", "Untargeted facial image scraping"],
                        ["predictive_policing", "Predictive policing"],
                        ["biometric_categorisation_sensitive", "Biometric categorisation (sensitive attrs.)"],
                      ].map(([k, label]) => (
                        <CheckItem key={k} id={k} label={label} checked={form[k as keyof AISystemFormData] as boolean} onChange={set(k as keyof AISystemFormData)} />
                      ))}
                    </div>
                  </CollapsiblePanel>
                  <CollapsiblePanel title="Annex III — High-Risk Categories">
                    <div className="check-grid">
                      {[
                        ["is_biometric_identification", "Biometric identification"],
                        ["is_critical_infrastructure", "Critical infrastructure"],
                        ["is_education_related", "Education & vocational training"],
                        ["is_employment_related", "Employment & worker management"],
                        ["is_credit_scoring", "Credit scoring"],
                        ["is_public_service", "Public services"],
                        ["is_law_enforcement", "Law enforcement"],
                        ["is_migration", "Migration & border control"],
                        ["is_judicial_admin", "Justice & democratic processes"],
                      ].map(([k, label]) => (
                        <CheckItem key={k} id={k} label={label} checked={form[k as keyof AISystemFormData] as boolean} onChange={set(k as keyof AISystemFormData)} />
                      ))}
                    </div>
                  </CollapsiblePanel>
                  <CollapsiblePanel title="GPAI — General Purpose AI">
                    <div className="check-grid">
                      <CheckItem id="is_gpai" label="General-purpose AI model" checked={form.is_gpai} onChange={set("is_gpai")} />
                    </div>
                    {form.is_gpai && (
                      <div className="form-group" style={{ marginTop: 12, maxWidth: 320 }}>
                        <label htmlFor="f_flops">Training Compute (FLOPs)</label>
                        <input type="number" id="f_flops" value={form.training_compute_flops || ""} onChange={setNum("training_compute_flops")} placeholder="0" min={0} />
                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>≥ 10²⁵ FLOPs = systemic risk</span>
                      </div>
                    )}
                  </CollapsiblePanel>
                  <CollapsiblePanel title="Art. 50 — Limited Risk (Transparency)">
                    <div className="check-grid">
                      <CheckItem id="is_chatbot" label="Chatbot / direct user interaction" checked={form.is_chatbot} onChange={set("is_chatbot")} />
                      <CheckItem id="generates_synthetic_content" label="Generates synthetic content" checked={form.generates_synthetic_content} onChange={set("generates_synthetic_content")} />
                    </div>
                  </CollapsiblePanel>
                  <div style={{
                    display: "flex", alignItems: "flex-start", gap: 10, marginTop: 16, padding: "12px 14px", borderRadius: 8,
                    border: `2px solid ${flagsConfirmed ? "#27ae60" : "#e67e22"}`,
                    background: flagsConfirmed ? "#f0faf4" : "#fffaf5",
                  }}>
                    <input type="checkbox" checked={flagsConfirmed} onChange={e => setFlagsConfirmed(e.target.checked)} style={{ marginTop: 2, flexShrink: 0, accentColor: "#27ae60", width: 16, height: 16 }} />
                    <div>
                      {flagsConfirmed
                        ? <strong style={{ color: "#27ae60" }}>✓ All details reviewed and confirmed</strong>
                        : <strong style={{ color: "#e67e22" }}>⚠ Please review all details before continuing</strong>
                      }
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                        Any changes after ticking this will reset the confirmation.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ENGINEER MODE step 2: Review + assign compliance officer */}
              {isEngineerMode && step === 2 && (
                <div className="wizard-page">
                  <div className="msg-strip info">
                    Review the details below, then assign a Compliance Officer and submit for review.
                  </div>
                  <div className="panel">
                    <div className="panel-header">Summary</div>
                    <div className="panel-body">
                      <div className="review-grid">
                        {[
                          ["Name", system!.name],
                          ["Description", form.description || "—"],
                          ["Purpose", form.intended_purpose || "—"],
                          ["Version", form.version || "1.0.0"],
                          ["Provider", form.provider || "—"],
                          ["System Type", form.system_type],
                          ["Autonomy Level", form.autonomy_level.replace(/_/g, " ")],
                          ["Lifecycle", form.lifecycle],
                        ].map(([label, value]) => (
                          <Fragment key={label}>
                            <span className="review-label">{label}</span>
                            <span className="review-value">{value}</span>
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="classification-box">
                    <h4>Estimated Classification (preview)</h4>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <TierBadge tier={preview.tier} />
                      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{preview.basis}</span>
                    </div>
                    {preview.obligations.length > 0 ? (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Obligations:</div>
                        <ul className="obligation-list">
                          {preview.obligations.map((o) => <li key={o}>{o}</li>)}
                        </ul>
                      </>
                    ) : (
                      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>No mandatory obligations.</span>
                    )}
                  </div>
                  <div className="form-group" style={{ marginTop: 16 }}>
                    <label className="required" htmlFor="assign_co">Assign to Compliance Officer</label>
                    <select className="form-select" id="assign_co" value={assigneeUsername} onChange={(e) => setAssigneeUsername(e.target.value)}>
                      <option value="">Choose Compliance Officer</option>
                      {complianceOfficers.map((u) => (
                        <option key={u.username} value={u.username}>{displayName(u)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div className="modal-footer">
          {doneId ? (
            <button className="btn-primary" onClick={onClose}>Done</button>
          ) : (
            <>
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              {step > 0 && (
                <button className="btn-ghost" onClick={() => setStep((s) => s - 1)}>← Back</button>
              )}
              {/* Owner step 0 → next */}
              {!isEngineerMode && step === 0 && (
                <button className="btn-primary" onClick={handleNext}>Next →</button>
              )}
              {/* Owner step 1 → register */}
              {!isEngineerMode && step === 1 && (
                <button className="btn-primary" onClick={handleOwnerSubmit} disabled={loading}>
                  {loading && <span className="spinner" />} Register System
                </button>
              )}
              {/* Engineer: next until last page, then submit */}
              {isEngineerMode && step < maxStep && (
                <button className="btn-primary" onClick={handleNext} disabled={step === 1 && !flagsConfirmed}>Next →</button>
              )}
              {isEngineerMode && step === maxStep && (
                <button className="btn-primary" onClick={handleEngineerSubmit} disabled={loading}>
                  {loading && <span className="spinner" />} Submit for Review
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
