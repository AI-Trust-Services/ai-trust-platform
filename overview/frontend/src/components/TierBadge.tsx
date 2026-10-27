import type { TierKey } from "../types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const TIER_LABELS: Record<TierKey, string> = {
  prohibited: "Prohibited Practice",
  high: "High Risk",
  "gpai-systemic": "GPAI with Systemic Risk",
  "gpai-standard": "GPAI Standard",
  limited: "Transparency Obligations",
  minimal: "Minimal or No Risk",
  pending: "Pending",
};

const TIER_CLASSES: Record<TierKey, string> = {
  prohibited: "bg-[#ffd5d5] text-[#8b0000]",
  high: "bg-[#fde8d0] text-[#8b3a00]",
  "gpai-systemic": "bg-[#f0e8ff] text-[#4108A0]",
  "gpai-standard": "bg-[#f4edff] text-[#6C1AF4]",
  limited: "bg-[#e8f0fb] text-[#1147E9]",
  minimal: "bg-[#d5f5e3] text-[#1a5c35]",
  pending: "bg-[#eaecee] text-[#556b82]",
};

interface TierBadgeProps {
  tier: TierKey;
  workflowStatus?: string;
  isChatbot?: boolean;
  generatesSyntheticContent?: boolean;
}

/**
 * EU AI Act tier badge. Art. 50 transparency stacks on top of a high-risk
 * classification — the only tier pair that co-applies. When tier="high" and
 * either Art. 50 trigger (chatbot / synthetic content) is set, a companion
 * "Transparency Obligations" badge is rendered next to the primary tier.
 */
export function TierBadge({
  tier,
  workflowStatus,
  isChatbot,
  generatesSyntheticContent,
}: TierBadgeProps) {
  const effectiveTier = workflowStatus === "draft" ? "pending" : tier;
  const label = TIER_LABELS[effectiveTier] ?? tier;
  const alsoTransparency =
    effectiveTier === "high" && (isChatbot || generatesSyntheticContent);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge
        className={cn(
          "rounded-full font-medium",
          TIER_CLASSES[effectiveTier] ?? TIER_CLASSES.minimal,
        )}
      >
        {label}
      </Badge>
      {alsoTransparency && (
        <Badge className={cn("rounded-full font-medium", TIER_CLASSES.limited)}>
          {TIER_LABELS.limited}
        </Badge>
      )}
    </span>
  );
}
