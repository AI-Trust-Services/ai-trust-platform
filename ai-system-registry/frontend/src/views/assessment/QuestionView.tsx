import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronLeft, MoreVertical, Users, SignalHigh, SignalMedium, SignalLow } from "lucide-react";
import type { ConfidenceLevel, QuestionComment, QuestionState } from "../../types";
import { api } from "../../api/client";
import { usePermissions } from "../../hooks/usePermissions";
import { useAssessment } from "./AssessmentApp";
import { ORDERED_QUESTION_KEYS, ASSESSMENT_SECTIONS } from "./AssessmentSidebar";
import {
  QUESTION_DEF_BY_ID,
  isPredefined,
  isMultiselect,
} from "../../config/aiQuestionnaire";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Display label for a raw option value (e.g. "YES" → "Yes"). */
const OPTION_LABELS: Record<string, string> = {
  YES: "Yes",
  NO: "No",
  PARTIALLY: "Partially",
  NOT_APPLICABLE: "Not applicable",
  NOT_ENOUGH_INFORMATION: "Not enough information",
  CONFLICT: "Conflicting evidence",
};

function optionLabel(value: string): string {
  return OPTION_LABELS[value] ?? value;
}

function sectionLabel(questionKey: string): string {
  return ASSESSMENT_SECTIONS.find((s) => s.questionKeys.includes(questionKey))?.label ?? "";
}

function ConfidenceIndicator({
  level,
  references,
  onClick,
}: {
  level: ConfidenceLevel | null;
  references: number;
  onClick: () => void;
}) {
  const meta: Record<ConfidenceLevel, { label: string; cls: string; Icon: typeof SignalHigh }> = {
    high: { label: "High Confidence", cls: "text-[#1a9d5c]", Icon: SignalHigh },
    medium: { label: "Medium Confidence", cls: "text-[#b57e00]", Icon: SignalMedium },
    low: { label: "Low confidence", cls: "text-[#d14343]", Icon: SignalLow },
  };
  const m = level ? meta[level] : { label: "Not assessed", cls: "text-muted-foreground", Icon: SignalLow };
  const Icon = m.Icon;
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 text-sm hover:underline", m.cls)}>
      <Icon className="size-4" />
      <span className="font-medium underline-offset-2">{m.label}</span>
      <span className="text-muted-foreground">· {references} reference{references === 1 ? "" : "s"}</span>
    </button>
  );
}

