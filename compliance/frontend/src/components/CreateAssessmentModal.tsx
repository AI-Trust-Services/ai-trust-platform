import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import { ASSESSMENT_TYPES, humanize } from "../utils";
import type { AISystem, Framework } from "../types";
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

export default function CreateAssessmentModal({ open, onClose, onSuccess }: Props) {
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

  const setVal = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New Assessment</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1.5">
            <Label>AI System <span className="text-destructive">*</span></Label>
            <Select value={form.ai_system_id} onValueChange={setVal("ai_system_id")}>
              <SelectTrigger><SelectValue placeholder="Select a system…" /></SelectTrigger>
              <SelectContent>
                {systems.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.id}) — {s.tier}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Framework <span className="text-destructive">*</span></Label>
            <Select value={form.framework_id} onValueChange={setVal("framework_id")}>
              <SelectTrigger><SelectValue placeholder="Select a framework…" /></SelectTrigger>
              <SelectContent>
                {frameworks.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name} — {f.version}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ca-title">Title <span className="text-destructive">*</span></Label>
            <Input id="ca-title" value={form.title} onChange={(e) => setVal("title")(e.target.value)} placeholder="e.g. EU AI Act High-Risk Compliance" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <Select value={form.type} onValueChange={setVal("type")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ASSESSMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ca-notes">Notes</Label>
            <Textarea id="ca-notes" value={form.notes} onChange={(e) => setVal("notes")(e.target.value)} placeholder="Optional context…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="animate-spin" />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
