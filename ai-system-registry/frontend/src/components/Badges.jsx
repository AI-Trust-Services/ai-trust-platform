import { TIER_META, LIFECYCLE_LABELS, fmtDate } from "../utils";

export function TierBadge({ tier }) {
  const meta = TIER_META[tier] || { label: tier, cls: "badge-minimal" };
  return <span className={`badge ${meta.cls}`}>{meta.label}</span>;
}

export function LifecycleBadge({ lc }) {
  return <span className={`lc-badge lc-${lc}`}>{LIFECYCLE_LABELS[lc] || lc}</span>;
}

export function ModelTypeBadge({ type }) {
  return <span className={`badge badge-${type}`}>{type}</span>;
}

export function ComplianceBar({ pct = 0 }) {
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

export function FormattedDate({ iso }) {
  return <span>{fmtDate(iso)}</span>;
}
