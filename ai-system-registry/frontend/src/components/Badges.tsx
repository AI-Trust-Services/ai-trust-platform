import type { TierKey, LifecycleKey, ModelType } from "../types";
import { TIER_META, LIFECYCLE_LABELS, fmtDate } from "../utils";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Identity color maps — these hues encode meaning (risk tier / lifecycle /
// model type), so they keep their existing values rather than moving onto the
// governed status ramp.
const TIER_CLASSES: Record<TierKey, string> = {
  prohibited: "bg-[#ffd5d5] text-[#8b0000]",
  high: "bg-[#fde8d0] text-[#8b3a00]",
  "gpai-systemic": "bg-[#e8d5fd] text-[#5a0080]",
  "gpai-standard": "bg-[#eed5fd] text-[#4a0070]",
  limited: "bg-[#fff3c4] text-[#7a5900]",
  minimal: "bg-[#d5f5e3] text-[#1a5c35]",
  pending: "bg-[#eaecee] text-[#556b82]",
};

const LIFECYCLE_CLASSES: Record<LifecycleKey, string> = {
  development: "bg-[#e8f0fb] text-[#0a6ed1]",
  testing: "bg-[#fff3c4] text-[#7a5900]",
  conformity: "bg-[#fde8d0] text-[#8b3a00]",
  market: "bg-[#d5f5e3] text-[#1a5c35]",
  "post-market": "bg-[#c8f0d8] text-[#0d4a28]",
  decommissioned: "bg-[#eeeeee] text-[#666666]",
};

const MODEL_TYPE_CLASSES: Record<ModelType, string> = {
  llm: "bg-[#e8f0fb] text-[#0a4a9e]",
  embedding: "bg-[#e8fbf0] text-[#0a4a2e]",
  multimodal: "bg-[#fbe8fb] text-[#4a0a4a]",
  classifier: "bg-[#fbf0e8] text-[#4a2a0a]",
};

export function TierBadge({ tier, workflowStatus }: { tier: TierKey; workflowStatus?: string }) {
  const effectiveTier = workflowStatus === "draft" ? "pending" : tier;
  const meta = TIER_META[effectiveTier] || { label: tier };
  return (
    <Badge className={cn("rounded-full font-medium", TIER_CLASSES[effectiveTier] ?? TIER_CLASSES.minimal)}>
      {meta.label}
    </Badge>
  );
}

export function LifecycleBadge({ lc }: { lc: LifecycleKey }) {
  return (
    <Badge className={cn("rounded-full font-medium", LIFECYCLE_CLASSES[lc])}>
      {LIFECYCLE_LABELS[lc] || lc}
    </Badge>
  );
}

export function ModelTypeBadge({ type }: { type: ModelType }) {
  return (
    <Badge className={cn("rounded-full font-medium", MODEL_TYPE_CLASSES[type])}>
      {type}
    </Badge>
  );
}

export function ComplianceBar({ pct = 0 }: { pct?: number }) {
  const color = pct >= 100 ? "#1a7a3c" : pct >= 60 ? "#e9a922" : "#bb0000";
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
