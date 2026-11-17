import type {
  AssessmentSummary,
  MySystemRow,
  OpenTaskRow,
} from "../../api/client";

export interface OwnerTaskRow {
  kind: "start" | "continue";
  system_id: string;
  system_name: string;
  system_version: string;
  workflow_status: string | null;
  owner_username: string | null;
  assigned_at: string;
  latest_assessment: AssessmentSummary | null;
}

// Assessment states where the ball is on the compliance officer's court. While
// in these states the owner has nothing to drive — the CO alone must act — so
// the owner sees no Open Task for this system. The CO's own "Review" task
// (source="review") is the single task for these states.
const AWAITING_CO_STATUSES: ReadonlySet<string> = new Set([
  "submitted",
  "under_review",
  "pending_review",
]);

// Owner tasks are system-level: an owner drives the process forward and does
// not self-assign individual questions. One row per owned system that has an
// unfinished EU AI Act journey (no assessment yet, or an assessment that has
// not been approved and is not currently awaiting CO review). Approved systems
// emit nothing.
export function deriveOwnerTasks(
  mySystems: MySystemRow[],
  assessments: AssessmentSummary[],
): OwnerTaskRow[] {
  const latestByAiSystem = new Map<string, AssessmentSummary>();
  for (const a of assessments) {
    const existing = latestByAiSystem.get(a.ai_system_id);
    if (!existing || a.created_at > existing.created_at) {
      latestByAiSystem.set(a.ai_system_id, a);
    }
  }
  const rows: OwnerTaskRow[] = [];
  for (const s of mySystems) {
    const latest = latestByAiSystem.get(s.id) ?? null;
    if (latest?.status === "approved") continue;
    if (latest && AWAITING_CO_STATUSES.has(latest.status)) continue;
    const kind: "start" | "continue" = latest === null ? "start" : "continue";
    const assigned_at =
      (latest?.updated_at ?? latest?.created_at) ||
      s.updated_at ||
      s.created_at ||
      new Date().toISOString();
    rows.push({
      kind,
      system_id: s.id,
      system_name: s.name,
      system_version: "", // registry's MySystemRow has no version — not shown for owner rows
      workflow_status: s.workflow_status,
      owner_username: s.business_owners,
      assigned_at,
      latest_assessment: latest,
    });
  }
  return rows.sort((a, b) => b.assigned_at.localeCompare(a.assigned_at));
}

// Owner-level tasks replace the per-question / self-assigned rows an owner
// would otherwise see for the same system — a user who is both owner and
// section-assignee should drive the whole process, not self-assign individual
// questions. CO review rows pass through: a CO is almost never the owner
// (separation of duties), but filtering by `source` keeps the invariant
// explicit instead of relying on it.
export function filterContributorTasksForOwner(
  openTasks: OpenTaskRow[],
  ownedSystemIds: Set<string>,
): OpenTaskRow[] {
  return openTasks.filter(
    (t) => t.source === "review" || !ownedSystemIds.has(t.system_id),
  );
}
