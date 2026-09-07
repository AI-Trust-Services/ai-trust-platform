import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

interface KpiCardProps {
  label: string;
  value: number | string;
  sub?: string;
  icon?: LucideIcon;
  color?: string;
}

export default function KpiCard({ label, value, sub, icon: Icon, color }: KpiCardProps) {
  return (
    <Card className="flex-1 gap-0 overflow-hidden p-5 transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--ring)_35%,var(--border))] hover:shadow-[var(--shadow-md)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
          <div className="my-1 text-[30px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">{value}</div>
        </div>
        {Icon && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-5" />
          </span>
        )}
      </div>
      {sub && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {color && <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />}
          {sub}
        </div>
      )}
    </Card>
  );
}
