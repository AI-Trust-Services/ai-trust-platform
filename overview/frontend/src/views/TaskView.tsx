import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Eye,
  Inbox,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  api,
  COMPLIANCE_URL,
  REGISTRY_URL,
  type AssessmentSummary,
  type OpenTaskRow,
  type UserSummary,
} from "../api/client";
import { navigateTo } from "../hooks/useLuigi";
import { InitialsAvatar } from "../components/InitialsAvatar";
import {
  AssessmentStageCell,
  pickLatestAssessmentPerSystem,
} from "../components/landing/AssessmentStage";

type LoadState = "loading" | "ready" | "error";
type SortDir = "asc" | "desc";

/**
 * One AI system's bundle of open questions for the current user — the
 * grouped row the Task View renders. Mirrors the landing's Open Tasks
 * grouping so the two views read consistently.
 */
interface SystemGroup {
  system_id: string;
  system_name: string;
  system_version: string;
  workflow_status: string | null;
  owner_username: string | null;
  questions: OpenTaskRow[]; // sorted by questionnaire order
  earliest_assigned_at: string;
}

/**
 * Task View (issue #276) — a standalone, nav-accessible page listing the
 * questionnaire tasks the current user owns, grouped per AI system (one row
 * per system, "Q2, Q4, Q7…" stacked) exactly like the landing's Open Tasks
 * section — but as a dedicated page with AI-system / Owner filters and a
 * sortable assign date.
 *
 * Scope: the `required` (user is the active section assignee, question still
 * unanswered) and `assigned` (explicit per-question delegation) sources from
 * GET /me/open-tasks. `review` rows (CO approval tasks) are excluded — they
 * are not questions and live in the compliance-officer landing's queue.
 */
export default function TaskView() {
  const [state, setState] = useState<LoadState>("loading");
  const [rows, setRows] = useState<OpenTaskRow[]>([]);
  const [assessments, setAssessments] = useState<AssessmentSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);

  const [systemSel, setSystemSel] = useState<Set<string>>(new Set());
  const [ownerSel, setOwnerSel] = useState<Set<string>>(new Set());
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    Promise.all([
      api.myOpenTasks(),
      api.allAssessments().catch(() => [] as AssessmentSummary[]),
      api.allUsers().catch(() => [] as UserSummary[]),
    ])
      .then(([tasks, allAssessments, allUsers]) => {
        // assigned + required only; review tasks belong to the CO queue.
        setRows(
          tasks.filter(
            (t) => t.source === "assigned" || t.source === "required",
          ),
        );
        setAssessments(allAssessments);
        setUsers(allUsers);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  const userMap = useMemo(() => {
    const m = new Map<string, UserSummary>();
    for (const u of users) m.set(u.username, u);
    return m;
  }, [users]);

  const latestBySystem = useMemo(
    () => pickLatestAssessmentPerSystem(assessments),
    [assessments],
  );

  // Filter options are derived from the rows themselves, so the dropdowns only
  // ever offer values that actually appear.
  const systemOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (!m.has(r.system_id)) m.set(r.system_id, r.system_name);
    return [...m.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const ownerOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const r of rows) {
      const u = r.owner_username;
      if (!u || seen.has(u)) continue;
      seen.add(u);
      const info = userMap.get(u);
      out.push({ value: u, label: info ? fullName(info, u) : u });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, userMap]);

  const visibleGroups = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (systemSel.size > 0 && !systemSel.has(r.system_id)) return false;
      if (ownerSel.size > 0 && !(r.owner_username && ownerSel.has(r.owner_username)))
        return false;
      return true;
    });
    const groups = groupBySystem(filtered);
    groups.sort((a, b) => {
      const cmp = a.earliest_assigned_at.localeCompare(b.earliest_assigned_at);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return groups;
  }, [rows, systemSel, ownerSel, sortDir]);

  const filtersActive = systemSel.size > 0 || ownerSel.size > 0;
  function resetFilters() {
    setSystemSel(new Set());
    setOwnerSel(new Set());
  }

  return (
    <main className="min-h-screen bg-[#f6f7fb]">
      <div className="flex w-full max-w-[1600px] flex-col gap-6 px-4 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-[-0.02em]">Task View</h1>
          <p className="text-sm text-muted-foreground">
            Every assessment question assigned to you, grouped by AI system.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            label={filterLabel("All AI systems", systemSel, systemOptions)}
            options={systemOptions}
            selected={systemSel}
            onToggle={(v) => setSystemSel((s) => toggle(s, v))}
          />
          <FilterDropdown
            label={filterLabel("All owners", ownerSel, ownerOptions)}
            options={ownerOptions}
            selected={ownerSel}
            onToggle={(v) => setOwnerSel((s) => toggle(s, v))}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            disabled={!filtersActive}
            title="Reset filters"
            className="gap-1.5 text-muted-foreground"
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        </div>

        {state === "loading" && <TableSkeleton />}
        {state === "error" && (
          <div className="rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-6 py-4 text-sm text-[var(--danger-fg)]">
            Failed to load your tasks. Please retry in a moment.
          </div>
        )}
        {state === "ready" &&
          (visibleGroups.length === 0 ? (
            <EmptyState filtersActive={filtersActive} />
          ) : (
            <TasksTable
              groups={visibleGroups}
              latestBySystem={latestBySystem}
              userMap={userMap}
              sortDir={sortDir}
              onToggleSort={() =>
                setSortDir((d) => (d === "asc" ? "desc" : "asc"))
              }
            />
          ))}
      </div>
    </main>
  );
}

