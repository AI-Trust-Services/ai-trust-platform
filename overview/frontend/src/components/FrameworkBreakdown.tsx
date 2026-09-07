import { useMemo } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, LabelList } from "recharts";
import { BarChart3 } from "lucide-react";
import type { FrameworkScore } from "../types";
import { Card } from "@/components/ui/card";
import { ChartTooltip, chartClass } from "@/components/ui/chart";
import { CardTitleBar } from "./CardTitleBar";

interface Props {
  data: FrameworkScore[];
  onClick?: () => void;
}

function scoreColor(score: number | null): string {
  if (score === null) return "#a1a1aa";
  if (score >= 80) return "var(--success)";
  if (score >= 50) return "var(--warning)";
  return "var(--destructive)";
}

const COLOR_LEGEND = [
  { color: "var(--success)", label: "≥ 80% — On track" },
  { color: "var(--warning)", label: "50–79% — Needs attention" },
  { color: "var(--destructive)", label: "< 50% — At risk" },
];

export default function FrameworkBreakdown({ data, onClick }: Props) {
  const chartData = useMemo(() =>
    data.map((f) => ({
      name: f.framework_name.length > 18 ? f.framework_name.slice(0, 17) + "…" : f.framework_name,
      fullName: f.framework_name,
      score: f.score ?? 0,
      total: f.total_obligations,
      fulfilled: f.fulfilled,
      color: scoreColor(f.score),
    })),
    [data]
  );

  if (data.length === 0) {
    return (
      <Card className="break-inside-avoid p-4">
        <CardTitleBar icon={BarChart3} title="Framework Compliance" color="var(--brand)" />
        <div className="py-10 text-center text-[13px] text-muted-foreground">
          No enabled frameworks
        </div>
      </Card>
    );
  }

  return (
    <Card
      className="break-inside-avoid p-4"
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : undefined }}
    >
      <CardTitleBar icon={BarChart3} title="Framework Compliance" color="var(--brand)" />
      <div className={chartClass}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ left: 0, right: 16, top: 16, bottom: 4 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} width={36} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={false}
              content={
                <ChartTooltip
                  labelFormatter={(_, p) => (p[0]?.payload?.fullName as string) ?? ""}
                  valueFormatter={(v, item) => `${v}%  (${item.payload?.fulfilled ?? 0}/${item.payload?.total ?? 0} fulfilled)`}
                  nameFormatter={() => "Compliance"}
                />
              }
            />
            <Bar dataKey="score" radius={[4, 4, 0, 0]} maxBarSize={48}>
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
              <LabelList
                dataKey="score"
                position="top"
                style={{ fontSize: 11, fontWeight: 600, fill: "var(--text-secondary)" }}
                formatter={(v: number) => `${v}%`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Color coding legend */}
      <div className="mt-2 flex flex-wrap justify-center gap-4">
        {COLOR_LEGEND.map((l) => (
          <div key={l.color} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: l.color }} />
            {l.label}
          </div>
        ))}
      </div>
    </Card>
  );
}
