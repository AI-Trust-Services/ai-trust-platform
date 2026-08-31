import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import { EVIDENCE_TYPES, humanize } from "../utils";
import type { AISystem, Assessment, Control, Obligation } from "../types";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
// Radix Select disallows empty-string item values — use a sentinel for "none".
const NONE = "__none__";

export default function UploadEvidenceModal({ open, onClose, onSuccess }: Props) {
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
      if (form.ai_system_id) fd.append("ai_system_ids", form.ai_system_id);
      if (form.assessment_id) fd.append("assessment_ids", form.assessment_id);
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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-[780px]">
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

          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Left column: metadata */}
            <div className="flex flex-col gap-4">
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
                <Label>AI System</Label>
                <Select
                  value={form.ai_system_id || NONE}
                  onValueChange={(v) => setForm((f) => ({ ...f, ai_system_id: v === NONE ? "" : v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— none —</SelectItem>
                    {systems.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.id})</SelectItem>)}
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

            {/* Right column: linking */}
            <div className="flex flex-col gap-4">
              {/* Controls checklist */}
              <div className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-1.5">
                  Link to Controls
                  {selectedControls.size > 0 && <Badge variant="secondary" className="rounded-full font-medium">{selectedControls.size} selected</Badge>}
                </Label>
                <div className="max-h-40 overflow-y-auto rounded-md border border-border">
                  {!form.ai_system_id ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">Select an AI system to see its controls</div>
                  ) : controls.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">No controls for this system</div>
                  ) : controls.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 last:border-0 hover:bg-muted/50">
                      <Checkbox checked={selectedControls.has(c.id)} onCheckedChange={() => toggleControl(c.id)} />
                      <span className="flex-1 truncate text-[13px] text-foreground">{c.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{c.id}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Obligations: pick assessment first */}
              <div className="flex flex-col gap-1.5">
                <Label>Assessment</Label>
                <Select
                  value={form.assessment_id || NONE}
                  onValueChange={(v) => setForm((f) => ({ ...f, assessment_id: v === NONE ? "" : v }))}
                  disabled={!form.ai_system_id}
                >
                  <SelectTrigger><SelectValue placeholder="— select to filter obligations —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— select to filter obligations —</SelectItem>
                    {assessments.map((a) => <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-1.5">
                  Link to Obligations
                  {selectedObligations.size > 0 && <Badge variant="secondary" className="rounded-full font-medium">{selectedObligations.size} selected</Badge>}
                </Label>
                <div className="max-h-40 overflow-y-auto rounded-md border border-border">
                  {!form.assessment_id ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">Select an assessment to see its obligations</div>
                  ) : obligations.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">No obligations for this assessment</div>
                  ) : obligations.map((o) => (
                    <label key={o.id} className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 last:border-0 hover:bg-muted/50">
                      <Checkbox checked={selectedObligations.has(o.id)} onCheckedChange={() => toggleObligation(o.id)} />
                      <span className="flex-1 truncate text-[13px] text-foreground">{o.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{o.article_ref || o.id}</span>
                    </label>
                  ))}
                </div>
              </div>
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
