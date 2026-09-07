import { CalendarClock } from "lucide-react";
import { COMPLIANCE_URL } from "../api/client";
import { navigateTo } from "../hooks/useLuigi";
import type { Deadline } from "../types";
import { Card } from "@/components/ui/card";
import { CardTitleBar } from "./CardTitleBar";
import { cn } from "@/lib/utils";

interface Props {
  deadlines: Deadline[];
  windowDays: number;
}

function daysUntil(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function pillStyle(days: number): { color: string; background: string } {
  if (days < 7)  return { color: "var(--danger-fg)",  background: "var(--danger-bg)" };
  if (days < 14) return { color: "var(--warning-fg)", background: "var(--warning-bg)" };
  return { color: "var(--warning-fg)", background: "var(--warning-bg)" };
}

export default function UpcomingDeadlines({ deadlines, windowDays }: Props) {
  return (
    <Card className="break-inside-avoid p-4">
      <CardTitleBar icon={CalendarClock} title="Evidence Expiring Soon" color="var(--warning)" />
      {deadlines.length === 0 ? (
        <div className="py-5 text-center text-[13px] text-muted-foreground">
          No evidence expiring in the next {windowDays} days
        </div>
      ) : (
        <div className="flex flex-col">
          {deadlines.map((d) => {
            const days = daysUntil(d.due_date);
            const path = d.type === "obligation" ? "/home/obligations" : "/home/evidence";
            return (
              <div
                key={d.id}
                className="flex cursor-pointer items-center gap-2.5 border-b border-border py-2 last:border-b-0 hover:bg-muted/60"
                onClick={() => navigateTo(path, COMPLIANCE_URL)}
              >
                <span
                  className={cn(
                    "shrink-0 rounded-md px-1.5 py-px text-[11px] font-semibold",
                    d.type === "obligation" ? "bg-muted text-muted-foreground" : "bg-accent text-accent-foreground",
                  )}
                >
                  {d.type === "obligation" ? "OBL" : "EVD"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{d.title}</div>
                  {d.ai_system_name && (
                    <div className="text-xs text-muted-foreground">{d.ai_system_name}</div>
                  )}
                </div>
                <span
                  className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                  style={pillStyle(days)}
                >
                  {days === 0 ? "today" : `${days}d`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
