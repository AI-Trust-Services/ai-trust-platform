import { useState, useEffect, useRef } from "react";
import { Loader2, X, Paperclip, FileText, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import { SELECT_CLASS } from "../utils";
import type { UserSummary } from "../types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

// The six canonical EU AI Act tiers — must match VALID_TIERS on the backend.
const TIER_OPTIONS: [string, string][] = [
  ["prohibited", "Prohibited (Art. 5)"],
  ["high", "High-Risk (Annex III)"],
  ["gpai-systemic", "GPAI — Systemic Risk"],
  ["gpai-standard", "GPAI — Standard"],
  ["limited", "Limited Risk (Art. 50)"],
  ["minimal", "Minimal Risk"],
];

const DOC_ACCEPT = ".pdf,.doc,.docx,.txt,.md,.ppt,.pptx";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function FullManualRegistration({ open, onClose, onSuccess }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tier, setTier] = useState("");
  const [complianceOfficerUsername, setComplianceOfficerUsername] = useState("");
  const [complianceOfficers, setComplianceOfficers] = useState<UserSummary[]>([]);
  const [docs, setDocs] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setTier("");
    setComplianceOfficerUsername("");
    setDocs([]);
    setLoading(false);
    submitting.current = false;
    api.getUsersByRole("ai_compliance_officer").then(setComplianceOfficers).catch(() => {});
  }, [open]);

  function displayName(u: UserSummary) {
    const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
    return full ? `${full} (${u.username})` : u.username;
  }

  function handlePickDocs(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length) setDocs((d) => [...d, ...picked]);
  }

  async function handleSubmit() {
    if (!name.trim()) { showToast("System name is required", true); return; }
    if (!tier) { showToast("Please select a risk tier", true); return; }
    if (!complianceOfficerUsername) { showToast("Please assign a Compliance Officer", true); return; }
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      const { system } = await api.intakeAssisted({
        registration_mode: "full_manual",
        name: name.trim(),
        description: description.trim(),
        tier,
        compliance_officer_username: complianceOfficerUsername,
      });
      // Upload staged documents sequentially so a failure points at a specific file.
      for (const file of docs) {
        await api.uploadDocument(system.id, file);
      }
      showToast("System registered — compliance officer notified");
      onSuccess();
    } catch (e) {
      showToast(`Registration failed: ${(e as Error).message}`, true);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => { if (!o) onClose(); }}>
      <DialogContent showCloseButton={false} className="flex max-h-[90vh] max-w-xl flex-col gap-0 p-0">
        <DialogHeader className="flex-row items-center justify-between space-y-0">
          <DialogTitle>Full Manual Registration</DialogTitle>
          <button onClick={onClose} className="text-muted-foreground transition-opacity hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
          <Alert variant="info">
            You are declaring the risk tier by hand. The system skips the questionnaire and classifier
            and goes straight to the named compliance officer for review.
          </Alert>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fm_name">System Name <span className="text-[var(--danger-fg)]">*</span></Label>
            <Input type="text" id="fm_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fraud Detection Model" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fm_description">Description</Label>
            <Textarea id="fm_description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of the AI system…" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fm_tier">Risk Tier <span className="text-[var(--danger-fg)]">*</span></Label>
            <select className={SELECT_CLASS} id="fm_tier" value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">— select tier —</option>
              {TIER_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fm_co">Compliance Officer <span className="text-[var(--danger-fg)]">*</span></Label>
            <select className={SELECT_CLASS} id="fm_co" value={complianceOfficerUsername} onChange={(e) => setComplianceOfficerUsername(e.target.value)}>
              <option value="">Choose Compliance Officer</option>
              {complianceOfficers.map((u) => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Supporting Documents</Label>
            <input ref={fileRef} type="file" accept={DOC_ACCEPT} multiple className="hidden" onChange={handlePickDocs} />
            <Button variant="outline" type="button" onClick={() => fileRef.current?.click()} className="self-start">
              <Paperclip /> Add documents
            </Button>
            <span className="text-xs text-muted-foreground">Allowed: PDF, DOC(X), TXT, MD, PPT(X)</span>
            {docs.length > 0 && (
              <div className="mt-1 divide-y divide-border rounded-md border border-border">
                {docs.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      className="ml-auto text-muted-foreground hover:text-[var(--danger-fg)]"
                      title="Remove"
                      onClick={() => setDocs((d) => d.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-start">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="animate-spin" />} Register System
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
