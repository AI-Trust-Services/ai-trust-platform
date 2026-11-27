import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ChevronLeft, Loader2, Lock, MoreVertical, Users, SignalHigh, SignalMedium, SignalLow, Trash2 } from "lucide-react";
import type { ConfidenceLevel, QuestionComment, QuestionState } from "../../types";
import { api } from "../../api/client";
import { usePermissions } from "../../hooks/usePermissions";
import InitialsAvatar from "../../components/InitialsAvatar";
import { useAssessment } from "./AssessmentApp";
import { ORDERED_QUESTION_KEYS, ASSESSMENT_SECTIONS } from "./AssessmentSidebar";
import {
  QUESTION_DEF_BY_ID,
  isPredefined,
  isMultiselect,
  isGated,
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
  const { state, reload, markSaved, basePath, userMap, ensureUserMap } = useAssessment();

  // Trigger the lazy user-map fetch on first QuestionView mount. AssessmentApp
  // guards with a ref so this is a no-op on every subsequent question navigation.
  useEffect(() => { ensureUserMap(); }, [ensureUserMap]);

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
  // Comment pending a delete-confirmation dialog (null = dialog closed). Uses a
  // shadcn Dialog rather than window.confirm(), which is unreliable in the Luigi
  // iframe (a sandbox without allow-modals silently returns false).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { username: currentUser, can } = usePermissions();

  const idx = questionKey ? ORDERED_QUESTION_KEYS.indexOf(questionKey) : -1;
  // Skip gated questions when navigating prev/next so the user never lands on
  // a locked placeholder after confirming or pressing the navigation buttons.
  const currentAnswersForNav: Record<string, string | null> = Object.fromEntries(
    state.questions.map((q) => [q.question_key, q.answer ?? null]),
  );
  const prevKey =
    idx > 0
      ? [...ORDERED_QUESTION_KEYS]
          .slice(0, idx)
          .reverse()
          .find((k) => !isGated(k, currentAnswersForNav)) ?? null
      : null;
  const nextKey =
    idx >= 0 && idx < ORDERED_QUESTION_KEYS.length - 1
      ? ORDERED_QUESTION_KEYS.slice(idx + 1).find((k) => !isGated(k, currentAnswersForNav)) ?? null
      : null;

  const changedFromAi = qState?.answer_source === "manual";
  // The compliance reviewer is any user with systems:approve. This mirrors the
  // branch in AssessmentApp (line ~108) which checks can("systems:approve") first,
  // before can("systems:write") — the CO role actually holds both, so the
  // `!can("systems:write")` guard would incorrectly exclude them (#435).
  // In this view confidence/references stay attributed to the AI answer and the
  // AI's original answer is shown alongside the user's; the owner/writer view
  // (no systems:approve) instead greys the indicator out once the AI answer is
  // overridden.
  const isComplianceReviewer = can("systems:approve");
  // Provenance line under the input. `answer_source` is seeded "ai_prefilled" for
  // EVERY question at /open, so it alone does not mean the AI answered this one —
  // an unanswered question would otherwise claim "Pre-filled AI answer" (#383).
  // NOT_ENOUGH_INFORMATION / CONFLICT are the AI explicitly declining to answer;
  // the control renders blank for them, so say what actually happened. A declined
  // (null-confidence) question the user then answers stays answer_source
  // "ai_prefilled" (no change-gate), but is NOT a pre-fill — only a concrete AI
  // answer (confidence set) is "Pre-filled AI answer"; anything else the user
  // typed is "Manual entry".
  const answerSourceLabel = changedFromAi
    ? "Manual entry"
    : qState?.answer === "NOT_ENOUGH_INFORMATION" ||
        qState?.answer === '["NOT_ENOUGH_INFORMATION"]'
      ? "AI found no supporting evidence"
      : qState?.answer === "CONFLICT" || qState?.answer === '["CONFLICT"]'
        ? "AI found conflicting evidence"
        : !qState?.answer
          ? "Not answered by AI"
          : qState?.confidence
            ? "Pre-filled AI answer"
            : "Manual entry";
  // Whether a comment that SATISFIES the backend change-gate exists — i.e. one
  // recorded at/after the last answer change. Backend-computed (mirrors the
  // confirm gate) so a stale pre-change comment doesn't enable a confirm the
  // server would reject. Kept fresh by reload() after add/delete/save.
  const hasQualifyingComment = qState?.has_qualifying_comment ?? false;
  // True while this question is still waiting for the AI background pipeline
  // to produce an answer. Inputs are locked until the answer arrives.
  const llmPending = qState?.llm_pending ?? false;
  // Read-only: the whole assessment is locked, or this question isn't the
  // current user's to edit. Drives input disabling + hides edit affordances.
  const canEdit = !llmPending && state.editable && (qState?.can_edit ?? false);
  // The CONFIRM gate: must be editable, and if the answer was changed from the
  // AI pre-fill, a qualifying comment (recorded after the change) is mandatory.
  const confirmDisabled =
    busy || !canEdit || (changedFromAi && !hasQualifyingComment);

  useEffect(() => {
    setAnswer(qState?.answer ?? "");
  }, [qState?.answer, questionKey]);

  useEffect(() => {
    if (!id || !questionKey) return;
    // Scope comments to THIS cycle (state.assessment_id) so a historical "View
    // results" shows the viewed cycle's comments, not the current cycle's.
    api
      .listComments(id, questionKey, state.assessment_id)
      .then(setComments)
      .catch(() => setComments([]));
  }, [id, questionKey, state.assessment_id]);

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

  // Owner or current assignee may (re)assign this question.
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
      // Refresh so the backend-computed has_qualifying_comment (which drives the
      // Confirm gate) reflects the new comment.
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comment failed");
    }
  };

  // The author may delete their own comment; the system owner may delete any.
  // Backend enforces the same rule (delete_comment); this only gates the affordance.
  const canDeleteComment = (c: QuestionComment): boolean =>
    state.editable &&
    !!currentUser &&
    (currentUser === c.author_username || currentUser === state.owner_username);

  const confirmDeleteComment = async () => {
    if (!id || !questionKey || !pendingDeleteId) return;
    const commentId = pendingDeleteId;
    try {
      await api.deleteComment(id, questionKey, commentId);
      setComments((prev) => prev.filter((x) => x.id !== commentId));
      markSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setPendingDeleteId(null);
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
      if (nextKey) navigate(`${basePath}/q/${nextKey}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirm failed");
    } finally {
      setBusy(false);
    }
  };

  const goNext = async () => {
    // "Next" does not confirm; if a confirmed answer was re-edited the backend
    // already reverted it to Incomplete on save. Just navigate.
    if (nextKey && id) navigate(`${basePath}/q/${nextKey}`);
  };

  if (!def || !questionKey) {
    return <div className="p-8 text-sm text-muted-foreground">Unknown question.</div>;
  }

  // Build a flat answers map from the loaded assessment state so isGated() can
  // evaluate the full dependency chain without additional API calls.
  const currentAnswers: Record<string, string | null> = Object.fromEntries(
    state.questions.map((q) => [q.question_key, q.answer ?? null]),
  );

  if (isGated(questionKey, currentAnswers)) {
    // Find the gate question label for a helpful explanation.
    const gateNode = def.appliesWhen;
    const gateIds: string[] = [];
    if (gateNode) {
      const collect = (node: typeof gateNode) => {
        for (const c of [...(node?.all ?? []), ...(node?.any ?? [])]) {
          if ("questionId" in c) gateIds.push(c.questionId);
        }
      };
      collect(gateNode);
    }
    const uniqueGateIds = [...new Set(gateIds)];

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-12 text-center">
        <Lock className="size-8 text-muted-foreground/40" />
        <div className="max-w-md space-y-2">
          <h2 className="text-base font-semibold text-foreground">{def.question}</h2>
          <p className="text-sm text-muted-foreground">
            This question is locked. It becomes available based on your answer to:{" "}
            {uniqueGateIds.length > 0 ? (
              uniqueGateIds.map((gid, i) => (
                <span key={gid}>
                  {i > 0 && ", "}
                  <Link
                    to={`${basePath}/q/${gid}`}
                    className="font-medium text-[#1147E9] hover:underline"
                  >
                    {QUESTION_DEF_BY_ID[gid]?.question ?? gid}
                  </Link>
                </span>
              ))
            ) : (
              <span className="font-medium text-foreground">a preceding question</span>
            )}.
          </p>
        </div>
      </div>
    );
  }

  // MULTISELECT: the stored answer is a JSON string array.
  const selectedMulti: string[] = isMultiselect(def)
    ? (() => {
        try {
          return JSON.parse(answer || "[]") as string[];
        } catch {
          return [];
        }
      })()
    : [];

  const toggleOption = (val: string) => {
    const next = selectedMulti.includes(val)
      ? selectedMulti.filter((v) => v !== val)
      : [...selectedMulti, val];
    const serialized = JSON.stringify(next);
    setAnswer(serialized);
    saveAnswer(serialized);
  };

  // Human-readable rendering of a raw stored answer (PREDEFINED value, MULTISELECT
  // JSON array, or DESCRIPTIVE free text). Used to show the AI's original answer
  // alongside the user's in the compliance-reviewer view (#435).
  const formatAnswerForDisplay = (raw: string | null): string => {
    if (!raw) return "Not answered by AI";
    if (raw === "NOT_ENOUGH_INFORMATION" || raw === '["NOT_ENOUGH_INFORMATION"]')
      return "AI found no supporting evidence";
    if (raw === "CONFLICT" || raw === '["CONFLICT"]') return "AI found conflicting evidence";
    if (isMultiselect(def)) {
      try {
        const vals = JSON.parse(raw) as string[];
        return (
          vals.map((v) => def.allowedAnswers.find((o) => o.value === v)?.label ?? v).join(", ") ||
          "Not answered by AI"
        );
      } catch {
        return raw;
      }
    }
    if (isPredefined(def)) return optionLabel(raw);
    return raw;
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
            {/* Assign-to-colleague — people icon → assignee dropdown */}
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
            {/* Three-dot menu — comment actions only (not assignment) */}
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

        {/* Confidence + references belong to the AI-generated answer only (#435).
            - Answer unchanged from the AI → the active answer IS the AI answer, so
              the indicator applies directly.
            - Compliance reviewer (read-only) & overridden & the AI actually answered
              (ai_original_answer present) → show the AI's original answer as its own
              block with the indicator attached, so both answers are visible and the
              confidence is unambiguously tied to the AI answer.
            - Otherwise overridden (owner/writer, or a reviewer where the AI never
              answered) → grey the indicator out with a note. Guarding the reviewer
              block on ai_original_answer avoids a misleading "AI suggested answer /
              Not answered by AI" card when the owner manually filled a question the
              AI skipped (answer_source flips to manual even with no AI original). */}
        {!changedFromAi ? (
          <div className="mt-3">
            <ConfidenceIndicator
              level={qState?.confidence ?? null}
              references={qState?.ai_references?.length ?? 0}
              onClick={() => setConfModalOpen(true)}
            />
          </div>
        ) : isComplianceReviewer && qState?.ai_original_answer ? (
          <div className="mt-3 rounded-md border border-border bg-[var(--muted)]/20 p-3">
            <p className="text-xs font-medium text-muted-foreground">AI suggested answer</p>
            <p className="mt-1 text-sm">{formatAnswerForDisplay(qState?.ai_original_answer ?? null)}</p>
            <div className="mt-2">
              <ConfidenceIndicator
                level={qState?.confidence ?? null}
                references={qState?.ai_references?.length ?? 0}
                onClick={() => setConfModalOpen(true)}
              />
            </div>
          </div>
        ) : (
          <div className="mt-3 opacity-60">
            <ConfidenceIndicator
              level={qState?.confidence ?? null}
              references={qState?.ai_references?.length ?? 0}
              onClick={() => setConfModalOpen(true)}
            />
            <p className="mt-0.5 text-xs text-muted-foreground">
              Applies to the AI&rsquo;s suggested answer, not your answer.
            </p>
          </div>
        )}

        {llmPending && (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-[#e0a008]/40 bg-[#fffbeb] px-4 py-2.5 text-sm text-[#854d0e]">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            <span>Waiting for AI answer — inputs will unlock when this batch completes</span>
          </div>
        )}

        <div className="mt-5 space-y-2">
          {isPredefined(def) ? (
            def.allowedAnswers.filter((opt) => opt !== "NOT_APPLICABLE").map((opt) => (
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
          ) : answer === "NOT_ENOUGH_INFORMATION" && !canEdit ? (
            <p className="rounded-md border border-border bg-[var(--muted)]/30 p-3 text-sm italic text-muted-foreground">
              Not enough information
            </p>
          ) : (
            <textarea
              className="min-h-24 w-full rounded-md border border-border p-3 text-sm disabled:bg-[var(--muted)]/40"
              value={answer === "NOT_ENOUGH_INFORMATION" ? "" : answer}
              disabled={!canEdit}
              onChange={(e) => setAnswer(e.target.value)}
              onBlur={() => answer !== (qState?.answer ?? "") && saveAnswer(answer)}
              placeholder="Enter your answer"
            />
          )}
          <p className="text-xs text-muted-foreground">{answerSourceLabel}</p>
        </div>

        {changedFromAi && !hasQualifyingComment && canEdit && (
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
                <li key={c.id} className="group flex items-start gap-2">
                  <InitialsAvatar name={displayName(c.author_username)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {displayName(c.author_username)}{" "}
                      <span className="font-normal text-muted-foreground">
                        {new Date(c.created_at).toLocaleString()}
                      </span>
                    </p>
                    <p className="text-sm">{c.body}</p>
                  </div>
                  {canDeleteComment(c) && (
                    <button
                      onClick={() => setPendingDeleteId(c.id)}
                      aria-label="Delete comment"
                      className="shrink-0 text-muted-foreground opacity-0 transition hover:text-[var(--danger-fg)] group-hover:opacity-100"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-[var(--danger-fg)]">{error}</p>}

      <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-card px-5 py-3">
        <button
          onClick={() => prevKey && navigate(`${basePath}/q/${prevKey}`)}
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
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Answer confidence</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pb-2 text-sm">
            <p className="font-medium leading-snug">{def.question}</p>
            <p>
              Confidence level:{" "}
              <span className="font-medium capitalize">{qState?.confidence ?? "not assessed"}</span>
            </p>
            {qState?.ai_explanation && (
              <div>
                <p className="mb-1 font-medium">Explanation</p>
                <p className="text-muted-foreground">{qState.ai_explanation}</p>
              </div>
            )}
            <div>
              <p className="mb-2 font-medium">Evidence references</p>
              {qState?.ai_references && qState.ai_references.length > 0 ? (
                <ul className="space-y-2">
                  {qState.ai_references.map((ref, i) => (
                    <li key={i} className="rounded-md border border-border p-3 text-xs">
                      <span className="font-medium text-foreground">
                        {ref.source ?? "Unknown source"}
                      </span>
                      {ref.location && <span className="ml-1 text-muted-foreground">— {ref.location}</span>}
                      {ref.sourceType && (
                        <span className="ml-1 text-muted-foreground/60">({ref.sourceType})</span>
                      )}
                      {ref.quote && (
                        <p className="mt-1.5 border-l-2 border-border pl-2 italic text-muted-foreground">
                          &ldquo;{ref.quote}&rdquo;
                        </p>
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
      <Dialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete comment</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This comment will be removed. This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setPendingDeleteId(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={confirmDeleteComment}
              className="rounded-md bg-[var(--danger-fg)] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
            >
              Delete
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
