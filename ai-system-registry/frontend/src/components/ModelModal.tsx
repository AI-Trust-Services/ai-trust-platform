import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import type { ModelCard, ModelCardFormData } from "../types";

const EMPTY: ModelCardFormData = { name: "", provider: "", version: "", model_type: "llm", description: "", inference_url: "", open_weights: false };

interface Props {
  open: boolean;
  editingModel: ModelCard | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ModelModal({ open, editingModel, onClose, onSuccess }: Props) {
  const [form, setForm] = useState<ModelCardFormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    if (open) setForm(editingModel ? { ...EMPTY, ...editingModel } : EMPTY);
  }, [open, editingModel]);

  if (!open) return null;

  const set = (k: keyof ModelCardFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: (e.target as HTMLInputElement).type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function handleSave() {
    if (!form.name.trim() || !form.provider.trim()) {
      showToast("Name and provider are required", true); return;
    }
    setSaving(true);
    try {
      if (editingModel) {
        await api.updateModel(editingModel.id, form);
        showToast("Model updated");
      } else {
        await api.createModel(form);
        showToast("Model card added");
      }
      onClose();
      onSuccess();
    } catch (e) {
      showToast(`Save failed: ${(e as Error).message}`, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h2>{editingModel ? "Edit Model Card" : "Add Model Card"}</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ padding: 24 }}>
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
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving && <span className="spinner" />}
            {editingModel ? "Save Changes" : "Add Model"}
          </button>
        </div>
      </div>
    </div>
  );
}
