import type { AssessmentSummary } from "../../api/client";

type StageTone = "progress" | "warn" | "success" | "danger";

export interface StageInfo {
  label: string;
  filled: 0 | 1 | 2 | 3 | 4;
  tone: StageTone;
}

// Four-step journey mirroring the SystemDetailPage "EU AI Act Progress" stepper.
// Stage N maps to N filled progress segments:
//   1. Register AI system          — system exists, no compliance assessment yet
//   2. Draft assessment started    — compliance assessment created but not submitted
//   3. Assessment under review     — submitted to the CO (progress tone), or
//                                    returned by the CO for rework (warn tone)
//   4. Risk classification approved — CO approved
// Legacy registry workflow statuses (classification rejected etc.) still get a
// danger-toned fallback so terminal failures remain visible.
export function stageInfo(
  a: AssessmentSummary | null,
  workflowStatus: string | null,
): StageInfo {
  if (a) {
    if (a.status === "approved")
      return { label: "4. Risk classification approved", filled: 4, tone: "success" };
    if (a.status === "returned")
      return { label: "3. Assessment under review", filled: 3, tone: "warn" };
    if (
      a.status === "under_review" ||
      a.status === "submitted" ||
      a.status === "pending_review"
    )
      return { label: "3. Assessment under review", filled: 3, tone: "progress" };
    return { label: "2. Draft assessment started", filled: 2, tone: "progress" };
  }
  if (workflowStatus === "rejected")
    return { label: "Classification rejected", filled: 1, tone: "danger" };
  return { label: "1. Register AI system", filled: 1, tone: "progress" };
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
