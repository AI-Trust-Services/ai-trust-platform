import type { AlertRule } from "../types";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import { usePermissions } from "../hooks/usePermissions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface Props {
  rules: AlertRule[];
  onRefresh: () => void;
}

const CATEGORIES = ["risk", "compliance", "observability", "registry"] as const;

// ── Identity color map — severity encodes meaning; keep exact hues ──
const SEV_CLASS: Record<string, string> = {
  error: "bg-[#fde8e8] text-[#8b0000]",
  warning: "bg-[#fff3c4] text-[#7a5900]",
  info: "bg-muted text-muted-foreground",
};

export function AlertRules({ rules, onRefresh }: Props) {
  const { showToast } = useToast();
  const { can } = usePermissions();
  const mayManage = can("alerts:manage_rules");
  const noManageTitle = "Requires permission: alerts:manage_rules";

  async function toggleRule(ruleId: string) {
    try {
      const result = await api.toggleRule(ruleId);
      showToast(result.enabled ? "Rule enabled" : "Rule disabled");
      onRefresh();
    } catch (e: any) {
      showToast(e.message, true);
    }
  }

  const grouped = CATEGORIES.reduce<Record<string, AlertRule[]>>((acc, cat) => {
    acc[cat] = rules.filter((r) => r.category === cat);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      {CATEGORIES.filter((cat) => grouped[cat].length > 0).map((cat) => (
        <div key={cat}>
          <div className="mt-1 px-0.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {cat}
          </div>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(380px,1fr))]">
            {grouped[cat].map((r) => (
              <Card
                key={r.id}
                className={cn(
                  "flex flex-col gap-2 p-4 transition-opacity",
                  !r.enabled && "opacity-60",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm font-semibold text-foreground">{r.name}</span>
                  <Badge className={cn("font-semibold", SEV_CLASS[r.severity])}>
                    {r.severity}
                  </Badge>
                  <Badge
                    className={cn(
                      "font-semibold",
                      r.enabled
                        ? "bg-[var(--success-bg)] text-[var(--success-fg)]"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {r.enabled ? "Active" : "Disabled"}
                  </Badge>
                  <Switch
                    className="ml-1"
                    checked={r.enabled}
                    disabled={!mayManage}
                    title={mayManage ? undefined : noManageTitle}
                    onCheckedChange={() => toggleRule(r.id)}
                  />
                </div>
                <div className="text-xs leading-normal text-muted-foreground">{r.description}</div>
                <div className="text-[11px] text-muted-foreground">
                  {r.threshold !== null && `Threshold: ${r.threshold} · `}
                  Source: <strong className="font-semibold text-foreground">{r.source}</strong>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
