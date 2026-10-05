import { useState, useRef } from "react";
import { Loader2, X, ExternalLink } from "lucide-react";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import type { UserSummary } from "../types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  name: string;
  description: string;
  intended_purpose: string;
  business_owners: string;
  technical_owners: string;
  git_repo_url: string;
}

const EMPTY: FormState = {
  name: "",
  description: "",
  intended_purpose: "",
  business_owners: "",
  technical_owners: "",
  git_repo_url: "",
};

function displayName(u: UserSummary) {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return full ? `${full} (${u.username})` : u.username;
}

export default function RegisterModal({ open, onClose, onSuccess }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const showToast = useToast();
  useModalControls();

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    submitting.current = false;
    api.getAllUsers().catch(() => []).then(setUsers);
  }, [open]);

  function set(k: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
    };
  }

  async function handleSubmit() {
    if (!form.name.trim()) { showToast("System name is required", true); return; }
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      await api.intake({
        ...form,
        // Required fields with defaults for the simplified flow
        version: "1.0.0",
        provider: "",
        org_name: "",
        org_role: "provider",
        provider_country: "DE",
        deployment_country: "",
        eu_output_usage: null,
        eu_market_placement: null,
        system_type: "application",
        autonomy_level: "decision_support",
        application_url: "",
        lifecycle: "development",
        is_gpai: false,
        training_compute_flops: 0,
        is_chatbot: false,
        generates_synthetic_content: false,
        subliminal_manipulation: false,
        exploits_vulnerability: false,
        social_scoring_public: false,
        real_time_biometric_public: false,
        emotion_recognition_workplace: false,
        untargeted_facial_scraping: false,
        predictive_policing: false,
        biometric_categorisation_sensitive: false,
        is_biometric_identification: false,
        is_critical_infrastructure: false,
        is_education_related: false,
        is_employment_related: false,
        is_credit_scoring: false,
        is_public_service: false,
        is_law_enforcement: false,
        is_migration: false,
        is_judicial_admin: false,
      });

      showToast("AI system registered");
      onSuccess();
      onClose();
    } catch (e) {
      showToast(`Registration failed: ${(e as Error).message}`, true);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showCloseButton={false} className="flex max-h-[90vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="flex-row items-center justify-between space-y-0">
          <DialogTitle>Register AI System</DialogTitle>
          <button onClick={onClose} className="text-muted-foreground transition-opacity hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </DialogHeader>

        <div className="overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-4">

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg_name">System Name <span className="text-[var(--danger-fg)]">*</span></Label>
              <Input id="reg_name" value={form.name} onChange={set("name")} placeholder="e.g. Fraud Detection Model" autoFocus />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg_desc">Description</Label>
              <Textarea id="reg_desc" rows={3} value={form.description} onChange={set("description")} placeholder="Brief description of the AI system…" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg_purpose">Purpose of Use</Label>
              <Textarea id="reg_purpose" rows={3} value={form.intended_purpose} onChange={set("intended_purpose")} placeholder="What is this AI system used for?" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reg_biz_owner">Business Owner</Label>
                <select
                  id="reg_biz_owner"
                  value={form.business_owners}
                  onChange={set("business_owners")}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  <option value="">Select user…</option>
                  {users.map((u) => (
                    <option key={u.username} value={u.username}>{displayName(u)}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reg_tech_owner">Technical Owner</Label>
                <select
                  id="reg_tech_owner"
                  value={form.technical_owners}
                  onChange={set("technical_owners")}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  <option value="">Select user…</option>
                  {users.map((u) => (
                    <option key={u.username} value={u.username}>{displayName(u)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg_git">Git / Application URL</Label>
              <div className="relative">
                <ExternalLink className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="reg_git"
                  value={form.git_repo_url}
                  onChange={set("git_repo_url")}
                  placeholder="https://github.com/org/repo"
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-muted-foreground">Link to the source repository or application (e.g. GitHub, GitLab).</p>
            </div>

          </div>
        </div>

        <DialogFooter className="sm:justify-start">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="animate-spin" />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
