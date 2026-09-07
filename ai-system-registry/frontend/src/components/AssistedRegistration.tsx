import { useState, useEffect, useRef } from "react";
import { Bot, Check, Loader2, Paperclip, SendHorizonal, Sparkles, User } from "lucide-react";
import { TierBadge } from "./Badges";
import { api } from "../api/client";
import { useToast } from "../App";
import type { ChatMessage, RationaleItem, ClassificationResult, UserSummary } from "../types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  system_name:       "System Name",
  purpose:           "Purpose",
  department:        "Department",
  use_case:          "Use Case",
  people_affected:   "People Affected",
  decision_context:  "Decision Context",
  human_involvement: "Human Involvement",
};

const TOTAL_FIELDS = Object.keys(FIELD_LABELS).length;
const REQUIRED_KEYS = ["system_name"];

const GREETING =
  "Hi! I'll help you register your AI system. Just describe what it does in your own words — " +
  "for example \"a tool that screens job applicants\" — and I'll take it from there.";

function displayName(u: UserSummary) {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return full ? `${full} (${u.username})` : u.username;
}

export default function AssistedRegistration({ open, onClose, onSuccess }: Props) {
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [inferredFlags, setInferredFlags] = useState<RationaleItem[]>([]);
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [wizardStep, setWizardStep] = useState<0 | 1>(0);

  const [engineers, setEngineers] = useState<UserSummary[]>([]);
  const [complianceOfficers, setComplianceOfficers] = useState<UserSummary[]>([]);
  const [assigneeUsername, setAssigneeUsername] = useState("");
  const [complianceOfficerUsername, setComplianceOfficerUsername] = useState("");
  const [registering, setRegistering] = useState(false);
  const [doneId, setDoneId] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;
    setTranscript([{ role: "assistant", content: GREETING }]);
    setFields({});
    setConfirmed({});
    setInput("");
    setBusy(false);
    setComplete(false);
    setDegraded(false);
    setInferredFlags([]);
    setClassification(null);
    setWizardStep(0);
    setAssigneeUsername("");
    setComplianceOfficerUsername("");
    setRegistering(false);
    setDoneId(null);
    submitting.current = false;
    Promise.all([
      api.getUsersByRole("ai_engineer"),
      api.getUsersByRole("ai_compliance_officer"),
    ]).then(([eng, co]) => { setEngineers(eng); setComplianceOfficers(co); }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!busy && !complete && !doneId) inputRef.current?.focus();
  }, [busy, complete, doneId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript, busy]);

  const FIELD_KEYS = Object.keys(FIELD_LABELS);
  const confirmedCount = FIELD_KEYS.filter(k => confirmed[k] === true).length;
  const unconfirmedFilledKeys = FIELD_KEYS.filter(k => {
    const v = fields[k];
    return (v !== undefined && v !== null && v !== "") && confirmed[k] !== true;
  });
  const requiredEmptyKeys = REQUIRED_KEYS.filter(k => !fields[k]);
  const canProceed = requiredEmptyKeys.length === 0 && unconfirmedFilledKeys.length === 0;
  const canRegister = !!fields.system_name && !!assigneeUsername && !registering;

  function handleFieldChange(key: string, value: string) {
    setFields(f => ({ ...f, [key]: value }));
    if (confirmed[key]) setConfirmed(c => ({ ...c, [key]: false }));
  }

  function handleConfirm(key: string) {
    setConfirmed(c => ({ ...c, [key]: true }));
  }

  async function runTurn(nextTranscript: ChatMessage[], overrideFields?: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await api.assistTurn(nextTranscript, overrideFields ?? fields);
      setFields(res.extracted_fields || {});
      if (res.message) {
        setTranscript([...nextTranscript, { role: "assistant", content: res.message }]);
      } else {
        setTranscript(nextTranscript);
      }
      if (res.complete) {
        setComplete(true);
        setDegraded(res.degraded);
        setInferredFlags(res.inferred_flags || []);
        setClassification(res.classification);
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
      const res = await api.assistExtract(file);
      const extracted = res.extracted_fields || {};
      const merged = { ...fields, ...extracted };
      setFields(merged);
      const notes = res.notes ? ` — ${res.notes}` : "";
      const summary = Object.keys(extracted).length
        ? `I read ${file.name}${notes}.`
        : `I couldn't pull much from ${file.name}. Could you describe the system instead?`;
      const assistMsg: ChatMessage = { role: "assistant", content: summary };
      const nextTranscript = [...currentTranscript, assistMsg];
      setTranscript(nextTranscript);
      const allFilled = Object.keys(FIELD_LABELS).every(k => {
        const v = merged[k];
        return v !== undefined && v !== null && v !== "";
      });
      if (allFilled) setComplete(true);
      setBusy(false);
      if (Object.keys(extracted).length) {
        await runTurn(nextTranscript, merged);
      }
    } catch (err) {
      showToast(`Document extraction failed: ${(err as Error).message}`, true);
      setTranscript(t => [...t, { role: "assistant", content: `I couldn't process ${file.name}.` }]);
      setBusy(false);
    }
  }

  async function handleRegister() {
    if (!fields.system_name) { showToast("A system name is required", true); return; }
    if (!assigneeUsername) { showToast("Please assign an AI Engineer", true); return; }
    if (submitting.current) return;
    submitting.current = true;
    setRegistering(true);

    const payload: Record<string, unknown> = {
      name: fields.system_name,
      description: (fields.purpose as string) || "",
      intended_purpose: fields.purpose ?? null,
      department: fields.department ?? null,
      use_case: fields.use_case ?? null,
      people_affected: fields.people_affected ?? null,
      decision_context: fields.decision_context ?? null,
      autonomy_level: fields.human_involvement ?? null,
      assignee_username: assigneeUsername,
      compliance_officer_username: complianceOfficerUsername || null,
      field_confirmations: confirmed,
    };
    for (const f of inferredFlags) payload[f.flag] = f.value;
    if (inferredFlags.length) payload.classification_rationale = inferredFlags;

    try {
      const res = await api.intakeAssisted(payload);
      setDoneId(res.system.id);
      showToast("AI system registered and engineer notified");
      onSuccess();
    } catch (e) {
      showToast(`Registration failed: ${(e as Error).message}`, true);
    } finally {
      submitting.current = false;
      setRegistering(false);
    }
  }

  // SELECT_CLASS equivalent for native selects inside this component
  const selectCls = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

  const STEPS = ["Describe your system", "Assign & Register"];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !doneId) onClose(); }}>
      <DialogContent className="sm:max-w-[960px] p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 px-6 pt-5 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-[var(--brand)]" /> AI-Assisted Registration
          </DialogTitle>
        </DialogHeader>

        {/* Step bar */}
        {!doneId && (
          <div className="shrink-0 flex border-b border-border bg-muted/30 px-6">
            {STEPS.map((label, i) => (
              <div key={i} className={cn(
                "flex items-center gap-2 border-b-[3px] py-3 pr-6 text-[13px]",
                i === wizardStep
                  ? "border-primary font-medium text-primary"
                  : i < wizardStep
                    ? "border-transparent text-foreground"
                    : "border-transparent text-muted-foreground",
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

        {/* Progress strip (step 0 only) */}
        {!doneId && wizardStep === 0 && (
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
        )}

        {/* Done state */}
        {doneId ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
            <Alert className="mb-4">
              <AlertDescription>
                AI system registered ({doneId}). The assigned engineer has been notified by email.
              </AlertDescription>
            </Alert>
            {classification && (
              <Card className="p-4">
                <h4 className="mb-2.5 text-sm font-semibold">Classification</h4>
                <div className="flex items-center gap-2.5">
                  <TierBadge tier={classification.tier} />
                  <span className="text-[13px] text-muted-foreground">{classification.basis}</span>
                </div>
              </Card>
            )}
          </div>

        /* Step 0: split pane */
        ) : wizardStep === 0 ? (
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
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".txt,.md,.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                  onChange={handleUpload}
                />
                <Button variant="ghost" size="icon" className="size-9 shrink-0" title="Upload a document"
                  disabled={busy} onClick={() => fileRef.current?.click()}>
                  <Paperclip className="size-4" />
                </Button>
                <Input
                  ref={inputRef}
                  className="flex-1"
                  placeholder={busy ? "Thinking…" : "Describe your AI system…"}
                  value={input}
                  disabled={busy}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                />
                <Button variant="ghost" size="icon" className="size-9 shrink-0" disabled={busy || !input.trim()} onClick={handleSend}>
                  <SendHorizonal className="size-4" />
                </Button>
              </div>

              {degraded && (
                <Alert>
                  <AlertDescription className="text-[13px]">
                    We reached the question limit. You can register with what we have, or the
                    assigned engineer can refine the details later.
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
                  const isRequired = REQUIRED_KEYS.includes(key);
                  const isConfirmed = confirmed[key] === true;
                  const isWide = key === "purpose" || key === "decision_context";

                  const borderCls = isConfirmed
                    ? "border-[var(--success)] bg-[#f0faf4]"
                    : isEmpty
                      ? isRequired ? "border-[var(--danger-fg)] bg-[#fff8f8]" : "border-border"
                      : "border-[var(--warning)]";

                  return (
                    <div key={key} className={cn(
                      "flex flex-col gap-1 rounded-md border p-2.5",
                      isWide && "col-span-2",
                      borderCls,
                    )}>
                      <div className="flex items-center justify-between">
                        <label htmlFor={`assist_field_${key}`} className="text-[11px] font-semibold text-muted-foreground">
                          {label}{isRequired && <span className="ml-0.5 text-[var(--danger-fg)]">*</span>}
                        </label>
                        {!isEmpty && (
                          isConfirmed ? (
                            <Badge className="h-5 gap-1 rounded-full bg-[var(--success)] text-white hover:bg-[var(--success-fg)]">
                              <Check className="size-3" /> Confirmed
                            </Badge>
                          ) : (
                            <Button size="sm" className="h-6 gap-1 px-2 text-[11px] bg-[var(--success)] hover:bg-[var(--success-fg)] text-white"
                              onClick={() => handleConfirm(key)}>
                              <Check className="size-3" /> Confirm
                            </Button>
                          )
                        )}
                      </div>
                      {isWide ? (
                        <Textarea id={`assist_field_${key}`} value={strVal} rows={2}
                          className="text-[13px]"
                          onChange={e => handleFieldChange(key, e.target.value)}
                          placeholder={`Enter ${label.toLowerCase()}…`}
                        />
                      ) : (
                        <Input id={`assist_field_${key}`} value={strVal}
                          className="text-[13px]"
                          onChange={e => handleFieldChange(key, e.target.value)}
                          placeholder={`Enter ${label.toLowerCase()}…`}
                        />
                      )}
                      {isEmpty && isRequired && (
                        <div className="text-[11px] text-[var(--danger-fg)]">Required — please fill in</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        /* Step 1: classification + assignment */
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
            {classification && (
              <Card className="mb-4 p-4">
                <h4 className="mb-2.5 text-sm font-semibold">Preliminary Classification</h4>
                <div className="mb-2.5 flex items-center gap-2.5">
                  <TierBadge tier={classification.tier} />
                  <span className="text-[13px] text-muted-foreground">{classification.basis}</span>
                </div>
                {classification.obligations.length > 0 ? (
                  <>
                    <div className="mb-1 text-[13px] font-medium">Obligations:</div>
                    <ul className="list-inside list-disc text-[13px] text-muted-foreground">
                      {classification.obligations.map((o) => <li key={o}>{o}</li>)}
                    </ul>
                  </>
                ) : (
                  <span className="text-[13px] text-muted-foreground">No mandatory obligations.</span>
                )}
              </Card>
            )}

            {inferredFlags.length > 0 && (
              <Card className="mb-4 p-4">
                <h4 className="mb-2 text-sm font-semibold">Why this classification</h4>
                <ul className="list-inside space-y-1 text-[13px]">
                  {inferredFlags.map((f) => (
                    <li key={f.flag}>
                      <code className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[12px]">{f.flag}</code>
                      {" — "}{f.rationale}
                      <span className="text-muted-foreground"> ({Math.round(f.confidence * 100)}% confident)</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <div className="mb-2 border-b border-border pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Assignment
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="assist_engineer" className="text-sm font-medium">
                  Assign to AI Engineer <span className="text-[var(--danger-fg)]">*</span>
                </label>
                <select id="assist_engineer" className={selectCls} value={assigneeUsername} onChange={(e) => setAssigneeUsername(e.target.value)}>
                  <option value="">— select an engineer —</option>
                  {engineers.map((u) => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="assist_co" className="text-sm font-medium">
                  Pre-assign Compliance Officer (optional)
                </label>
                <select id="assist_co" className={selectCls} value={complianceOfficerUsername} onChange={(e) => setComplianceOfficerUsername(e.target.value)}>
                  <option value="">— Let the AI Engineer choose —</option>
                  {complianceOfficers.map((u) => <option key={u.username} value={u.username}>{displayName(u)}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Validation strip (step 0) */}
        {!doneId && wizardStep === 0 && !canProceed && (requiredEmptyKeys.length > 0 || unconfirmedFilledKeys.length > 0) && (
          <div className="shrink-0 mx-6 mb-2">
            <Alert>
              <AlertDescription className="text-[13px]">
                {requiredEmptyKeys.length > 0 && <span>{requiredEmptyKeys.length} required field{requiredEmptyKeys.length > 1 ? "s" : ""} not filled. </span>}
                {unconfirmedFilledKeys.length > 0 && <span>{unconfirmedFilledKeys.length} field{unconfirmedFilledKeys.length > 1 ? "s" : ""} filled but not confirmed. </span>}
                Confirm all filled fields to proceed.
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter className="shrink-0 px-6 py-4">
          {doneId ? (
            <Button onClick={onClose}>Done</Button>
          ) : wizardStep === 0 ? (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={() => setWizardStep(1)} disabled={!canProceed}
                title={!canProceed ? (requiredEmptyKeys.length > 0 ? "Fill required fields first" : "Confirm all filled fields before proceeding") : undefined}>
                Next →
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="ghost" onClick={() => setWizardStep(0)}>← Back</Button>
              <Button onClick={handleRegister} disabled={!canRegister}
                title={!fields.system_name ? "Enter a system name" : !assigneeUsername ? "Assign an AI Engineer first" : undefined}>
                {registering && <Loader2 className="animate-spin" />} Register System
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
