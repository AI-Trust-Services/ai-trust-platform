import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import type { Assessment } from "../types";
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

  const setVal = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New Obligation</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1.5">
            <Label>Assessment <span className="text-destructive">*</span></Label>
            <Select value={form.assessment_id} onValueChange={setVal("assessment_id")}>
              <SelectTrigger><SelectValue placeholder="Select an assessment…" /></SelectTrigger>
              <SelectContent>
                {assessments.map((a) => <SelectItem key={a.id} value={a.id}>{a.title} ({a.id})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="co-title">Title <span className="text-destructive">*</span></Label>
            <Input id="co-title" value={form.title} onChange={(e) => setVal("title")(e.target.value)} placeholder="e.g. Enable human oversight" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="co-ref">Article / Reference</Label>
            <Input id="co-ref" value={form.article_ref} onChange={(e) => setVal("article_ref")(e.target.value)} placeholder="e.g. Art. 14" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="co-desc">Description</Label>
            <Textarea id="co-desc" value={form.description} onChange={(e) => setVal("description")(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="co-owner">Owner</Label>
            <Input id="co-owner" value={form.owner} onChange={(e) => setVal("owner")(e.target.value)} placeholder="e.g. Compliance Officer" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="co-due">Due Date</Label>
            <Input id="co-due" type="date" value={form.due_date} onChange={(e) => setVal("due_date")(e.target.value)} />
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
