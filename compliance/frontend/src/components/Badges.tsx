import type { BadgeMeta } from "../types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Legacy status class → governed status-ramp classes. Status-like colors move
// onto the governed ramp; the label→color meaning is preserved 1:1.
const STATUS_CLASSES: Record<string, string> = {
  "st-draft":      "bg-muted text-muted-foreground",
  "st-na":         "bg-muted text-muted-foreground",
  "st-submitted":  "bg-accent text-accent-foreground",
  "st-applicable": "bg-accent text-accent-foreground",
  "st-review":     "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
  "st-progress":   "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
  "st-approved":   "bg-[var(--success-bg)] text-[var(--success-fg)]",
  "st-fulfilled":  "bg-[var(--success-bg)] text-[var(--success-fg)]",
  "st-overdue":    "bg-[var(--danger-bg)] text-[var(--danger-fg)]",
};

interface StatusBadgeProps { meta: Record<string, BadgeMeta>; value: string; }
export function StatusBadge({ meta, value }: StatusBadgeProps) {
  const m = meta[value] ?? { label: value, cls: "st-draft" };
  return (
    <Badge className={cn("rounded-full font-medium", STATUS_CLASSES[m.cls] ?? STATUS_CLASSES["st-draft"])}>
      {m.label}
    </Badge>
  );
}

// Risk tier is an identity color map — hues are meaningful and kept as-is.
const TIER_CLASSES: Record<string, string> = {
  prohibited:      "bg-[#fef2f2] text-[#b91c1c]",
  high:            "bg-[#fff7ed] text-[#c2410c]",
  "gpai-systemic": "bg-[#f5f3ff] text-[#6d28d9]",
  "gpai-standard": "bg-[#f5f3ff] text-[#7c3aed]",
  limited:         "bg-[#fffbeb] text-[#b45309]",
  minimal:         "bg-[#f0fdf4] text-[#15803d]",
};

interface TierBadgeProps { tier: string; }
export function TierBadge({ tier }: TierBadgeProps) {
  const labels: Record<string, string> = {
    prohibited: "Prohibited", high: "High-Risk",
    "gpai-systemic": "GPAI Systemic", "gpai-standard": "GPAI Standard",
    limited: "Limited", minimal: "Minimal",
  };
  return (
    <Badge className={cn("rounded-full gap-1.5 font-semibold", TIER_CLASSES[tier] ?? "bg-muted text-muted-foreground")}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {labels[tier] ?? tier}
    </Badge>
  );
}

interface ScoreBarProps { score: number | null | undefined; }
export function ScoreBar({ score }: ScoreBarProps) {
  if (score === null || score === undefined) {
    return <Badge variant="secondary" className="rounded-full font-medium">N/A</Badge>;
  }
  const color = score >= 100 ? "var(--success)" : score >= 60 ? "var(--warning)" : "var(--destructive)";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-[90px] overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-[width]" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="min-w-[34px] text-xs tabular-nums text-muted-foreground">{score.toFixed(0)}%</span>
    </div>
  );
}
