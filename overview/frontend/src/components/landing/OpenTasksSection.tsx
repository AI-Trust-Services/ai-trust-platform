import { useMemo } from "react";
import { Eye, Inbox, Play, ArrowRight, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigateTo } from "../../hooks/useLuigi";
import {
  REGISTRY_URL,
  type AssessmentSummary,
  type OpenTaskRow,
  type UserSummary,
} from "../../api/client";
import { InitialsAvatar } from "../InitialsAvatar";
import {
  AssessmentStageCell,
  pickLatestAssessmentPerSystem,
} from "./AssessmentStage";
import type { OwnerTaskRow } from "./ownerTasks";

type LoadState = "loading" | "ready" | "error";

interface SystemGroup {
  system_id: string;
  system_name: string;
  system_version: string;
  workflow_status: string | null;
  questions: OpenTaskRow[];
  earliest_assigned_at: string;
  owner_username: string | null;
  // When all questions in the group are CO-review tasks, display + jump
  // behaviour change: no Q-numbers, click lands on the assessment detail
  // panel (not the questionnaire modal).
  is_review: boolean;
  review_assessment_id: string | null;
}

interface OpenTasksSectionProps {
  state: LoadState;
  rows: OpenTaskRow[];
  ownerTasks: OwnerTaskRow[];
  assessments: AssessmentSummary[];
  userMap: Map<string, UserSummary>;
  // Task View reuses this table on its own page: it supplies its own "Task
  // View" heading (hideHeader), the assign-date sort direction (sortDir), and
  // an onToggleSort handler that turns the "Assign date" column header into a
  // clickable sort control. All default to the landing's behaviour (fixed
  // heading, date-desc, non-clickable header) so the landing is untouched.
  hideHeader?: boolean;
  sortDir?: "asc" | "desc";
  onToggleSort?: () => void;
}

export function OpenTasksSection({
  state,
  rows,
  ownerTasks,
  assessments,
  userMap,
  hideHeader = false,
  sortDir = "desc",
  onToggleSort,
}: OpenTasksSectionProps) {
  const latestBySystem = useMemo(
    () => pickLatestAssessmentPerSystem(assessments),
    [assessments],
  );
  const assessmentsById = useMemo(() => {
    const m = new Map<string, AssessmentSummary>();
    for (const a of assessments) m.set(a.id, a);
    return m;
  }, [assessments]);

  const groups = groupBySystem(rows);
  groups.sort((a, b) => {
    const c = a.earliest_assigned_at.localeCompare(b.earliest_assigned_at);
    return sortDir === "asc" ? c : -c;
  });
  const sortedOwnerTasks = [...ownerTasks].sort((a, b) => {
    const c = a.assigned_at.localeCompare(b.assigned_at);
    return sortDir === "asc" ? c : -c;
  });
  const totalQuestions = rows.length;
  const totalOwnerTasks = ownerTasks.length;
  const totalSystems = groups.length + totalOwnerTasks;
  const hasAnything = totalQuestions > 0 || totalOwnerTasks > 0;

  return (
    <section className="flex flex-col gap-3">
      {!hideHeader && (
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-foreground">Open Tasks</h2>
          <span className="text-xs text-muted-foreground">
            {state === "ready" && hasAnything
              ? formatSummary(totalSystems, totalQuestions)
              : "No open tasks"}
          </span>
        </div>
      )}
      {state === "ready" && hasAnything ? (
        <TasksTable
          groups={groups}
          ownerTasks={sortedOwnerTasks}
          latestBySystem={latestBySystem}
          assessmentsById={assessmentsById}
          userMap={userMap}
          sortDir={sortDir}
          onToggleSort={onToggleSort}
        />
      ) : (
        <EmptyState />
      )}
    </section>
  );
}

function formatSummary(totalSystems: number, totalQuestions: number): string {
  const systemsPart = `${totalSystems} ${totalSystems === 1 ? "assessment" : "assessments"} in progress`;
  if (totalQuestions === 0) return systemsPart;
  const questionsPart = `${totalQuestions} ${totalQuestions === 1 ? "question" : "questions"} assigned to you`;
  return `${systemsPart} · ${questionsPart}`;
}

