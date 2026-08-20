import type { TierKey, LifecycleKey, ModelType } from "../types";
import { TIER_META, LIFECYCLE_LABELS, fmtDate } from "../utils";

export function TierBadge({ tier, workflowStatus }: { tier: TierKey; workflowStatus?: string }) {
  const effectiveTier = workflowStatus === "draft" ? "pending" : tier;
  const meta = TIER_META[effectiveTier] || { label: tier, cls: "badge-minimal" };
  return <span className={`badge ${meta.cls}`}>{meta.label}</span>;
}

export function LifecycleBadge({ lc }: { lc: LifecycleKey }) {
  return <span className={`lc-badge lc-${lc}`}>{LIFECYCLE_LABELS[lc] || lc}</span>;
}

export function ModelTypeBadge({ type }: { type: ModelType }) {
  return <span className={`badge badge-${type}`}>{type}</span>;
}

export function ComplianceBar({ pct = 0 }: { pct?: number }) {
  const color = pct >= 100 ? "#1a7a3c" : pct >= 60 ? "#e9a922" : "#bb0000";
  return (
    <div className="progress-wrap">
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="progress-text">{pct.toFixed(0)}%</span>
    </div>
  );
}

export function FormattedDate({ iso }: { iso: string | null | undefined }) {
  return <span>{fmtDate(iso)}</span>;
}
