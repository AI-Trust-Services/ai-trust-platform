import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import { EVIDENCE_TYPES, humanize } from "../utils";
import type { AISystem, Assessment, Control, Obligation } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  title: string;
  description: string;
  evidence_type: string;
  ai_system_id: string;
  assessment_id: string;
  validity_from: string;
  validity_until: string;
  uploaded_by: string;
}

const EMPTY: FormState = {
  title: "", description: "", evidence_type: "document",
  ai_system_id: "", assessment_id: "",
  validity_from: "", validity_until: "", uploaded_by: "",
};

export default function UploadEvidenceModal({ open, onClose, onSuccess }: Props): JSX.Element | null {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [controls, setControls] = useState<Control[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [selectedControls, setSelectedControls] = useState<Set<string>>(new Set());
  const [selectedObligations, setSelectedObligations] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const showToast = useToast();

  // Load systems on open
  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setFile(null);
    setSelectedControls(new Set());
    setSelectedObligations(new Set());
    setControls([]);
    setObligations([]);
    setAssessments([]);
    (async () => {
      try {
        const sys = await api.getSystems();
        setSystems(sys.filter((s) => s.lifecycle !== "decommissioned"));
      } catch (e) {
        showToast(`Failed to load systems: ${(e as Error).message}`, true);
      }
    })();
  }, [open, showToast]);

  // When system changes: load its assessments and controls
  useEffect(() => {
    setSelectedControls(new Set());
    setSelectedObligations(new Set());
    setObligations([]);
    setAssessments([]);
    setForm((f) => ({ ...f, assessment_id: "" }));
    if (!form.ai_system_id) { setControls([]); return; }
    (async () => {
      try {
        const [ctl, assess] = await Promise.all([
          api.getControls({ ai_system_id: form.ai_system_id }),
          api.getAssessments(form.ai_system_id),
        ]);
        setControls(ctl);
        setAssessments(assess);
      } catch (e) {
        showToast(`Failed to load options: ${(e as Error).message}`, true);
      }
    })();
  }, [form.ai_system_id, showToast]);

  // When assessment changes: load its obligations
  useEffect(() => {
    setSelectedObligations(new Set());
    setObligations([]);
    if (!form.assessment_id) return;
    (async () => {
      try {
        setObligations(await api.getObligations({ assessment_id: form.assessment_id }));
      } catch (e) {
        showToast(`Failed to load obligations: ${(e as Error).message}`, true);
      }
    })();
  }, [form.assessment_id, showToast]);

  if (!open) return null;

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function toggleControl(id: string) {
    setSelectedControls((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleObligation(id: string) {
    setSelectedObligations((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]);
  }

  async function handleSubmit() {
    if (!form.title.trim()) { showToast("Title is required", true); return; }
    if (selectedControls.size === 0 && selectedObligations.size === 0 && !form.ai_system_id && !form.assessment_id) {
      showToast("Link to at least one control, obligation, AI system, or assessment", true); return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("title", form.title);
      fd.append("description", form.description);
      fd.append("evidence_type", form.evidence_type);
      fd.append("uploaded_by", form.uploaded_by);
      if (form.ai_system_id) fd.append("ai_system_id", form.ai_system_id);
      if (form.assessment_id) fd.append("assessment_id", form.assessment_id);
      if (form.validity_from) fd.append("validity_from", form.validity_from);
      if (form.validity_until) fd.append("validity_until", form.validity_until);
      selectedControls.forEach((id) => fd.append("control_ids", id));
      selectedObligations.forEach((id) => fd.append("obligation_ids", id));
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
      <div className="modal" style={{ width: 760 }}>
        <div className="modal-header">
          <h2>Upload Evidence</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {/* File drop */}
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

          <div className="form-grid" style={{ marginTop: 16 }}>
            {/* Left column: metadata */}
            <div className="form-grid single">
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
                <label>AI System</label>
                <select className="form-select" value={form.ai_system_id} onChange={set("ai_system_id")}>
                  <option value="">— none —</option>
                  {systems.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
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

            {/* Right column: linking */}
            <div className="form-grid single">
              {/* Controls checklist */}
              <div className="form-group">
                <label>Link to Controls {selectedControls.size > 0 && <span className="chip" style={{ marginLeft: 6 }}>{selectedControls.size} selected</span>}</label>
                <div className="checklist-box">
                  {!form.ai_system_id ? (
                    <div className="checklist-empty">Select an AI system to see its controls</div>
                  ) : controls.length === 0 ? (
                    <div className="checklist-empty">No controls for this system</div>
                  ) : controls.map((c) => (
                    <label key={c.id} className="checklist-item">
                      <input type="checkbox" checked={selectedControls.has(c.id)} onChange={() => toggleControl(c.id)} />
                      <span className="checklist-label">{c.title}</span>
                      <span className="checklist-sub">{c.id}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Obligations: pick assessment first */}
              <div className="form-group">
                <label>Assessment</label>
                <select className="form-select" value={form.assessment_id} onChange={set("assessment_id")} disabled={!form.ai_system_id}>
                  <option value="">— select to filter obligations —</option>
                  {assessments.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Link to Obligations {selectedObligations.size > 0 && <span className="chip" style={{ marginLeft: 6 }}>{selectedObligations.size} selected</span>}</label>
                <div className="checklist-box">
                  {!form.assessment_id ? (
                    <div className="checklist-empty">Select an assessment to see its obligations</div>
                  ) : obligations.length === 0 ? (
                    <div className="checklist-empty">No obligations for this assessment</div>
                  ) : obligations.map((o) => (
                    <label key={o.id} className="checklist-item">
                      <input type="checkbox" checked={selectedObligations.has(o.id)} onChange={() => toggleObligation(o.id)} />
                      <span className="checklist-label">{o.title}</span>
                      <span className="checklist-sub">{o.article_ref || o.id}</span>
                    </label>
                  ))}
                </div>
              </div>
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
