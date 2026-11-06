import { useNavigate, useParams } from "react-router";
import { ArrowRight } from "lucide-react";
import { useAssessment } from "./AssessmentApp";
import { ORDERED_QUESTION_KEYS } from "./AssessmentSidebar";
import { usePermissions } from "../../hooks/usePermissions";
import { TIER_META } from "../../utils";

const CLASSIFICATION_TABS = [
  { key: "minimal", label: "Minimal or no risk" },
  { key: "limited", label: "Transparency Obligations" },
  { key: "high", label: "High-risk" },
  { key: "prohibited", label: "Prohibited practice" },
];

// Which display-only tab is "active" for a given stored tier.
function activeTab(tier: string): string {
  if (tier === "prohibited") return "prohibited";
  if (tier === "high") return "high";
  if (tier === "limited") return "limited";
  if (tier.startsWith("gpai")) return "high";
  return "minimal";
}

/** #346 — the AI-prefilled assessment start page. */
export default function AssessmentStartPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, basePath } = useAssessment();
  const { can } = usePermissions();
  const counts = state.confidence_counts;
  const total = counts.high + counts.medium + counts.low || 1;
  const active = activeTab(state.tier);
  const tierLabel = TIER_META[state.tier]?.label ?? state.tier;
  // CO entry: offer "Issue a Risk Classification" only while the assessment is
  // submitted-but-not-yet-decided (status_label "locked" = workflow pending_review).
  // An already-approved assessment is read-only with no action (the backend /issue
  // 409s on a non-pending_review status), matching the CO/contributor read-only view.
  const canIssue = state.status_label === "locked" && can("systems:approve");

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <p className="text-sm text-muted-foreground">EU AI Act Compliance</p>
      <h1 className="mt-1 text-3xl font-bold">Review the Assessment</h1>
      <p className="mt-3 text-muted-foreground">
        Our AI reviewed your {state.source_documents.length} uploaded document
        {state.source_documents.length === 1 ? "" : "s"} and pre-filled{" "}
        {state.questions.filter((q) => q.answer_source === "ai_prefilled" && q.answer).length} answers. Check the
        preliminary risk classification, then review the answers it was least sure about.
      </p>

      <div className="mt-6 rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between">
          <span className="rounded-full bg-[#eaecee] px-3 py-1 text-xs font-medium text-[#556b82]">
            AI-generated · not final
          </span>
          {state.org_role && (
            <span className="text-sm text-muted-foreground">
              Role: <span className="text-foreground">{state.org_role}</span>
            </span>
          )}
        </div>
        <h2 className="mt-4 text-xl font-bold">
          Preliminary Risk Classification: <span className="text-[#8b3a00]">{tierLabel}</span>
        </h2>

        <div className="mt-4 grid grid-cols-4 gap-2">
          {CLASSIFICATION_TABS.map((t) => (
            <div
              key={t.key}
              className={
                "rounded-md border px-3 py-2 text-center text-sm " +
                (t.key === active
                  ? "border-[#1147E9] font-semibold text-[#1147E9]"
                  : "border-border text-muted-foreground")
              }
            >
              {t.label}
            </div>
          ))}
        </div>

        {state.basis && <p className="mt-4 text-sm text-muted-foreground">{state.basis}</p>}

        <h3 className="mt-6 text-lg font-semibold">How confident the assessment was answered</h3>
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
              {state.decisive_questions.length === 1 ? "" : "s"} determine the {tierLabel} result. If you change one of
              them, the classification may change.
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
          onClick={() => navigate(`${basePath}/q/${ORDERED_QUESTION_KEYS[0]}`)}
          className="rounded-md bg-[#1147E9] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0d39c4]"
        >
          Continue to first question
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