function TasksTable({
  groups,
  ownerTasks,
  latestBySystem,
  assessmentsById,
  userMap,
  sortDir,
  onToggleSort,
}: {
  groups: SystemGroup[];
  ownerTasks: OwnerTaskRow[];
  latestBySystem: Map<string, AssessmentSummary>;
  assessmentsById: Map<string, AssessmentSummary>;
  userMap: Map<string, UserSummary>;
  sortDir: "asc" | "desc";
  onToggleSort?: () => void;
}) {
  // For review groups the stage must reflect *the* assessment the CO is being
  // asked to review — not the system's latest assessment, which may already be
  // approved on a different row.
  const assessmentForGroup = (g: SystemGroup): AssessmentSummary | null => {
    if (g.is_review && g.review_assessment_id) {
      return assessmentsById.get(g.review_assessment_id) ?? null;
    }
    return latestBySystem.get(g.system_id) ?? null;
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium text-muted-foreground">
            <th className="px-4 py-3 text-left">Assigned to you</th>
            <th className="px-4 py-3 text-left">
              {onToggleSort ? (
                <button
                  type="button"
                  onClick={onToggleSort}
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Assign date
                  {sortDir === "asc" ? (
                    <ArrowUp className="size-3" />
                  ) : (
                    <ArrowDown className="size-3" />
                  )}
                </button>
              ) : (
                "Assign date"
              )}
            </th>
            <th className="px-4 py-3 text-left">AI System</th>
            <th className="px-4 py-3 text-left">Owner</th>
            <th className="px-4 py-3 text-left">Assessment stage</th>
            <th className="w-16 px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {ownerTasks.map((t) => (
            <OwnerRow key={`owner:${t.system_id}`} task={t} userMap={userMap} />
          ))}
          {groups.map((g) => (
            <TaskRow
              key={g.is_review ? `${g.system_id}:review:${g.review_assessment_id}` : g.system_id}
              group={g}
              latestAssessment={assessmentForGroup(g)}
              userMap={userMap}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OwnerRow({
  task,
  userMap,
}: {
  task: OwnerTaskRow;
  userMap: Map<string, UserSummary>;
}) {
  function openSystem() {
    sessionStorage.setItem("lastSystemPath", `/systems/${task.system_id}`);
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }
  // Both "Start" and "Continue" land in the registry's single-page assessment
  // app; its start page decides new-vs-continue. (Replaces the old compliance
  // Create-Assessment modal / questionnaire handoff, removed in #358.)
  function handlePrimary() {
    sessionStorage.setItem(
      "lastSystemPath",
      `/systems/${task.system_id}/assessment`,
    );
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }

  const label =
    task.kind === "start"
      ? "Start EU AI Act Assessment"
      : "Continue EU AI Act Assessment";
  const Icon = task.kind === "start" ? Play : ArrowRight;
  const ownerInfo = task.owner_username ? userMap.get(task.owner_username) : undefined;

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="max-w-[320px] px-4 py-3">
        <button
          type="button"
          onClick={handlePrimary}
          className="inline-flex items-center gap-2 text-left font-medium text-foreground underline underline-offset-2"
          title={label}
        >
          <Icon className="size-3.5 text-muted-foreground" />
          {label}
        </button>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {formatRelativeDate(task.assigned_at)}
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={openSystem}
          className="flex flex-col items-start text-left"
        >
          <span
            className="truncate font-medium text-foreground underline underline-offset-2"
            title={task.system_name}
          >
            {task.system_name}
          </span>
          <span className="text-xs text-muted-foreground">{task.system_id}</span>
        </button>
      </td>
      <td className="px-4 py-3">
        {task.owner_username ? (
          <div className="flex items-center gap-2">
            <InitialsAvatar
              username={task.owner_username}
              firstName={ownerInfo?.firstName}
              lastName={ownerInfo?.lastName}
              size="sm"
            />
            <span className="text-foreground">
              {ownerInfo
                ? `${ownerInfo.firstName} ${ownerInfo.lastName}`.trim() ||
                  task.owner_username
                : task.owner_username}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <AssessmentStageCell
          assessment={task.latest_assessment}
          workflowStatus={task.workflow_status}
        />
      </td>
      <td className="px-4 py-3 text-right">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={handlePrimary}
          aria-label={label}
          title={label}
        >
          <Eye className="size-4" />
        </Button>
      </td>
    </tr>
  );
}

function TaskRow({
  group,
  latestAssessment,
  userMap,
}: {
  group: SystemGroup;
  latestAssessment: AssessmentSummary | null;
  userMap: Map<string, UserSummary>;
}) {
  function openSystem() {
    // Hand off via sessionStorage.lastSystemPath — the registry MFE reads this
    // on Luigi init and navigates internally. Keeps the side-nav visible
    // because Luigi stays on the top-level /home/ai-system-registry node.
    sessionStorage.setItem("lastSystemPath", `/systems/${group.system_id}`);
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }
  // Jump the user into the registry's single-page assessment app (replaces the
  // old compliance questionnaire modal / assessment detail, removed in #358).
  //   - a per-question task → deep-link to that exact question (.../q/:key)
  //   - a review task → the assessment overview, where the CO reviews/raises issues
  const assessmentBase = `/systems/${group.system_id}/assessment`;
  function goToRegistry(path: string) {
    sessionStorage.setItem("lastSystemPath", path);
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }
  function openQuestions() {
    if (group.is_review) {
      goToRegistry(assessmentBase);
      return;
    }
    // Land on the first open question in the group; the app can page through
    // the rest from there.
    const firstKey = group.questions[0]?.question_key;
    goToRegistry(firstKey ? `${assessmentBase}/q/${firstKey}` : assessmentBase);
  }

  const labels = formatTaskLabel(group);
  const full = group.is_review
    ? labels
    : group.questions
        .map((q) => `${formatQuestionNumber(q.question_key)} · ${q.question_label}`)
        .join(" · ");
  const ownerInfo = group.owner_username
    ? userMap.get(group.owner_username)
    : undefined;

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
            <InitialsAvatar
              username={group.owner_username}
              firstName={ownerInfo?.firstName}
              lastName={ownerInfo?.lastName}
              size="sm"
            />
            <span className="text-foreground">
              {ownerInfo
                ? `${ownerInfo.firstName} ${ownerInfo.lastName}`.trim() ||
                  group.owner_username
                : group.owner_username}
            </span>
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
          onClick={openQuestions}
          aria-label={`Open ${group.system_name}`}
          title={
            group.is_review
              ? "Open assessment for review"
              : latestAssessment
                ? "Jump to question"
                : "View system detail"
          }
        >
          <Eye className="size-4" />
        </Button>
      </td>
    </tr>
  );
}

function EmptyState() {
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
    </div>
  );
}

function groupBySystem(rows: OpenTaskRow[]): SystemGroup[] {
  const map = new Map<string, SystemGroup>();
  // CO-review tasks get their own group per assessment so a CO who is also an
  // assignee on the same system still sees separate rows for each role.
  const keyFor = (row: OpenTaskRow) =>
    row.source === "review"
      ? `${row.system_id}:review:${row.assignment_id}`
      : row.system_id;
  for (const row of rows) {
    const key = keyFor(row);
    const existing = map.get(key);
    if (existing) {
      existing.questions.push(row);
      if (row.assigned_at < existing.earliest_assigned_at) {
        existing.earliest_assigned_at = row.assigned_at;
      }
    } else {
      map.set(key, {
        system_id: row.system_id,
        system_name: row.system_name,
        system_version: row.system_version,
        workflow_status: row.workflow_status,
        questions: [row],
        earliest_assigned_at: row.assigned_at,
        owner_username: row.owner_username,
        is_review: row.source === "review",
        review_assessment_id:
          row.source === "review" ? row.assignment_id ?? null : null,
      });
    }
  }
  // Sort each group's questions by their Q-number so the preview reads
  // "Q2, Q4, Q7" in order rather than in assignment order. Review groups
  // have no Q-numbers so skip the sort.
  for (const g of map.values()) {
    if (g.is_review) continue;
    g.questions.sort(
      (a, b) =>
        questionIndex(a.question_key) - questionIndex(b.question_key),
    );
  }
  return Array.from(map.values()).sort((a, b) =>
    b.earliest_assigned_at.localeCompare(a.earliest_assigned_at),
  );
}

function formatTaskLabel(group: SystemGroup): string {
  if (group.is_review) {
    // Short, action-oriented label matching the Title Case used by the owner
    // rows ("Start / Continue EU AI Act Assessment"). The AI System column
    // already names the system, so we don't repeat the assessment title here.
    return "Start Review";
  }
  return formatQuestionLabels(group.questions);
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
