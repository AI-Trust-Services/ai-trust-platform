import { useState, useEffect, useRef, Fragment } from "react";
import { TierBadge } from "./Badges";
import { previewClassify } from "../utils";
import { api } from "../api/client";
import { useToast } from "../App";
import type { AISystemFormData } from "../types";

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

const STEPS = ["Identity", "Purpose & Lifecycle", "Risk Flags", "Review"];

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
}

export default function RegisterWizard({ open, onClose, onSuccess }: Props) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<AISystemFormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const [registeredId, setRegisteredId] = useState<string | null>(null);
  const showToast = useToast();

  useEffect(() => {
    if (open) { setStep(0); setForm(EMPTY_FORM); setRegisteredId(null); submitting.current = false; }
  }, [open]);

  if (!open) return null;

  const set = (k: keyof AISystemFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: (e.target as HTMLInputElement).type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const setNum = (k: keyof AISystemFormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: parseFloat(e.target.value) || 0 }));

  function handleNext() {
    if (step === 0 && !form.name.trim()) { showToast("System name is required", true); return; }
    setStep((s) => Math.min(s + 1, 3));
  }

  async function handleSubmit() {
    if (!form.name.trim()) { showToast("System name is required", true); return; }
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      const result = await api.intake({ ...form, version: form.version || "1.0.0", provider_country: form.provider_country || "DE" });
      setRegisteredId(result.id);
      showToast("AI system registered successfully");
      onSuccess();
    } catch (e) {
      showToast(`Registration failed: ${(e as Error).message}`, true);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  function handleCopyId() {
    navigator.clipboard.writeText(registeredId!)
      .then(() => showToast("System ID copied"))
      .catch(() => showToast("Copy failed", true));
  }

  const preview = previewClassify(form, form.training_compute_flops);

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget && !registeredId) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>Register AI System</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        {registeredId ? (
          <div className="modal-body">
            <div className="msg-strip info" style={{ marginBottom: 16 }}>
              Your AI system has been registered successfully.
            </div>
            <div className="panel">
              <div className="panel-header">Telemetry Configuration</div>
              <div className="panel-body">
                <p style={{ fontSize: 13, marginBottom: 12 }}>
                  Use this system ID as the telemetry service name for your application
                  (e.g. set <code style={{ fontFamily: "monospace" }}>OTEL_SERVICE_NAME</code> to it)
                  so its spans are linked to this system:
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <code style={{ background: "var(--bg)", border: "1px solid var(--border)", padding: "6px 12px", borderRadius: 6, fontSize: 13, fontFamily: "monospace", flex: 1 }}>
                    {registeredId}
                  </code>
                  <button className="btn-ghost" onClick={handleCopyId} style={{ flexShrink: 0 }}>⎘ Copy ID</button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="wizard-steps">
              {STEPS.map((label, i) => (
                <div key={i} className={`wizard-step${i === step ? " active" : i < step ? " done" : ""}`}>
                  <span className="step-num">{i + 1}</span> {label}
                </div>
              ))}
            </div>

            <div className="modal-body">
              {step === 0 && (
                <div className="wizard-page">
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="required" htmlFor="reg_name">System Name</label>
                      <input type="text" id="reg_name" value={form.name} onChange={set("name")} placeholder="e.g. Fraud Detection Model" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="reg_version">Version</label>
                      <input type="text" id="reg_version" value={form.version} onChange={set("version")} placeholder="1.0.0" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="reg_provider">Provider Name</label>
                      <input type="text" id="reg_provider" value={form.provider} onChange={set("provider")} placeholder="e.g. SAP SE" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="reg_org_name">Organisation Name</label>
                      <input type="text" id="reg_org_name" value={form.org_name} onChange={set("org_name")} placeholder="e.g. SAP AI Core" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="reg_org_role">Organisation Role</label>
                      <select className="form-select" id="reg_org_role" value={form.org_role} onChange={set("org_role")}>
                        <option value="provider">Provider</option>
                        <option value="deployer">Deployer</option>
                        <option value="importer">Importer</option>
                        <option value="distributor">Distributor</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="reg_country">Provider Country (ISO)</label>
                      <input type="text" id="reg_country" value={form.provider_country} onChange={set("provider_country")} placeholder="DE" maxLength={2} />
                    </div>
                    <div className="form-group">
                      <label htmlFor="reg_system_type">System Type</label>
                      <select className="form-select" id="reg_system_type" value={form.system_type} onChange={set("system_type")}>
                        <option value="application">Application</option>
                        <option value="model">Model</option>
                        <option value="component">Component</option>
                        <option value="service">Service</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="reg_autonomy">Autonomy Level</label>
                      <select className="form-select" id="reg_autonomy" value={form.autonomy_level} onChange={set("autonomy_level")}>
                        <option value="decision_support">Decision support</option>
                        <option value="human_in_the_loop">Human in the loop</option>
                        <option value="human_on_the_loop">Human on the loop</option>
                        <option value="fully_automated">Fully automated</option>
                      </select>
                    </div>
                    <div className="form-group span2">
                      <label htmlFor="reg_app_url">Application URL (optional)</label>
                      <input type="url" id="reg_app_url" value={form.application_url} onChange={set("application_url")} placeholder="https://your-ai-app.example.com" />
                    </div>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="wizard-page">
                  <div className="form-grid single">
                    <div className="form-group">
                      <label htmlFor="reg_description">Description</label>
                      <textarea id="reg_description" rows={3} value={form.description} onChange={set("description")} placeholder="Brief description of the AI system…" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="reg_purpose">Intended Purpose</label>
                      <textarea id="reg_purpose" rows={3} value={form.intended_purpose} onChange={set("intended_purpose")} placeholder="Describe the intended purpose and deployment context…" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="reg_lifecycle">Initial Lifecycle State</label>
                      <select className="form-select" id="reg_lifecycle" value={form.lifecycle} onChange={set("lifecycle")}>
                        <option value="development">Development</option>
                        <option value="testing">Testing</option>
                        <option value="conformity">Conformity</option>
                        <option value="market">On Market</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="wizard-page">
                  <div className="msg-strip info">
                    Check all applicable flags. The backend will automatically determine the EU AI Act risk tier.
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
                </div>
              )}

              {step === 3 && (
                <div className="wizard-page">
                  <div className="msg-strip info">
                    Review the information below. When you submit, the system will be classified automatically based on the risk flags.
                  </div>
                  <div className="panel">
                    <div className="panel-header">Summary</div>
                    <div className="panel-body">
                      <div className="review-grid">
                        {[
                          ["Name", form.name],
                          ["Version", form.version || "1.0.0"],
                          ["Provider", form.provider || "—"],
                          ["Organisation", form.org_name || "—"],
                          ["Role", form.org_role],
                          ["Country", form.provider_country || "—"],
                          ["System Type", form.system_type],
                          ["Autonomy Level", form.autonomy_level.replace(/_/g, " ")],
                          ["Lifecycle", form.lifecycle],
                          ["Purpose", form.intended_purpose || "—"],
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
                </div>
              )}
            </div>
          </>
        )}

        <div className="modal-footer">
          {registeredId ? (
            <button className="btn-primary" onClick={onClose}>Done</button>
          ) : (
            <>
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              {step > 0 && <button className="btn-ghost" onClick={() => setStep((s) => s - 1)}>← Back</button>}
              {step < 3 && <button className="btn-primary" onClick={handleNext}>Next →</button>}
              {step === 3 && (
                <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
                  {loading && <span className="spinner" />} Register System
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
