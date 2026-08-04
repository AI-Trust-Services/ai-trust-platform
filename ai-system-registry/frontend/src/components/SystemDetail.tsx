import { useState, useEffect, Fragment } from "react";
import { TierBadge, LifecycleBadge, ComplianceBar } from "./Badges";
import { fmtDateTime, LIFECYCLE_LABELS, copyToClipboard } from "../utils";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import type { AISystem, ModelCard } from "../types";

const NO_WRITE_TITLE = "Requires permission: systems:write";

function DetailGrid({ rows }: { rows: ([string, React.ReactNode] | false | null | undefined)[] }) {
  return (
    <div className="detail-grid">
      {rows.filter((r): r is [string, React.ReactNode] => Array.isArray(r)).map(([label, value]) => (
        <Fragment key={label}>
          <span className="detail-label">{label}</span>
          <span className="detail-value">{value}</span>
        </Fragment>
      ))}
    </div>
  );
}

function FlagPanel({ title, flags }: { title: string; flags: [unknown, string][] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div className="panel-header" onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer" }}>
        {title} <span>{open ? "▼" : "▶"}</span>
      </div>
      {open && (
        <div className="panel-body">
          <div className="check-grid">
            {flags.map(([val, label]) => (
              <label key={label} className="check-item">
                <input type="checkbox" checked={!!val} disabled readOnly />
                <span style={{ color: val ? "var(--text)" : "var(--text-secondary)" }}>{label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EditForm({ system, models: _models, onSave, onClose }: { system: AISystem; models: ModelCard[]; onSave: (updated: AISystem) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    name: system.name || "",
    version: system.version || "",
    provider: system.provider || "",
    org_name: system.org_name || "",
    org_role: system.org_role || "provider",
    provider_country: system.provider_country || "",
    system_type: system.system_type || "application",
    autonomy_level: system.autonomy_level || "decision_support",
    lifecycle: system.lifecycle || "development",
    application_url: system.application_url || "",
    description: system.description || "",
    intended_purpose: system.intended_purpose || "",
  });
  const [saving, setSaving] = useState(false);
  const showToast = useToast();
  const { mayWrite } = useModalControls();

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.updateSystem(system.id, form);
      showToast("System updated successfully");
      onSave(updated);
    } catch (e) {
      showToast(`Update failed: ${(e as Error).message}`, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tab-panel active">
      <div className="msg-strip info">Changes to identity and purpose fields only. Classification flags are immutable after registration.</div>
      <div className="form-grid">
        <div className="form-group"><label className="required" htmlFor="edit_name">System Name</label><input type="text" id="edit_name" value={form.name} onChange={set("name")} /></div>
        <div className="form-group"><label htmlFor="edit_version">Version</label><input type="text" id="edit_version" value={form.version} onChange={set("version")} /></div>
        <div className="form-group"><label htmlFor="edit_provider">Provider</label><input type="text" id="edit_provider" value={form.provider} onChange={set("provider")} /></div>
        <div className="form-group"><label htmlFor="edit_org_name">Organisation</label><input type="text" id="edit_org_name" value={form.org_name} onChange={set("org_name")} /></div>
        <div className="form-group">
          <label htmlFor="edit_org_role">Role</label>
          <select className="form-select" id="edit_org_role" value={form.org_role} onChange={set("org_role")}>
            <option value="provider">Provider</option>
            <option value="deployer">Deployer</option>
            <option value="importer">Importer</option>
            <option value="distributor">Distributor</option>
          </select>
        </div>
        <div className="form-group"><label htmlFor="edit_country">Country</label><input type="text" id="edit_country" value={form.provider_country} onChange={set("provider_country")} maxLength={2} /></div>
        <div className="form-group">
          <label htmlFor="edit_system_type">System Type</label>
          <select className="form-select" id="edit_system_type" value={form.system_type} onChange={set("system_type")}>
            <option value="application">Application</option>
            <option value="model">Model</option>
            <option value="component">Component</option>
            <option value="service">Service</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="edit_autonomy">Autonomy Level</label>
          <select className="form-select" id="edit_autonomy" value={form.autonomy_level} onChange={set("autonomy_level")}>
            <option value="decision_support">Decision support</option>
            <option value="human_in_the_loop">Human in the loop</option>
            <option value="human_on_the_loop">Human on the loop</option>
            <option value="fully_automated">Fully automated</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="edit_lifecycle">Lifecycle State</label>
          <select className="form-select" id="edit_lifecycle" value={form.lifecycle} onChange={set("lifecycle")}>
            {Object.entries(LIFECYCLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="form-group"><label htmlFor="edit_app_url">Application URL</label><input type="url" id="edit_app_url" value={form.application_url} onChange={set("application_url")} /></div>
        <div className="form-group span2"><label htmlFor="edit_description">Description</label><textarea id="edit_description" rows={3} value={form.description} onChange={set("description")} /></div>
        <div className="form-group span2"><label htmlFor="edit_purpose">Intended Purpose</label><textarea id="edit_purpose" rows={3} value={form.intended_purpose} onChange={set("intended_purpose")} /></div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSave} disabled={saving || !mayWrite}
          title={mayWrite ? undefined : NO_WRITE_TITLE}>
          {saving && <span className="spinner" />} Save Changes
        </button>
      </div>
    </div>
  );
}

function ModelTab({ system, models, onSystemUpdate }: { system: AISystem; models: ModelCard[]; onSystemUpdate: (updated: AISystem) => void }) {
  const [selectedModelId, setSelectedModelId] = useState(system.model_id || "");
  const [linking, setLinking] = useState(false);
  const showToast = useToast();
  const { mayWrite } = useModalControls();
  const linkedModel = models.find((m) => m.id === system.model_id);

  async function handleLink() {
    if (!selectedModelId) { showToast("Please select a model first", true); return; }
    setLinking(true);
    try {
      const updated = await api.linkModel(system.id, selectedModelId);
      showToast("Model linked successfully");
      onSystemUpdate(updated);
    } catch (e) {
      showToast(`Link failed: ${(e as Error).message}`, true);
    } finally {
      setLinking(false);
    }
  }

  async function handleUnlink() {
    try {
      const updated = await api.unlinkModel(system.id);
      showToast("Model unlinked");
      onSystemUpdate(updated);
    } catch (e) {
      showToast(`Unlink failed: ${(e as Error).message}`, true);
    }
  }

  return (
    <div className="tab-panel active">
      {system.model_id ? (
        <div className="detail-section">
          <h3>Currently Linked Model</h3>
          <div className="model-link-box linked">
            <div className="model-link-name">{linkedModel ? linkedModel.name : system.model_id}</div>
            <div className="model-link-meta">
              {linkedModel ? `${linkedModel.provider} · ${linkedModel.model_type} · v${linkedModel.version}` : system.model_id}
              {linkedModel?.inference_url && (
                <> · <a href={linkedModel.inference_url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>{linkedModel.inference_url}</a></>
              )}
            </div>
            {linkedModel?.description && <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-secondary)" }}>{linkedModel.description}</div>}
          </div>
          <button className="btn-ghost" style={{ marginTop: 4 }} disabled={!mayWrite}
            title={mayWrite ? undefined : NO_WRITE_TITLE} onClick={handleUnlink}>Unlink Model</button>
        </div>
      ) : (
        <div className="msg-strip info" style={{ marginBottom: 16 }}>No model card is linked to this system yet.</div>
      )}
      <div className="detail-section">
        <h3>Link a Model Card</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="modelLinkSelect">Select model from catalog</label>
            <select className="form-select" id="modelLinkSelect" value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
              <option value="">— choose a model —</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.provider} · {m.model_type})</option>
              ))}
            </select>
          </div>
          <button className="btn-primary" onClick={handleLink} disabled={linking || !mayWrite}
            title={mayWrite ? undefined : NO_WRITE_TITLE}>Link</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          Linking a model records which LLM or AI model powers this system. One system can have at most one linked model.
        </div>
      </div>
    </div>
  );
}

export default function SystemDetail({ system: initialSystem, models, open, onClose, onDelete, onUpdate }: {
  system: AISystem | null;
  models: ModelCard[];
  open: boolean;
  onClose: () => void;
  onDelete: () => void;
  onUpdate: (updated: AISystem) => void;
}) {
  const [tab, setTab] = useState("overview");
  const [system, setSystem] = useState<AISystem | null>(initialSystem);
  const showToast = useToast();
  const { mayWrite } = useModalControls();

  useEffect(() => { setSystem(initialSystem); setTab("overview"); }, [initialSystem]);

  if (!open || !system) return null;

  function handleSystemUpdate(updated: AISystem) {
    setSystem(updated);
    onUpdate(updated);
  }

  async function handleDelete() {
    if (!confirm(`Delete "${system!.name}"?\n\nThis action cannot be undone.`)) return;
    try {
      await api.deleteSystem(system!.id);
      onClose();
      showToast("System deleted");
      onDelete();
    } catch (e) {
      showToast(`Delete failed: ${(e as Error).message}`, true);
    }
  }

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <div>
            <h2>{system.name}</h2>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              {system.id} · v{system.version} &nbsp;
              <TierBadge tier={system.tier} /> <LifecycleBadge lc={system.lifecycle} />
            </div>
          </div>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        <div className="tab-bar">
          {["overview", "model", "edit"].map((t) => (
            <div key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </div>
          ))}
        </div>

        <div className="modal-body">
          {tab === "overview" && (
            <div className="tab-panel active">
              <div className="detail-section">
                <h3>Identity</h3>
                <DetailGrid rows={[
                  ["Name", system.name],
                  ["Version", system.version],
                  ["Provider", system.provider || "—"],
                  ["Organisation", system.org_name || "—"],
                  ["Role", system.org_role],
                  ["Country", system.provider_country],
                  ["System Type", system.system_type],
                  ["Autonomy Level", (system.autonomy_level || "").replace(/_/g, " ")],
                  !!system.application_url && ["Application URL", <a key="url" href={system.application_url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>{system.application_url}</a>],
                ]} />
                <div style={{ marginTop: 16, padding: 12, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 8 }}>Telemetry Configuration</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>Use this system ID as the telemetry service name (e.g. <code style={{ fontFamily: "monospace" }}>OTEL_SERVICE_NAME</code>) to link telemetry to this system:</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{ fontSize: 12, fontFamily: "monospace", flex: 1 }}>{system.id}</code>
                    <button className="btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => {
                      copyToClipboard(system.id)
                        .then(() => showToast("System ID copied"))
                        .catch(() => showToast("Copy failed", true));
                    }}>⎘ Copy ID</button>
                  </div>
                </div>
              </div>
              <div className="detail-section">
                <h3>Purpose</h3>
                <DetailGrid rows={[
                  ["Description", system.description || "—"],
                  ["Intended Purpose", system.intended_purpose || "—"],
                ]} />
              </div>
              <div className="detail-section">
                <h3>Classification</h3>
                <DetailGrid rows={[
                  ["Risk Tier", <TierBadge key="tier" tier={system.tier} />],
                  ["Classification Basis", <span key="basis" style={{ fontSize: 13 }}>{system.basis}</span>],
                  system.annex_iii_area != null && ["Annex III Area", `Area ${system.annex_iii_area}`],
                  ["GPAI", system.is_gpai ? <span key="gpai" style={{ color: "var(--brand)" }}>Yes</span> : "No"],
                ]} />
              </div>
              <div className="detail-section">
                <h3>Risk Flags</h3>
                <FlagPanel title="Art. 5 — Prohibited Practice Flags" flags={[
                  [system.subliminal_manipulation, "Subliminal manipulation"],
                  [system.exploits_vulnerability, "Exploits vulnerability"],
                  [system.social_scoring_public, "Social scoring (public authority)"],
                  [system.real_time_biometric_public, "Real-time biometric ID in public"],
                  [system.emotion_recognition_workplace, "Emotion recognition (workplace/education)"],
                  [system.untargeted_facial_scraping, "Untargeted facial image scraping"],
                  [system.predictive_policing, "Predictive policing"],
                  [system.biometric_categorisation_sensitive, "Biometric categorisation (sensitive attrs.)"],
                ]} />
                <FlagPanel title="Annex III — High-Risk Flags" flags={[
                  [system.is_biometric_identification, "Biometric identification"],
                  [system.is_critical_infrastructure, "Critical infrastructure"],
                  [system.is_education_related, "Education & vocational training"],
                  [system.is_employment_related, "Employment & worker management"],
                  [system.is_credit_scoring, "Credit scoring"],
                  [system.is_public_service, "Public services"],
                  [system.is_law_enforcement, "Law enforcement"],
                  [system.is_migration, "Migration & border control"],
                  [system.is_judicial_admin, "Justice & democratic processes"],
                ]} />
                <FlagPanel title="Art. 50 — Limited Risk" flags={[
                  [system.is_chatbot, "Chatbot / direct user interaction"],
                  [system.generates_synthetic_content, "Generates synthetic content"],
                ]} />
              </div>
              <div className="detail-section">
                <h3>Lifecycle</h3>
                <DetailGrid rows={[
                  ["State", <LifecycleBadge key="lc" lc={system.lifecycle} />],
                  ["Compliance", <ComplianceBar key="comp" pct={system.compliance} />],
                  ["Registered", fmtDateTime(system.created_at)],
                  ["Last Updated", fmtDateTime(system.updated_at)],
                ]} />
              </div>
            </div>
          )}

          {tab === "model" && (
            <ModelTab system={system} models={models} onSystemUpdate={handleSystemUpdate} />
          )}

          {tab === "edit" && (
            <EditForm system={system} models={models} onSave={handleSystemUpdate} onClose={onClose} />
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-danger" onClick={handleDelete} disabled={!mayWrite}
            title={mayWrite ? undefined : NO_WRITE_TITLE}>Delete System</button>
          <div className="toolbar-spacer" />
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
