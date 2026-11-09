import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { AlertTriangle, CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { AssessmentState, QuestionState } from "../../types";
import { AI_SECTIONS, ORDERED_QUESTION_IDS, QUESTION_DEF_BY_ID } from "../../config/aiQuestionnaire";
import { TierBadge } from "../../components/Badges";
import { cn } from "@/lib/utils";

/** Ordered sections → question keys, derived from ai-questionnaire.json
 * (each JSON category is one section). */
export const ASSESSMENT_SECTIONS: { key: string; label: string; questionKeys: string[] }[] =
  AI_SECTIONS.map((s) => ({ key: s.key, label: s.label, questionKeys: s.questionIds }));

export const ORDERED_QUESTION_KEYS = ORDERED_QUESTION_IDS;

/** Progress-segment color: owner-confirmed ⇒ green; otherwise by AI confidence
 * band (green/amber/red), matching the start-page confidence bar. Unknown ⇒ amber. */
function segmentColor(s?: QuestionState): string {
  if (s?.owner_confirmed) return "bg-[#1a9d5c]";
  if (s?.confidence === "high") return "bg-[#1a9d5c]";
  if (s?.confidence === "medium") return "bg-[#e0a008]";
  if (s?.confidence === "low") return "bg-[#d14343]";
  return "bg-[#e0a008]";
}

/** Left progress sidebar: system name + preliminary classification, per-section
 * completion fractions, per-question status, attention count, Finalize button. */
export function AssessmentSidebar({
  state,
  activeQuestionKey,
  onFinalize,
  finalizeEnabled,
  locked = false,
  basePath,
}: {
  state: AssessmentState;
  activeQuestionKey?: string;
  onFinalize: () => void;
  finalizeEnabled: boolean;
  locked?: boolean;
  basePath: string;
}) {
  const { id } = useParams();
  const stateByKey = useMemo(
    () => Object.fromEntries(state.questions.map((q) => [q.question_key, q])),
    [state.questions],
  );

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col overflow-y-auto border-r border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">EU AI Act Assessment</h2>
      </div>
      <div className="border-b border-border px-5 py-4">
        <Link to={`/systems/${id}`} className="text-sm font-semibold text-[#1147E9] hover:underline">
          {state.system_name}
        </Link>
        <p className="mt-2 text-xs text-muted-foreground">Preliminary risk classification:</p>
        <div className="mt-1">
          <TierBadge tier={state.tier} transparency={state.transparency} />
        </div>
        {state.org_role && (
          <p className="mt-2 text-xs text-muted-foreground">
            Role: <span className="text-foreground">{state.org_role}</span>
          </p>
        )}
        {/* Per-question progress: colored by confidence on load (green/amber/red,
            matching the start-page confidence bar), then green once owner-confirmed. */}
        <div className="mt-3 flex gap-0.5">
          {ORDERED_QUESTION_KEYS.map((k) => (
            <div
              key={k}
              className={cn("h-1.5 flex-1 rounded-full", segmentColor(stateByKey[k]))}
            />
          ))}
        </div>
        {state.attention_count > 0 && (
          <p className="mt-3 text-xs font-medium text-[#8b3a00]">
            {state.attention_count} question{state.attention_count === 1 ? "" : "s"} require your attention
          </p>
        )}
      </div>

      <nav className="flex-1 px-2 py-3">
        {/* Overview → back to the assessment start page (#346). */}
        <div className="mb-4">
          <div className="px-3 py-1">
            <span className="text-sm font-semibold">Overview</span>
          </div>
          <Link
            to={basePath}
            className={cn(
              "flex items-start gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent",
              !activeQuestionKey && "bg-accent",
            )}
          >
            <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="flex flex-col">
              <span>Assessment</span>
              <span className="text-xs text-muted-foreground">Review the summary</span>
            </span>
          </Link>
        </div>
        {ASSESSMENT_SECTIONS.map((section) => {
          const total = section.questionKeys.length;
          // Completion is OWNER-confirmed (the submit gate), not any confirmation.
          const complete = section.questionKeys.filter((k) => stateByKey[k]?.owner_confirmed).length;
          return (
            <div key={section.key} className="mb-4">
              <div className="flex items-center justify-between px-3 py-1">
                <span className="text-sm font-semibold">{section.label}</span>
                <span className="text-xs text-muted-foreground">
                  {complete}/{total}
                </span>
              </div>
              <ul>
                {section.questionKeys.map((key) => {
                  const q = stateByKey[key];
                  const ownerConfirmed = q?.owner_confirmed;
                  // Confirmed by a contributor but not yet by the owner — progress,
                  // but still needs the owner's confirmation before submit.
                  const contributorOnly = q?.confirmed && !ownerConfirmed;
                  const needsAttention = q?.needs_attention && !ownerConfirmed;
                  const llmPending = q?.llm_pending;
                  // Only show the attention indicator (orange) when there IS an
                  // answer but confidence is low — blank/unanswered questions are
                  // just grey "Incomplete", not flagged as needing attention.
                  const showAttention = needsAttention && !!q?.answer && !llmPending;
                  const statusText = ownerConfirmed
                    ? "Complete"
                    : contributorOnly
                      ? "Confirmed by contributor"
                      : llmPending
                        ? "Waiting for AI…"
                        : "Incomplete";
                  return (
                    <li key={key}>
                      <Link
                        to={`${basePath}/q/${key}`}
                        className={cn(
                          "flex items-start gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent",
                          activeQuestionKey === key && "bg-accent",
                        )}
                      >
                        {ownerConfirmed ? (
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#1a5c35]" />
                        ) : llmPending ? (
                          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                        ) : (
                          <Circle
                            className={cn(
                              "mt-0.5 size-4 shrink-0",
                              contributorOnly ? "text-[#b57e00]" : "text-muted-foreground",
                            )}
                          />
                        )}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center gap-1.5 leading-snug">
                            <span className="line-clamp-2">{QUESTION_LABELS[key] ?? key}</span>
                            {showAttention && (
                              <AlertTriangle className="size-3 shrink-0 text-[#c45000]" />
                            )}
                          </span>
                          <span
                            className={cn(
                              "text-xs",
                              ownerConfirmed
                                ? "text-[#1a5c35]"
                                : contributorOnly
                                  ? "text-[#b57e00]"
                                  : showAttention
                                    ? "text-[#c45000]"
                                    : "text-muted-foreground",
                            )}
                          >
                            {statusText}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border p-4">
        {locked ? (
          <p className="rounded-md bg-[var(--muted)]/60 px-3 py-2 text-center text-xs font-medium text-muted-foreground">
            {state.status_label === "approved"
              ? "Approved — risk classification issued"
              : "Submitted — awaiting Compliance Officer review"}
          </p>
        ) : (
          <button
            onClick={onFinalize}
            disabled={!finalizeEnabled}
            className={cn(
              "w-full rounded-md px-4 py-2 text-sm font-semibold text-white",
              finalizeEnabled ? "bg-[#1147E9] hover:bg-[#0d39c4]" : "cursor-not-allowed bg-[#9db4f5]",
            )}
          >
            Finalize Assessment
          </button>
        )}
      </div>
    </aside>
  );
}

// Flat label lookup built from the frontend questionnaire config.
export const QUESTION_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(QUESTION_DEF_BY_ID).map((q) => [q.id, q.question]),
);
