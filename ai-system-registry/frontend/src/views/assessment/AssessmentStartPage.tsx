import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useAssessment } from "./AssessmentApp";
import { ORDERED_QUESTION_KEYS, ASSESSMENT_SECTIONS } from "./AssessmentSidebar";
import { usePermissions } from "../../hooks/usePermissions";
import { api } from "../../api/client";
import { TIER_META } from "../../utils";
import { cn } from "@/lib/utils";

type RunStatus = "idle" | "running" | "done" | "error";

/** #362 — Assessment start page with AI generation button. */
export default function AssessmentStartPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, reload } = useAssessment();
  const { can } = usePermissions();

  // If already prefilled from a previous run, start in 'done' state.
  const [runStatus, setRunStatus] = useState<RunStatus>(state.prefilled ? "done" : "idle");
  const [runError, setRunError] = useState<string | null>(null);

  const canGenerate = can("systems:write") && state.editable;
  const canIssue = state.status_label === "locked" && can("systems:approve");
  const tierLabel = TIER_META[state.tier]?.label ?? state.tier;

  const onGenerate = async () => {
    if (!id) return;
    setRunStatus("running");
    setRunError(null);
    try {
      const runResult = await api.runQuestionnaire(id);
      await api.applyRun(id, runResult.run_key, runResult.result.results);
      await reload();
      setRunStatus("done");
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Generation failed");
      setRunStatus("error");
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <p className="text-sm text-muted-foreground">EU AI Act Compliance</p>
      <h1 className="mt-1 text-3xl font-bold">Review the Assessment</h1>
      <p className="mt-3 text-muted-foreground">
        This assessment covers {ORDERED_QUESTION_KEYS.length} questions across {ASSESSMENT_SECTIONS.length} categories. You can generate AI-assisted answers from your uploaded documents, or fill in the answers manually.
      </p>

      {/* AI generation panel */}
      {canGenerate && (
        <div className="mt-6 rounded-xl border border-border bg-card p-6">
          <span className="rounded-full bg-[#eaecee] px-3 py-1 text-xs font-medium text-[#556b82]">
            AI-assisted answers
          </span>
          <h2 className="mt-4 text-lg font-semibold">Generate AI Answers</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Our AI will analyse your uploaded documents and propose answers for each question. You can review and edit every answer before confirming.
          </p>

          {runStatus === "idle" && (
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={onGenerate}
                className="rounded-md bg-[#1147E9] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0d39c4]"
              >
                Generate AI Answers
              </button>
              <button
                onClick={() => navigate(`/systems/${id}/assessment/q/${ORDERED_QUESTION_KEYS[0]}`)}
                className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                Skip, fill manually →
              </button>
            </div>
          )}

          {runStatus === "running" && (
            <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>Generating answers… this may take a minute.</span>
            </div>
          )}

          {runStatus === "done" && (
            <div className="mt-4 flex items-center gap-2 text-sm text-[#1a9d5c]">
              <CheckCircle2 className="size-4" />
              <span>AI answers generated — review and confirm each question below.</span>
            </div>
          )}

          {runStatus === "error" && (
            <div className="mt-4">
              <div className="flex items-center gap-2 text-sm text-[#d14343]">
                <AlertCircle className="size-4" />
                <span>{runError ?? "Generation failed"}</span>
              </div>
              <button
                onClick={onGenerate}
                className="mt-3 rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
              >
                Retry
              </button>
            </div>
          )}

          {/* Per-section progress when running or done */}
          {(runStatus === "running" || runStatus === "done") && (
            <div className="mt-4 space-y-2">
              {ASSESSMENT_SECTIONS.map((section) => {
                const answered = section.questionKeys.filter(
                  (k) => state.questions.find((q) => q.question_key === k)?.answer,
                ).length;
                return (
                  <div key={section.key} className="flex items-center gap-3 text-sm">
                    <span className="w-40 truncate text-muted-foreground">{section.label}</span>
                    <div className="flex-1 rounded-full bg-[var(--muted)] h-1.5">
                      <div
                        className="h-1.5 rounded-full bg-[#1147E9] transition-all"
                        style={{ width: `${(answered / section.questionKeys.length) * 100}%` }}
                      />
                    </div>
                    <span className="w-16 text-right text-xs text-muted-foreground">
                      {answered}/{section.questionKeys.length}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Preliminary classification — shown once answers exist */}
      {runStatus === "done" && state.tier && state.tier !== "pending" && (
        <div className="mt-4 rounded-xl border border-border bg-card p-6">
          <span className="rounded-full bg-[#eaecee] px-3 py-1 text-xs font-medium text-[#556b82]">
            AI-generated · not final
          </span>
          <h2 className="mt-4 text-xl font-bold">
            Preliminary Risk Classification:{" "}
            <span className="text-[#8b3a00]">{tierLabel}</span>
          </h2>
          {state.basis && (
            <p className="mt-3 text-sm text-muted-foreground">{state.basis}</p>
          )}

          {/* Confidence bar */}
          {(state.confidence_counts.high + state.confidence_counts.medium + state.confidence_counts.low) > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold">Answer confidence</h3>
              <ConfidenceBar counts={state.confidence_counts} />
            </>
          )}
        </div>
      )}

      {/* Action row */}
      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={() => navigate(`/systems/${id}/assessment/q/${ORDERED_QUESTION_KEYS[0]}`)}
          disabled={runStatus === "running"}
          className={cn(
            "rounded-md px-5 py-2.5 text-sm font-semibold text-white",
            runStatus === "running"
              ? "cursor-not-allowed bg-[#9db4f5]"
              : "bg-[#1147E9] hover:bg-[#0d39c4]",
          )}
        >
          {runStatus === "done" ? "Review answers" : "Continue to first question"}
        </button>
        {canIssue && (
          <button
            onClick={() => navigate(`/systems/${id}/assessment/issue`)}
            className="rounded-md border border-[#1147E9] px-5 py-2.5 text-sm font-semibold text-[#1147E9] hover:bg-[#eef3ff]"
          >
            Issue a Risk Classification
          </button>
        )}
        {runStatus !== "running" && (
          <span className="text-sm text-muted-foreground">You may review the assessment in any order.</span>
        )}
      </div>
    </div>
  );
}

function ConfidenceBar({
  counts,
}: {
  counts: { high: number; medium: number; low: number };
}) {
  const total = counts.high + counts.medium + counts.low || 1;
  return (
    <>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full">
        <div className="bg-[#1a9d5c]" style={{ width: `${(counts.high / total) * 100}%` }} />
        <div className="bg-[#e0a008]" style={{ width: `${(counts.medium / total) * 100}%` }} />
        <div className="bg-[#d14343]" style={{ width: `${(counts.low / total) * 100}%` }} />
      </div>
      <div className="mt-2 flex gap-6 text-sm text-muted-foreground">
        <span>● {counts.high} high confidence</span>
        <span>● {counts.medium} medium confidence</span>
        <span>● {counts.low} low confidence</span>
      </div>
    </>
  );
}
