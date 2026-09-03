import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../api/client";
import { registryClient } from "../api/registryClient";
import { useToast } from "../App";
import { usePermissions } from "../hooks/usePermissions";
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
  const [allUsers, setAllUsers] = useState<Array<{ username: string; firstName: string; lastName: string; role: string }>>([]);
  const [bizSearch, setBizSearch] = useState("");
  const [bizSelected, setBizSelected] = useState<string>("");
  const [bizDropdown, setBizDropdown] = useState(false);
  const [techSearch, setTechSearch] = useState("");
  const [techSelected, setTechSelected] = useState<string>("");
  const [techDropdown, setTechDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const showToast = useToast();
  const { username } = usePermissions();

  const selectedSystem = systems.find((s) => s.id === form.ai_system_id);
  const isPending = selectedSystem?.tier === "pending";

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setBizSearch("");
    setBizSelected("");
    setTechSearch("");
    setTechSelected("");
    (async () => {
      try {
        const [sys, fw] = await Promise.all([api.getSystems(), api.getFrameworks()]);
        setSystems(sys.filter((s) => s.lifecycle !== "decommissioned"));
        setFrameworks(fw.filter((f) => f.enabled));
      } catch (e) {
        showToast(`Failed to load options: ${(e as Error).message}`, true);
      }
    })();
    registryClient.getAllUsers().then(setAllUsers).catch(() => {});
  }, [open, showToast]);

  if (!open) return null;

  const setVal = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const bizFiltered = bizSearch.trim()
    ? allUsers.filter((u) => {
        const q = bizSearch.toLowerCase();
        return u.username.toLowerCase().includes(q) || u.firstName.toLowerCase().includes(q) || u.lastName.toLowerCase().includes(q);
      }).slice(0, 8)
    : [];

  const techFiltered = techSearch.trim()
    ? allUsers.filter((u) => {
        const q = techSearch.toLowerCase();
        return u.username.toLowerCase().includes(q) || u.firstName.toLowerCase().includes(q) || u.lastName.toLowerCase().includes(q);
      }).slice(0, 8)
    : [];

  async function handleSubmit() {
    if (!form.ai_system_id) { showToast("Select an AI system", true); return; }
    if (!form.framework_id) { showToast("Select a framework", true); return; }
    if (!form.title.trim()) { showToast("Title is required", true); return; }
    setLoading(true);
    try {
      await api.createAssessment(form);
      if (isPending && username && selectedSystem?.workflow_status === "draft") {
        await registryClient.assignWorkflow(form.ai_system_id, {
          business_assignee_username: bizSelected || username,
          technical_assignee_username: techSelected || undefined,
        });
      }
      onClose();
      showToast("Assessment created");
      onSuccess();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("already in progress")) {
        showToast("A questionnaire is already in progress for this system. Open the existing assessment.", true);
      } else {
        showToast(`Failed: ${msg}`, true);
      }
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
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.id}) — {s.tier === "pending" ? "Pending classification" : s.tier}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isPending && (
            <div className="flex flex-col gap-1.5">
              <Label>Business Section Owner <span className="text-muted-foreground text-xs font-normal">(optional — defaults to you)</span></Label>
              <div className="relative">
                <Input
                  value={bizSearch}
                  onChange={(e) => { setBizSearch(e.target.value); setBizSelected(""); setBizDropdown(e.target.value.trim().length > 0); }}
                  onFocus={() => { if (bizSearch.trim() && !bizSelected) setBizDropdown(true); }}
                  onBlur={() => setTimeout(() => setBizDropdown(false), 150)}
                  placeholder={`${username} (you) — type to reassign`}
                  className="text-sm"
                />
                {bizDropdown && bizFiltered.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-background shadow-md">
                    {bizFiltered.map((u) => (
                      <button
                        key={u.username}
                        type="button"
                        className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setBizSelected(u.username);
                          setBizSearch([u.firstName, u.lastName].filter(Boolean).join(" ") || u.username);
                          setBizDropdown(false);
                        }}
                      >
                        <span className="font-medium">{[u.firstName, u.lastName].filter(Boolean).join(" ") || u.username}</span>
                        <span className="text-xs text-muted-foreground">{u.username} · {u.role.replace(/_/g, " ")}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Will be assigned the business questionnaire section. Leave blank to assign to yourself.</p>
            </div>
          )}
          {isPending && (
            <div className="flex flex-col gap-1.5">
              <Label>Technical Section Owner <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              <div className="relative">
                <Input
                  value={techSearch}
                  onChange={(e) => { setTechSearch(e.target.value); setTechSelected(""); setTechDropdown(e.target.value.trim().length > 0); }}
                  onFocus={() => { if (techSearch.trim() && !techSelected) setTechDropdown(true); }}
                  onBlur={() => setTimeout(() => setTechDropdown(false), 150)}
                  placeholder="Search by name or username…"
                  className="text-sm"
                />
                {techDropdown && techFiltered.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-background shadow-md">
                    {techFiltered.map((u) => (
                      <button
                        key={u.username}
                        type="button"
                        className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setTechSelected(u.username);
                          setTechSearch([u.firstName, u.lastName].filter(Boolean).join(" ") || u.username);
                          setTechDropdown(false);
                        }}
                      >
                        <span className="font-medium">{[u.firstName, u.lastName].filter(Boolean).join(" ") || u.username}</span>
                        <span className="text-xs text-muted-foreground">{u.username} · {u.role.replace(/_/g, " ")}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Will be assigned the technical questionnaire section. Leave blank to assign later.</p>
            </div>
          )}
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
