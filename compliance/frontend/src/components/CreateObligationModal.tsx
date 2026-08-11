import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import type { Assessment } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  assessment_id: string;
  title: string;
  article_ref: string;
  description: string;
  owner: string;
  due_date: string;
}

const EMPTY: FormState = { assessment_id: "", title: "", article_ref: "", description: "", owner: "", due_date: "" };

export default function CreateObligationModal({ open, onClose, onSuccess }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    (async () => {
      try {
        const a = await api.getAssessments();
        setAssessments(a.filter((x) => x.status !== "approved"));
      } catch (e) {
        showToast(`Failed to load assessments: ${(e as Error).message}`, true);
      }
    })();
  }, [open, showToast]);

  if (!open) return null;

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit() {
    if (!form.assessment_id) { showToast("Select an assessment", true); return; }
    if (!form.title.trim()) { showToast("Title is required", true); return; }
    setLoading(true);
    try {
      await api.createObligation({ ...form, due_date: form.due_date || null });
      onClose();
      showToast("Obligation created");
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
          <h2>New Obligation</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid single">
            <div className="form-group">
              <label className="required">Assessment</label>
              <select className="form-select" value={form.assessment_id} onChange={set("assessment_id")}>
                <option value="">Select an assessment…</option>
                {assessments.map((a) => <option key={a.id} value={a.id}>{a.title} ({a.id})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="required">Title</label>
              <input type="text" value={form.title} onChange={set("title")} placeholder="e.g. Enable human oversight" />
            </div>
            <div className="form-group">
              <label>Article / Reference</label>
              <input type="text" value={form.article_ref} onChange={set("article_ref")} placeholder="e.g. Art. 14" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={set("description")} />
            </div>
            <div className="form-group">
              <label>Owner</label>
              <input type="text" value={form.owner} onChange={set("owner")} placeholder="e.g. Compliance Officer" />
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
