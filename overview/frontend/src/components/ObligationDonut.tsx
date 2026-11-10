import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, Label } from "recharts";
import { PieChart as PieChartIcon } from "lucide-react";
import type { ObligationStatusCounts } from "../types";
import { Card } from "@/components/ui/card";
import { ChartTooltip, chartClass } from "@/components/ui/chart";
import { CardTitleBar } from "./CardTitleBar";

interface Props {
  data: ObligationStatusCounts;
  onClick?: () => void;
}

const SLICES = [
  { key: "fulfilled",      label: "Fulfilled",      color: "var(--success)" },
  { key: "in_progress",    label: "In Progress",    color: "var(--brand)" },
  { key: "applicable",     label: "Applicable",     color: "var(--warning)" },
  { key: "overdue",        label: "Overdue",        color: "var(--destructive)" },
  { key: "not_applicable", label: "Not Applicable", color: "#a1a1aa" },
] as const;

function CenterLabel({ viewBox, total }: { viewBox?: { cx: number; cy: number }; total: number }) {
  const { cx = 0, cy = 0 } = viewBox ?? {};
  return (
    <>
      <text x={cx} y={cy - 6} textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 22, fontWeight: 700, fill: "var(--text)" }}>
        {total.toLocaleString()}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 11, fill: "var(--text-secondary)" }}>
        total
      </text>
    </>
  );
}

export default function ObligationDonut({ data, onClick }: Props) {
  const chartData = useMemo(() =>
    SLICES.map((s) => ({ name: s.label, value: data[s.key] ?? 0, color: s.color }))
      .filter((d) => d.value > 0),
    [data]
  );
  const total = SLICES.reduce((acc, s) => acc + (data[s.key] ?? 0), 0);

  return (
    <Card
      className="break-inside-avoid p-4"
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : undefined }}
    >
      <CardTitleBar icon={PieChartIcon} title="Obligation Status" color="var(--brand)" />
      <div className={chartClass}>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="40%"
              cy="50%"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={2}
              stroke="var(--card)"
              strokeWidth={2}
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
              <Label content={<CenterLabel total={total} />} position="center" />
            </Pie>
            <Tooltip cursor={false} content={<ChartTooltip hideLabel valueFormatter={(v) => v.toLocaleString()} />} />
            <Legend
              iconType="circle"
              iconSize={8}
              layout="vertical"
              align="right"
              verticalAlign="middle"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: string, entry: any) =>
                `${value} (${(entry?.payload?.value ?? 0).toLocaleString()})`
              }
              wrapperStyle={{ fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
