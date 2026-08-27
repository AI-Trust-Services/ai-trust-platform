import { useState, useEffect, useRef } from "react";
import { Bot, Check, ChevronDown, ChevronRight, Loader2, Paperclip, SendHorizonal, Sparkles, User } from "lucide-react";
import { TierBadge } from "./Badges";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import type { ChatMessage, RationaleItem, ClassificationResult, UserSummary } from "../types";
import { BUSINESS_QUESTIONS, TECHNICAL_QUESTIONS } from "../config/questionnaire";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const GREETING =
  "Hi! I'll help you register your AI system. Upload a document (model card, spec, or brief) and I'll pre-fill the questionnaire — then we'll go through any remaining questions together.";

// Maps backend field names → our questionnaire keys (used when receiving from backend).
// Backend TARGET_FIELDS now use the same keys as questionnaire.ts, so no remapping needed.
const ASSIST_MAP: Record<string, string> = {};

// Reverse: our questionnaire keys → backend field names (used when sending to backend)
const ASSIST_MAP_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(ASSIST_MAP).map(([k, v]) => [v, k])
);

function mapAssistFields(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    result[ASSIST_MAP[k] ?? k] = v;
  }
  return result;
}

function toBackendFields(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    result[ASSIST_MAP_REVERSE[k] ?? k] = v;
  }
  return result;
}

function displayName(u: UserSummary) {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return full ? `${full} (${u.username})` : u.username;
}

function isAnswered(q: { key: string; type: string }, fields: Record<string, unknown>): boolean {
  const v = fields[q.key];
  if (q.type === "boolean") return v === true;
  if (q.type === "number") return typeof v === "number" && v > 0;
  return v != null && v !== "";
}

