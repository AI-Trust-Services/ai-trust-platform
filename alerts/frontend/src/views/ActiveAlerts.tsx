import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AlertEvent, AlertRule } from "../types";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import { usePermissions } from "../hooks/usePermissions";
import { fmtDateTime, fmtAge, fmtValue } from "../utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface Props {
  alerts: AlertEvent[];
  rules: AlertRule[];
  onRefresh: () => void;
}

// ── Identity color maps — category & severity encode meaning; keep exact hues ──
const CAT_CLASS: Record<string, string> = {
  risk: "bg-[#fde8e8] text-[#8b0000]",
  compliance: "bg-[#fde8d0] text-[#8b3a00]",
  observability: "bg-[#e8f0fb] text-[#0a4a9e]",
  registry: "bg-[#d5f5e3] text-[#1a5c35]",
};
const SEV_CLASS: Record<string, string> = {
  error: "bg-[#fde8e8] text-[#8b0000]",
  warning: "bg-[#fff3c4] text-[#7a5900]",
  info: "bg-muted text-muted-foreground",
};
const SEV_DOT: Record<string, string> = {
  error: "#bb0000",
  warning: "#e9a922",
};
const SEV_BORDER: Record<string, string> = {
  error: "#bb0000",
  warning: "#e9a922",
};

export function ActiveAlerts({ alerts, rules, onRefresh }: Props) {
  const { showToast } = useToast();
  const { can } = usePermissions();
  const mayHandle = can("alerts:handle");
  const noHandleTitle = "Requires permission: alerts:handle";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const ruleMap = Object.fromEntries(rules.map((r) => [r.id, r]));

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleAlert(eventId: string) {
    try {
      await api.handleEvent(eventId);
      showToast("Alert marked as handled");
      onRefresh();
    } catch (e: any) {
      showToast(e.message, true);
    }
  }

  async function approveModel(eventId: string) {
    try {
      await api.approveModel(eventId);
      showToast("Model change approved — baseline updated");
      onRefresh();
    } catch (e: any) {
      showToast(e.message, true);
    }
  }

  async function rejectModel(eventId: string) {
    try {
      await api.rejectModel(eventId);
      showToast("Model change rejected — baseline unchanged");
      onRefresh();
    } catch (e: any) {
      showToast(e.message, true);
    }
  }

  if (!alerts.length) {
    return (
      <div className="flex flex-col gap-3 px-6 py-5">
        <div className="py-20 text-center text-muted-foreground">
          <div className="mb-4 text-4xl text-[var(--success-fg)]">✓</div>
          <h3 className="mb-2 text-base font-semibold text-foreground">No active alerts</h3>
          <p>All systems are operating within normal parameters.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      {alerts.map((a) => {
        const isExpanded = expanded.has(a.id);
        const rule = ruleMap[a.rule_id];
        const isModelDivergence = rule?.condition_type === "model_diverged";
        const canHandle = a.alert_type === "event" && !a.handled_at;
        const valueText = fmtValue(a.rule_name, a.value_at_trigger);
        return (
          <Card
            key={a.id}
            className="overflow-hidden border-l-4 transition-shadow hover:shadow-[var(--shadow-md)]"
            style={{ borderLeftColor: SEV_BORDER[a.severity] ?? "var(--border)" }}
          >
            <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(a.id)}>
              <CollapsibleTrigger asChild>
                <div className="flex cursor-pointer select-none items-center gap-3 p-3.5 hover:bg-muted/50">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: SEV_DOT[a.severity] ?? "transparent" }}
                  />
                  <Badge
                    className={cn(
                      "shrink-0 uppercase tracking-wide font-semibold",
                      CAT_CLASS[a.category],
                    )}
                  >
                    {a.category}
                  </Badge>
                  <span className="flex-1 text-sm font-semibold text-foreground">{a.rule_name}</span>
                  {a.entity_id && (
                    <Badge
                      className="shrink-0 bg-[#f0e8fb] font-semibold text-[#5a0a9e]"
                      title={a.entity_id}
                    >
                      {a.entity_display_name || a.entity_id}
                    </Badge>
                  )}
                  <Badge className={cn("shrink-0 font-semibold", SEV_CLASS[a.severity])}>
                    {a.severity}
                  </Badge>
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                    {fmtAge(a.triggered_at)}
                  </span>
                  <ChevronRight
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground transition-transform",
                      isExpanded && "rotate-90",
                    )}
                  />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-border px-4 pb-3.5">
                  <div className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
                    {a.description}
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    Triggered: {fmtDateTime(a.triggered_at)}
                  </div>
                  {valueText && (
                    <div className="mt-1.5 text-xs text-muted-foreground">{valueText}</div>
                  )}
                  {canHandle && (
                    <div className="mt-3 flex gap-2">
                      {isModelDivergence ? (
                        <>
                          <Button
                            size="sm"
                            disabled={!mayHandle}
                            title={mayHandle ? undefined : noHandleTitle}
                            onClick={() => approveModel(a.id)}
                          >
                            Approve new model
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={!mayHandle}
                            title={mayHandle ? undefined : noHandleTitle}
                            onClick={() => rejectModel(a.id)}
                          >
                            Reject
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={!mayHandle}
                          title={mayHandle ? undefined : noHandleTitle}
                          onClick={() => handleAlert(a.id)}
                        >
                          Mark as handled
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        );
      })}
    </div>
  );
}
