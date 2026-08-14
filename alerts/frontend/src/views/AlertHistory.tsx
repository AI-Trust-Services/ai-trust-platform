import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AlertEvent } from "../types";
import { fmtDateTime, fmtValue } from "../utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface Props {
  alerts: AlertEvent[];
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

export function AlertHistory({ alerts }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (!alerts.length) {
    return (
      <div className="flex flex-col gap-3 px-6 py-5">
        <div className="py-20 text-center text-muted-foreground">
          <h3 className="mb-2 text-base font-semibold text-foreground">No alert history</h3>
          <p>Resolved and handled alerts will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      {alerts.map((a) => {
        const isExpanded = expanded.has(a.id);
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
                    {fmtDateTime(a.triggered_at)}
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
                  {a.resolved_at && (
                    <div className="mt-1.5 text-xs text-muted-foreground">
                      Auto-resolved: {fmtDateTime(a.resolved_at)}
                    </div>
                  )}
                  {a.handled_at && (
                    <div className="mt-1.5 text-xs text-muted-foreground">
                      Marked as handled: {fmtDateTime(a.handled_at)}
                    </div>
                  )}
                  {valueText && (
                    <div className="mt-1.5 text-xs text-muted-foreground">{valueText}</div>
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