export default function AssistedRegistration({ open, onClose, onSuccess }: Props) {
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [fields, setFields] = useState<Record<string, unknown>>({ name: "" });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [inferredFlags, setInferredFlags] = useState<RationaleItem[]>([]);
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [wizardStep, setWizardStep] = useState<0 | 1>(0);
  const [flagsOpen, setFlagsOpen] = useState(false);

  const [businessOwners, setBusinessOwners] = useState<UserSummary[]>([]);
  const [engineers, setEngineers] = useState<UserSummary[]>([]);
  const [complianceOfficers, setComplianceOfficers] = useState<UserSummary[]>([]);
  const [businessAssigneeUsername, setBusinessAssigneeUsername] = useState("");
  const [technicalAssigneeUsername, setTechnicalAssigneeUsername] = useState("");
  const [complianceOfficerUsername, setComplianceOfficerUsername] = useState("");
  const [registering, setRegistering] = useState(false);
  const [doneId, setDoneId] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const showToast = useToast();
  const { username } = useModalControls();

  useEffect(() => {
    if (!open) return;
    setTranscript([{ role: "assistant", content: GREETING }]);
    setFields({ name: "" });
    setInput("");
    setBusy(false);
    setInferredFlags([]);
    setClassification(null);
    setWizardStep(0);
    setFlagsOpen(false);
    setBusinessAssigneeUsername("");
    setTechnicalAssigneeUsername("");
    setComplianceOfficerUsername("");
    setRegistering(false);
    setDoneId(null);
    submitting.current = false;
    Promise.all([
      api.getUsersByRole("business_owner"),
      api.getUsersByRole("ai_engineer"),
      api.getUsersByRole("ai_compliance_officer"),
    ]).then(([biz, eng, co]) => {
      setBusinessOwners(biz);
      setEngineers(eng);
      setComplianceOfficers(co);
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!busy && wizardStep === 0 && !doneId) inputRef.current?.focus();
  }, [busy, wizardStep, doneId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript, busy]);

  async function runTurn(nextTranscript: ChatMessage[], overrideFields?: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await api.assistTurn(nextTranscript, toBackendFields(overrideFields ?? fields));
      if (res.extracted_fields && Object.keys(res.extracted_fields).length > 0) {
        setFields(f => ({ ...f, ...mapAssistFields(res.extracted_fields!) }));
      }
      if (res.message) {
        setTranscript([...nextTranscript, { role: "assistant", content: res.message }]);
      } else {
        setTranscript(nextTranscript);
      }
      if (res.inferred_flags?.length) setInferredFlags(res.inferred_flags);
      if (res.classification) setClassification(res.classification);
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
    const currentTranscript = [...transcript, uploadMsg];
    setTranscript(currentTranscript);
    try {
      const res = await api.assistExtract(file);
      const extracted = mapAssistFields(res.extracted_fields || {});
      const merged = { ...fields, ...extracted };
      setFields(merged);
      const notes = res.notes ? ` — ${res.notes}` : "";
      const filled = Object.keys(extracted).length;
      const summary = filled
        ? `I extracted ${filled} field${filled > 1 ? "s" : ""} from "${file.name}"${notes}. I've pre-filled the form — let me know if anything looks wrong.`
        : `I couldn't pull much from "${file.name}". Could you describe the system instead?`;
      const assistMsg: ChatMessage = { role: "assistant", content: summary };
      const nextTranscript = [...currentTranscript, assistMsg];
      setTranscript(nextTranscript);
      setBusy(false);
      if (filled) await runTurn(nextTranscript, merged);
    } catch (err) {
      showToast(`Document extraction failed: ${(err as Error).message}`, true);
      setTranscript(t => [...t, { role: "assistant", content: `I couldn't process "${file.name}".` }]);
      setBusy(false);
    }
  }

  async function handleRegister() {
    if (!fields.name) { showToast("A system name is required", true); return; }
    if (!businessAssigneeUsername) { showToast("Please assign a Business Assignee", true); return; }
    if (!technicalAssigneeUsername) { showToast("Please assign a Technical Assignee", true); return; }
    if (!complianceOfficerUsername) { showToast("Please assign a Compliance Officer", true); return; }
    if (submitting.current) return;
    submitting.current = true;
    setRegistering(true);

    // Split business fields into system-column vs questionnaire_answers storage.
    const systemFields: Record<string, unknown> = { name: fields.name };
    const answerFields: Record<string, string> = {};
    for (const q of BUSINESS_QUESTIONS) {
      const val = fields[q.key];
      if (val == null || val === "") continue;
      if (q.storage === "system") systemFields[q.key] = val;
      else answerFields[q.key] = String(val);
    }
    for (const q of TECHNICAL_QUESTIONS) {
      const val = fields[q.key];
      if (val == null) continue;
      systemFields[q.key] = q.type === "number" ? Number(val) : Boolean(val);
    }
    for (const f of inferredFlags) systemFields[f.flag] = f.value;
    if (inferredFlags.length) systemFields.classification_rationale = inferredFlags;

    try {
      const res = await api.intakeAssisted({ description: "", ...systemFields });
      if (Object.keys(answerFields).length > 0) {
        await api.patchQuestionnaireAnswers(res.system.id, answerFields);
      }
      await api.assignWorkflow(res.system.id, {
        business_assignee_username: businessAssigneeUsername,
        technical_assignee_username: technicalAssigneeUsername,
        compliance_officer_username: complianceOfficerUsername,
      });
      // If creator is also the business assignee, auto-submit business section.
      if (businessAssigneeUsername === username) {
        await api.submitBusinessSection(res.system.id);
      }
      setDoneId(res.system.id);
      showToast(businessAssigneeUsername === username
        ? "System registered — technical assignee notified"
        : "System registered — business assignee notified");
      onSuccess();
    } catch (e) {
      showToast(`Registration failed: ${(e as Error).message}`, true);
    } finally {
      submitting.current = false;
      setRegistering(false);
    }
  }

  const selectCls = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

  const businessAnswered = BUSINESS_QUESTIONS.filter(q => isAnswered(q, fields)).length;
  const technicalAnswered = TECHNICAL_QUESTIONS.filter(q => isAnswered(q, fields)).length;
  const totalAnswered = businessAnswered + technicalAnswered + (fields.name ? 1 : 0);
  const totalQuestions = BUSINESS_QUESTIONS.length + TECHNICAL_QUESTIONS.length + 1;

  const STEPS = ["Fill Questionnaire", "Assign & Register"];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !doneId) onClose(); }}>
      <DialogContent className="sm:max-w-[1100px] p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 px-6 pt-5 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-[var(--brand)]" /> AI-Assisted Registration
          </DialogTitle>
        </DialogHeader>

        {!doneId && (
          <div className="shrink-0 flex border-b border-border bg-muted/30 px-6">
            {STEPS.map((label, i) => (
              <div key={i} className={cn(
                "flex items-center gap-2 border-b-[3px] py-3 pr-6 text-[13px]",
                i === wizardStep ? "border-primary font-medium text-primary" : i < wizardStep ? "border-transparent text-foreground" : "border-transparent text-muted-foreground",
              )}>
                <span className={cn(
                  "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                  i === wizardStep ? "bg-primary text-primary-foreground" : i < wizardStep ? "bg-[var(--success)] text-white" : "bg-muted text-muted-foreground",
                )}>{i + 1}</span>
                {label}
              </div>
            ))}
          </div>
        )}

        {/* Progress strip (step 0) */}
        {!doneId && wizardStep === 0 && (
          <div className="shrink-0 flex items-center gap-3 border-b border-border bg-muted/20 px-6 py-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full transition-[width]" style={{
                width: `${(totalAnswered / totalQuestions) * 100}%`,
                background: "var(--brand)",
              }} />
            </div>
            <span className="min-w-[110px] text-right text-xs text-muted-foreground">
              {totalAnswered} / {totalQuestions} answered
            </span>
          </div>
        )}

        {/* Done state */}
        {doneId ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
            <Alert className="mb-4">
              <AlertDescription>
                System registered ({doneId}).{" "}
                {businessAssigneeUsername === username
                  ? "Technical assignee has been notified."
                  : "Business assignee has been notified."}
              </AlertDescription>
            </Alert>
            {classification && (
              <div className="rounded-md border border-border p-4">
                <div className="mb-2 text-sm font-semibold">Preliminary Classification</div>
                <div className="flex items-center gap-2.5">
                  <TierBadge tier={classification.tier} />
                  <span className="text-[13px] text-muted-foreground">{classification.basis}</span>
                </div>
              </div>
            )}
          </div>

        /* Step 0: split pane */
        ) : wizardStep === 0 ? (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* LEFT: chat */}
            <div className="flex w-[38%] shrink-0 flex-col gap-2.5 overflow-hidden border-r border-border p-4">
              <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
                {transcript.map((m, i) => (
                  <div key={i} className={cn("flex items-end gap-2", m.role === "user" ? "flex-row-reverse" : "flex-row")}>
                    <div className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full",
                      m.role === "user" ? "bg-primary/15 text-primary" : "bg-[var(--brand)] text-white",
                    )}>
                      {m.role === "user" ? <User className="size-3" /> : <Bot className="size-3" />}
                    </div>
                    <div className={cn(
                      "max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
                      m.role === "user" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border border-border bg-muted text-foreground",
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
                          <span key={delay} className="size-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${delay}ms` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <input ref={fileRef} type="file" className="hidden"
                  accept=".txt,.md,.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                  onChange={handleUpload} />
                <Button variant="ghost" size="icon" className="size-9 shrink-0" title="Upload a document"
                  disabled={busy} onClick={() => fileRef.current?.click()}>
                  <Paperclip className="size-4" />
                </Button>
                <Input
                  ref={inputRef}
                  className="flex-1"
                  placeholder={busy ? "Thinking…" : "Describe your system or ask a question…"}
                  value={input}
                  disabled={busy}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                />
                <Button variant="ghost" size="icon" className="size-9 shrink-0" disabled={busy || !input.trim()} onClick={handleSend}>
                  <SendHorizonal className="size-4" />
                </Button>
              </div>
            </div>

            {/* RIGHT: questionnaire form */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* System name */}
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">System</div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs font-medium">System Name <span className="text-[var(--danger-fg)]">*</span></Label>
                  <Input
                    value={fields.name != null ? String(fields.name) : ""}
                    onChange={(e) => setFields(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Fraud Detection Model"
                    className="text-sm"
                  />
                </div>
              </div>

              {/* Business questions */}
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  General Information — {businessAnswered}/{BUSINESS_QUESTIONS.length} answered
                </div>
                <div className="flex flex-col gap-2">
                  {BUSINESS_QUESTIONS.map((q) => {
                    const val = fields[q.key];
                    if (q.type === "boolean") {
                      return (
                        <label key={q.key} className="flex items-start gap-2.5 rounded-md border border-border p-2.5 text-sm">
                          <Checkbox checked={Boolean(val)} onCheckedChange={(c: boolean | "indeterminate") => setFields(f => ({ ...f, [q.key]: c === true }))} className="mt-0.5 shrink-0" />
                          <div>
                            <div className="font-medium text-[13px]">{q.label}</div>
                            <div className="text-xs text-muted-foreground">{q.hint}</div>
                          </div>
                        </label>
                      );
                    }
                    if (q.type === "select") {
                      return (
                        <div key={q.key} className="flex flex-col gap-1">
                          <Label className="text-xs font-medium">{q.label}</Label>
                          <select className={selectCls} value={val != null ? String(val) : ""} onChange={(e) => setFields(f => ({ ...f, [q.key]: e.target.value }))}>
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
                          <Textarea value={val != null ? String(val) : ""} onChange={(e) => setFields(f => ({ ...f, [q.key]: e.target.value }))} placeholder={q.hint} rows={2} className="text-sm" />
                        </div>
                      );
                    }
                    return (
                      <div key={q.key} className="flex flex-col gap-1">
                        <Label className="text-xs font-medium">{q.label}</Label>
                        <Input value={val != null ? String(val) : ""} onChange={(e) => setFields(f => ({ ...f, [q.key]: e.target.value }))} placeholder={q.hint} className="text-sm" />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Technical questions */}
              <Collapsible open={flagsOpen} onOpenChange={setFlagsOpen}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>AI Risk Classification — {technicalAnswered}/{TECHNICAL_QUESTIONS.length} flagged</span>
                  {flagsOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 flex flex-col gap-2">
                  {TECHNICAL_QUESTIONS.map((q) => {
                    const val = fields[q.key];
                    if (q.type === "number") {
                      return (
                        <div key={q.key} className="flex flex-col gap-1">
                          <Label className="text-xs font-medium">{q.label}</Label>
                          <Input
                            type="number"
                            value={val != null ? String(val) : ""}
                            onChange={(e) => setFields(f => ({ ...f, [q.key]: parseFloat(e.target.value) || 0 }))}
                            placeholder={q.hint}
                            className="text-sm"
                          />
                        </div>
                      );
                    }
                    return (
                      <label key={q.key} className="flex items-start gap-2.5 rounded-md border border-border p-2.5 text-sm">
                        <Checkbox
                          checked={Boolean(val)}
                          onCheckedChange={(c: boolean | "indeterminate") => setFields(f => ({ ...f, [q.key]: c === true }))}
                          className="mt-0.5 shrink-0"
                        />
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
          </div>

        /* Step 1: assign */
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">
            {/* Business section summary */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">General Information</div>
                <Badge variant="outline" className="text-xs">{businessAnswered}/{BUSINESS_QUESTIONS.length} answered</Badge>
              </div>
              <div className="mb-3 rounded-md border border-border divide-y divide-border">
                {BUSINESS_QUESTIONS.map((q) => {
                  const answered = isAnswered(q, fields);
                  return (
                    <div key={q.key} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                      {answered
                        ? <Check className="size-3.5 shrink-0 text-[var(--success)]" />
                        : <span className="size-3.5 shrink-0 rounded-full border border-muted-foreground inline-block" />}
                      <span className={answered ? "text-muted-foreground" : ""}>{q.label}</span>
                      {answered && fields[q.key] != null && (
                        <span className="ml-auto max-w-[200px] truncate text-xs text-muted-foreground">{String(fields[q.key])}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="biz_assign" className="text-sm font-medium">
                  Business Assignee <span className="text-[var(--danger-fg)]">*</span>
                  <span className="ml-1 text-xs font-normal text-muted-foreground">— will complete unanswered questions</span>
                </label>
                <select id="biz_assign" className={selectCls} value={businessAssigneeUsername} onChange={(e) => setBusinessAssigneeUsername(e.target.value)}>
                  <option value="">— select business assignee —</option>
                  {businessOwners.map((u) => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
                </select>
              </div>
            </div>

            {/* Technical section summary */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">AI Risk Classification</div>
                <Badge variant="outline" className="text-xs">{technicalAnswered}/{TECHNICAL_QUESTIONS.length} flagged</Badge>
              </div>
              <Collapsible>
                <CollapsibleTrigger className="mb-3 flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                  <ChevronRight className="size-3" /> Show all flags
                </CollapsibleTrigger>
                <CollapsibleContent className="mb-3 rounded-md border border-border divide-y divide-border">
                  {TECHNICAL_QUESTIONS.map((q) => {
                    const answered = isAnswered(q, fields);
                    return (
                      <div key={q.key} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                        {answered
                          ? <Check className="size-3.5 shrink-0 text-[var(--success)]" />
                          : <span className="size-3.5 shrink-0 rounded-full border border-muted-foreground inline-block" />}
                        <span className={answered ? "" : "text-muted-foreground"}>{q.label}</span>
                      </div>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tech_assign" className="text-sm font-medium">
                  Technical Assignee <span className="text-[var(--danger-fg)]">*</span>
                  <span className="ml-1 text-xs font-normal text-muted-foreground">— will complete risk classification</span>
                </label>
                <select id="tech_assign" className={selectCls} value={technicalAssigneeUsername} onChange={(e) => setTechnicalAssigneeUsername(e.target.value)}>
                  <option value="">— select technical assignee —</option>
                  {engineers.map((u) => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
                </select>
              </div>
            </div>

            {/* CO */}
            <div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="co_assign" className="text-sm font-medium">
                  Compliance Officer <span className="text-[var(--danger-fg)]">*</span>
                </label>
                <select id="co_assign" className={selectCls} value={complianceOfficerUsername} onChange={(e) => setComplianceOfficerUsername(e.target.value)}>
                  <option value="">— select compliance officer —</option>
                  {complianceOfficers.map((u) => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
                </select>
              </div>
            </div>

            {classification && (
              <div className="rounded-md border border-border p-4">
                <div className="mb-2 text-sm font-semibold">Preliminary Classification</div>
                <div className="flex items-center gap-2.5">
                  <TierBadge tier={classification.tier} />
                  <span className="text-[13px] text-muted-foreground">{classification.basis}</span>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="shrink-0 px-6 py-4">
          {doneId ? (
            <Button onClick={onClose}>Done</Button>
          ) : wizardStep === 0 ? (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button
                onClick={() => setWizardStep(1)}
                disabled={!fields.name}
                title={!fields.name ? "Enter a system name to continue" : undefined}
              >
                Next →
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="ghost" onClick={() => setWizardStep(0)}>← Back</Button>
              <Button
                onClick={handleRegister}
                disabled={!fields.name || !businessAssigneeUsername || !technicalAssigneeUsername || !complianceOfficerUsername || registering}
              >
                {registering && <Loader2 className="animate-spin" />} Register System
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
