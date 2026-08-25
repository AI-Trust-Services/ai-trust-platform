import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import { CONTROL_CATEGORIES, humanize } from "../utils";
import type { AISystem } from "../types";
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
  title: string;
  description: string;
  category: string;
  owner: string;
  due_date: string;
}

const EMPTY: FormState = { ai_system_id: "", title: "", description: "", category: "general", owner: "", due_date: "" };
// Sentinel for the "Org-wide" option — Radix Select disallows an empty-string value.
const ORG_WIDE = "__org__";

export default function CreateControlModal({ open, onClose, onSuccess }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [loading, setLoading] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    (async () => {
      try {
        const sys = await api.getSystems();
        setSystems(sys.filter((s) => s.lifecycle !== "decommissioned"));
      } catch (e) {
        showToast(`Failed to load systems: ${(e as Error).message}`, true);
      }
    })();
  }, [open, showToast]);

  if (!open) return null;

  const setVal = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit() {
    if (!form.title.trim()) { showToast("Title is required", true); return; }
    setLoading(true);
    try {
      await api.createControl({ ...form, ai_system_id: form.ai_system_id || null, due_date: form.due_date || null });
      onClose();
      showToast("Control created");
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
          <DialogTitle>New Control</DialogTitle>
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
            <Label>AI System (leave blank for org-wide)</Label>
            <Select
              value={form.ai_system_id || ORG_WIDE}
              onValueChange={(v) => setVal("ai_system_id")(v === ORG_WIDE ? "" : v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ORG_WIDE}>Org-wide (all systems)</SelectItem>
                {systems.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.id})</SelectItem>)}
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
