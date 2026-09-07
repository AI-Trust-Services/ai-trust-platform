import { BellRing } from "lucide-react";
import { ALERTS_URL } from "../api/client";
import { navigateTo } from "../hooks/useLuigi";
import { fmtDate } from "../utils";
import type { AlertEvent } from "../types";
import { Card } from "@/components/ui/card";
import { CardTitleBar } from "./CardTitleBar";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  alerts: AlertEvent[];
  loading?: boolean;
}

const SEVERITY_COLOR: Record<string, string> = {
  error:   "var(--destructive)",
  warning: "var(--warning)",
  info:    "var(--brand)",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return fmtDate(iso);
}

export default function AlertFeed({ alerts, loading }: Props) {
  return (
    <Card className="flex break-inside-avoid flex-col p-4">
      <CardTitleBar icon={BellRing} title="Active Alerts" color="var(--destructive)" />
      {loading ? (
        <div className="flex flex-col gap-2.5 py-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-[var(--success-fg)]">
          ✓ No active alerts
        </div>
      ) : (
        <div className="flex flex-col">
          {alerts.map((a) => (
            <div
              key={a.id}
              className="flex cursor-pointer items-center gap-2.5 border-b border-border py-2 last:border-b-0 hover:bg-muted/60"
              onClick={() => navigateTo("/home/alerts", ALERTS_URL)}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: SEVERITY_COLOR[a.severity] ?? "#999" }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{a.rule_name}</div>
                {a.entity_display_name && (
                  <div className="text-xs text-muted-foreground">{a.entity_display_name}</div>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {relativeTime(a.triggered_at)}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-1 border-t border-border pt-2 text-right">
        <span
          className="cursor-pointer text-xs text-[color:var(--brand)]"
          onClick={() => navigateTo("/home/alerts", ALERTS_URL)}
        >
          View all alerts →
        </span>
      </div>
    </Card>
  );
}
