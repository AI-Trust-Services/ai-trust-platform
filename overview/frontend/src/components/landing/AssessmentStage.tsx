import type { AssessmentSummary } from "../../api/client";

type StageTone = "progress" | "warn" | "success" | "danger";

export interface StageInfo {
  label: string;
  filled: 0 | 1 | 2 | 3 | 4;
  tone: StageTone;
}

// Four-step journey mirroring the governance assessment statuses from the
// product terminology doc (section 5.1): draft → under_review → returned →
// approved. "Returned to owner" is not a regression: the CO sent it back for
// rework, so it stays on step 3 with a warn tone. Systems without an
// assessment yet surface the registry workflow label with zero filled
// segments.
export function stageInfo(
  a: AssessmentSummary | null,
  workflowStatus: string | null,
): StageInfo {
  if (a) {
    if (a.status === "approved")
      return { label: "4. Approved", filled: 4, tone: "success" };
    if (a.status === "returned")
      return { label: "3. Returned to owner", filled: 3, tone: "warn" };
    // Backend currently also emits the legacy "submitted" status after the
    // owner clicks Submit; treat it as "Under Review" for display until the
    // backend is aligned to the terminology doc.
    if (a.status === "under_review" || a.status === "submitted")
      return { label: "2. Under Review", filled: 2, tone: "progress" };
    return { label: "1. Draft", filled: 1, tone: "progress" };
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
  const pct = Math.round((filled / 4) * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-foreground">{label}</span>
      <div
        className="flex max-w-[180px] gap-1"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} — stage ${filled} of 4`}
      >
        {[0, 1, 2, 3].map((i) => (
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
