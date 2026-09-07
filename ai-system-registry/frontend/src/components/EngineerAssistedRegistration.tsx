import { useState, useEffect, useRef } from "react";
import { Bot, Check, ChevronDown, ChevronRight, Loader2, Paperclip, SendHorizonal, Sparkles, User } from "lucide-react";
import { TierBadge } from "./Badges";
import { api } from "../api/client";
import { useToast } from "../App";
import type { AISystem, ChatMessage, RationaleItem, ClassificationResult, UserSummary } from "../types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  system: AISystem;
  onClose: () => void;
  onSuccess: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  description:      "Description",
  intended_purpose: "Intended Purpose",
  version:          "Version",
  provider:         "Provider",
  org_name:         "Organisation Name",
  system_type:      "System Type",
  lifecycle:        "Lifecycle State",
  autonomy_level:   "Autonomy Level",
};

const ENUM_OPTIONS: Record<string, { value: string; label: string }[]> = {
  system_type: [
    { value: "application", label: "Application" },
    { value: "model",       label: "Model" },
    { value: "component",   label: "Component" },
    { value: "service",     label: "Service" },
  ],
  lifecycle: [
    { value: "development", label: "Development" },
    { value: "testing",     label: "Testing" },
    { value: "conformity",  label: "Conformity" },
    { value: "market",      label: "On Market" },
  ],
  autonomy_level: [
    { value: "decision_support",   label: "Decision support" },
    { value: "human_in_the_loop",  label: "Human in the loop" },
    { value: "human_on_the_loop",  label: "Human on the loop" },
    { value: "fully_automated",    label: "Fully automated" },
  ],
};

const ALL_FIELD_KEYS = Object.keys(FIELD_LABELS);
const TOTAL_FIELDS = ALL_FIELD_KEYS.length;

const PROHIBITED_FLAGS: [string, string][] = [
  ["subliminal_manipulation",            "Subliminal manipulation"],
  ["exploits_vulnerability",             "Exploits vulnerability"],
  ["social_scoring_public",              "Social scoring (public authority)"],
  ["real_time_biometric_public",         "Real-time biometric ID in public"],
  ["emotion_recognition_workplace",      "Emotion recognition (workplace/education)"],
  ["untargeted_facial_scraping",         "Untargeted facial image scraping"],
  ["predictive_policing",                "Predictive policing"],
  ["biometric_categorisation_sensitive", "Biometric categorisation (sensitive attrs.)"],
];
const ANNEX_III_FLAGS: [string, string][] = [
  ["is_biometric_identification", "Biometric identification"],
  ["is_critical_infrastructure",  "Critical infrastructure"],
  ["is_education_related",        "Education & vocational training"],
  ["is_employment_related",       "Employment & worker management"],
  ["is_credit_scoring",           "Credit scoring"],
  ["is_public_service",           "Public services"],
  ["is_law_enforcement",          "Law enforcement"],
  ["is_migration",                "Migration & border control"],
  ["is_judicial_admin",           "Justice & democratic processes"],
];
const GPAI_FLAGS: [string, string][] = [
  ["is_gpai", "General-purpose AI model"],
];
const LIMITED_FLAGS: [string, string][] = [
  ["is_chatbot",                  "Chatbot / direct user interaction"],
  ["generates_synthetic_content", "Generates synthetic content"],
];

const GREETING =
  "Hi! I'll help you complete the technical registration. " +
  "You can upload a model card or technical spec, or just describe the system — version, provider, deployment context, and so on.";

function displayName(u: UserSummary) {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return full ? `${full} (${u.username})` : u.username;
}

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

function CheckItem({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer" htmlFor={id}>
      <Checkbox id={id} checked={checked} onCheckedChange={(c) => onChange(c === true)} className="mt-0.5" />
      <span>{label}</span>
    </label>
  );
}

