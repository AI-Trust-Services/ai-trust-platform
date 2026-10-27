import { useEffect, useRef, useState } from "react";
import { Box, Eye, MoreVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigateTo } from "../../hooks/useLuigi";
import {
  COMPLIANCE_URL,
  REGISTRY_URL,
  api,
  type AssessmentSummary,
  type MySystemRow,
} from "../../api/client";
import { InitialsAvatar } from "../InitialsAvatar";
import { TierBadge } from "../TierBadge";
import type { TierKey } from "../../types";

interface MySystemsSectionProps {
  canRegister: boolean;
}

type LoadState = "loading" | "ready" | "error";

interface Row {
  system: MySystemRow;
  latestAssessment: AssessmentSummary | null;
}

export function MySystemsSection({ canRegister }: MySystemsSectionProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    Promise.all([
      api.mySystems(),
      api.allAssessments().catch(() => [] as AssessmentSummary[]),
    ])
      .then(([systems, assessments]) => {
        const latestByAiSystem = pickLatestPerSystem(assessments);
        setRows(
          systems.map((s) => ({
            system: s,
            latestAssessment: latestByAiSystem.get(s.id) ?? null,
          })),
        );
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">My AI Systems</h2>
        <span className="text-xs text-muted-foreground">
          {state === "ready" && rows.length > 0
            ? `${rows.length} ${rows.length === 1 ? "system" : "systems"} total`
            : "No systems yet"}
        </span>
      </div>
      {state === "ready" && rows.length > 0 ? (
        <SystemsTable rows={rows} />
      ) : (
        <EmptyState canRegister={canRegister} />
      )}
    </section>
  );
}

function SystemsTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium text-muted-foreground">
            <th className="px-4 py-3 text-left">AI System</th>
            <th className="px-4 py-3 text-left">Risk classification</th>
            <th className="px-4 py-3 text-left">Team</th>
            <th className="px-4 py-3 text-left">Assessment stage</th>
            <th className="w-24 px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <SystemRowView key={row.system.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SystemRowView({ row }: { row: Row }) {
  const { system, latestAssessment } = row;

  function openSystem() {
    navigateTo(
      `/home/ai-system-registry/systems/${system.id}`,
      `${REGISTRY_URL}#/systems/${system.id}`,
    );
  }
  function openAssessments() {
    navigateTo("/home/assessments", COMPLIANCE_URL);
  }

  const team = teamMembers(system);

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="max-w-[260px] px-4 py-3">
        <button
          type="button"
          onClick={openSystem}
          className="flex flex-col items-start text-left hover:underline"
        >
          <span className="truncate font-medium text-foreground" title={system.name}>
            {system.name}
          </span>
          <span className="text-xs text-muted-foreground">{system.id}</span>
        </button>
      </td>
      <td className="px-4 py-3">
        <TierBadge
          tier={system.tier as TierKey}
          workflowStatus={system.workflow_status}
          isChatbot={system.is_chatbot}
          generatesSyntheticContent={system.generates_synthetic_content}
        />
      </td>
      <td className="px-4 py-3">
        <AvatarStack usernames={team} />
      </td>
      <td className="px-4 py-3">
        <span className="text-foreground">
          {formatAssessmentStage(latestAssessment, system.workflow_status)}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={openSystem}
            aria-label={`Open ${system.name}`}
            title={`Open ${system.name}`}
          >
            <Eye className="size-4" />
          </Button>
          <RowMenu onOpenSystem={openSystem} onOpenAssessments={openAssessments} />
        </div>
      </td>
    </tr>
  );
}

function AvatarStack({ usernames }: { usernames: string[] }) {
  if (usernames.length === 0) return <span className="text-muted-foreground">—</span>;
  const shown = usernames.slice(0, 4);
  const extra = usernames.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((u, i) => (
        <span
          key={u}
          className={i === 0 ? "" : "-ml-2"}
          style={{ zIndex: shown.length - i }}
          title={u}
        >
          <InitialsAvatar username={u} size="sm" className="ring-2 ring-card" />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="-ml-2 flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-card"
          title={`+${extra} more`}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

interface RowMenuProps {
  onOpenSystem: () => void;
  onOpenAssessments: () => void;
}

function RowMenu({ onOpenSystem, onOpenAssessments }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function pick(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div ref={ref} className="relative inline-block">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="size-4" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[200px] overflow-hidden rounded-md border border-border bg-popover p-1 text-sm shadow-md"
        >
          <MenuItem onClick={() => pick(onOpenSystem)}>View system detail</MenuItem>
          <MenuItem onClick={() => pick(onOpenAssessments)}>View assessments</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full rounded-sm px-2 py-1.5 text-left text-foreground hover:bg-muted"
    >
      {children}
    </button>
  );
}

function EmptyState({ canRegister }: { canRegister: boolean }) {
  function handleRegister() {
    navigateTo(
      "/home/ai-system-registry/systems/new",
      `${REGISTRY_URL}#/systems/new`,
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Box className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">No AI systems yet</h3>
        <p className="max-w-md text-xs text-muted-foreground">
          You haven&apos;t added any AI systems to the platform. Register your first AI
          system to start assessing it for EU AI Act compliance.
        </p>
      </div>
      {canRegister && (
        <Button
          onClick={handleRegister}
          className="border-transparent bg-[var(--brand)] text-white hover:bg-[color-mix(in_srgb,var(--brand)_88%,black)]"
        >
          <Plus />
          Register new AI System
        </Button>
      )}
    </div>
  );
}

function teamMembers(system: MySystemRow): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (u: string | null) => {
    if (!u) return;
    if (seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  push(system.business_owners);
  for (const c of system.contributors) push(c);
  push(system.business_assignee_username);
  push(system.technical_assignee_username);
  push(system.compliance_officer_username);
  return out;
}

function pickLatestPerSystem(
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

const ASSESSMENT_STATUS_LABELS: Record<string, string> = {
  questionnaire_pending: "Questionnaire pending",
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
};

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  draft: "Draft started",
  business_pending: "Awaiting owner",
  technical_pending: "Awaiting engineer",
  pending_review: "Under review",
  info_requested: "Info requested",
  approved: "Risk classification approved",
  rejected: "Rejected",
};

function formatAssessmentStage(
  a: AssessmentSummary | null,
  workflowStatus: string,
): string {
  if (a) return ASSESSMENT_STATUS_LABELS[a.status] ?? a.status;
  return WORKFLOW_STATUS_LABELS[workflowStatus] ?? workflowStatus;
}
