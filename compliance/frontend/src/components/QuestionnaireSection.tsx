import { useState, useEffect, useRef } from "react";
import { Loader2, Paperclip, UserPlus, X } from "lucide-react";
import { registryClient } from "../api/registryClient";
import type { AISystem, WorkflowStep, QuestionAssignment } from "../types";
import type { SectionKey } from "../config/questionnaire";
import {
  BUSINESS_QUESTIONS,
  AI_TECHNICAL_QUESTIONS,
  getBusinessFieldValues,
  getAITechnicalFieldValues,
  activeSubAssignee,
} from "../config/questionnaire";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  system: AISystem;
  section: SectionKey;
  username: string;
  /** When true, renders inline without a Dialog wrapper (for use inside a Sheet panel). */
  noDialog?: boolean;
  /** Optional extra content rendered below the dialog title (e.g. progress steps). */
  headerExtra?: React.ReactNode;
  onClose: () => void;
  onSuccess: () => void;
  showToast: (msg: string, err?: boolean) => void;
}

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
      {answered ? `Answered by ${assignment.assignee_username}` : `Awaiting ${assignment.assignee_username}`}
      {isOwner && (
        <button type="button" onClick={() => onUnassign(assignment.question_key)} className="ml-0.5 rounded-full hover:opacity-70" title="Remove assignment">
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

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
        return u.username.toLowerCase().includes(q) || u.firstName.toLowerCase().includes(q) || u.lastName.toLowerCase().includes(q);
      }).slice(0, 8)
    : [];

  function selectUser(u: UserWithRole) {
    setSelected({ username: u.username });
    setSearch([u.firstName, u.lastName].filter(Boolean).join(" ") || u.username);
    setShowDropdown(false);
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
              onChange={(e) => { setSearch(e.target.value); setSelected(null); setShowDropdown(e.target.value.trim().length > 0); }}
              onFocus={() => { if (search.trim() && !selected) setShowDropdown(true); }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="Type a name or username…"
              className="text-sm"
            />
            {showDropdown && filtered.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-background shadow-md">
                {filtered.map((u) => (
                  <button key={u.username} type="button" className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted" onMouseDown={(e) => { e.preventDefault(); selectUser(u); }}>
                    <span className="font-medium">{[u.firstName, u.lastName].filter(Boolean).join(" ") || u.username}</span>
                    <span className="text-xs text-muted-foreground">{u.username} · {u.role.replace(/_/g, " ")}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Context for the assignee…" rows={2} className="text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={() => selected && onConfirm(selected.username, note.trim())} disabled={busy || !selected}>
            {busy && <Loader2 className="animate-spin" />} Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function QuestionnaireSection({ open, system, section, username, noDialog, headerExtra, onClose, onSuccess, showToast }: Props) {
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [assignments, setAssignments] = useState<QuestionAssignment[]>([]);
  const [allUsers, setAllUsers] = useState<UserWithRole[]>([]);
  const [assignDialog, setAssignDialog] = useState<{ questionKey: string; label: string } | null>(null);
  const [assigning, setAssigning] = useState(false);
  // Delegate (sub-assign) state
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [delegateSearch, setDelegateSearch] = useState("");
  const [delegateSelected, setDelegateSelected] = useState("");
  const [delegateDropdown, setDelegateDropdown] = useState(false);
  const [delegateNote, setDelegateNote] = useState("");
  const [delegatePool, setDelegatePool] = useState<UserWithRole[]>([]);
  const [delegating, setDelegating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const questions = section === "business" ? BUSINESS_QUESTIONS : AI_TECHNICAL_QUESTIONS;

  const owner = section === "business" ? system.business_assignee_username : system.technical_assignee_username;
  const sub = activeSubAssignee(steps, section);
  const isDelegate = !!sub && username === sub;
  const isOwner = !owner || username === owner;
  const lockedForOwner = isOwner && !!sub && !isDelegate;

  const assignmentFor = (key: string) => assignments.find((a) => a.section === section && a.question_key === key);
  const myQuestionAssignments = assignments.filter((a) => a.section === section && a.assignee_username === username);
  const iAmQuestionAssignee = myQuestionAssignments.length > 0 && !isOwner && !isDelegate;
  const editable = isDelegate || (isOwner && !sub) || !owner || iAmQuestionAssignee;
  const visibleQuestions = iAmQuestionAssignee ? questions.filter((q) => assignmentFor(q.key)?.assignee_username === username) : questions;
  const isQuestionLockedForOwner = (key: string): boolean => { if (!isOwner) return false; const a = assignmentFor(key); return !!a && !a.answered_at; };
  const pendingAssignments = assignments.filter((a) => a.section === section && !a.answered_at);

  const delegateFiltered = delegateSearch.trim()
    ? delegatePool.filter((u) => {
        const q = delegateSearch.toLowerCase();
        return u.username.toLowerCase().includes(q) || u.firstName.toLowerCase().includes(q) || u.lastName.toLowerCase().includes(q);
      }).filter((u) => u.username !== username).slice(0, 8)
    : delegatePool.filter((u) => u.username !== username).slice(0, 8);

  useEffect(() => {
    if (!open && !noDialog) return;
    setBusy(false);
    setDelegateOpen(false);
    setDelegateSearch("");
    setDelegateSelected("");
    setFields(section === "business"
      ? getBusinessFieldValues(system) as Record<string, unknown>
      : getAITechnicalFieldValues(system) as Record<string, unknown>);
    registryClient.getWorkflow(system.id).then(setSteps).catch(() => setSteps([]));
    registryClient.getQuestionAssignments(system.id).then(setAssignments).catch(() => setAssignments([]));
    registryClient.getAllUsers().then(setAllUsers).catch(() => {});
  }, [open, noDialog, system.id, section]);

  // Load delegate pool when the delegate panel opens
  useEffect(() => {
    if (!delegateOpen) return;
    const role = section === "business" ? "business_owner" : "ai_engineer";
    registryClient.getUsersByRole(role).then((users) => setDelegatePool(users.map((u) => ({ ...u, role })))).catch(() => {});
  }, [delegateOpen, section]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setBusy(true);
    try {
      const resp = await registryClient.questionnaireExtract(system.id, section, file);
      if (resp.extracted_fields && Object.keys(resp.extracted_fields).length > 0) {
        setFields((f) => ({ ...f, ...resp.extracted_fields }));
        showToast(`Pre-filled from "${file.name}"${resp.notes ? " — " + resp.notes : ""}`);
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
        const questionsToSave = iAmQuestionAssignee ? BUSINESS_QUESTIONS.filter((q) => assignmentFor(q.key)?.assignee_username === username) : BUSINESS_QUESTIONS;
        const systemFields: Record<string, unknown> = {};
        const answerFields: Record<string, string> = {};
        for (const q of questionsToSave) {
          const val = fields[q.key];
          if (val == null) continue;
          if (q.storage === "system") systemFields[q.key] = val;
          else answerFields[q.key] = String(val);
        }
        await Promise.all([
          Object.keys(systemFields).length > 0 ? registryClient.updateSystem(system.id, systemFields) : null,
          Object.keys(answerFields).length > 0 ? registryClient.patchQuestionnaireAnswers(system.id, answerFields) : null,
        ].filter(Boolean));
      } else {
        const questionsToSave = iAmQuestionAssignee ? AI_TECHNICAL_QUESTIONS.filter((q) => assignmentFor(q.key)?.assignee_username === username) : AI_TECHNICAL_QUESTIONS;
        const answerFields: Record<string, string> = {};
        for (const q of questionsToSave) {
          const val = fields[q.key];
          if (val == null || val === "") continue;
          answerFields[q.key] = String(val);
        }
        if (Object.keys(answerFields).length > 0) {
          await registryClient.patchQuestionnaireAnswers(system.id, answerFields, "technical");
        }
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
        await registryClient.submitBusinessSection(system.id);
        showToast("Business section submitted — technical assignee notified");
      } else {
        showToast("Technical answers saved — proceed to risk classification");
      }
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
      await registryClient.subComplete(system.id, section);
      showToast("Section returned to the owner for review");
      onSuccess();
    } catch (e) {
      showToast(`Return failed: ${(e as Error).message}`, true);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAnswerSubmit() {
    setSubmitting(true);
    try {
      await handleSave();
      for (const a of myQuestionAssignments) {
        await registryClient.questionAnswer(system.id, { section, question_key: a.question_key });
      }
      showToast("Answers submitted — section owner notified");
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
      const result = await registryClient.questionAssign(system.id, { section, question_key: assignDialog.questionKey, assignee_username: assigneeUsername, note: note || undefined });
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
      const result = await registryClient.questionUnassign(system.id, { section, question_key: questionKey });
      setAssignments(result);
      showToast("Assignment removed");
    } catch (e) {
      showToast(`Unassign failed: ${(e as Error).message}`, true);
    }
  }

  async function handleDelegate() {
    if (!delegateSelected) { showToast("Select who to delegate to", true); return; }
    setDelegating(true);
    try {
      const updatedSteps = await registryClient.subAssign(system.id, section, delegateSelected, delegateNote.trim() || undefined);
      setSteps(updatedSteps);
      setDelegateOpen(false);
      setDelegateSearch("");
      setDelegateSelected("");
      setDelegateNote("");
      showToast("Section delegated — contributor notified");
    } catch (e) {
      showToast(`Delegation failed: ${(e as Error).message}`, true);
    } finally {
      setDelegating(false);
    }
  }

  async function handleReclaim() {
    try {
      const updatedSteps = await registryClient.subReclaim(system.id, section);
      setSteps(updatedSteps);
      showToast("Delegation reclaimed");
    } catch (e) {
      showToast(`Reclaim failed: ${(e as Error).message}`, true);
    }
  }

  const sectionTitle = section === "business" ? "Use Case & Context" : "AI Risk Classification";

  const delegateUI = isOwner ? (
    <div className="mb-4 rounded-md border border-border bg-muted/30 p-3">
      {!sub ? (
        delegateOpen ? (
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium">Delegate {section === "business" ? "Business" : "Technical"} Section</div>
            <p className="text-xs text-muted-foreground">Hand this section to another contributor to fill in. You remain the owner and can reclaim it at any time.</p>
            <div className="relative">
              <Input
                value={delegateSearch}
                onChange={(e) => { setDelegateSearch(e.target.value); setDelegateSelected(""); setDelegateDropdown(e.target.value.trim().length > 0); }}
                onFocus={() => { if (delegateSearch.trim() && !delegateSelected) setDelegateDropdown(true); }}
                onBlur={() => setTimeout(() => setDelegateDropdown(false), 150)}
                placeholder="Search by name or username…"
                className="text-sm"
              />
              {delegateDropdown && delegateFiltered.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-background shadow-md">
                  {delegateFiltered.map((u) => (
                    <button key={u.username} type="button" className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted"
                      onMouseDown={(e) => { e.preventDefault(); setDelegateSelected(u.username); setDelegateSearch([u.firstName, u.lastName].filter(Boolean).join(" ") || u.username); setDelegateDropdown(false); }}>
                      <span className="font-medium">{[u.firstName, u.lastName].filter(Boolean).join(" ") || u.username}</span>
                      <span className="text-xs text-muted-foreground">{u.username} · {u.role.replace(/_/g, " ")}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Textarea value={delegateNote} onChange={(e) => setDelegateNote(e.target.value)} placeholder="Optional context for the contributor…" rows={2} className="text-sm" />
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setDelegateOpen(false); setDelegateSearch(""); setDelegateSelected(""); setDelegateNote(""); }}>Cancel</Button>
              <Button size="sm" onClick={handleDelegate} disabled={delegating || !delegateSelected}>
                {delegating && <Loader2 className="animate-spin" />} Delegate Section
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">You own this section.</span>
            <Button variant="outline" size="sm" onClick={() => setDelegateOpen(true)}>Delegate…</Button>
          </div>
        )
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Delegated to <strong className="text-foreground">{sub}</strong></span>
          <Button variant="ghost" size="sm" onClick={handleReclaim}>Reclaim</Button>
        </div>
      )}
    </div>
  ) : null;

  const formContent = (
    <div className={noDialog ? "flex flex-col" : "w-full overflow-y-auto px-5 py-4"}>
      {noDialog && delegateUI && <div className="px-5 pt-4">{delegateUI}</div>}
      <div className={noDialog ? "px-5 py-2" : ""}>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {section === "business" ? "Use Case & Context" : "Describe the System"}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy || !editable}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            title="Upload a document to pre-fill answers"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
            Pre-fill from document
          </button>
          <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.docx,.pptx,.png,.jpg,.jpeg" className="hidden" onChange={handleUpload} />
        </div>
        <div className="flex flex-col gap-3">
          {visibleQuestions.map((q) => {
            const val = fields[q.key];
            const assignment = assignmentFor(q.key);
            const lockedInput = isQuestionLockedForOwner(q.key);

            const assignControl = (isOwner && !lockedForOwner) ? (
              assignment ? (
                <QuestionAssignPill assignment={assignment} isOwner={isOwner} onUnassign={handleUnassign} />
              ) : (
                <button type="button" onClick={() => setAssignDialog({ questionKey: q.key, label: q.label })} className="inline-flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground" title="Assign this question to someone">
                  <UserPlus className="size-3" /> Assign…
                </button>
              )
            ) : null;

            if (q.type === "boolean") {
              return (
                <label key={q.key} className="flex items-start gap-2.5 rounded-md border border-border p-3 text-sm">
                  <input type="checkbox" checked={Boolean(val)} onChange={(e) => setFields((f) => ({ ...f, [q.key]: e.target.checked }))} className="mt-0.5 shrink-0" disabled={!editable || lockedInput} />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{q.label}</span>{assignControl}</div>
                    <div className="text-xs text-muted-foreground">{q.hint}</div>
                  </div>
                </label>
              );
            }
            if (q.type === "number") {
              return (
                <div key={q.key} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2"><Label className="text-xs font-medium">{q.label}</Label>{assignControl}</div>
                  <Input type="number" value={val != null ? String(val) : ""} onChange={(e) => setFields((f) => ({ ...f, [q.key]: parseFloat(e.target.value) || 0 }))} placeholder={q.hint} className="text-sm" disabled={!editable || lockedInput} />
                </div>
              );
            }
            if (q.type === "textarea") {
              return (
                <div key={q.key} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2"><Label className="text-xs font-medium">{q.label}</Label>{assignControl}</div>
                  <Textarea value={val != null ? String(val) : ""} onChange={(e) => setFields((f) => ({ ...f, [q.key]: e.target.value }))} placeholder={q.hint} rows={3} className="text-sm" disabled={!editable || lockedInput} />
                </div>
              );
            }
            if (q.type === "select") {
              return (
                <div key={q.key} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2"><Label className="text-xs font-medium">{q.label}</Label>{assignControl}</div>
                  <select value={val != null ? String(val) : ""} onChange={(e) => setFields((f) => ({ ...f, [q.key]: e.target.value }))} className="rounded-md border border-input bg-background px-3 py-2 text-sm" disabled={!editable || lockedInput}>
                    <option value="">— select —</option>
                    {q.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              );
            }
            return (
              <div key={q.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2"><Label className="text-xs font-medium">{q.label}</Label>{assignControl}</div>
                <Input value={val != null ? String(val) : ""} onChange={(e) => setFields((f) => ({ ...f, [q.key]: e.target.value }))} placeholder={q.hint} className="text-sm" disabled={!editable || lockedInput} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const footerContent = (
    <>
      {lockedForOwner ? (
        <span className="self-center text-[13px] text-muted-foreground">
          Delegated to <strong className="text-foreground">{sub}</strong> — reclaim above to edit.
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
                  {pendingAssignments.length} question{pendingAssignments.length !== 1 ? "s" : ""} pending — you may still continue
                </span>
              )}
              <Button onClick={handleSubmit} disabled={saving || submitting || !editable}>
                {submitting && <Loader2 className="animate-spin" />}
                {section === "business" ? "Submit Business Section" : "Save & Continue to Classification"}
              </Button>
            </>
          )}
        </>
      )}
    </>
  );

  if (noDialog) {
    return (
      <>
        {formContent}
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {footerContent}
        </div>
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
            <p className="text-xs text-muted-foreground">Fill the form below. Save your progress before submitting.</p>
            {headerExtra && <div className="mt-3">{headerExtra}</div>}
          </DialogHeader>

          {!noDialog && delegateUI && <div className="shrink-0 border-b border-border px-5 py-3">{delegateUI}</div>}

          {formContent}

          <DialogFooter className="shrink-0 sm:justify-start">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            {footerContent}
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
