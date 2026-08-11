import { useState, useRef } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import type { EvidenceDetail } from "../types";

interface Props {
  open: boolean;
  evidence: EvidenceDetail | null;
  onClose: () => void;
  onSuccess: (updated: EvidenceDetail) => void;
}

export default function UploadVersionModal({ open, evidence, onClose, onSuccess }: Props) {
  const [versionLabel, setVersionLabel] = useState("");
  const [uploadedBy, setUploadedBy] = useState("");
  const [validityUntil, setValidityUntil] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const showToast = useToast();

  if (!open || !evidence) return null;

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]);
  }

  async function handleSubmit() {
    if (!versionLabel.trim()) { showToast("Version label is required", true); return; }
    if (!file) { showToast("A file is required for a new version", true); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("version_label", versionLabel);
      fd.append("uploaded_by", uploadedBy);
      if (validityUntil) fd.append("validity_until", validityUntil);
      fd.append("file", file);
      const updated = await api.uploadEvidenceVersion(evidence!.id, fd);
      showToast(`Version ${versionLabel} uploaded`);
      onSuccess(updated);
      onClose();
    } catch (e) {
      showToast(`Failed: ${(e as Error).message}`, true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 520 }}>
        <div className="modal-header">
          <h2>Upload New Version — {evidence.title}</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="msg-strip info" style={{ marginBottom: 16 }}>
            Current version: <strong>{evidence.version_label}</strong>. The current file will be preserved in version history.
          </div>
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
              <>Drag &amp; drop the new version file here, or click to browse (max 100 MB)</>
            )}
          </div>
          <div className="form-grid single" style={{ marginTop: 16 }}>
            <div className="form-group">
              <label className="required">Version Label</label>
              <input type="text" value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="e.g. 2.1, Q2-2025, final" />
            </div>
            <div className="form-group">
              <label>Uploaded By</label>
              <input type="text" value={uploadedBy} onChange={(e) => setUploadedBy(e.target.value)} placeholder="Your name" />
            </div>
            <div className="form-group">
              <label>Valid Until</label>
              <input type="date" value={validityUntil} onChange={(e) => setValidityUntil(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading && <span className="spinner" />} Upload Version
          </button>
        </div>
      </div>
    </div>
  );
}