export default function EngineerAssistedRegistration({ open, system, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<0 | 1>(0);

  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [degraded, setDegraded] = useState(false);

  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [inferredFlags, setInferredFlags] = useState<RationaleItem[]>([]);
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [flagsConfirmed, setFlagsConfirmed] = useState(false);

  const [complianceOfficers, setComplianceOfficers] = useState<UserSummary[]>([]);
  const [complianceOfficerUsername, setComplianceOfficerUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;

    const prevConfirmed = system.field_confirmations ?? {};
    const savedFields: Record<string, unknown> = {};
    for (const k of ALL_FIELD_KEYS) {
      if (prevConfirmed[k] === true) {
        const v = (system as Record<string, unknown>)[k];
        if (v !== undefined && v !== null && v !== "") savedFields[k] = v;
      }
    }
    const hasSavedFields = Object.keys(savedFields).length > 0;

    setFields(savedFields);
    setConfirmed(system.field_confirmations ?? {});
    setStep(0);
    setTranscript([{ role: "assistant", content: GREETING }]);
    setInput("");
    setBusy(false);
    setComplete(hasSavedFields);
    setDegraded(false);
    setFlags({});
    setInferredFlags([]);
    setClassification(null);
    setFlagsConfirmed(false);
    setComplianceOfficerUsername(system.compliance_officer_username ?? "");
    setSubmitting(false);
    api.getUsersByRole("ai_compliance_officer").then(setComplianceOfficers).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript, busy]);

  useEffect(() => {
    if (!busy && step === 0) inputRef.current?.focus();
  }, [busy, step]);

  // Derived counts
  const filledCount = ALL_FIELD_KEYS.filter(k => {
    const v = fields[k]; return v !== undefined && v !== null && v !== "";
  }).length;
  const emptyCount = TOTAL_FIELDS - filledCount;
  const confirmedCount = ALL_FIELD_KEYS.filter(k => confirmed[k] === true).length;
  const unconfirmedCount = ALL_FIELD_KEYS.filter(k => {
    const v = fields[k];
    return (v !== undefined && v !== null && v !== "") && confirmed[k] !== true;
  }).length;
  const canProceedToStep1 = filledCount > 0 && unconfirmedCount === 0;

  async function runTurn(nextTranscript: ChatMessage[], overrideFields?: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await api.engineerAssistTurn(system.id, nextTranscript, overrideFields ?? fields);
      setFields(res.extracted_fields || {});
      if (res.message) setTranscript([...nextTranscript, { role: "assistant", content: res.message }]);
      else setTranscript(nextTranscript);
      if (res.complete) {
        setComplete(true);
        setDegraded(res.degraded);
        setInferredFlags(res.inferred_flags || []);
        setClassification(res.classification);
        const flagMap: Record<string, boolean> = {};
        for (const f of (res.inferred_flags || [])) {
          if (typeof f.value === "boolean") flagMap[f.flag] = f.value;
        }
        setFlags(flagMap);
      }
    } catch (e) {
      showToast(`Assistant unavailable: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  }

  function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    inputRef.current?.focus();
    const next: ChatMessage[] = [...transcript, { role: "user", content: text }];
    setTranscript(next);
    runTurn(next);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
    setBusy(true);
    const uploadMsg: ChatMessage = { role: "user", content: `Uploaded: ${file.name}` };
    setTranscript(t => [...t, uploadMsg]);
    const currentTranscript = [...transcript, uploadMsg];
    try {
      const res = await api.engineerAssistExtract(system.id, file);
      const extracted = res.extracted_fields || {};
      const merged = { ...fields, ...extracted };
      setFields(merged);
      const notes = res.notes ? ` — ${res.notes}` : "";
      const summary = Object.keys(extracted).length
        ? `Extracted from ${file.name}${notes}.`
        : `Couldn't extract much from ${file.name}. Please describe the system.`;
      const assistMsg: ChatMessage = { role: "assistant", content: summary };
      const nextTranscript = [...currentTranscript, assistMsg];
      setTranscript(nextTranscript);
      if (Object.keys(FIELD_LABELS).every(k => { const v = merged[k]; return v !== undefined && v !== null && v !== ""; })) setComplete(true);
      setBusy(false);
      if (Object.keys(extracted).length) await runTurn(nextTranscript, merged);
    } catch (err) {
      showToast(`Document extraction failed: ${(err as Error).message}`, true);
      setTranscript(t => [...t, { role: "assistant", content: `Couldn't process ${file.name}.` }]);
      setBusy(false);
    }
  }

  async function handleConfirm(key: string) {
    const next = { ...confirmed, [key]: true };
    setConfirmed(next);
    setSaving(true);
    try {
      await Promise.all([
        api.updateSystem(system.id, { [key]: fields[key] } as never),
        api.patchFieldConfirmations(system.id, { [key]: true }),
      ]);
    } catch (e) {
      showToast(`Failed to save confirmation: ${(e as Error).message}`, true);
    } finally {
      setSaving(false);
    }
  }

  function handleFieldChange(key: string, value: string) {
    setFields(f => ({ ...f, [key]: value }));
    if (confirmed[key]) setConfirmed(c => ({ ...c, [key]: false }));
  }

  async function handleSubmit() {
    if (submitting) return;
    if (!complianceOfficerUsername) {
      showToast("Please assign a Compliance Officer before submitting", true);
      return;
    }
    setSubmitting(true);
    const payload: Record<string, unknown> = {
      description:      String(fields.description ?? ""),
      intended_purpose: String(fields.intended_purpose ?? ""),
      version:          String(fields.version ?? ""),
      provider:         String(fields.provider ?? ""),
      org_name:         String(fields.org_name ?? ""),
      system_type:      String(fields.system_type ?? "application"),
      lifecycle:        String(fields.lifecycle ?? "development"),
      autonomy_level:   String(fields.autonomy_level ?? "decision_support"),
      compliance_officer_username: complianceOfficerUsername,
      ...flags,
    };
    if (inferredFlags.length) payload.classification_rationale = inferredFlags;
    try {
      await api.updateSystem(system.id, payload);
      await api.submitForReview(system.id, complianceOfficerUsername);
      showToast("Technical details saved. System forwarded to compliance.");
      onSuccess();
    } catch (e) {
      showToast(`Save failed: ${(e as Error).message}`, true);
    } finally {
      setSubmitting(false);
    }
  }

  if (!system) return null;

  const STEPS = ["Describe & confirm fields", "Risk flags & submit"];
  const selectCls = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={cn("p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden", step === 0 ? "sm:max-w-[960px]" : "sm:max-w-[720px]")}>
        <DialogHeader className="shrink-0 px-6 pt-5 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-[var(--brand)]" /> AI-Assisted Technical Review
            <span className="ml-2 text-[13px] font-normal text-muted-foreground">{system.name} · {system.id}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Step bar */}
        <div className="shrink-0 flex border-b border-border bg-muted/30 px-6">
          {STEPS.map((label, i) => (
            <div key={i} className={cn(
              "flex items-center gap-2 border-b-[3px] py-3 pr-6 text-[13px]",
              i === step
                ? "border-primary font-medium text-primary"
                : i < step
                  ? "border-transparent text-foreground"
                  : "border-transparent text-muted-foreground",
            )}>
              <span className={cn(
                "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-[var(--success)] text-white" : "bg-muted text-muted-foreground",
              )}>{i + 1}</span>
              {label}
            </div>
          ))}
        </div>

        {/* STEP 0: chat + fields */}
        {step === 0 && (
          <>
            {/* Progress strip */}
            <div className="shrink-0 flex items-center gap-3 border-b border-border bg-muted/20 px-6 py-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full transition-[width]" style={{
                  width: `${(confirmedCount / TOTAL_FIELDS) * 100}%`,
                  background: confirmedCount === TOTAL_FIELDS ? "var(--success)" : "var(--brand)",
                }} />
              </div>
              <span className="min-w-[90px] text-right text-xs text-muted-foreground">
                {confirmedCount === TOTAL_FIELDS ? "✓ " : ""}{confirmedCount} / {TOTAL_FIELDS} confirmed
              </span>
            </div>

            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* LEFT: chat */}
              <div className="flex w-[44%] shrink-0 flex-col gap-2.5 overflow-hidden border-r border-border p-4">
                <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
                  {transcript.filter(m => m.role !== "system").map((m, i) => (
                    <div key={i} className={cn("flex items-end gap-2", m.role === "user" ? "flex-row-reverse" : "flex-row")}>
                      <div className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full",
                        m.role === "user" ? "bg-primary/15 text-primary" : "bg-[var(--brand)] text-white",
                      )}>
                        {m.role === "user" ? <User className="size-3" /> : <Bot className="size-3" />}
                      </div>
                      <div className={cn(
                        "max-w-[76%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
                        m.role === "user"
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm border border-border bg-muted text-foreground",
                      )}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {busy && (
                    <div className="flex items-end gap-2">
                      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-white">
                        <Bot className="size-3" />
                      </div>
                      <div className="rounded-2xl rounded-bl-sm border border-border bg-muted px-4 py-3">
                        <div className="flex gap-1.5">
                          {[0, 150, 300].map((delay) => (
                            <span key={delay} className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
                              style={{ animationDelay: `${delay}ms` }} />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <input ref={fileRef} type="file" className="hidden"
                    accept=".txt,.md,.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                    onChange={handleUpload}
                  />
                  <Button variant="ghost" size="icon" className="size-9 shrink-0" title="Upload a document"
                    disabled={busy} onClick={() => fileRef.current?.click()}>
                    <Paperclip className="size-4" />
                  </Button>
                <Input
                    className="flex-1"
                    placeholder={busy ? "Thinking…" : "Describe the system technically…"}
                    value={input} disabled={busy}
                    ref={inputRef}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleSend(); }}
                  />
                  <Button variant="ghost" size="icon" className="size-9 shrink-0" disabled={busy || !input.trim()} onClick={handleSend}>
                    <SendHorizonal className="size-4" />
                  </Button>
                </div>

                {degraded && (
                  <Alert>
                    <AlertDescription className="text-[13px]">
                      Reached the question limit. Review and confirm the fields on the right, then proceed.
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              {/* RIGHT: fields */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="mb-2.5 border-b border-border pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Collected Details — confirm each field
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(FIELD_LABELS).map(([key, label]) => {
                    const v = fields[key];
                    const strVal = (v !== undefined && v !== null && v !== "") ? String(v) : "";
                    const isEmpty = strVal === "";
                    const isConfirmed = confirmed[key] === true;
                    const isWide = key === "description" || key === "intended_purpose";
                    const opts = ENUM_OPTIONS[key];

                    const borderCls = isConfirmed
                      ? "border-[var(--success)] bg-[#f0faf4]"
                      : isEmpty
                        ? "border-[var(--danger-fg)] bg-[#fff8f8]"
                        : "border-border";

                    return (
                      <div key={key} className={cn(
                        "flex flex-col gap-1 rounded-md border p-2.5",
                        isWide && "col-span-2",
                        borderCls,
                      )}>
                        <div className="flex items-center justify-between">
                          <label htmlFor={`eng_field_${key}`} className="text-[11px] font-semibold text-muted-foreground">
                            {label}
                          </label>
                          {!isEmpty && (
                            isConfirmed ? (
                              <Badge className="h-5 gap-1 rounded-full bg-[var(--success)] text-white hover:bg-[var(--success-fg)]">
                                <Check className="size-3" /> Confirmed
                              </Badge>
                            ) : (
                              <Button size="sm" className="h-6 gap-1 px-2 text-[11px] bg-[var(--success)] hover:bg-[var(--success-fg)] text-white"
                                onClick={() => handleConfirm(key)} disabled={saving}>
                                <Check className="size-3" /> Confirm
                              </Button>
                            )
                          )}
                        </div>
                        {opts ? (
                          <select id={`eng_field_${key}`} className="w-full rounded border border-border bg-background px-2 py-1 text-[13px]"
                            value={strVal} onChange={e => handleFieldChange(key, e.target.value)}>
                            <option value="">— not set —</option>
                            {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : isWide ? (
                          <Textarea id={`eng_field_${key}`} value={strVal} rows={2}
                            className="text-[13px]"
                            onChange={e => handleFieldChange(key, e.target.value)}
                            placeholder={`Enter ${label.toLowerCase()}…`}
                          />
                        ) : (
                          <Input id={`eng_field_${key}`} value={strVal}
                            className="text-[13px]"
                            onChange={e => handleFieldChange(key, e.target.value)}
                            placeholder={`Enter ${label.toLowerCase()}…`}
                          />
                        )}
                        {isEmpty && (
                          <div className="text-[11px] text-[var(--danger-fg)]">Required — please fill in</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {filledCount > 0 && (emptyCount > 0 || unconfirmedCount > 0) && (
            <div className="shrink-0 mx-6 mb-2">
                <Alert>
                  <AlertDescription className="text-[13px]">
                    {emptyCount > 0 && <span>{emptyCount} field{emptyCount > 1 ? "s" : ""} not filled. </span>}
                    {unconfirmedCount > 0 && <span>{unconfirmedCount} field{unconfirmedCount > 1 ? "s" : ""} filled but not confirmed. </span>}
                    Confirm all filled fields to proceed.
                  </AlertDescription>
                </Alert>
              </div>
            )}

          <DialogFooter className="shrink-0 px-6 py-4">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={() => setStep(1)} disabled={!canProceedToStep1}
                title={!canProceedToStep1 ? (filledCount === 0 ? "Fill at least one field first" : "Confirm all filled fields before proceeding") : undefined}>
                Next →
              </Button>
            </DialogFooter>
          </>
        )}

        {/* STEP 1: risk flags + assignment + submit */}
        {step === 1 && (
          <>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
              {emptyCount > 0 && (
                <Alert className="mb-3">
                  <AlertDescription className="flex items-center gap-2 text-[13px]">
                    {emptyCount} field{emptyCount > 1 ? "s" : ""} not filled.
                    <button className="underline text-[13px]" onClick={() => setStep(0)}>← Review fields</button>
                  </AlertDescription>
                </Alert>
              )}

              {classification && (
                <Card className="mb-4 p-4">
                  <h4 className="mb-2.5 text-sm font-semibold">Inferred Classification</h4>
                  <div className="mb-2 flex items-center gap-2.5">
                    <TierBadge tier={classification.tier} />
                    <span className="text-[13px] text-muted-foreground">{classification.basis}</span>
                  </div>
                  {inferredFlags.length > 0 && (
                    <ul className="list-inside space-y-1 text-[13px]">
                      {inferredFlags.map(f => (
                        <li key={f.flag}>
                          <code className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[12px]">{f.flag}</code>
                          {" — "}{f.rationale}
                          <span className="text-muted-foreground"> ({Math.round(f.confidence * 100)}% confident)</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}

              <Alert className="mb-4">
                <AlertDescription className="text-[13px]">
                  Review the pre-checked risk flags below. Adjust as needed — the tier is recalculated on save.
                </AlertDescription>
              </Alert>

              <CollapsiblePanel title="Art. 5 — Prohibited Practices">
                <div className="grid grid-cols-2 gap-2">
                  {PROHIBITED_FLAGS.map(([k, label]) => (
                    <CheckItem key={k} id={k} label={label} checked={!!flags[k]}
                      onChange={v => { setFlags(f => ({ ...f, [k]: v })); setFlagsConfirmed(false); }} />
                  ))}
                </div>
              </CollapsiblePanel>

              <CollapsiblePanel title="Annex III — High-Risk Categories">
                <div className="grid grid-cols-2 gap-2">
                  {ANNEX_III_FLAGS.map(([k, label]) => (
                    <CheckItem key={k} id={k} label={label} checked={!!flags[k]}
                      onChange={v => { setFlags(f => ({ ...f, [k]: v })); setFlagsConfirmed(false); }} />
                  ))}
                </div>
              </CollapsiblePanel>

              <CollapsiblePanel title="GPAI — General Purpose AI">
                <div className="grid grid-cols-2 gap-2">
                  {GPAI_FLAGS.map(([k, label]) => (
                    <CheckItem key={k} id={k} label={label} checked={!!flags[k]}
                      onChange={v => { setFlags(f => ({ ...f, [k]: v })); setFlagsConfirmed(false); }} />
                  ))}
                </div>
              </CollapsiblePanel>

              <CollapsiblePanel title="Art. 50 — Limited Risk (Transparency)">
                <div className="grid grid-cols-2 gap-2">
                  {LIMITED_FLAGS.map(([k, label]) => (
                    <CheckItem key={k} id={k} label={label} checked={!!flags[k]}
                      onChange={v => { setFlags(f => ({ ...f, [k]: v })); setFlagsConfirmed(false); }} />
                  ))}
                </div>
              </CollapsiblePanel>

              {/* Flags reviewed confirmation */}
              <div
                className={cn(
                  "flex items-start gap-3 rounded-lg border-2 p-3 mt-4 cursor-pointer",
                  flagsConfirmed ? "border-[var(--success)] bg-[#f0faf4]" : "border-[var(--warning)] bg-[var(--warning-bg)]",
                )}
                onClick={() => setFlagsConfirmed(v => !v)}
              >
                <Checkbox
                  checked={flagsConfirmed}
                  onCheckedChange={(c) => setFlagsConfirmed(c === true)}
                  className="mt-0.5"
                  id="flags_confirmed"
                />
                <div>
                  <Label htmlFor="flags_confirmed" className="cursor-pointer text-[13px] font-semibold">
                    {flagsConfirmed
                      ? <span className="text-[var(--success)]">✓ Risk flags reviewed and confirmed</span>
                      : <span className="text-[var(--warning)]">⚠ Please review and confirm all risk flags</span>}
                  </Label>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    Changing a flag after ticking this will reset the confirmation.
                  </p>
                </div>
              </div>

              <div className="mt-5 border-b border-border pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Assignment
              </div>
              <div className="mt-3 flex flex-col gap-1.5">
                <label htmlFor="eng_co" className="text-sm font-medium">
                  Assign Compliance Officer <span className="text-[var(--danger-fg)]">*</span>
                </label>
                <select id="eng_co" className={selectCls} value={complianceOfficerUsername}
                  onChange={e => setComplianceOfficerUsername(e.target.value)}>
                  <option value="">— select a compliance officer —</option>
                  {complianceOfficers.map(u => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
                </select>
              </div>
            </div>

            <DialogFooter className="shrink-0 px-6 py-4">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="ghost" onClick={() => setStep(0)}>← Back</Button>
              <Button onClick={handleSubmit} disabled={submitting || !complianceOfficerUsername || !flagsConfirmed}>
                {submitting && <Loader2 className="animate-spin" />} Forward to Compliance
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
