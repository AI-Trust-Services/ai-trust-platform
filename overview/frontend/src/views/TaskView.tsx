import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  api,
  type AssessmentSummary,
  type MySystemRow,
  type OpenTaskRow,
  type UserSummary,
} from "../api/client";
import { OpenTasksSection } from "../components/landing/OpenTasksSection";
import {
  deriveOwnerTasks,
  filterContributorTasksForOwner,
} from "../components/landing/ownerTasks";

type LoadState = "loading" | "ready" | "error";
type SortDir = "asc" | "desc";

/**
 * Task View (issue #276) — a standalone, nav-accessible page listing the
 * current user's open questionnaire tasks.
 *
 * It reuses the landing's `OpenTasksSection` verbatim so the behaviour matches
 * the Overview page exactly: for AI systems the user *owns*, the rows collapse
 * to system-level "Start / Continue EU AI Act Assessment" actions
 * (`deriveOwnerTasks`); questions appear as grouped rows only for systems the
 * user does not own (`filterContributorTasksForOwner`). On top of that shared
 * table, this page adds a "Task View" header, AI-system / Owner filters, an
 * assign-date sort control, and a Refresh (reset-filters) button.
 *
 * Scope: the `required` + `assigned` sources of `/me/open-tasks`. CO `review`
 * rows are excluded — they live in the compliance-officer landing's queue.
 */
export default function TaskView() {
  const [state, setState] = useState<LoadState>("loading");
  const [openTasks, setOpenTasks] = useState<OpenTaskRow[]>([]);
  const [mySystems, setMySystems] = useState<MySystemRow[]>([]);
  const [assessments, setAssessments] = useState<AssessmentSummary[]>([]);
  const [assessmentsFailed, setAssessmentsFailed] = useState(false);
  const [users, setUsers] = useState<UserSummary[]>([]);

  const [systemSel, setSystemSel] = useState<Set<string>>(new Set());
  const [ownerSel, setOwnerSel] = useState<Set<string>>(new Set());
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    // /me/open-tasks + /me/systems are the page's success condition; a failed
    // assessments fetch only costs the stage column + quick-open id, so keep it
    // resilient but track the failure to warn the user honestly (see notice).
    let assessmentsOk = true;
    Promise.all([
      api.myOpenTasks(),
      api.mySystems().catch(() => [] as MySystemRow[]),
      api.allAssessments().catch(() => {
        assessmentsOk = false;
        return [] as AssessmentSummary[];
      }),
      api.allUsers().catch(() => [] as UserSummary[]),
    ])
      .then(([tasks, systems, allAssessments, allUsers]) => {
        // assigned + required only; review tasks belong to the CO queue.
        setOpenTasks(
          tasks.filter(
            (t) => t.source === "assigned" || t.source === "required",
          ),
        );
        setMySystems(systems);
        setAssessments(allAssessments);
        setUsers(allUsers);
        setAssessmentsFailed(!assessmentsOk);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  const userMap = useMemo(() => {
    const m = new Map<string, UserSummary>();
    for (const u of users) m.set(u.username, u);
    return m;
  }, [users]);

  // Owner logic, identical to the landing: owned systems become system-level
  // Start/Continue rows; question rows remain only for non-owned systems.
  const ownerTasks = useMemo(
    () => deriveOwnerTasks(mySystems, assessments),
    [mySystems, assessments],
  );
  const contributorTasks = useMemo(() => {
    const ownedIds = new Set(mySystems.map((s) => s.id));
    return filterContributorTasksForOwner(openTasks, ownedIds);
  }, [openTasks, mySystems]);

  // Filter options are derived from the rows actually shown (owner + question
  // rows), so the dropdowns never offer values that aren't present.
  const systemOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of ownerTasks) if (!m.has(t.system_id)) m.set(t.system_id, t.system_name);
    for (const r of contributorTasks) if (!m.has(r.system_id)) m.set(r.system_id, r.system_name);
    return [...m.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [ownerTasks, contributorTasks]);

  const ownerOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    const add = (u: string | null) => {
      if (!u || seen.has(u)) return;
      seen.add(u);
      const info = userMap.get(u);
      out.push({ value: u, label: info ? fullName(info, u) : u });
    };
    for (const t of ownerTasks) add(t.owner_username);
    for (const r of contributorTasks) add(r.owner_username);
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [ownerTasks, contributorTasks, userMap]);

  const matches = (systemId: string, owner: string | null) =>
    (systemSel.size === 0 || systemSel.has(systemId)) &&
    (ownerSel.size === 0 || (!!owner && ownerSel.has(owner)));

  const filteredOwnerTasks = useMemo(
    () => ownerTasks.filter((t) => matches(t.system_id, t.owner_username)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownerTasks, systemSel, ownerSel],
  );
  const filteredContributorTasks = useMemo(
    () => contributorTasks.filter((r) => matches(r.system_id, r.owner_username)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contributorTasks, systemSel, ownerSel],
  );

  const filtersActive = systemSel.size > 0 || ownerSel.size > 0;
  function resetFilters() {
    setSystemSel(new Set());
    setOwnerSel(new Set());
  }

  return (
    <main className="min-h-screen bg-[#f6f7fb]">
      <div className="flex w-full max-w-[1600px] flex-col gap-6 px-4 py-8">
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">Task View</h1>

        <div className="flex flex-wrap items-center justify-end gap-2">
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
            variant="outline"
            onClick={resetFilters}
            disabled={!filtersActive}
            title="Reset filters to all values"
            className="gap-1.5 bg-card shadow-sm"
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>

        {state === "ready" && assessmentsFailed && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>
              Assessment details couldn&apos;t be loaded — the assessment-stage
              column may be incomplete, and opening a task may take you to the AI
              system instead of its questionnaire. Reload in a moment to try
              again.
            </span>
          </div>
        )}

        {state === "loading" && <TableSkeleton />}
        {state === "error" && (
          <div className="rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-6 py-4 text-sm text-[var(--danger-fg)]">
            Failed to load your tasks. Please retry in a moment.
          </div>
        )}
        {state === "ready" && (
          <OpenTasksSection
            hideHeader
            sortDir={sortDir}
            onToggleSort={() =>
              setSortDir((d) => (d === "asc" ? "desc" : "asc"))
            }
            state="ready"
            rows={filteredContributorTasks}
            ownerTasks={filteredOwnerTasks}
            assessments={assessments}
            userMap={userMap}
          />
        )}
      </div>
    </main>
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
        <Button variant="outline" className="gap-1 bg-card shadow-sm">
          {label} <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
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

// ── small helpers ───────────────────────────────────────────────────────────

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
