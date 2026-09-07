import type { TierKey, LifecycleKey } from "../types";
import { TIER_LABELS, fmtDate, statusColor } from "../utils";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TIER_CLASSES: Record<TierKey, string> = {
  prohibited: "bg-[#fef2f2] text-[#b91c1c]",
  high: "bg-[#fff7ed] text-[#c2410c]",
  "gpai-systemic": "bg-[#f0e8ff] text-[#4108A0]",
  "gpai-standard": "bg-[#f4edff] text-[#6C1AF4]",
  limited: "bg-[#fffbeb] text-[#b45309]",
  minimal: "bg-[#f0fdf4] text-[#15803d]",
};

const LIFECYCLE_CLASSES: Record<LifecycleKey, string> = {
  development: "bg-[#eff6ff] text-[#1147E9]",
  testing: "bg-[#fffbeb] text-[#b45309]",
  conformity: "bg-[#fff7ed] text-[#c2410c]",
  market: "bg-[#f0fdf4] text-[#15803d]",
  "post-market": "bg-[#f0fdf4] text-[#166534]",
  decommissioned: "bg-[#f4f4f5] text-[#71717a]",
};

const LIFECYCLE_LABELS: Record<LifecycleKey, string> = {
  development: "Development", testing: "Testing", conformity: "Conformity",
  market: "On Market", "post-market": "Post-Market", decommissioned: "Decommissioned",
};

export function TierBadge({ tier }: { tier: TierKey }) {
  return (
    <Badge className={cn("gap-1.5 font-semibold", TIER_CLASSES[tier])}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {TIER_LABELS[tier] ?? tier}
    </Badge>
  );
}

export function LifecycleBadge({ lc }: { lc: LifecycleKey }) {
  return (
    <Badge className={cn("gap-1.5 font-semibold", LIFECYCLE_CLASSES[lc])}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {LIFECYCLE_LABELS[lc] ?? lc}
    </Badge>
  );
}

export function ComplianceBar({ pct = 0 }: { pct?: number }) {
  const color = statusColor(pct);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-[90px] overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="min-w-[34px] text-xs tabular-nums text-muted-foreground">{pct.toFixed(0)}%</span>
    </div>
  );
}

export function FormattedDate({ iso }: { iso: string | null | undefined }) {
  return <span>{fmtDate(iso)}</span>;
}
