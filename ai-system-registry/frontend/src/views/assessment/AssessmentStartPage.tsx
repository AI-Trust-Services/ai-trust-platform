import { useNavigate, useParams } from "react-router";
import { ArrowRight, Loader2, Undo2 } from "lucide-react";
import { useAssessment } from "./AssessmentApp";
import { ORDERED_QUESTION_KEYS } from "./AssessmentSidebar";
import { usePermissions } from "../../hooks/usePermissions";
import { isGated } from "../../config/aiQuestionnaire";
import { SolverPanel } from "./SolverPanel";

export default function AssessmentStartPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, basePath, solverResult } = useAssessment();
  const { can } = usePermissions();
  const counts = state.confidence_counts;
  const total = counts.high + counts.medium + counts.low || 1;
  const canIssue = state.status_label === "locked" && can("systems:approve");

  const byKey = Object.fromEntries(state.questions.map((q) => [q.question_key, q]));
  const currentAnswers = Object.fromEntries(state.questions.map((q) => [q.question_key, q.answer ?? null]));
  const firstOpenKey =
    ORDERED_QUESTION_KEYS.find(
      (k) => byKey[k]?.can_edit && !byKey[k]?.owner_confirmed && !byKey[k]?.llm_pending && !isGated(k, currentAnswers),
    ) ??
    ORDERED_QUESTION_KEYS.find((k) => !byKey[k]?.owner_confirmed && !isGated(k, currentAnswers)) ??
    ORDERED_QUESTION_KEYS.find((k) => !isGated(k, currentAnswers)) ??
    ORDERED_QUESTION_KEYS[0];

  const solverLabel = solverResult ? solverResult.risk.labelId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : null;

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <p className="text-sm text-muted-foreground">EU AI Act Compliance</p>
      <h1 className="mt-1 text-3xl font-bold">Review the Assessment</h1>
      <p className="mt-3 text-muted-foreground">
        Our AI reviewed your {state.source_documents.length} uploaded document
        {state.source_documents.length === 1 ? "" : "s"} and pre-filled{" "}
        {state.questions.filter((q) => q.answer_source === "ai_prefilled" && q.answer).length} answers. Check the
        preliminary risk classification, then review and confirm each AI-proposed answer before submitting.
      </p>

      {state.review_note && (
        <div className="mt-4 rounded-xl border border-[#d14343]/40 bg-[#fef2f2] px-5 py-4">
          <div className="flex items-start gap-3">
            <Undo2 className="mt-0.5 size-5 shrink-0 text-[#d14343]" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#991b1b]">Returned by Compliance Officer</p>
              <p className="mt-0.5 text-xs text-[#991b1b]/80">
                {state.review_note.author} · {new Date(state.review_note.created_at).toLocaleString()}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{state.review_note.note}</p>
            </div>
          </div>
        </div>
      )}

      {state.prefill_pending && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#e0a008]/40 bg-[#fffbeb] px-5 py-3 text-sm text-[#854d0e]">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          <span>AI is generating answers based on uploaded system data</span>
        </div>
      )}

      <div className="mt-6">
        <SolverPanel solverResult={solverResult} pending={state.prefill_pending} />
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold">How confident the assessment was answered</h3>
        <div className="mt-3 flex h-2 overflow-hidden rounded-full">
          <div className="bg-[#1a9d5c]" style={{ width: `${(counts.high / total) * 100}%` }} />
          <div className="bg-[#e0a008]" style={{ width: `${(counts.medium / total) * 100}%` }} />
          <div className="bg-[#d14343]" style={{ width: `${(counts.low / total) * 100}%` }} />
        </div>
        <div className="mt-2 flex gap-6 text-sm text-muted-foreground">
          <span>● {counts.high} high confidence</span>
          <span>● {counts.medium} medium confidence</span>
          <span>● {counts.low} low confidence</span>
        </div>

        {state.decisive_questions.length > 0 && (
          <>
            <h3 className="mt-6 text-lg font-semibold">Why this classification</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              These {state.decisive_questions.length} answer
              {state.decisive_questions.length === 1 ? "" : "s"} determine the{" "}
              {solverLabel ?? "classification"} result. If you change one of them, the classification may change.
            </p>
            <div className="mt-3 space-y-3">
              {state.decisive_questions.map((d) => (
                <div key={d.question_key} className="rounded-lg border border-border bg-[var(--muted)]/40 p-4">
                  <div className="flex items-start justify-between">
                    <p className="text-xs text-muted-foreground">
                      {d.section}: {d.question_label}
                    </p>
                    <button
                      onClick={() => navigate(`${basePath}/q/${d.question_key}`)}
                      className="inline-flex items-center gap-1 text-sm text-[#1147E9] hover:underline"
                    >
                      Go to question <ArrowRight className="size-3.5" />
                    </button>
                  </div>
                  <p className="mt-1 font-medium">{d.question_label}</p>
                  {d.answer && (
                    <p className="mt-1 text-sm">
                      <span className="text-muted-foreground">Answer: </span>
                      {d.answer}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={() => navigate(`${basePath}/q/${firstOpenKey}`)}
          className="rounded-md bg-[#1147E9] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0d39c4]"
        >
          Continue assessment
        </button>
        {canIssue && (
          <button
            onClick={() => navigate(`/systems/${id}/assessment/issue`)}
            className="rounded-md border border-[#1147E9] px-5 py-2.5 text-sm font-semibold text-[#1147E9] hover:bg-[#eef3ff]"
          >
            Issue a Risk Classification
          </button>
        )}
        <span className="text-sm text-muted-foreground">You may review the assessment in any order.</span>
      </div>
    </div>
  );
}
