import type { AssessmentSummary } from "../../api/client";

type StageTone = "progress" | "warn" | "success" | "danger";

export interface StageInfo {
  label: string;
  filled: 0 | 1 | 2 | 3;
  tone: StageTone;
}

// Three-step journey mirroring the governance phases:
//   1. Draft assessment started  (assessment created, not yet in review)
//   2. Assessment under review   (CO reviewing)
//   3. Approved                  (CO approved)
// Systems without an assessment yet surface the registry workflow label with
// zero filled segments. Rejected / info_requested keep the segment count and
// signal state via tone (destructive / warn) rather than regressing progress.
export function stageInfo(
  a: AssessmentSummary | null,
  workflowStatus: string | null,
): StageInfo {
  if (a) {
    if (a.status === "approved") return { label: "3. Approved", filled: 3, tone: "success" };
    if (a.status === "rejected") return { label: "Rejected", filled: 2, tone: "danger" };
    if (a.status === "in_review")
      return { label: "2. Assessment under review", filled: 2, tone: "progress" };
    return { label: "1. Draft assessment started", filled: 1, tone: "progress" };
  }
  switch (workflowStatus) {
    case "approved":
      return { label: "Ready for assessment", filled: 0, tone: "progress" };
    case "info_requested":
      return { label: "Info requested", filled: 0, tone: "warn" };
    case "rejected":
      return { label: "Classification rejected", filled: 0, tone: "danger" };
    case "pending_review":
      return { label: "Classification under review", filled: 0, tone: "progress" };
    case "business_pending":
      return { label: "Awaiting owner", filled: 0, tone: "progress" };
    case "technical_pending":
      return { label: "Awaiting engineer", filled: 0, tone: "progress" };
    case "draft":
      return { label: "Draft started", filled: 0, tone: "progress" };
    default:
      return { label: workflowStatus ?? "—", filled: 0, tone: "progress" };
  }
}

const TONE_CLASSES: Record<StageTone, string> = {
  progress: "bg-[var(--brand)]",
  warn: "bg-amber-500",
  success: "bg-emerald-500",
  danger: "bg-destructive",
};

export function AssessmentStageCell({
  assessment,
  workflowStatus,
}: {
  assessment: AssessmentSummary | null;
  workflowStatus: string | null;
}) {
  const { label, filled, tone } = stageInfo(assessment, workflowStatus);
  const toneClass = TONE_CLASSES[tone];
  const pct = Math.round((filled / 3) * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-foreground">{label}</span>
      <div
        className="flex max-w-[160px] gap-1"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} — stage ${filled} of 3`}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i < filled ? toneClass : "bg-muted"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export function pickLatestAssessmentPerSystem(
  assessments: AssessmentSummary[],
): Map<string, AssessmentSummary> {
  const map = new Map<string, AssessmentSummary>();
  for (const a of assessments) {
    const existing = map.get(a.ai_system_id);
    if (!existing || a.created_at > existing.created_at) {
      map.set(a.ai_system_id, a);
    }
  }
  return map;
}
