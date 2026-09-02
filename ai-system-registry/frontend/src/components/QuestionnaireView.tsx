import { useState, useEffect, useRef } from "react";
import { Bot, Loader2, Paperclip, SendHorizonal, User, UserPlus, X } from "lucide-react";
import { TierBadge } from "./Badges";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import type { AISystem, ChatMessage, ClassificationResult, WorkflowStep, QuestionAssignment } from "../types";
import type { SectionKey } from "../config/questionnaire";
import {
  BUSINESS_QUESTIONS,
  TECHNICAL_QUESTIONS,
  AI_TECHNICAL_QUESTIONS,
  technicalQuestionsForMode,
  getBusinessFieldValues,
  getTechnicalFieldValues,
  getAITechnicalFieldValues,
  activeSubAssignee,
} from "../config/questionnaire";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  system: AISystem;
  section: SectionKey;
  onClose: () => void;
  onSuccess: () => void;
}

function businessGreeting(name: string) {
  return `Hi! I'm here to capture the business context for "${name}". Let's start — in your own words, what is the primary purpose of this AI system?`;
}
function technicalGreeting(name: string) {
  return `Hi! I'll help assess the EU AI Act risk classification for "${name}". I'll ask about its technical characteristics and use cases. Let's start — does this system make decisions without human review (fully automated), or does a human review the outputs?`;
}

// ── Per-question assignment pill ──────────────────────────────────────────────

interface QuestionAssignPillProps {
  assignment: QuestionAssignment;
  isOwner: boolean;
  onUnassign: (questionKey: string) => void;
}

