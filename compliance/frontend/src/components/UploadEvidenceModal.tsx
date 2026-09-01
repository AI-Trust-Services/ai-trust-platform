import { useState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import { EVIDENCE_TYPES, humanize } from "../utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  title: string;
  description: string;
  evidence_type: string;
  validity_from: string;
  validity_until: string;
  uploaded_by: string;
}

const EMPTY: FormState = {
  title: "", description: "", evidence_type: "document",
  validity_from: "", validity_until: "", uploaded_by: "",
};

export default function UploadEvidenceModal({ open, onClose, onSuccess }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const showToast = useToast();

  if (!open) return null;

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]);
  }

  async function handleSubmit() {
    if (!form.title.trim()) { showToast("Title is required", true); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("title", form.title);
      fd.append("description", form.description);
      fd.append("evidence_type", form.evidence_type);
      fd.append("uploaded_by", form.uploaded_by);
      if (form.validity_from) fd.append("validity_from", form.validity_from);
      if (form.validity_until) fd.append("validity_until", form.validity_until);
      if (file) fd.append("file", file);
      await api.uploadEvidence(fd);
      setForm(EMPTY);
      setFile(null);
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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Upload Evidence</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto p-6">
          {/* File drop */}
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
              <>Drag &amp; drop a file here, or click to browse (max 100 MB, optional)</>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ue-title">Title <span className="text-destructive">*</span></Label>
              <Input id="ue-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Human Oversight Policy v2.1" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Evidence Type</Label>
              <Select value={form.evidence_type} onValueChange={(v) => setForm((f) => ({ ...f, evidence_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVIDENCE_TYPES.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ue-desc">Description</Label>
              <Textarea id="ue-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ue-vf">Valid From</Label>
                <Input id="ue-vf" type="date" value={form.validity_from} onChange={(e) => setForm((f) => ({ ...f, validity_from: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ue-vu">Valid Until</Label>
                <Input id="ue-vu" type="date" value={form.validity_until} onChange={(e) => setForm((f) => ({ ...f, validity_until: e.target.value }))} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ue-by">Uploaded By</Label>
              <Input id="ue-by" value={form.uploaded_by} onChange={(e) => setForm((f) => ({ ...f, uploaded_by: e.target.value }))} placeholder="Your name" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="animate-spin" />} Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
