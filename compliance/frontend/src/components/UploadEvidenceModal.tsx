import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import { EVIDENCE_TYPES, humanize } from "../utils";
import type { Control, Obligation } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  title: string;
  description: string;
  evidence_type: string;
  control_id: string;
  obligation_id: string;
  validity_from: string;
  validity_until: string;
  uploaded_by: string;
}

const EMPTY: FormState = {
  title: "", description: "", evidence_type: "document",
  control_id: "", obligation_id: "", validity_from: "", validity_until: "", uploaded_by: "",
};

export default function UploadEvidenceModal({ open, onClose, onSuccess }: Props): JSX.Element | null {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [controls, setControls] = useState<Control[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setFile(null);
    (async () => {
      try {
        const [ctl, obs] = await Promise.all([api.getControls(), api.getObligations()]);

        //TODO: Find a better solution to fetch obligations.
        
        setControls(ctl);
        setObligations(obs);
      } catch (e) {
        showToast(`Failed to load options: ${(e as Error).message}`, true);
      }
    })();
  }, [open, showToast]);

  if (!open) return null;

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]);
  }

  async function handleSubmit() {
    if (!form.title.trim()) { showToast("Title is required", true); return; }
    if (!form.control_id && !form.obligation_id) {
      showToast("Link to at least one control or obligation", true); return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("title", form.title);
      fd.append("description", form.description);
      fd.append("evidence_type", form.evidence_type);
      fd.append("uploaded_by", form.uploaded_by);
      if (form.control_id) fd.append("control_id", form.control_id);
      if (form.obligation_id) fd.append("obligation_id", form.obligation_id);
      if (form.validity_from) fd.append("validity_from", form.validity_from);
      if (form.validity_until) fd.append("validity_until", form.validity_until);
      if (file) fd.append("file", file);
      await api.uploadEvidence(fd);
      onClose();
      showToast("Evidence uploaded");
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
          <h2>Upload Evidence</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div
            className={`dropzone${drag ? " drag" : ""}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
          >
            <input ref={fileRef} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file ? (
              <>Drop a different file or click to replace<div className="file-name">{file.name} ({(file.size / 1024).toFixed(0)} KB)</div></>
            ) : (
              <>Drag &amp; drop a file here, or click to browse (max 100 MB, optional)</>
            )}
          </div>
          <div className="form-grid single" style={{ marginTop: 16 }}>
            <div className="form-group">
              <label className="required">Title</label>
              <input type="text" value={form.title} onChange={set("title")} placeholder="e.g. Human Oversight Policy v2.1" />
            </div>
            <div className="form-group">
              <label>Evidence Type</label>
              <select className="form-select" value={form.evidence_type} onChange={set("evidence_type")}>
                {EVIDENCE_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Link to Control</label>
              <select className="form-select" value={form.control_id} onChange={set("control_id")}>
                <option value="">— none —</option>
                {controls.map((c) => <option key={c.id} value={c.id}>{c.title} ({c.id})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Link to Obligation</label>
              <select className="form-select" value={form.obligation_id} onChange={set("obligation_id")}>
                <option value="">— none —</option>
                {obligations.map((o) => <option key={o.id} value={o.id}>{o.title} ({o.id})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={set("description")} />
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label>Valid From</label>
                <input type="date" value={form.validity_from} onChange={set("validity_from")} />
              </div>
              <div className="form-group">
                <label>Valid Until</label>
                <input type="date" value={form.validity_until} onChange={set("validity_until")} />
              </div>
            </div>
            <div className="form-group">
              <label>Uploaded By</label>
              <input type="text" value={form.uploaded_by} onChange={set("uploaded_by")} placeholder="Your name" />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading && <span className="spinner" />} Upload
          </button>
        </div>
      </div>
    </div>
  );
}
