import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Box,
  ClipboardList,
  Eye,
  MoreVertical,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigateTo } from "../../hooks/useLuigi";
import {
  COMPLIANCE_URL,
  REGISTRY_URL,
  type AssessmentSummary,
  type MySystemRow,
} from "../../api/client";
import { InitialsAvatar } from "../InitialsAvatar";
import { TierBadge } from "../TierBadge";
import type { TierKey } from "../../types";
import {
  AssessmentStageCell,
  pickLatestAssessmentPerSystem,
} from "./AssessmentStage";

type LoadState = "loading" | "ready" | "error";

interface MySystemsSectionProps {
  canRegister: boolean;
  state: LoadState;
  systems: MySystemRow[];
  assessments: AssessmentSummary[];
}

interface Row {
  system: MySystemRow;
  latestAssessment: AssessmentSummary | null;
}

export function MySystemsSection({
  canRegister,
  state,
  systems,
  assessments,
}: MySystemsSectionProps) {
  const rows: Row[] = useMemo(() => {
    const latestByAiSystem = pickLatestAssessmentPerSystem(assessments);
    return systems.map((s) => ({
      system: s,
      latestAssessment: latestByAiSystem.get(s.id) ?? null,
    }));
  }, [systems, assessments]);

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
    // Hand the target system id to the registry MFE via localStorage so Luigi
    // stays on the top-level /home/ai-system-registry node (deeper routes make
    // Luigi drop the side-nav).
    localStorage.setItem(
      "registry.openSystem",
      JSON.stringify({ systemId: system.id }),
    );
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }
  // All assessments for this system — hand off via the same localStorage key
  // the compliance MFE consumes to pre-filter its list (`viewSystem`).
  function openSystemAssessments() {
    localStorage.setItem(
      "compliance.viewSystem",
      JSON.stringify({ systemId: system.id, systemName: system.name }),
    );
    navigateTo("/home/assessments", COMPLIANCE_URL);
  }
  // Jump straight to the latest assessment detail. Only enabled when one
  // exists; the extra `openAssessment` key tells compliance to open it.
  function openLatestAssessment() {
    if (!latestAssessment) return;
    localStorage.setItem(
      "compliance.viewSystem",
      JSON.stringify({ systemId: system.id, systemName: system.name }),
    );
    localStorage.setItem(
      "compliance.openAssessment",
      JSON.stringify({ assessmentId: latestAssessment.id }),
    );
    navigateTo("/home/assessments", COMPLIANCE_URL);
  }

  const team = teamMembers(system);

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="max-w-[260px] px-4 py-3">
        <button
          type="button"
          onClick={openSystem}
          className="flex flex-col items-start text-left"
        >
          <span
            className="truncate font-medium text-foreground underline underline-offset-2"
            title={system.name}
          >
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
        <AssessmentStageCell
          assessment={latestAssessment}
          workflowStatus={system.workflow_status}
        />
      </td>
      <td className="px-4 py-3 text-right">
        <div
          className="inline-flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={openSystem}
            aria-label={`Open ${system.name}`}
            title="View system detail"
          >
            <Eye className="size-4" />
          </Button>
          <RowMenu
            onOpenSystem={openSystem}
            onOpenSystemAssessments={openSystemAssessments}
            onOpenLatestAssessment={openLatestAssessment}
            hasAssessment={latestAssessment !== null}
          />
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
  onOpenSystemAssessments: () => void;
  onOpenLatestAssessment: () => void;
  hasAssessment: boolean;
}

// Approximate dropdown height. If less than this much room is available below
// the trigger, flip the menu to open upwards so the last row's menu isn't
// clipped by the viewport.
const MENU_HEIGHT_PX = 150;
const MENU_WIDTH_PX = 220;

function RowMenu({
  onOpenSystem,
  onOpenSystemAssessments,
  onOpenLatestAssessment,
  hasAssessment,
}: RowMenuProps) {
  const [open, setOpen] = useState(false);
  // Position the dropdown as fixed in viewport coords so it can escape the
  // table's `overflow-hidden` wrapper (needed for the rounded corners).
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < MENU_HEIGHT_PX;
    const top = openUp ? rect.top - MENU_HEIGHT_PX - 4 : rect.bottom + 4;
    // Right-align the menu to the trigger, clamped to the viewport.
    const rawLeft = rect.right - MENU_WIDTH_PX;
    const left = Math.max(8, Math.min(rawLeft, window.innerWidth - MENU_WIDTH_PX - 8));
    setPos({ top, left });
    setOpen(true);
  }

  function pick(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant="outline"
        size="icon"
        className="size-8"
        onClick={toggle}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="size-4" />
      </Button>
      {open && pos && (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[100] overflow-hidden rounded-md border border-border bg-popover p-1 text-sm shadow-md"
          style={{ top: pos.top, left: pos.left, width: MENU_WIDTH_PX }}
        >
          <MenuItem icon={<Eye className="size-4" />} onClick={() => pick(onOpenSystem)}>
            View system detail
          </MenuItem>
          <MenuItem
            icon={<ClipboardList className="size-4" />}
            onClick={() => pick(onOpenSystemAssessments)}
          >
            View assessments
          </MenuItem>
          <MenuItem
            icon={<ArrowRight className="size-4" />}
            onClick={() => pick(onOpenLatestAssessment)}
            disabled={!hasAssessment}
            title={!hasAssessment ? "No assessment started yet" : undefined}
          >
            Open latest assessment
          </MenuItem>
        </div>
      )}
    </>
  );
}

function MenuItem({
  onClick,
  children,
  icon,
  disabled,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
    >
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

function EmptyState({ canRegister }: { canRegister: boolean }) {
  function handleRegister() {
    // Same localStorage handoff pattern as `registry.openSystem` so Luigi stays
    // on the top-level /home/ai-system-registry node (deeper routes make Luigi
    // drop the side-nav).
    localStorage.setItem("registry.openNew", "1");
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
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