/** #314 — the individual question review card. */
export default function QuestionView() {
  const { id, questionKey } = useParams();
  const navigate = useNavigate();
  const { state, reload, markSaved } = useAssessment();

  const qState: QuestionState | undefined = useMemo(
    () => state.questions.find((q) => q.question_key === questionKey),
    [state.questions, questionKey],
  );
  const def = questionKey ? QUESTION_DEF_BY_ID[questionKey] : undefined;

  const [answer, setAnswer] = useState(qState?.answer ?? "");
  const [comments, setComments] = useState<QuestionComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [confModalOpen, setConfModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userMap, setUserMap] = useState<Record<string, { firstName: string; lastName: string }>>({});
  const { username: currentUser } = usePermissions();

  const idx = questionKey ? ORDERED_QUESTION_KEYS.indexOf(questionKey) : -1;
  const prevKey = idx > 0 ? ORDERED_QUESTION_KEYS[idx - 1] : null;
  const nextKey = idx >= 0 && idx < ORDERED_QUESTION_KEYS.length - 1 ? ORDERED_QUESTION_KEYS[idx + 1] : null;

  const changedFromAi = qState?.answer_source === "manual";
  const hasComment = comments.length > 0;
  const canEdit = state.editable && (qState?.can_edit ?? false);
  const confirmDisabled = busy || !canEdit || (changedFromAi && !hasComment);

  useEffect(() => {
    setAnswer(qState?.answer ?? "");
  }, [qState?.answer, questionKey]);

  useEffect(() => {
    if (!id || !questionKey) return;
    api.listComments(id, questionKey).then(setComments).catch(() => setComments([]));
  }, [id, questionKey]);

  useEffect(() => {
    api
      .getAllUsers()
      .then((users) => {
        const m: Record<string, { firstName: string; lastName: string }> = {};
        for (const u of users) m[u.username] = { firstName: u.firstName, lastName: u.lastName };
        setUserMap(m);
      })
      .catch(() => setUserMap({}));
  }, []);

  const displayName = (uname: string): string => {
    const u = userMap[uname];
    const full = u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : "";
    return full || uname;
  };

  const assignTo = async (assignee: string | null) => {
    if (!id || !questionKey) return;
    try {
      if (assignee) await api.assignQuestion(id, questionKey, assignee);
      else await api.unassignQuestion(id, questionKey);
      markSaved();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assignment failed");
    }
  };

  const mayAssign =
    canEdit || (!!qState?.assignee_username && qState.assignee_username === currentUser);
  const assignedToMe = qState?.assignee_username === currentUser && !!currentUser;

  const saveAnswer = async (value: string) => {
    if (!id || !questionKey) return;
    try {
      await api.saveAnswer(id, questionKey, value);
      markSaved();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const postComment = async () => {
    if (!id || !questionKey || !commentDraft.trim()) return;
    try {
      const c = await api.addComment(id, questionKey, commentDraft.trim());
      setComments((prev) => [...prev, c]);
      setCommentDraft("");
      markSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comment failed");
    }
  };

  const onConfirm = async () => {
    if (!id || !questionKey) return;
    setBusy(true);
    setError(null);
    try {
      await api.confirmQuestion(id, questionKey);
      markSaved();
      await reload();
      if (nextKey) navigate(`/systems/${id}/assessment/q/${nextKey}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirm failed");
    } finally {
      setBusy(false);
    }
  };

  const goNext = async () => {
    if (nextKey && id) navigate(`/systems/${id}/assessment/q/${nextKey}`);
  };

  if (!def || !questionKey) {
    return <div className="p-8 text-sm text-muted-foreground">Unknown question.</div>;
  }

  // MULTISELECT: parse the current answer as a JSON string array.
  const selectedMulti: string[] = isMultiselect(def)
    ? (() => { try { return JSON.parse(answer || "[]") as string[]; } catch { return []; } })()
    : [];

  const toggleOption = (val: string) => {
    const next = selectedMulti.includes(val)
      ? selectedMulti.filter((v) => v !== val)
      : [...selectedMulti, val];
    const serialized = JSON.stringify(next);
    setAnswer(serialized);
    saveAnswer(serialized);
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between">
          <p className="text-xs text-muted-foreground">{sectionLabel(questionKey)}</p>
          <div className="flex items-center gap-2">
            {assignedToMe && (
              <span className="rounded-full bg-[#e8f0fb] px-2.5 py-0.5 text-xs font-medium text-[#1147E9]">
                Assigned to you
              </span>
            )}
            {qState?.assignee_username && !assignedToMe && (
              <span className="rounded-full bg-[#eaecee] px-2.5 py-0.5 text-xs text-[#556b82]">
                {displayName(qState.assignee_username)}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="Assign to colleague" disabled={!mayAssign}>
                <Users
                  className={cn(
                    "size-4",
                    mayAssign ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/40",
                  )}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                {state.contributors.map((c) => (
                  <DropdownMenuItem
                    key={c.username}
                    onClick={() => assignTo(c.username)}
                    className={cn(qState?.assignee_username === c.username && "font-semibold")}
                  >
                    <span className="flex flex-col">
                      <span>{displayName(c.username)}</span>
                      <span className="text-xs text-muted-foreground">{c.username}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => assignTo(null)}>Set unassigned</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="Comment actions" disabled={!canEdit}>
                <MoreVertical className="size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => document.getElementById("comment-field")?.focus()}>
                  Leave a comment
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <h1 className="mt-1 text-2xl font-bold">{def.question}</h1>

        <div className="mt-3">
          <ConfidenceIndicator
            level={qState?.confidence ?? null}
            references={qState?.ai_references?.length ?? 0}
            onClick={() => setConfModalOpen(true)}
          />
        </div>

        <div className="mt-5 space-y-2">
          {isPredefined(def) ? (
            // PREDEFINED: radio buttons with human-readable labels
            def.allowedAnswers.map((opt) => (
              <label key={opt} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={questionKey}
                  checked={answer === opt}
                  disabled={!canEdit}
                  onChange={() => {
                    setAnswer(opt);
                    saveAnswer(opt);
                  }}
                />
                <span>{optionLabel(opt)}</span>
              </label>
            ))
          ) : isMultiselect(def) ? (
            // MULTISELECT: checkboxes
            def.allowedAnswers.map((opt) => (
              <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedMulti.includes(opt.value)}
                  disabled={!canEdit}
                  onChange={() => toggleOption(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            ))
          ) : (
            // DESCRIPTIVE: textarea
            <textarea
              className="min-h-24 w-full rounded-md border border-border p-3 text-sm disabled:bg-[var(--muted)]/40"
              value={answer}
              disabled={!canEdit}
              onChange={(e) => setAnswer(e.target.value)}
              onBlur={() => answer !== (qState?.answer ?? "") && saveAnswer(answer)}
              placeholder="Enter your answer"
            />
          )}
          <p className="text-xs text-muted-foreground">
            {qState?.answer_source === "manual" ? "Manual entry" : "AI-assisted answer"}
          </p>
        </div>

        {changedFromAi && !hasComment && canEdit && (
          <p className="mt-3 text-xs font-medium text-[#8b3a00]">
            You changed the AI answer — add a comment explaining the change before confirming.
          </p>
        )}

        <div className="mt-6">
          <p className="text-sm font-medium">Leave a comment</p>
          <textarea
            id="comment-field"
            className="mt-2 min-h-20 w-full rounded-md border border-border p-3 text-sm disabled:bg-[var(--muted)]/40"
            placeholder="Enter your text here"
            value={commentDraft}
            disabled={!canEdit}
            onChange={(e) => setCommentDraft(e.target.value)}
          />
          <div className="mt-2">
            <button
              onClick={postComment}
              disabled={!canEdit || !commentDraft.trim()}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              Comment
            </button>
          </div>
        </div>

        {comments.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-medium">Comments</p>
            <ul className="mt-2 space-y-3">
              {comments.map((c) => (
                <li key={c.id} className="flex items-start gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1147E9] text-xs font-semibold text-white">
                    {c.author_username.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-sm font-medium">
                      {c.author_username}{" "}
                      <span className="font-normal text-muted-foreground">
                        {new Date(c.created_at).toLocaleString()}
                      </span>
                    </p>
                    <p className="text-sm">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-[var(--danger-fg)]">{error}</p>}

      <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-card px-5 py-3">
        <button
          onClick={() => prevKey && navigate(`/systems/${id}/assessment/q/${prevKey}`)}
          disabled={!prevKey}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <ChevronLeft className="size-4" /> Previous
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={goNext}
            disabled={!nextKey}
            className="rounded-md border border-border px-4 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
          >
            Next
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-semibold text-white",
              confirmDisabled ? "cursor-not-allowed bg-[#9db4f5]" : "bg-[#1147E9] hover:bg-[#0d39c4]",
            )}
          >
            Confirm
          </button>
        </div>
      </div>

      <Dialog open={confModalOpen} onOpenChange={setConfModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Answer confidence</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="font-medium">{def.question}</p>
            <p>
              Confidence:{" "}
              <span className="font-medium capitalize">{qState?.confidence ?? "not assessed"}</span>
            </p>
            {qState?.ai_explanation && (
              <div>
                <p className="mb-1 font-medium">Explanation</p>
                <p className="text-muted-foreground">{qState.ai_explanation}</p>
              </div>
            )}
            <div>
              <p className="mb-1 font-medium">Evidence references</p>
              {qState?.ai_references && qState.ai_references.length > 0 ? (
                <ul className="space-y-2 text-muted-foreground">
                  {qState.ai_references.map((ref, i) => (
                    <li key={i} className="rounded-md border border-border p-2 text-xs">
                      <span className="font-medium text-foreground">
                        {ref.source ?? "Unknown source"}
                      </span>
                      {ref.location && <span className="ml-1">— {ref.location}</span>}
                      {ref.sourceType && (
                        <span className="ml-1 text-muted-foreground/60">({ref.sourceType})</span>
                      )}
                      {ref.quote && (
                        <p className="mt-1 border-l-2 border-border pl-2 italic">&ldquo;{ref.quote}&rdquo;</p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No references available for this question.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
