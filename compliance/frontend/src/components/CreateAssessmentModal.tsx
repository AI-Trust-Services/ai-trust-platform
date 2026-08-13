import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import { ASSESSMENT_TYPES, humanize } from "../utils";
import type { AISystem, Framework } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  ai_system_id: string;
  framework_id: string;
  title: string;
  type: string;
  notes: string;
}

const EMPTY: FormState = { ai_system_id: "", framework_id: "", title: "", type: "compliance", notes: "" };

export default function CreateAssessmentModal({ open, onClose, onSuccess }: Props): JSX.Element | null {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [loading, setLoading] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    (async () => {
      try {
        const [sys, fw] = await Promise.all([api.getSystems(), api.getFrameworks()]);
        setSystems(sys.filter((s) => s.lifecycle !== "decommissioned" && s.workflow_status === "approved"));
        setFrameworks(fw.filter((f) => f.enabled));
      } catch (e) {
        showToast(`Failed to load options: ${(e as Error).message}`, true);
      }
    })();
  }, [open, showToast]);

  if (!open) return null;

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit() {
    if (!form.ai_system_id) { showToast("Select an AI system", true); return; }
    if (!form.framework_id) { showToast("Select a framework", true); return; }
    if (!form.title.trim()) { showToast("Title is required", true); return; }
    setLoading(true);
    try {
      await api.createAssessment(form);
      onClose();
      showToast("Assessment created");
      onSuccess();
    } catch (e) {
      showToast(`Failed: ${(e as Error).message}`, true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>New Assessment</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid single">
            <div className="form-group">
              <label className="required">AI System</label>
              <select className="form-select" value={form.ai_system_id} onChange={set("ai_system_id")}>
                <option value="">Select a system…</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.id}) — {s.tier}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="required">Framework</label>
              <select className="form-select" value={form.framework_id} onChange={set("framework_id")}>
                <option value="">Select a framework…</option>
                {frameworks.map((f) => (
                  <option key={f.id} value={f.id}>{f.name} — {f.version}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="required">Title</label>
              <input type="text" value={form.title} onChange={set("title")} placeholder="e.g. EU AI Act High-Risk Compliance" />
            </div>
            <div className="form-group">
              <label>Type</label>
              <select className="form-select" value={form.type} onChange={set("type")}>
                {ASSESSMENT_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea value={form.notes} onChange={set("notes")} placeholder="Optional context…" />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading && <span className="spinner" />} Create
          </button>
        </div>
      </div>
    </div>
  );
}
