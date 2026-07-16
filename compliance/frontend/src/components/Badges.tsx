import type { BadgeMeta } from "../types";

interface StatusBadgeProps { meta: Record<string, BadgeMeta>; value: string; }
export function StatusBadge({ meta, value }: StatusBadgeProps): JSX.Element {
  const m = meta[value] ?? { label: value, cls: "st-draft" };
  return <span className={`st-badge ${m.cls}`}>{m.label}</span>;
}

interface TierBadgeProps { tier: string; }
export function TierBadge({ tier }: TierBadgeProps): JSX.Element {
  const labels: Record<string, string> = {
    prohibited: "Prohibited", high: "High-Risk",
    "gpai-systemic": "GPAI Systemic", "gpai-standard": "GPAI Standard",
    limited: "Limited", minimal: "Minimal",
  };
  return <span className={`badge badge-${tier}`}>{labels[tier] ?? tier}</span>;
}

interface ScoreBarProps { score: number | null | undefined; }
export function ScoreBar({ score }: ScoreBarProps): JSX.Element {
  if (score === null || score === undefined) {
    return <span className="chip">N/A</span>;
  }
  const color = score >= 100 ? "#1a7a3c" : score >= 60 ? "#e9a922" : "#bb0000";
  return (
    <div className="progress-wrap">
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="progress-text">{score.toFixed(0)}%</span>
    </div>
  );
}
