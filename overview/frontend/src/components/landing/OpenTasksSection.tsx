import { useMemo } from "react";
import { Eye, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigateTo } from "../../hooks/useLuigi";
import {
  COMPLIANCE_URL,
  REGISTRY_URL,
  type AssessmentSummary,
  type OpenTaskRow,
} from "../../api/client";
import { InitialsAvatar } from "../InitialsAvatar";
import {
  AssessmentStageCell,
  pickLatestAssessmentPerSystem,
} from "./AssessmentStage";

type LoadState = "loading" | "ready" | "error";

interface SystemGroup {
  system_id: string;
  system_name: string;
  system_version: string;
  workflow_status: string | null;
  questions: OpenTaskRow[];
  earliest_assigned_at: string;
  owner_username: string | null;
}

interface OpenTasksSectionProps {
  state: LoadState;
  rows: OpenTaskRow[];
  assessments: AssessmentSummary[];
}

export function OpenTasksSection({ state, rows, assessments }: OpenTasksSectionProps) {
  const latestBySystem = useMemo(
    () => pickLatestAssessmentPerSystem(assessments),
    [assessments],
  );

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
        <TasksTable groups={groups} latestBySystem={latestBySystem} />
      ) : (
        <EmptyState />
      )}
    </section>
  );
}

function TasksTable({
  groups,
  latestBySystem,
}: {
  groups: SystemGroup[];
  latestBySystem: Map<string, AssessmentSummary>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium text-muted-foreground">
            <th className="px-4 py-3 text-left">Assigned to you</th>
            <th className="px-4 py-3 text-left">Assign date</th>
            <th className="px-4 py-3 text-left">AI System</th>
            <th className="px-4 py-3 text-left">Owner</th>
            <th className="px-4 py-3 text-left">Assessment stage</th>
            <th className="w-16 px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <TaskRow
              key={g.system_id}
              group={g}
              latestAssessment={latestBySystem.get(g.system_id) ?? null}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({
  group,
  latestAssessment,
}: {
  group: SystemGroup;
  latestAssessment: AssessmentSummary | null;
}) {
  function openSystem() {
    // Hand the target system id to the registry MFE via localStorage so Luigi
    // stays on the top-level /home/ai-system-registry node (deeper routes make
    // Luigi drop the side-nav).
    localStorage.setItem(
      "registry.openSystem",
      JSON.stringify({ systemId: group.system_id }),
    );
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }
  function openQuestions() {
    // Deep-link into the system detail; it opens with the questionnaire
    // visible. For an explicit per-question assignment the registry already
    // scrolls to the pending question via its own navigation state.
    openSystem();
  }
  function openAssessment() {
    if (!latestAssessment) {
      openSystem();
      return;
    }
    localStorage.setItem(
      "compliance.viewSystem",
      JSON.stringify({ systemId: group.system_id, systemName: group.system_name }),
    );
    localStorage.setItem(
      "compliance.openAssessment",
      JSON.stringify({ assessmentId: latestAssessment.id }),
    );
    navigateTo("/home/assessments", COMPLIANCE_URL);
  }

  const labels = formatQuestionLabels(group.questions);
  const full = group.questions
    .map((q) => `${formatQuestionNumber(q.question_key)} · ${q.question_label}`)
    .join(" · ");

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="max-w-[320px] px-4 py-3">
        <button
          type="button"
          onClick={openQuestions}
          className="block w-full truncate text-left text-foreground underline underline-offset-2"
          title={full}
        >
          {labels}
        </button>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {formatRelativeDate(group.earliest_assigned_at)}
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={openSystem}
          className="flex flex-col items-start text-left"
        >
          <span
            className="truncate font-medium text-foreground underline underline-offset-2"
            title={group.system_name}
          >
            {group.system_name}
          </span>
          <span className="text-xs text-muted-foreground">
            {group.system_id} · v{group.system_version}
          </span>
        </button>
      </td>
      <td className="px-4 py-3">
        {group.owner_username ? (
          <div className="flex items-center gap-2">
            <InitialsAvatar username={group.owner_username} size="sm" />
            <span className="text-foreground">{group.owner_username}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <AssessmentStageCell
          assessment={latestAssessment}
          workflowStatus={group.workflow_status}
        />
      </td>
      <td className="px-4 py-3 text-right">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={openAssessment}
          aria-label={`Open ${group.system_name}`}
          title={latestAssessment ? "Open assessment" : "View system detail"}
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
      }
    } else {
      map.set(row.system_id, {
        system_id: row.system_id,
        system_name: row.system_name,
        system_version: row.system_version,
        workflow_status: row.workflow_status,
        questions: [row],
        earliest_assigned_at: row.assigned_at,
        owner_username: row.owner_username,
      });
    }
  }
  // Sort each group's questions by their Q-number so the preview reads
  // "Q2, Q4, Q7" in order rather than in assignment order.
  for (const g of map.values()) {
    g.questions.sort(
      (a, b) =>
        questionIndex(a.question_key) - questionIndex(b.question_key),
    );
  }
  return Array.from(map.values()).sort((a, b) =>
    b.earliest_assigned_at.localeCompare(a.earliest_assigned_at),
  );
}

function formatQuestionLabels(questions: OpenTaskRow[]): string {
  if (questions.length === 1) {
    const q = questions[0];
    return `${formatQuestionNumber(q.question_key)} · ${q.question_label}`;
  }
  // Multiple questions: show "Q2, Q4, Q7, Q8…" compactly.
  const nums = questions.map((q) => formatQuestionNumber(q.question_key));
  return `${nums.join(", ")}…`;
}

// Ordered question keys mirror the registry questionnaire. Business questions
// take Q1–Q10, AI-mode technical questions Q11–Q17. Keeping this list local to
// the overview MFE is a deliberate duplication of the registry's REQUIRED_* —
// if a key is missing here it just renders as "Q?", which degrades gracefully.
const QUESTION_ORDER: readonly string[] = [
  // Business (REQUIRED_BUSINESS in questionnaire_required.py)
  "submission_type",
  "use_case_owner",
  "use_case_type",
  "department",
  "technologies",
  "use_case_status",
  "use_case",
  "planned_modifications",
  "exception_category",
  "sector_legislation",
  // Technical AI (REQUIRED_AI_TECHNICAL)
  "data_and_inputs",
  "decision_domain",
  "automation_and_oversight",
  "affected_people",
  "model_nature",
  "user_interaction",
  "prohibited_practices",
];

function questionIndex(key: string): number {
  const i = QUESTION_ORDER.indexOf(key);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

function formatQuestionNumber(key: string): string {
  const i = QUESTION_ORDER.indexOf(key);
  return i === -1 ? "Q?" : `Q${i + 1}`;
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
