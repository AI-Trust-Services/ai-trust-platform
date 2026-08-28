import { useState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import type { EvidenceDetail } from "../types";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Upload New Version — {evidence.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 p-6">
          <div className="rounded-md border border-[var(--info-border,var(--border))] bg-[var(--info-bg,var(--muted))] px-3 py-2 text-[13px] text-foreground">
            Current version: <strong>{evidence.version_label}</strong>. The current file will be preserved in version history.
          </div>
          <div
            className={cn(
              "cursor-pointer rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-[13px] text-muted-foreground transition-colors hover:border-primary hover:bg-accent",
              drag && "border-primary bg-accent",
            )}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
          >
            <input ref={fileRef} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file ? (
              <>Drop a different file or click to replace<div className="mt-1.5 font-medium text-foreground">{file.name} ({(file.size / 1024).toFixed(0)} KB)</div></>
            ) : (
              <>Drag &amp; drop the new version file here, or click to browse (max 100 MB)</>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="uv-label">Version Label <span className="text-destructive">*</span></Label>
            <Input id="uv-label" value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="e.g. 2.1, Q2-2025, final" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="uv-by">Uploaded By</Label>
            <Input id="uv-by" value={uploadedBy} onChange={(e) => setUploadedBy(e.target.value)} placeholder="Your name" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="uv-until">Valid Until</Label>
            <Input id="uv-until" type="date" value={validityUntil} onChange={(e) => setValidityUntil(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="animate-spin" />} Upload Version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
