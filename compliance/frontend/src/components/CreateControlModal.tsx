import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import { CONTROL_CATEGORIES, humanize } from "../utils";
import type { AISystem, Obligation } from "../types";
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
  system_id: string;
  obligation_id: string;
  title: string;
  description: string;
  category: string;
  owner: string;
  due_date: string;
}

const EMPTY: FormState = { system_id: "", obligation_id: "", title: "", description: "", category: "general", owner: "", due_date: "" };

export default function CreateControlModal({ open, onClose, onSuccess }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [loading, setLoading] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setObligations([]);
    (async () => {
      try {
        const sys = await api.getSystems();
        setSystems(sys.filter((s) => s.lifecycle !== "decommissioned"));
      } catch (e) {
        showToast(`Failed to load systems: ${(e as Error).message}`, true);
      }
    })();
  }, [open, showToast]);

  async function onSystemChange(systemId: string) {
    setForm((f) => ({ ...f, system_id: systemId, obligation_id: "" }));
    setObligations([]);
    if (!systemId) return;
    try {
      const obls = await api.getObligations({ ai_system_id: systemId });
      setObligations(obls);
    } catch (e) {
      showToast(`Failed to load obligations: ${(e as Error).message}`, true);
    }
  }

  if (!open) return null;

  const setVal = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit() {
    if (!form.obligation_id) { showToast("Obligation is required", true); return; }
    if (!form.title.trim()) { showToast("Title is required", true); return; }
    setLoading(true);
    try {
      await api.createControl({
        obligation_id: form.obligation_id,
        title: form.title,
        description: form.description,
        category: form.category,
        owner: form.owner,
        due_date: form.due_date || null,
      });
      onClose();
      showToast("Requirement created");
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
          <DialogTitle>New Requirement</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cc-title">Title <span className="text-destructive">*</span></Label>
            <Input id="cc-title" value={form.title} onChange={(e) => setVal("title")(e.target.value)} placeholder="e.g. Human-in-the-loop approval workflow" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Category</Label>
            <Select value={form.category} onValueChange={setVal("category")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONTROL_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{humanize(c)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>AI System <span className="text-destructive">*</span></Label>
            <Select value={form.system_id} onValueChange={onSystemChange}>
              <SelectTrigger><SelectValue placeholder="Select a system…" /></SelectTrigger>
              <SelectContent>
                {systems.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.id})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Obligation <span className="text-destructive">*</span></Label>
            <Select value={form.obligation_id} onValueChange={setVal("obligation_id")} disabled={!form.system_id}>
              <SelectTrigger><SelectValue placeholder={form.system_id ? "Select an obligation…" : "Select a system first"} /></SelectTrigger>
              <SelectContent>
                {obligations.map((o) => <SelectItem key={o.id} value={o.id}>{o.title} ({o.article_ref})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cc-desc">Description</Label>
            <Textarea id="cc-desc" value={form.description} onChange={(e) => setVal("description")(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cc-owner">Owner</Label>
            <Input id="cc-owner" value={form.owner} onChange={(e) => setVal("owner")(e.target.value)} placeholder="e.g. AI Engineer" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cc-due">Due Date</Label>
            <Input id="cc-due" type="date" value={form.due_date} onChange={(e) => setVal("due_date")(e.target.value)} />
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
