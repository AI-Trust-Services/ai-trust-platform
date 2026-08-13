import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import { CONTROL_CATEGORIES, humanize } from "../utils";
import type { AISystem } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  ai_system_id: string;
  title: string;
  description: string;
  category: string;
  owner: string;
  due_date: string;
}

const EMPTY: FormState = { ai_system_id: "", title: "", description: "", category: "general", owner: "", due_date: "" };

export default function CreateControlModal({ open, onClose, onSuccess }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [loading, setLoading] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    (async () => {
      try {
        const sys = await api.getSystems();
        setSystems(sys.filter((s) => s.lifecycle !== "decommissioned"));
      } catch (e) {
        showToast(`Failed to load systems: ${(e as Error).message}`, true);
      }
    })();
  }, [open, showToast]);

  if (!open) return null;

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit() {
    if (!form.title.trim()) { showToast("Title is required", true); return; }
    setLoading(true);
    try {
      await api.createControl({ ...form, ai_system_id: form.ai_system_id || null, due_date: form.due_date || null });
      onClose();
      showToast("Control created");
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
          <h2>New Control</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid single">
            <div className="form-group">
              <label className="required">Title</label>
              <input type="text" value={form.title} onChange={set("title")} placeholder="e.g. Human-in-the-loop approval workflow" />
            </div>
            <div className="form-group">
              <label>Category</label>
              <select className="form-select" value={form.category} onChange={set("category")}>
                {CONTROL_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>AI System (leave blank for org-wide)</label>
              <select className="form-select" value={form.ai_system_id} onChange={set("ai_system_id")}>
                <option value="">Org-wide (all systems)</option>
                {systems.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={set("description")} />
            </div>
            <div className="form-group">
              <label>Owner</label>
              <input type="text" value={form.owner} onChange={set("owner")} placeholder="e.g. AI Engineer" />
            </div>
            <div className="form-group">
              <label>Due Date</label>
              <input type="date" value={form.due_date} onChange={set("due_date")} />
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
