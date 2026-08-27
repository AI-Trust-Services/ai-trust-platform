import { useState, useEffect, useRef, Fragment } from "react";
import { Check, Loader2, X, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { TierBadge } from "./Badges";
import { previewClassify, copyToClipboard, SELECT_CLASS } from "../utils";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import type { AISystem, AISystemFormData, UserSummary } from "../types";
import { BUSINESS_QUESTIONS, TECHNICAL_QUESTIONS } from "../config/questionnaire";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const EMPTY_FORM: AISystemFormData = {
  name: "", version: "1.0.0", provider: "", org_name: "",
  org_role: "provider", provider_country: "DE", system_type: "application",
  autonomy_level: "decision_support", application_url: "",
  description: "", intended_purpose: "", lifecycle: "development",
  subliminal_manipulation: false, exploits_vulnerability: false,
  social_scoring_public: false, real_time_biometric_public: false,
  emotion_recognition_workplace: false, untargeted_facial_scraping: false,
  predictive_policing: false, biometric_categorisation_sensitive: false,
  is_biometric_identification: false, is_critical_infrastructure: false,
  is_education_related: false, is_employment_related: false,
  is_credit_scoring: false, is_public_service: false,
  is_law_enforcement: false, is_migration: false, is_judicial_admin: false,
  is_gpai: false, training_compute_flops: 0,
  is_chatbot: false, generates_synthetic_content: false,
};

const ENGINEER_STEPS = ["Purpose & Lifecycle", "Risk Flags", "Review"];
const OWNER_STEPS = ["Fill Questionnaire", "Assign & Submit"];

// Re-themed "panel" — a bordered card with a muted header. No shadcn primitive
// maps to this collapsible section, so it stays styled markup on the new tokens.
function CollapsiblePanel({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-3 overflow-hidden rounded-md border border-border">
      <CollapsibleTrigger className="flex w-full items-center justify-between bg-muted/40 px-4 py-2.5 text-sm font-medium">
        {title} {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="p-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function CheckItem({ id, label, checked, onCheckedChange }: { id: string; label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm" htmlFor={id}>
      <Checkbox id={id} checked={checked} onCheckedChange={(c: boolean | "indeterminate") => onCheckedChange(c === true)} className="mt-0.5" />
      <span>{label}</span>
    </label>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  system?: AISystem;
}

export default function RegisterWizard({ open, onClose, onSuccess, system }: Props) {
  const isEngineerMode = !!system;
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<AISystemFormData>(EMPTY_FORM);
  const [businessFields, setBusinessFields] = useState<Record<string, unknown>>({});
  const [businessOwners, setBusinessOwners] = useState<UserSummary[]>([]);
  const [businessAssigneeUsername, setBusinessAssigneeUsername] = useState("");
  const [assigneeUsername, setAssigneeUsername] = useState(""); // CO for engineer mode
  const [technicalAssigneeUsername, setTechnicalAssigneeUsername] = useState("");
  const [complianceOfficerUsername, setComplianceOfficerUsername] = useState("");
  const [engineers, setEngineers] = useState<UserSummary[]>([]);
  const [complianceOfficers, setComplianceOfficers] = useState<UserSummary[]>([]);
  const [techSectionOpen, setTechSectionOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [flagsConfirmed, setFlagsConfirmed] = useState(false);
  const submitting = useRef(false);
  const [doneId, setDoneId] = useState<string | null>(null);
  const showToast = useToast();
  const { username } = useModalControls();

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setDoneId(null);
    setFlagsConfirmed(false);
    submitting.current = false;
    if (isEngineerMode) {
      setForm({
        name: system.name || "",
        version: system.version || "1.0.0",
        provider: system.provider || "",
        org_name: system.org_name || "",
        org_role: system.org_role || "provider",
        provider_country: system.provider_country || "DE",
        system_type: system.system_type || "application",
        autonomy_level: system.autonomy_level || "decision_support",
        application_url: system.application_url || "",
        description: system.description || "",
        intended_purpose: system.intended_purpose || "",
        lifecycle: system.lifecycle || "development",
        subliminal_manipulation: system.subliminal_manipulation,
        exploits_vulnerability: system.exploits_vulnerability,
        social_scoring_public: system.social_scoring_public,
        real_time_biometric_public: system.real_time_biometric_public,
        emotion_recognition_workplace: system.emotion_recognition_workplace,
        untargeted_facial_scraping: system.untargeted_facial_scraping,
        predictive_policing: system.predictive_policing,
        biometric_categorisation_sensitive: system.biometric_categorisation_sensitive,
        is_biometric_identification: system.is_biometric_identification,
        is_critical_infrastructure: system.is_critical_infrastructure,
        is_education_related: system.is_education_related,
        is_employment_related: system.is_employment_related,
        is_credit_scoring: system.is_credit_scoring,
        is_public_service: system.is_public_service,
        is_law_enforcement: system.is_law_enforcement,
        is_migration: system.is_migration,
        is_judicial_admin: system.is_judicial_admin,
        is_gpai: system.is_gpai,
        training_compute_flops: system.training_compute_flops,
        is_chatbot: system.is_chatbot,
        generates_synthetic_content: system.generates_synthetic_content,
      });
      setComplianceOfficerUsername(system.compliance_officer_username || "");
      api.getUsersByRole("ai_compliance_officer")
        .then(setComplianceOfficers)
        .catch(() => {});
    } else {
      setForm(EMPTY_FORM);
      setBusinessFields({});
      setBusinessAssigneeUsername("");
      setAssigneeUsername("");
      setTechnicalAssigneeUsername("");
      setComplianceOfficerUsername("");
      setTechSectionOpen(false);
      Promise.all([
        api.getUsersByRole("business_owner"),
        api.getUsersByRole("ai_engineer"),
        api.getUsersByRole("ai_compliance_officer"),
      ]).then(([biz, eng, co]) => {
        setBusinessOwners(biz);
        setEngineers(eng);
        setComplianceOfficers(co);
      }).catch(() => {});
    }
  }, [open, isEngineerMode, system]);

  const set = (k: keyof AISystemFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [k]: (e.target as HTMLInputElement).type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
    setFlagsConfirmed(false);
  };
  const setBool = (k: keyof AISystemFormData) => (checked: boolean) => {
    setForm((f) => ({ ...f, [k]: checked }));
    setFlagsConfirmed(false);
  };
  const setNum = (k: keyof AISystemFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: parseFloat(e.target.value) || 0 }));
    setFlagsConfirmed(false);
  };

  const maxStep = isEngineerMode ? 2 : 1;

  function handleNext() {
    if (!isEngineerMode && step === 0 && !form.name.trim()) { showToast("System name is required", true); return; }
    setStep((s) => Math.min(s + 1, maxStep));
  }

  async function handleOwnerSubmit() {
    if (!form.name.trim()) { showToast("System name is required", true); return; }
    if (!businessAssigneeUsername) { showToast("Please assign a Business Assignee", true); return; }
    if (!technicalAssigneeUsername) { showToast("Please assign a Technical Assignee", true); return; }
    if (!complianceOfficerUsername) { showToast("Please assign a Compliance Officer", true); return; }
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      const systemFields: Record<string, unknown> = {};
      const answerFields: Record<string, string> = {};
      for (const q of BUSINESS_QUESTIONS) {
        const val = businessFields[q.key];
        if (val == null || val === "") continue;
        if (q.storage === "system") systemFields[q.key] = val;
        else answerFields[q.key] = String(val);
      }
      for (const q of TECHNICAL_QUESTIONS) {
        const val = businessFields[q.key];
        if (val == null) continue;
        systemFields[q.key] = q.type === "number" ? Number(val) : Boolean(val);
      }
      const result = await api.intake({ ...EMPTY_FORM, name: form.name, description: form.description, ...systemFields } as AISystemFormData);
      if (Object.keys(answerFields).length > 0) {
        await api.patchQuestionnaireAnswers(result.id, answerFields);
      }
      await api.assignWorkflow(result.id, {
        business_assignee_username: businessAssigneeUsername,
        technical_assignee_username: technicalAssigneeUsername,
        compliance_officer_username: complianceOfficerUsername,
      });
      if (businessAssigneeUsername === username) {
        await api.submitBusinessSection(result.id);
      }
      setDoneId(result.id);
      showToast(businessAssigneeUsername === username
        ? "System registered — technical assignee notified"
        : "System registered — business assignee notified");
      onSuccess();
    } catch (e) {
      showToast(`Registration failed: ${(e as Error).message}`, true);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  async function handleEngineerSubmit() {
    if (!assigneeUsername) { showToast("Please assign a Compliance Officer", true); return; }
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      await api.updateSystem(system!.id, { ...form });
      await api.submitForReview(system!.id, assigneeUsername);
      setDoneId(system!.id);
      showToast("System details saved and submitted for review");
      onSuccess();
    } catch (e) {
      showToast(`Submission failed: ${(e as Error).message}`, true);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  function handleCopyId() {
    copyToClipboard(doneId!)
      .then(() => showToast("System ID copied"))
      .catch(() => showToast("Copy failed", true));
  }

  const preview = previewClassify(form, form.training_compute_flops);

  const bizAnswered = BUSINESS_QUESTIONS.filter(q => {
    const v = businessFields[q.key];
    return q.type === "boolean" ? v === true : (v != null && v !== "");
  });
  const techAnswered = TECHNICAL_QUESTIONS.filter(q => {
    const v = businessFields[q.key];
    return q.type === "boolean" ? v === true : (q.type === "number" ? (typeof v === "number" && v > 0) : (v != null && v !== ""));
  });

  function displayName(u: UserSummary) {
    const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
    return full ? `${full} (${u.username})` : u.username;
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => { if (!o && !doneId) onClose(); }}>
      <DialogContent showCloseButton={false} className="flex max-h-[90vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="flex-row items-center justify-between space-y-0">
          <DialogTitle>{isEngineerMode ? `Fill in details — ${system!.name}` : "Register AI System"}</DialogTitle>
          <button onClick={onClose} className="text-muted-foreground transition-opacity hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </DialogHeader>

        {doneId ? (
          <div className="overflow-y-auto px-6 py-5">
            <Alert variant="info" className="mb-4">
              {isEngineerMode
                ? "System details saved and submitted for review. The compliance officer has been notified."
                : "AI system registered. The assigned engineer has been notified by email."}
            </Alert>
            {!isEngineerMode && (
              <div className="overflow-hidden rounded-md border border-border">
                <div className="bg-muted/40 px-4 py-2.5 text-sm font-medium">Telemetry Configuration</div>
                <div className="p-4">
                  <p className="mb-3 text-[13px]">
                    Use this system ID as the telemetry service name
                    (e.g. <code className="font-mono">OTEL_SERVICE_NAME</code>):
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[13px]">
                      {doneId}
                    </code>
                    <Button variant="ghost" onClick={handleCopyId} className="shrink-0"><Copy /> Copy ID</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {isEngineerMode && (
              <div className="flex flex-wrap gap-4 border-b border-border px-6 py-3">
                {ENGINEER_STEPS.map((label, i) => (
                  <div key={i} className={cn(
                    "flex items-center gap-2 text-sm",
                    i === step ? "font-semibold text-[var(--brand)]" : i < step ? "text-foreground" : "text-muted-foreground",
                  )}>
                    <span className={cn(
                      "flex size-5 items-center justify-center rounded-full text-xs font-semibold",
                      i === step ? "bg-[var(--brand)] text-white" : i < step ? "bg-[var(--success)] text-white" : "bg-muted text-muted-foreground",
                    )}>{i + 1}</span>
                    {label}
                  </div>
                ))}
              </div>
            )}
            {!isEngineerMode && (
              <div className="flex flex-wrap gap-4 border-b border-border px-6 py-3">
                {OWNER_STEPS.map((label, i) => (
                  <div key={i} className={cn(
                    "flex items-center gap-2 text-sm",
                    i === step ? "font-semibold text-[var(--brand)]" : i < step ? "text-foreground" : "text-muted-foreground",
                  )}>
                    <span className={cn(
                      "flex size-5 items-center justify-center rounded-full text-xs font-semibold",
                      i === step ? "bg-[var(--brand)] text-white" : i < step ? "bg-[var(--success)] text-white" : "bg-muted text-muted-foreground",
                    )}>{i + 1}</span>
                    {label}
                  </div>
                ))}
              </div>
            )}

            <div className="overflow-y-auto px-6 py-5">
              {/* OWNER MODE step 0: Full questionnaire */}
              {!isEngineerMode && step === 0 && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reg_name">System Name <span className="text-[var(--danger-fg)]">*</span></Label>
                    <Input type="text" id="reg_name" value={form.name} onChange={set("name")} placeholder="e.g. Fraud Detection Model" />
                  </div>

                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    General Information (optional)
                  </div>
                  {BUSINESS_QUESTIONS.map((q) => {
                    const val = businessFields[q.key];
                    if (q.type === "select") {
                      return (
                        <div key={q.key} className="flex flex-col gap-1">
                          <Label className="text-xs font-medium">{q.label}</Label>
                          <select className={SELECT_CLASS} value={val != null ? String(val) : ""} onChange={(e) => setBusinessFields((f) => ({ ...f, [q.key]: e.target.value }))}>
                            <option value="">— select —</option>
                            {q.options?.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                      );
                    }
                    if (q.type === "textarea") {
                      return (
                        <div key={q.key} className="flex flex-col gap-1">
                          <Label className="text-xs font-medium">{q.label}</Label>
                          <Textarea value={val != null ? String(val) : ""} onChange={(e) => setBusinessFields((f) => ({ ...f, [q.key]: e.target.value }))} placeholder={q.hint} rows={2} className="text-sm" />
                        </div>
                      );
                    }
                    return (
                      <div key={q.key} className="flex flex-col gap-1">
                        <Label className="text-xs font-medium">{q.label}</Label>
                        <Input value={val != null ? String(val) : ""} onChange={(e) => setBusinessFields((f) => ({ ...f, [q.key]: e.target.value }))} placeholder={q.hint} className="text-sm" />
                      </div>
                    );
                  })}

                  <Collapsible open={techSectionOpen} onOpenChange={setTechSectionOpen}>
                    <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>AI Risk Classification (optional)</span>
                      {techSectionOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 flex flex-col gap-2">
                      {TECHNICAL_QUESTIONS.map((q) => {
                        const val = businessFields[q.key];
                        if (q.type === "number") {
                          return (
                            <div key={q.key} className="flex flex-col gap-1">
                              <Label className="text-xs font-medium">{q.label}</Label>
                              <Input type="number" value={val != null ? String(val) : ""} onChange={(e) => setBusinessFields((f) => ({ ...f, [q.key]: parseFloat(e.target.value) || 0 }))} placeholder={q.hint} className="text-sm" />
                            </div>
                          );
                        }
                        return (
                          <label key={q.key} className="flex items-start gap-2.5 rounded-md border border-border p-2.5 text-sm">
                            <Checkbox checked={Boolean(val)} onCheckedChange={(c: boolean | "indeterminate") => setBusinessFields((f) => ({ ...f, [q.key]: c === true }))} className="mt-0.5 shrink-0" />
                            <div>
                              <div className="font-medium text-[13px]">{q.label}</div>
                              <div className="text-xs text-muted-foreground">{q.hint}</div>
                            </div>
                          </label>
                        );
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )}

              {/* OWNER MODE step 1: Assign & Submit */}
              {!isEngineerMode && step === 1 && (
                  <div className="flex flex-col gap-5">
                    {/* Business summary */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-sm font-semibold">General Information</span>
                        <Badge variant="outline" className="text-xs">{bizAnswered.length}/{BUSINESS_QUESTIONS.length} answered</Badge>
                      </div>
                      <div className="mb-3 divide-y divide-border rounded-md border border-border">
                        {BUSINESS_QUESTIONS.map((q) => {
                          const v = businessFields[q.key];
                          const answered = v != null && v !== "";
                          return (
                            <div key={q.key} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                              {answered ? <Check className="size-3.5 shrink-0 text-[var(--success)]" /> : <span className="inline-block size-3.5 shrink-0 rounded-full border border-muted-foreground" />}
                              <span className={answered ? "" : "text-muted-foreground"}>{q.label}</span>
                              {answered && <span className="ml-auto max-w-[180px] truncate text-xs text-muted-foreground">{String(v)}</span>}
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="reg_biz">Business Assignee <span className="text-[var(--danger-fg)]">*</span> <span className="font-normal text-muted-foreground text-xs">— will complete unanswered questions</span></Label>
                        <select className={SELECT_CLASS} id="reg_biz" value={businessAssigneeUsername} onChange={(e) => setBusinessAssigneeUsername(e.target.value)}>
                          <option value="">Choose Business Assignee</option>
                          {businessOwners.map((u) => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Technical summary */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-sm font-semibold">AI Risk Classification</span>
                        <Badge variant="outline" className="text-xs">{techAnswered.length}/{TECHNICAL_QUESTIONS.length} flagged</Badge>
                      </div>
                      <Collapsible>
                        <CollapsibleTrigger className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                          <ChevronRight className="size-3" /> Show all flags
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mb-3 divide-y divide-border rounded-md border border-border">
                          {TECHNICAL_QUESTIONS.map((q) => {
                            const v = businessFields[q.key];
                            const answered = q.type === "boolean" ? v === true : (q.type === "number" ? (typeof v === "number" && v > 0) : (v != null && v !== ""));
                            return (
                              <div key={q.key} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                                {answered ? <Check className="size-3.5 shrink-0 text-[var(--success)]" /> : <span className="inline-block size-3.5 shrink-0 rounded-full border border-muted-foreground" />}
                                <span className={answered ? "" : "text-muted-foreground"}>{q.label}</span>
                              </div>
                            );
                          })}
                        </CollapsibleContent>
                      </Collapsible>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="reg_technical">Technical Assignee <span className="text-[var(--danger-fg)]">*</span> <span className="font-normal text-muted-foreground text-xs">— will complete risk classification</span></Label>
                        <select className={SELECT_CLASS} id="reg_technical" value={technicalAssigneeUsername} onChange={(e) => setTechnicalAssigneeUsername(e.target.value)}>
                          <option value="">Choose Technical Assignee</option>
                          {engineers.map((u) => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* CO */}
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="reg_co">Compliance Officer <span className="text-[var(--danger-fg)]">*</span></Label>
                      <select className={SELECT_CLASS} id="reg_co" value={complianceOfficerUsername} onChange={(e) => setComplianceOfficerUsername(e.target.value)}>
                        <option value="">Choose Compliance Officer</option>
                        {complianceOfficers.map((u) => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
                      </select>
                    </div>
                  </div>
              )}

              {/* ENGINEER MODE step 0: Purpose & Lifecycle */}
              {isEngineerMode && step === 0 && (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="eng_description">Description</Label>
                    <Textarea id="eng_description" rows={3} value={form.description} onChange={set("description")} placeholder="Brief description of the AI system…" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="eng_purpose">Intended Purpose</Label>
                    <Textarea id="eng_purpose" rows={3} value={form.intended_purpose} onChange={set("intended_purpose")} placeholder="Describe the intended purpose and deployment context…" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="eng_lifecycle">Lifecycle State</Label>
                    <select className={SELECT_CLASS} id="eng_lifecycle" value={form.lifecycle} onChange={set("lifecycle")}>
                      <option value="development">Development</option>
                      <option value="testing">Testing</option>
                      <option value="conformity">Conformity</option>
                      <option value="market">On Market</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="eng_version">Version</Label>
                    <Input type="text" id="eng_version" value={form.version} onChange={set("version")} placeholder="1.0.0" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="eng_provider">Provider Name</Label>
                    <Input type="text" id="eng_provider" value={form.provider} onChange={set("provider")} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="eng_org_name">Organisation Name</Label>
                    <Input type="text" id="eng_org_name" value={form.org_name} onChange={set("org_name")} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="eng_system_type">System Type</Label>
                    <select className={SELECT_CLASS} id="eng_system_type" value={form.system_type} onChange={set("system_type")}>
                      <option value="application">Application</option>
                      <option value="model">Model</option>
                      <option value="component">Component</option>
                      <option value="service">Service</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="eng_autonomy">Autonomy Level</Label>
                    <select className={SELECT_CLASS} id="eng_autonomy" value={form.autonomy_level} onChange={set("autonomy_level")}>
                      <option value="decision_support">Decision support</option>
                      <option value="human_in_the_loop">Human in the loop</option>
                      <option value="human_on_the_loop">Human on the loop</option>
                      <option value="fully_automated">Fully automated</option>
                    </select>
                  </div>
                </div>
              )}

              {/* ENGINEER MODE step 1: Risk Flags */}
              {isEngineerMode && step === 1 && (
                <div>
                  <Alert variant="info" className="mb-4">
                    Check all applicable flags. The risk tier will be determined automatically from these flags.
                  </Alert>
                  <CollapsiblePanel title="Art. 5 — Prohibited Practices">
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        ["subliminal_manipulation", "Subliminal manipulation"],
                        ["exploits_vulnerability", "Exploits vulnerability"],
                        ["social_scoring_public", "Social scoring (public authority)"],
                        ["real_time_biometric_public", "Real-time biometric ID in public"],
                        ["emotion_recognition_workplace", "Emotion recognition (workplace/education)"],
                        ["untargeted_facial_scraping", "Untargeted facial image scraping"],
                        ["predictive_policing", "Predictive policing"],
                        ["biometric_categorisation_sensitive", "Biometric categorisation (sensitive attrs.)"],
                      ].map(([k, label]) => (
                        <CheckItem key={k} id={k} label={label} checked={form[k as keyof AISystemFormData] as boolean} onCheckedChange={setBool(k as keyof AISystemFormData)} />
                      ))}
                    </div>
                  </CollapsiblePanel>
                  <CollapsiblePanel title="Annex III — High-Risk Categories">
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        ["is_biometric_identification", "Biometric identification"],
                        ["is_critical_infrastructure", "Critical infrastructure"],
                        ["is_education_related", "Education & vocational training"],
                        ["is_employment_related", "Employment & worker management"],
                        ["is_credit_scoring", "Credit scoring"],
                        ["is_public_service", "Public services"],
                        ["is_law_enforcement", "Law enforcement"],
                        ["is_migration", "Migration & border control"],
                        ["is_judicial_admin", "Justice & democratic processes"],
                      ].map(([k, label]) => (
                        <CheckItem key={k} id={k} label={label} checked={form[k as keyof AISystemFormData] as boolean} onCheckedChange={setBool(k as keyof AISystemFormData)} />
                      ))}
                    </div>
                  </CollapsiblePanel>
                  <CollapsiblePanel title="GPAI — General Purpose AI">
                    <div className="grid grid-cols-2 gap-2">
                      <CheckItem id="is_gpai" label="General-purpose AI model" checked={form.is_gpai} onCheckedChange={setBool("is_gpai")} />
                    </div>
                    {form.is_gpai && (
                      <div className="mt-3 flex max-w-80 flex-col gap-1.5">
                        <Label htmlFor="f_flops">Training Compute (FLOPs)</Label>
                        <Input type="number" id="f_flops" value={form.training_compute_flops || ""} onChange={setNum("training_compute_flops")} placeholder="0" min={0} />
                        <span className="text-xs text-muted-foreground">≥ 10²⁵ FLOPs = systemic risk</span>
                      </div>
                    )}
                  </CollapsiblePanel>
                  <CollapsiblePanel title="Art. 50 — Limited Risk (Transparency)">
                    <div className="grid grid-cols-2 gap-2">
                      <CheckItem id="is_chatbot" label="Chatbot / direct user interaction" checked={form.is_chatbot} onCheckedChange={setBool("is_chatbot")} />
                      <CheckItem id="generates_synthetic_content" label="Generates synthetic content" checked={form.generates_synthetic_content} onCheckedChange={setBool("generates_synthetic_content")} />
                    </div>
                  </CollapsiblePanel>
                  <div style={{
                    display: "flex", alignItems: "flex-start", gap: 10, marginTop: 16, padding: "12px 14px", borderRadius: 8,
                    border: `2px solid ${flagsConfirmed ? "#27ae60" : "#e67e22"}`,
                    background: flagsConfirmed ? "#f0faf4" : "#fffaf5",
                  }}>
                    <input type="checkbox" checked={flagsConfirmed} onChange={e => setFlagsConfirmed(e.target.checked)} style={{ marginTop: 2, flexShrink: 0, accentColor: "#27ae60", width: 16, height: 16 }} />
                    <div>
                      {flagsConfirmed
                        ? <strong style={{ color: "#27ae60" }}>✓ All details reviewed and confirmed</strong>
                        : <strong style={{ color: "#e67e22" }}>⚠ Please review all details before continuing</strong>
                      }
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                        Any changes after ticking this will reset the confirmation.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ENGINEER MODE step 2: Review + assign compliance officer */}
              {isEngineerMode && step === 2 && (
                <div>
                  <Alert variant="info" className="mb-4">
                    Review the details below, then assign a Compliance Officer and submit for review.
                  </Alert>
                  <div className="mb-4 overflow-hidden rounded-md border border-border">
                    <div className="bg-muted/40 px-4 py-2.5 text-sm font-medium">Summary</div>
                    <div className="p-4">
                      <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-[13px]">
                        {[
                          ["Name", system!.name],
                          ["Description", form.description || "—"],
                          ["Purpose", form.intended_purpose || "—"],
                          ["Version", form.version || "1.0.0"],
                          ["Provider", form.provider || "—"],
                          ["System Type", form.system_type],
                          ["Autonomy Level", form.autonomy_level.replace(/_/g, " ")],
                          ["Lifecycle", form.lifecycle],
                        ].map(([label, value]) => (
                          <Fragment key={label}>
                            <span className="font-medium text-muted-foreground">{label}</span>
                            <span>{value}</span>
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-accent/40 p-4">
                    <h4 className="mb-2.5 text-sm font-semibold">Estimated Classification (preview)</h4>
                    <div className="mb-2.5 flex items-center gap-2.5">
                      <TierBadge tier={preview.tier} />
                      <span className="text-[13px] text-muted-foreground">{preview.basis}</span>
                    </div>
                    {preview.obligations.length > 0 ? (
                      <>
                        <div className="mb-1 text-[13px] font-medium">Obligations:</div>
                        <ul className="list-inside list-disc text-[13px] text-muted-foreground">
                          {preview.obligations.map((o) => <li key={o}>{o}</li>)}
                        </ul>
                      </>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">No mandatory obligations.</span>
                    )}
                  </div>
                  <div className="mt-4 flex flex-col gap-1.5">
                    <Label htmlFor="assign_co">Assign to Compliance Officer <span className="text-[var(--danger-fg)]">*</span></Label>
                    <select className={SELECT_CLASS} id="assign_co" value={assigneeUsername} onChange={(e) => setAssigneeUsername(e.target.value)}>
                      <option value="">Choose Compliance Officer</option>
                      {complianceOfficers.map((u) => (
                        <option key={u.username} value={u.username}>{displayName(u)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <DialogFooter className="sm:justify-start">
          {doneId ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              {step > 0 && (
                <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>← Back</Button>
              )}
              {/* Owner: next until last step, then register */}
              {!isEngineerMode && step < maxStep && (
                <Button onClick={handleNext}>Next →</Button>
              )}
              {!isEngineerMode && step === maxStep && (
                <Button onClick={handleOwnerSubmit} disabled={loading}>
                  {loading && <Loader2 className="animate-spin" />} Register System
                </Button>
              )}
              {/* Engineer: next until last page, then submit */}
              {isEngineerMode && step < maxStep && (
                <Button onClick={handleNext} disabled={step === 1 && !flagsConfirmed}>Next →</Button>
              )}
              {isEngineerMode && step === maxStep && (
                <Button onClick={handleEngineerSubmit} disabled={loading}>
                  {loading && <Loader2 className="animate-spin" />} Submit for Review
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