function QuestionAssignPill({ assignment, isOwner, onUnassign }: QuestionAssignPillProps) {
  const answered = !!assignment.answered_at;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
      answered
        ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
        : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    )}>
      {answered
        ? `Answered by ${assignment.assignee_username}`
        : `Awaiting ${assignment.assignee_username}`}
      {isOwner && (
        <button
          type="button"
          onClick={() => onUnassign(assignment.question_key)}
          className="ml-0.5 rounded-full hover:opacity-70"
          title="Remove assignment"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

// ── Assign-question dialog ────────────────────────────────────────────────────

type UserWithRole = { username: string; firstName: string; lastName: string; role: string };

interface AssignQuestionDialogProps {
  questionLabel: string;
  users: UserWithRole[];
  onConfirm: (assignee: string, note: string) => void;
  onCancel: () => void;
  busy: boolean;
}

function AssignQuestionDialog({ questionLabel, users, onConfirm, onCancel, busy }: AssignQuestionDialogProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ username: string } | null>(null);
  const [note, setNote] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const filtered = search.trim()
    ? users.filter((u) => {
        const q = search.toLowerCase();
        return (
          u.username.toLowerCase().includes(q) ||
          u.firstName.toLowerCase().includes(q) ||
          u.lastName.toLowerCase().includes(q)
        );
      }).slice(0, 8)
    : [];

  function selectUser(u: UserWithRole) {
    const display = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username;
    setSelected({ username: u.username });
    setSearch(display);
    setShowDropdown(false);
  }

  function handleSearchChange(val: string) {
    setSearch(val);
    setSelected(null);
    setShowDropdown(val.trim().length > 0);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Assign question to someone</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 py-2 text-sm">
          <p className="text-muted-foreground text-xs">"{questionLabel}"</p>
          <div className="relative flex flex-col gap-1">
            <Label className="text-xs">Assignee</Label>
            <Input
              autoFocus
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              onFocus={() => { if (search.trim() && !selected) setShowDropdown(true); }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="Type a name or username…"
              className="text-sm"
            />
            {showDropdown && filtered.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-background shadow-md">
                {filtered.map((u) => (
                  <button
                    key={u.username}
                    type="button"
                    className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted"
                    onMouseDown={(e) => { e.preventDefault(); selectUser(u); }}
                  >
                    <span className="font-medium">{[u.firstName, u.lastName].filter(Boolean).join(" ") || u.username}</span>
                    <span className="text-xs text-muted-foreground">{u.username} · {u.role.replace(/_/g, " ")}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Note (optional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Context for the assignee…"
              rows={2}
              className="text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            onClick={() => selected && onConfirm(selected.username, note.trim())}
            disabled={busy || !selected}
          >
            {busy && <Loader2 className="animate-spin" />} Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function QuestionnaireView({ open, system, section, onClose, onSuccess }: Props) {
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [assignments, setAssignments] = useState<QuestionAssignment[]>([]);
  const [allUsers, setAllUsers] = useState<UserWithRole[]>([]);
  const [assignDialog, setAssignDialog] = useState<{ questionKey: string; label: string } | null>(null);
  const [assigning, setAssigning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const showToast = useToast();
  const { username } = useModalControls();

  const isAIMode = system.registration_mode === "ai";
  const questions = section === "business" ? BUSINESS_QUESTIONS : technicalQuestionsForMode(system.registration_mode);
  const showChat = isAIMode;

  // Section-level delegation state
  const owner = section === "business" ? system.business_assignee_username : system.technical_assignee_username;
  const sub = activeSubAssignee(steps, section);
  const isDelegate = !!sub && username === sub;
  const isOwner = !!owner && username === owner;
  const lockedForOwner = isOwner && !!sub && !isDelegate;

  // Per-question assignment state (derived from assignments)
  const assignmentFor = (key: string) =>
    assignments.find((a) => a.section === section && a.question_key === key);
  const myQuestionAssignments = assignments.filter(
    (a) => a.section === section && a.assignee_username === username,
  );
  // I'm a question-level assignee when I have assigned questions and I'm not the section owner/delegate.
  const iAmQuestionAssignee = myQuestionAssignments.length > 0 && !isOwner && !isDelegate;

  const editable = isDelegate || (isOwner && !sub) || !owner || iAmQuestionAssignee;

  // Questions visible to me: question assignees only see their own; everyone else sees all.
  const visibleQuestions = iAmQuestionAssignee
    ? questions.filter((q) => assignmentFor(q.key)?.assignee_username === username)
    : questions;

  // Owner: question is locked if assigned to someone else and not yet answered.
  const isQuestionLockedForOwner = (key: string): boolean => {
    if (!isOwner) return false;
    const a = assignmentFor(key);
    return !!a && !a.answered_at;
  };

  // Pending assignments in this section (shown as a warning before section submit).
  const pendingAssignments = assignments.filter((a) => a.section === section && !a.answered_at);

  useEffect(() => {
    if (!open) return;
    const greeting = section === "business" ? businessGreeting(system.name) : technicalGreeting(system.name);
    setTranscript([{ role: "assistant", content: greeting }]);
    setInput("");
    setBusy(false);
    setComplete(false);
    setDegraded(false);
    setClassification(null);
    setFields(section === "business"
      ? getBusinessFieldValues(system) as Record<string, unknown>
      : isAIMode
        ? getAITechnicalFieldValues(system) as Record<string, unknown>
        : getTechnicalFieldValues(system));
    api.getWorkflow(system.id).then(setSteps).catch(() => setSteps([]));
    api.getQuestionAssignments(system.id).then(setAssignments).catch(() => setAssignments([]));
    api.getAllUsers().then(setAllUsers).catch(() => {});
  }, [open, system.id, section]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript]);

  async function sendTurn(userMessage: string) {
    if (!userMessage.trim() || busy) return;
    const newMsg: ChatMessage = { role: "user", content: userMessage };
    const nextTranscript = [...transcript, newMsg];
    setTranscript(nextTranscript);
    setInput("");
    setBusy(true);
    try {
      const resp = await api.questionnaireTurn(system.id, section, nextTranscript, fields);
      const assistantMsg: ChatMessage = { role: "assistant", content: resp.message };
      setTranscript((t) => [...t, assistantMsg]);
      if (resp.extracted_fields && Object.keys(resp.extracted_fields).length > 0) {
        setFields((f) => ({ ...f, ...resp.extracted_fields }));
      }
      if (resp.complete) {
        setComplete(true);
        setDegraded(resp.degraded);
        if (resp.classification) setClassification(resp.classification);
      }
    } catch (e) {
      showToast(`AI assistant error: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setBusy(true);
    try {
      const resp = await api.questionnaireExtract(system.id, section, file);
      if (resp.extracted_fields && Object.keys(resp.extracted_fields).length > 0) {
        setFields((f) => ({ ...f, ...resp.extracted_fields }));
        const note = `I extracted the following from "${file.name}": ${Object.entries(resp.extracted_fields).map(([k, v]) => `${k}: ${v}`).join(", ")}.${resp.notes ? " " + resp.notes : ""}`;
        setTranscript((t) => [...t, { role: "assistant", content: note }]);
      } else {
        showToast("No fields extracted from the document", true);
      }
    } catch (e) {
      showToast(`Extract failed: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (section === "business") {
        // When acting as a question assignee, only save the questions assigned to me.
        const questionsToSave = iAmQuestionAssignee
          ? BUSINESS_QUESTIONS.filter((q) => assignmentFor(q.key)?.assignee_username === username)
          : BUSINESS_QUESTIONS;
        const systemFields: Record<string, unknown> = {};
        const answerFields: Record<string, string> = {};
        for (const q of questionsToSave) {
          const val = fields[q.key];
          if (val == null) continue;
          if (q.storage === "system") systemFields[q.key] = val;
          else answerFields[q.key] = String(val);
        }
        await Promise.all([
          Object.keys(systemFields).length > 0 ? api.updateSystem(system.id, systemFields as never) : null,
          Object.keys(answerFields).length > 0 ? api.patchQuestionnaireAnswers(system.id, answerFields) : null,
        ].filter(Boolean));
      } else if (isAIMode) {
        const questionsToSave = iAmQuestionAssignee
          ? AI_TECHNICAL_QUESTIONS.filter((q) => assignmentFor(q.key)?.assignee_username === username)
          : AI_TECHNICAL_QUESTIONS;
        const answerFields: Record<string, string> = {};
        for (const q of questionsToSave) {
          const val = fields[q.key];
          if (val == null || val === "") continue;
          answerFields[q.key] = String(val);
        }
        if (Object.keys(answerFields).length > 0) {
          await api.patchQuestionnaireAnswers(system.id, answerFields, "technical");
        }
      } else {
        const questionsToSave = iAmQuestionAssignee
          ? TECHNICAL_QUESTIONS.filter((q) => assignmentFor(q.key)?.assignee_username === username)
          : TECHNICAL_QUESTIONS;
        const flagFields: Record<string, unknown> = {};
        for (const q of questionsToSave) {
          const val = fields[q.key];
          if (val == null) continue;
          flagFields[q.key] = q.type === "number" ? Number(val) : Boolean(val);
        }
        if (Object.keys(flagFields).length > 0) await api.updateSystem(system.id, flagFields as never);
      }
      showToast("Progress saved");
    } catch (e) {
      showToast(`Save failed: ${(e as Error).message}`, true);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await handleSave();
      if (section === "business") {
        await api.submitBusinessSection(system.id);
      } else {
        await api.submitTechnicalSection(system.id);
      }
      showToast(section === "business"
        ? "Business section submitted — technical assignee notified"
        : "Technical section submitted — compliance officer notified");
      onSuccess();
    } catch (e) {
      showToast(`Submit failed: ${(e as Error).message}`, true);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMarkComplete() {
    setSubmitting(true);
    try {
      await handleSave();
      await api.subComplete(system.id, section);
      showToast("Section returned to the owner for review");
      onSuccess();
    } catch (e) {
      showToast(`Return failed: ${(e as Error).message}`, true);
    } finally {
      setSubmitting(false);
    }
  }

  // Question assignee submits their answers and marks them as answered.
  async function handleAnswerSubmit() {
    setSubmitting(true);
    try {
      await handleSave();
      for (const a of myQuestionAssignments) {
        await api.questionAnswer(system.id, { section, question_key: a.question_key });
      }
      showToast("Answers submitted — section owner has been notified");
      onSuccess();
    } catch (e) {
      showToast(`Submit failed: ${(e as Error).message}`, true);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssignConfirm(assigneeUsername: string, note: string) {
    if (!assignDialog) return;
    setAssigning(true);
    try {
      const result = await api.questionAssign(system.id, {
        section,
        question_key: assignDialog.questionKey,
        assignee_username: assigneeUsername,
        note: note || undefined,
      });
      setAssignments(result);
      setAssignDialog(null);
      showToast(`Question assigned to ${assigneeUsername}`);
    } catch (e) {
      showToast(`Assign failed: ${(e as Error).message}`, true);
    } finally {
      setAssigning(false);
    }
  }

  async function handleUnassign(questionKey: string) {
    try {
      const result = await api.questionUnassign(system.id, { section, question_key: questionKey });
      setAssignments(result);
      showToast("Assignment removed");
    } catch (e) {
      showToast(`Unassign failed: ${(e as Error).message}`, true);
    }
  }

  const sectionTitle = section === "business" ? "Use Case & Context" : "AI Risk Classification";

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent showCloseButton={false} className="flex max-h-[90vh] max-w-5xl flex-col gap-0 p-0">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
            <DialogTitle className="text-base">
              {sectionTitle} — {system.name}
              {iAmQuestionAssignee && (
                <span className="ml-2 rounded-full bg-[var(--brand)]/10 px-2 py-0.5 text-[11px] font-normal text-[var(--brand)]">
                  Answering {myQuestionAssignments.length} assigned question{myQuestionAssignments.length !== 1 ? "s" : ""}
                </span>
              )}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {showChat
                ? "Chat with the AI assistant or fill the form directly. Save your progress before submitting."
                : "Fill the form below. Save your progress before submitting."}
            </p>
          </DialogHeader>

          <div className="flex min-h-0 flex-1">
            {/* Chat pane */}
            {showChat && (
            <div className="flex w-1/2 flex-col border-r border-border">
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {transcript.map((m, i) => (
                  <div key={i} className={cn("flex gap-2.5", m.role === "user" && "flex-row-reverse")}>
                    <span className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-white text-[10px] font-bold",
                      m.role === "user" ? "bg-[var(--brand)]" : "bg-muted-foreground",
                    )}>
                      {m.role === "user" ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                    </span>
                    <div className={cn(
                      "max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed",
                      m.role === "user"
                        ? "bg-[var(--brand)] text-white"
                        : "bg-muted text-foreground",
                    )}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="flex gap-2.5">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted-foreground text-white text-[10px]">
                      <Bot className="size-3.5" />
                    </span>
                    <div className="rounded-xl bg-muted px-3 py-2 text-[13px]">
                      <Loader2 className="size-3.5 animate-spin" />
                    </div>
                  </div>
                )}
                {degraded && (
                  <Alert variant="warning" className="text-xs">
                    Turn limit reached. Please review the form and submit manually.
                  </Alert>
                )}
                {classification && section === "technical" && (
                  <div className="rounded-xl border border-border bg-accent/40 px-3 py-2.5 text-[13px]">
                    <div className="mb-1 font-semibold">Preliminary classification:</div>
                    <div className="flex items-center gap-2">
                      <TierBadge tier={classification.tier} />
                      <span className="text-muted-foreground">{classification.basis}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t border-border px-4 py-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
                    title="Upload document"
                    disabled={busy}
                  >
                    <Paperclip className="size-4" />
                  </button>
                  <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.docx,.pptx,.png,.jpg,.jpeg" className="hidden" onChange={handleUpload} />
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTurn(input); } }}
                    placeholder={complete ? "Section complete — submit when ready" : "Type a message…"}
                    disabled={busy || complete}
                    className="flex-1 text-sm"
                  />
                  <button
                    onClick={() => sendTurn(input)}
                    disabled={!input.trim() || busy || complete}
                    className="flex size-8 items-center justify-center rounded-md bg-[var(--brand)] text-white disabled:opacity-40"
                  >
                    <SendHorizonal className="size-4" />
                  </button>
                </div>
              </div>
            </div>
            )}

            {/* Form pane */}
            <div className={cn("overflow-y-auto px-5 py-4", showChat ? "w-1/2" : "w-full")}>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Current Values
              </div>
              <div className="flex flex-col gap-3">
                {visibleQuestions.map((q) => {
                  const val = fields[q.key];
                  const assignment = assignmentFor(q.key);
                  const lockedInput = isQuestionLockedForOwner(q.key);

                  // Assign button / pill shown only to the section owner when not section-locked.
                  const assignControl = (isOwner && !lockedForOwner) ? (
                    assignment ? (
                      <QuestionAssignPill
                        assignment={assignment}
                        isOwner={isOwner}
                        onUnassign={handleUnassign}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAssignDialog({ questionKey: q.key, label: q.label })}
                        className="inline-flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground"
                        title="Assign this question to someone"
                      >
                        <UserPlus className="size-3" /> Assign…
                      </button>
                    )
                  ) : null;

                  if (q.type === "boolean") {
                    return (
                      <label key={q.key} className="flex items-start gap-2.5 rounded-md border border-border p-3 text-sm">
                        <Checkbox
                          checked={Boolean(val)}
                          onCheckedChange={(c) => setFields((f) => ({ ...f, [q.key]: c === true }))}
                          className="mt-0.5 shrink-0"
                          disabled={!editable || lockedInput}
                        />
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{q.label}</span>
                            {assignControl}
                          </div>
                          <div className="text-xs text-muted-foreground">{q.hint}</div>
                        </div>
                      </label>
                    );
                  }
                  if (q.type === "number") {
                    return (
                      <div key={q.key} className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Label className="text-xs font-medium">{q.label}</Label>
                          {assignControl}
                        </div>
                        <Input
                          type="number"
                          value={val != null ? String(val) : ""}
                          onChange={(e) => setFields((f) => ({ ...f, [q.key]: parseFloat(e.target.value) || 0 }))}
                          placeholder={q.hint}
                          className="text-sm"
                          disabled={!editable || lockedInput}
                        />
                      </div>
                    );
                  }
                  if (q.type === "textarea") {
                    return (
                      <div key={q.key} className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Label className="text-xs font-medium">{q.label}</Label>
                          {assignControl}
                        </div>
                        <Textarea
                          value={val != null ? String(val) : ""}
                          onChange={(e) => setFields((f) => ({ ...f, [q.key]: e.target.value }))}
                          placeholder={q.hint}
                          rows={2}
                          className="text-sm"
                          disabled={!editable || lockedInput}
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={q.key} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Label className="text-xs font-medium">{q.label}</Label>
                        {assignControl}
                      </div>
                      <Input
                        value={val != null ? String(val) : ""}
                        onChange={(e) => setFields((f) => ({ ...f, [q.key]: e.target.value }))}
                        placeholder={q.hint}
                        className="text-sm"
                        disabled={!editable || lockedInput}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 sm:justify-start">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            {lockedForOwner ? (
              <span className="self-center text-[13px] text-muted-foreground">
                Delegated to <strong className="text-foreground">{sub}</strong> — reclaim from the system detail panel to edit.
              </span>
            ) : (
              <>
                <Button variant="outline" onClick={handleSave} disabled={saving || submitting || !editable}>
                  {saving && <Loader2 className="animate-spin" />} Save Progress
                </Button>
                {iAmQuestionAssignee ? (
                  <Button onClick={handleAnswerSubmit} disabled={saving || submitting}>
                    {submitting && <Loader2 className="animate-spin" />} Submit Answers
                  </Button>
                ) : isDelegate ? (
                  <Button onClick={handleMarkComplete} disabled={saving || submitting}>
                    {submitting && <Loader2 className="animate-spin" />} Mark Complete &amp; Return
                  </Button>
                ) : (
                  <>
                    {pendingAssignments.length > 0 && (
                      <span className="self-center text-[12px] text-yellow-600 dark:text-yellow-400">
                        {pendingAssignments.length} question{pendingAssignments.length !== 1 ? "s" : ""} pending — you may still submit
                      </span>
                    )}
                    <Button onClick={handleSubmit} disabled={saving || submitting || !editable}>
                      {submitting && <Loader2 className="animate-spin" />}
                      Submit {section === "business" ? "Business" : "Technical"} Section
                    </Button>
                  </>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {assignDialog && (
        <AssignQuestionDialog
          questionLabel={assignDialog.label}
          users={allUsers}
          onConfirm={handleAssignConfirm}
          onCancel={() => setAssignDialog(null)}
          busy={assigning}
        />
      )}
    </>
  );
}
