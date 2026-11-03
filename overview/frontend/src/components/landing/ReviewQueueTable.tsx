import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Eye, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  COMPLIANCE_URL,
  type OpenTaskRow,
  type UserSummary,
} from "../../api/client";
import { navigateTo } from "../../hooks/useLuigi";
import { InitialsAvatar } from "../InitialsAvatar";
import { TierBadge } from "../TierBadge";
import type { TierKey } from "../../types";

interface ReviewQueueTableProps {
  rows: OpenTaskRow[];
  userMap: Map<string, UserSummary>;
}

type SortKey = "submitted" | "rollout" | "risk";
type SortDir = "asc" | "desc";

// Risk ordering per issue #345: Prohibited → High+Transparency → High →
// Transparency → Minimal → anything else. Stacked (high + Art. 50 flag) ranks
// one slot above plain high.
const TIER_RANK: Record<string, number> = {
  prohibited: 0,
  high: 2,
  "gpai-systemic": 2,
  "gpai-standard": 2,
  limited: 3,
  minimal: 4,
  pending: 5,
};

function riskRank(row: OpenTaskRow): number {
  const base = TIER_RANK[row.tier ?? ""] ?? 99;
  if (
    row.tier === "high" &&
    (row.is_chatbot || row.generates_synthetic_content)
  ) {
    return 1; // high + transparency sits between prohibited and plain high
  }
  return base;
}

/** Narrow filter — the backend already restricts review rows to this CO, but
 *  this component accepts the full open-tasks list for API-call reuse. */
function pickReviewRows(rows: OpenTaskRow[]): OpenTaskRow[] {
  return rows.filter((r) => r.source === "review");
}

export function ReviewQueueTable({ rows, userMap }: ReviewQueueTableProps) {
  const reviewRows = useMemo(() => pickReviewRows(rows), [rows]);
  const [sortKey, setSortKey] = useState<SortKey>("submitted");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sortedRows = useMemo(() => {
    const copy = reviewRows.slice();
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "submitted") {
        cmp = new Date(a.assigned_at).getTime() - new Date(b.assigned_at).getTime();
      } else if (sortKey === "rollout") {
        const aTime = a.planned_rollout_date
          ? new Date(a.planned_rollout_date).getTime()
          : Number.POSITIVE_INFINITY;
        const bTime = b.planned_rollout_date
          ? new Date(b.planned_rollout_date).getTime()
          : Number.POSITIVE_INFINITY;
        cmp = aTime - bTime;
      } else {
        cmp = riskRank(a) - riskRank(b);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [reviewRows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "risk" ? "asc" : "desc");
    }
  }

  function openAssessment(row: OpenTaskRow) {
    if (!row.assignment_id) return;
    localStorage.setItem(
      "compliance.viewSystem",
      JSON.stringify({ systemId: row.system_id, systemName: row.system_name }),
    );
    localStorage.setItem(
      "compliance.openAssessment",
      JSON.stringify({ assessmentId: row.assignment_id }),
    );
    navigateTo("/home/assessments", COMPLIANCE_URL);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Ready for review</h2>
      {sortedRows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">AI System</th>
                <th className="px-4 py-3">
                  <SortButton
                    active={sortKey === "submitted"}
                    dir={sortDir}
                    onClick={() => toggleSort("submitted")}
                  >
                    Submission date
                  </SortButton>
                </th>
                <th className="px-4 py-3">
                  <SortButton
                    active={sortKey === "rollout"}
                    dir={sortDir}
                    onClick={() => toggleSort("rollout")}
                  >
                    Planned rollout
                  </SortButton>
                </th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">
                  <SortButton
                    active={sortKey === "risk"}
                    dir={sortDir}
                    onClick={() => toggleSort("risk")}
                  >
                    Risk classification
                  </SortButton>
                </th>
                <th className="w-16 px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr
                  key={`${row.system_id}:${row.assignment_id}`}
                  className="border-b border-border last:border-b-0 hover:bg-muted/30"
                >
                  <td className="max-w-[260px] px-4 py-3">
                    <button
                      type="button"
                      onClick={() => openAssessment(row)}
                      className="flex flex-col items-start text-left"
                    >
                      <span
                        className="truncate font-medium text-foreground underline underline-offset-2"
                        title={row.system_name}
                      >
                        {row.system_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {row.system_id} · v{row.system_version}
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">
                    {formatRelative(row.assigned_at)}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">
                    {formatRollout(row.planned_rollout_date)}
                  </td>
                  <td className="px-4 py-3">
                    <OwnerCell
                      username={row.owner_username}
                      userMap={userMap}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {row.tier ? (
                      <TierBadge
                        tier={row.tier as TierKey}
                        workflowStatus={row.workflow_status ?? undefined}
                        isChatbot={!!row.is_chatbot}
                        generatesSyntheticContent={
                          !!row.generates_synthetic_content
                        }
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => openAssessment(row)}
                      aria-label={`Review assessment for ${row.system_name}`}
                      title="Review assessment"
                    >
                      <Eye className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SortButton({
  active,
  dir,
  onClick,
  children,
}: {
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      {children}
      <Icon className="size-3" />
    </button>
  );
}

function OwnerCell({
  username,
  userMap,
}: {
  username: string | null;
  userMap: Map<string, UserSummary>;
}) {
  if (!username) {
    return <span className="text-xs text-muted-foreground">Unassigned</span>;
  }
  const u = userMap.get(username);
  const full = u ? `${u.firstName} ${u.lastName}`.trim() || username : username;
  return (
    <div className="flex items-center gap-2">
      <InitialsAvatar
        firstName={u?.firstName}
        lastName={u?.lastName}
        username={username}
        size="sm"
      />
      <span className="text-sm text-foreground">{full}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
      <Inbox className="size-6 text-muted-foreground/60" />
      <span>No assessments waiting for your review.</span>
    </div>
  );
}

// ─── Date formatters ────────────────────────────────────────────────────────
// Submission date: always a relative label ("3 days ago"). Planned rollout:
// relative when ≤ ~1 month out, absolute otherwise — matches the issue spec.
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const days = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function formatRollout(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = then - Date.now();
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000));
  // Within ~1 month in the future → relative; past or far-future → absolute.
  if (days >= 0 && days <= 31) {
    if (days === 0) return "today";
    if (days === 1) return "in 1 day";
    if (days < 14) return `in ${days} days`;
    const weeks = Math.round(days / 7);
    return `in ${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
