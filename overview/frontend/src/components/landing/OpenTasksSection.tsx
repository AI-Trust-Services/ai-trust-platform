import { useEffect, useState } from "react";
import { Eye, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigateTo } from "../../hooks/useLuigi";
import { REGISTRY_URL, api, type OpenTaskRow } from "../../api/client";
import { InitialsAvatar } from "../InitialsAvatar";

type LoadState = "loading" | "ready" | "error";

interface SystemGroup {
  system_id: string;
  system_name: string;
  workflow_status: string | null;
  questions: OpenTaskRow[];
  earliest_assigned_at: string;
  assigned_by_username: string | null;
}

export function OpenTasksSection() {
  const [state, setState] = useState<LoadState>("loading");
  const [rows, setRows] = useState<OpenTaskRow[]>([]);

  useEffect(() => {
    api
      .myOpenTasks()
      .then((r) => {
        setRows(r);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  const groups = groupBySystem(rows);
  const totalQuestions = rows.length;
  const totalSystems = groups.length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">Open Tasks</h2>
        <span className="text-xs text-muted-foreground">
          {state === "ready" && totalQuestions > 0
            ? `${totalSystems} ${totalSystems === 1 ? "assessment" : "assessments"} in progress · ${totalQuestions} ${totalQuestions === 1 ? "question" : "questions"} assigned to you`
            : "No questions assigned to you"}
        </span>
      </div>
      {state === "ready" && groups.length > 0 ? (
        <TasksTable groups={groups} />
      ) : (
        <EmptyState />
      )}
    </section>
  );
}

function TasksTable({ groups }: { groups: SystemGroup[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium text-muted-foreground">
            <th className="px-4 py-3 text-left">Assigned to you</th>
            <th className="px-4 py-3 text-left">Assign date</th>
            <th className="px-4 py-3 text-left">AI System</th>
            <th className="px-4 py-3 text-left">Assigned by</th>
            <th className="px-4 py-3 text-left">Workflow status</th>
            <th className="w-16 px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <TaskRow key={g.system_id} group={g} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({ group }: { group: SystemGroup }) {
  function handleOpen() {
    navigateTo(
      `/home/ai-system-registry/systems/${group.system_id}`,
      `${REGISTRY_URL}#/systems/${group.system_id}`,
    );
  }

  const labels = group.questions.map((q) => q.question_label);
  const full = labels.join(" · ");
  const shown =
    labels.length > 3
      ? `${labels.slice(0, 3).join(" · ")}  + ${labels.length - 3} more`
      : full;

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="max-w-[320px] px-4 py-3">
        <div className="truncate text-foreground" title={full}>
          {shown}
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {formatRelativeDate(group.earliest_assigned_at)}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{group.system_name}</span>
          <span className="text-xs text-muted-foreground">{group.system_id}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        {group.assigned_by_username ? (
          <div className="flex items-center gap-2">
            <InitialsAvatar username={group.assigned_by_username} size="sm" />
            <span className="text-foreground">{group.assigned_by_username}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="text-foreground">
          {formatWorkflowStatus(group.workflow_status)}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleOpen}
          aria-label={`Open ${group.system_name}`}
          title={`Open ${group.system_name}`}
        >
          <Eye className="size-4" />
        </Button>
      </td>
    </tr>
  );
}

function EmptyState() {
  function handleViewSystems() {
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Inbox className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">
          No tasks assigned to you
        </h3>
        <p className="max-w-md text-xs text-muted-foreground">
          You haven&apos;t been assigned any questions in an AI System assessment yet.
          When a colleague assigns you a question, it&apos;ll appear here.
        </p>
      </div>
      <Button variant="outline" onClick={handleViewSystems}>
        View all AI Systems
      </Button>
    </div>
  );
}

function groupBySystem(rows: OpenTaskRow[]): SystemGroup[] {
  const map = new Map<string, SystemGroup>();
  for (const row of rows) {
    const existing = map.get(row.system_id);
    if (existing) {
      existing.questions.push(row);
      if (row.assigned_at < existing.earliest_assigned_at) {
        existing.earliest_assigned_at = row.assigned_at;
        existing.assigned_by_username = row.assigned_by_username;
      }
    } else {
      map.set(row.system_id, {
        system_id: row.system_id,
        system_name: row.system_name,
        workflow_status: row.workflow_status,
        questions: [row],
        earliest_assigned_at: row.assigned_at,
        assigned_by_username: row.assigned_by_username,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    b.earliest_assigned_at.localeCompare(a.earliest_assigned_at),
  );
}

function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return "1 month ago";
  return `${diffMonths} months ago`;
}

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  business_pending: "Awaiting owner",
  technical_pending: "Awaiting engineer",
  pending_review: "Awaiting review",
  info_requested: "Info requested",
  approved: "Approved",
  rejected: "Rejected",
};

function formatWorkflowStatus(status: string | null): string {
  if (!status) return "—";
  return WORKFLOW_STATUS_LABELS[status] ?? status;
}