function TasksTable({
  groups,
  latestBySystem,
  userMap,
  sortDir,
  onToggleSort,
}: {
  groups: SystemGroup[];
  latestBySystem: Map<string, AssessmentSummary>;
  userMap: Map<string, UserSummary>;
  sortDir: SortDir;
  onToggleSort: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium text-muted-foreground">
            <th className="px-4 py-3 text-left">Assigned to you</th>
            <th className="px-4 py-3 text-left">
              <SortButton dir={sortDir} onClick={onToggleSort}>
                Assign date
              </SortButton>
            </th>
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
              userMap={userMap}
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
  userMap,
}: {
  group: SystemGroup;
  latestAssessment: AssessmentSummary | null;
  userMap: Map<string, UserSummary>;
}) {
  function openSystem() {
    sessionStorage.setItem("lastSystemPath", `/systems/${group.system_id}`);
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }
  // Open the questionnaire so the user can answer. `fromDelegate` bypasses the
  // technical-pending gate for per-question delegates (any `assigned` row in
  // the group); section owners are the assignee anyway. No assessment yet →
  // fall back to the system detail.
  function openQuestions() {
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
      JSON.stringify({
        assessmentId: latestAssessment.id,
        questionnaire: true,
        fromDelegate: group.questions.some((q) => q.source === "assigned"),
      }),
    );
    navigateTo("/home/assessments", COMPLIANCE_URL);
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

  const label = formatQuestionLabels(group.questions);
  const full = group.questions
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
          className="block w-full truncate text-left font-medium text-foreground underline underline-offset-2"
          title={full}
        >
          {label}
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
              {ownerInfo ? fullName(ownerInfo, group.owner_username) : group.owner_username}
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
          onClick={openAssessment}
          aria-label={`Open assessment for ${group.system_name}`}
          title={latestAssessment ? "Open assessment" : "View system detail"}
        >
          <Eye className="size-4" />
        </Button>
      </td>
    </tr>
  );
}

function FilterDropdown({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { label: string; value: string }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-1">
          {label} <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        {options.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            No options
          </div>
        ) : (
          options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.value}
              checked={selected.has(o.value)}
              onCheckedChange={() => onToggle(o.value)}
              onSelect={(e) => e.preventDefault()}
            >
              {o.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortButton({
  dir,
  onClick,
  children,
}: {
  dir: SortDir;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const Icon = dir === "asc" ? ArrowUp : ArrowDown;
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

function EmptyState({ filtersActive }: { filtersActive: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Inbox className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">
          {filtersActive ? "No tasks match these filters" : "No tasks assigned to you"}
        </h3>
        <p className="max-w-md text-xs text-muted-foreground">
          {filtersActive
            ? "Try clearing the AI-system or owner filters."
            : "When a question in an AI System assessment is assigned to you, or a section you own still has open questions, it'll appear here."}
        </p>
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-col divide-y divide-border">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-4">
            <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── grouping + small helpers ─────────────────────────────────────────────────

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
        owner_username: row.owner_username,
        questions: [row],
        earliest_assigned_at: row.assigned_at,
      });
    }
  }
  // Order each group's questions by questionnaire order so the preview reads
  // "Q2, Q4, Q7" rather than in assignment order.
  for (const g of map.values()) {
    g.questions.sort(
      (a, b) => questionIndex(a.question_key) - questionIndex(b.question_key),
    );
  }
  return [...map.values()];
}

function fullName(u: UserSummary, fallback: string): string {
  return `${u.firstName} ${u.lastName}`.trim() || fallback;
}

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function filterLabel(
  defaultLabel: string,
  sel: Set<string>,
  options: { label: string; value: string }[],
): string {
  if (sel.size === 0) return defaultLabel;
  if (sel.size === 1)
    return options.find((o) => o.value === [...sel][0])?.label ?? defaultLabel;
  return `${defaultLabel} (${sel.size})`;
}

function formatQuestionLabels(questions: OpenTaskRow[]): string {
  if (questions.length === 1) {
    const q = questions[0];
    return `${formatQuestionNumber(q.question_key)} · ${q.question_label}`;
  }
  // Multiple: compact "Q2, Q4, Q7…".
  return `${questions.map((q) => formatQuestionNumber(q.question_key)).join(", ")}…`;
}

// Ordered question keys mirror the registry questionnaire — a deliberate
// duplication of OpenTasksSection's list (and the backend's REQUIRED_*). A key
// missing here just renders as "Q?", which degrades gracefully.
const QUESTION_ORDER: readonly string[] = [
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
  const diffDays = Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  const months = Math.floor(diffDays / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}
