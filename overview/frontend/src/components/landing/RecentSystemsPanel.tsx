import { navigateTo } from "../../hooks/useLuigi";
import { REGISTRY_URL, type RecentSystemRow } from "../../api/client";
import { TierBadge } from "../TierBadge";
import type { TierKey } from "../../types";

interface RecentSystemsPanelProps {
  systems: RecentSystemRow[];
}

/**
 * Horizontal card row of the N most recently registered systems across the
 * organisation. Each card deep-links to the registry; the CO can jump
 * straight into the detail they likely want to triage.
 */
export function RecentSystemsPanel({ systems }: RecentSystemsPanelProps) {
  if (systems.length === 0) return null;
  const visible = systems.slice(0, 3);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Recent AI Systems</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {visible.map((s) => (
          <RecentSystemCard key={s.id} system={s} />
        ))}
      </div>
    </section>
  );
}

function RecentSystemCard({ system }: { system: RecentSystemRow }) {
  function openInRegistry() {
    sessionStorage.setItem("lastSystemPath", `/systems/${system.id}`);
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }
  return (
    <button
      type="button"
      onClick={openInRegistry}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition hover:border-foreground/20 hover:shadow-sm"
    >
      <div className="min-h-[28px]">
        <TierBadge
          tier={system.tier as TierKey}
          workflowStatus={system.workflow_status}
          isChatbot={system.is_chatbot}
          generatesSyntheticContent={system.generates_synthetic_content}
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="truncate text-sm font-semibold text-foreground">
          {system.name}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {system.id} · v{system.version}
        </span>
      </div>
    </button>
  );
}
