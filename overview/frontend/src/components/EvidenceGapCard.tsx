import { FileWarning } from "lucide-react";
import type { EvidenceGap } from "../types";
import { Card } from "@/components/ui/card";
import { CardTitleBar } from "./CardTitleBar";
import { cn } from "@/lib/utils";

interface Props {
  data: EvidenceGap;
  windowDays: number;
  onClick?: () => void;
}

const ROWS = [
  { key: "expired",      label: "Expired",                     color: "var(--danger-fg)",  bg: "var(--danger-bg)" },
  { key: "expiring_soon",label: "Expiring soon",               color: "var(--warning-fg)", bg: "var(--warning-bg)" },
  { key: "missing",      label: "Missing approved evidence",   color: "var(--warning-fg)", bg: "var(--warning-bg)" },
] as const;

export default function EvidenceGapCard({ data, windowDays, onClick }: Props) {
  const rows = ROWS.map((r) => ({ ...r, count: data[r.key] ?? 0 }));
  const label = (r: typeof rows[number]) =>
    r.key === "expiring_soon" ? `${r.label} (${windowDays}d)` : r.label;

  return (
    <Card
      className={cn("break-inside-avoid p-4", onClick && "cursor-pointer")}
      onClick={onClick}
    >
      <CardTitleBar icon={FileWarning} title="Evidence Gap" color="var(--warning)" />
      <div className="flex flex-col gap-2.5 py-3">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-muted-foreground">{label(r)}</span>
            <span
              className="min-w-8 rounded-md px-2.5 py-0.5 text-center text-[13px] font-semibold tabular-nums"
              style={{
                color: r.count > 0 ? r.color : "var(--success-fg)",
                background: r.count > 0 ? r.bg : "var(--success-bg)",
              }}
            >
              {r.count}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
