import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ModelCard, ModelCardFormData, ModelSystemResponse } from "../types";
import { TierBadge, LifecycleBadge, ModelTypeBadge } from "./Badges";
import { useToast, useModalControls } from "../App";

const EMPTY: ModelCardFormData = { name: "", provider: "", version: "", model_type: "llm", description: "", inference_url: "", open_weights: false };

export default function ModelDetail({ modelId, open, onClose, onUpdate }: {
  modelId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}) {
  const [model, setModel] = useState<ModelCard | null>(null);
  const [systems, setSystems] = useState<ModelSystemResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("overview");
  const [form, setForm] = useState<ModelCardFormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const showToast = useToast();
  const { mayWrite } = useModalControls();

  useEffect(() => {
    if (!modelId) return;
    setTab("overview");
    setLoading(true);
    Promise.all([api.getModelCard(modelId), api.getModelSystems(modelId)])
      .then(([m, s]) => { setModel(m); setSystems(s); setForm({ ...EMPTY, ...m }); })
      .finally(() => setLoading(false));
  }, [modelId]);

  const set = (k: keyof ModelCardFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: (e.target as HTMLInputElement).type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function handleSave() {
    if (!form.name.trim() || !form.provider.trim()) {
      showToast("Name and provider are required", true); return;
    }
    setSaving(true);
    try {
      const updated = await api.updateModel(model!.id, form);
      setModel(updated);
      setForm({ ...EMPTY, ...updated });
      showToast("Model updated");
      onUpdate?.();
    } catch (e) {
      showToast(`Save failed: ${(e as Error).message}`, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className={`detail-overlay${open ? " open" : ""}`} onClick={onClose} />
      <div className={`detail-panel${open ? " open" : ""}`}>
        {loading || !model ? (
          <div style={{ padding: 32, color: "var(--text-secondary)", fontSize: 13 }}>
            {loading ? "Loading…" : null}
          </div>
        ) : (
          <>
            <div className="modal-header">
              <div>
                <h2>{model.name}</h2>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                  {model.id} &nbsp;
                  <ModelTypeBadge type={model.model_type} />
                  {model.open_weights && <span className="badge badge-info" style={{ marginLeft: 4 }}>Open weights</span>}
                </div>
              </div>
              <button className="btn-close" onClick={onClose}>×</button>
            </div>

            <div className="tab-bar">
              {(mayWrite ? ["overview", "edit"] : ["overview"]).map((t) => (
                <div key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </div>
              ))}
            </div>

            <div className="modal-body">
            {tab === "overview" && (
              <div className="tab-panel active">
                <div className="detail-section">
                  <h3>Model Details</h3>
                  <div className="detail-grid">
                    <span className="detail-label">Provider</span>
                    <span className="detail-value">{model.provider || "—"}</span>
                    <span className="detail-label">Version</span>
                    <span className="detail-value">{model.version || "—"}</span>
                    <span className="detail-label">Type</span>
                    <span className="detail-value"><ModelTypeBadge type={model.model_type} /></span>
                    <span className="detail-label">Weights</span>
                    <span className="detail-value">
                      {model.open_weights
                        ? <span style={{ color: "#1a5c35", fontWeight: 500 }}>Open</span>
                        : <span style={{ color: "var(--text-secondary)" }}>Proprietary</span>}
                    </span>
                    {model.inference_url && <>
                      <span className="detail-label">Inference URL</span>
                      <span className="detail-value">
                        <a href={model.inference_url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>
                          {model.inference_url}
                        </a>
                      </span>
                    </>}
                    {model.description && <>
                      <span className="detail-label">Description</span>
                      <span className="detail-value">{model.description}</span>
                    </>}
                  </div>
                </div>

                <div className="detail-section">
                  <h3>Linked AI Systems</h3>
                  {systems.length === 0 ? (
                    <div className="msg-strip info">No systems linked to this model.</div>
                  ) : (
                    systems.map((s) => (
                      <div key={s.id} className="model-link-box linked">
                        <div className="model-link-name">{s.name}</div>
                        <div className="model-link-meta">
                          {s.id} &nbsp;
                          <TierBadge tier={s.tier as any} /> <LifecycleBadge lc={s.lifecycle as any} />
                          {s.role && <> · <span style={{ color: "var(--brand)" }}>{s.role}</span></>}
                          &nbsp; {Math.round(s.compliance * 100)}% compliance
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {tab === "edit" && (
              <div className="tab-panel active">
                <div className="detail-section">
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="required" htmlFor="mc_name">Model Name</label>
                      <input type="text" id="mc_name" value={form.name} onChange={set("name")} placeholder="e.g. GPT-4o" />
                    </div>
                    <div className="form-group">
                      <label className="required" htmlFor="mc_provider">Provider</label>
                      <input type="text" id="mc_provider" value={form.provider} onChange={set("provider")} placeholder="e.g. openai" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="mc_version">Version</label>
                      <input type="text" id="mc_version" value={form.version} onChange={set("version")} placeholder="e.g. 2024-08" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="mc_model_type">Type</label>
                      <select className="form-select" id="mc_model_type" value={form.model_type} onChange={set("model_type")}>
                        <option value="llm">LLM</option>
                        <option value="embedding">Embedding</option>
                        <option value="multimodal">Multimodal</option>
                        <option value="classifier">Classifier</option>
                      </select>
                    </div>
                    <div className="form-group span2">
                      <label htmlFor="mc_description">Description</label>
                      <textarea id="mc_description" rows={2} value={form.description} onChange={set("description")} placeholder="Brief description…" />
                    </div>
                    <div className="form-group span2">
                      <label htmlFor="mc_inference_url">Inference URL (optional)</label>
                      <input type="url" id="mc_inference_url" value={form.inference_url} onChange={set("inference_url")} placeholder="https://api.example.com/v1" />
                    </div>
                    <div className="form-group span2">
                      <label className="check-item" style={{ fontWeight: 400 }}>
                        <input type="checkbox" id="mc_open_weights" checked={form.open_weights} onChange={set("open_weights")} style={{ marginTop: 0, accentColor: "var(--brand)" }} />
                        <span style={{ fontSize: 14 }}>Open weights (publicly available model weights)</span>
                      </label>
                    </div>
                  </div>
                </div>
                <div style={{ padding: "0 24px 24px", display: "flex", justifyContent: "flex-end" }}>
                  <button className="btn-primary" onClick={handleSave} disabled={saving}>
                    {saving && <span className="spinner" />} Save Changes
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
        )}
      </div>
    </>
  );
}
