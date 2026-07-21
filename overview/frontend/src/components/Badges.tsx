import type { TierKey, LifecycleKey } from "../types";
import { TIER_LABELS, fmtDate } from "../utils";

export function TierBadge({ tier }: { tier: TierKey }) {
  return <span className={`badge badge-${tier}`}>{TIER_LABELS[tier] ?? tier}</span>;
}

export function LifecycleBadge({ lc }: { lc: LifecycleKey }) {
  const labels: Record<LifecycleKey, string> = {
    development: "Development", testing: "Testing", conformity: "Conformity",
    market: "On Market", "post-market": "Post-Market", decommissioned: "Decommissioned",
  };
  return <span className={`lc-badge lc-${lc}`}>{labels[lc] ?? lc}</span>;
}

export function ComplianceBar({ pct = 0 }: { pct?: number }) {
  const color = pct >= 80 ? "#1a7a3c" : pct >= 50 ? "#e9a922" : "#bb0000";
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
