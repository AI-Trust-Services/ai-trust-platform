import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { ObligationStatusCounts } from "../types";

interface Props {
  data: ObligationStatusCounts;
  onClick?: () => void;
}

const SLICES = [
  { key: "fulfilled",      label: "Fulfilled",      color: "#1a7a3c" },
  { key: "in_progress",    label: "In Progress",    color: "#0a6ed1" },
  { key: "applicable",     label: "Applicable",     color: "#e9a922" },
  { key: "overdue",        label: "Overdue",        color: "#bb0000" },
  { key: "not_applicable", label: "Not Applicable", color: "#999999" },
] as const;

export default function ObligationDonut({ data, onClick }: Props): JSX.Element {
  const chartData = useMemo(() =>
    SLICES.map((s) => ({ name: s.label, value: data[s.key] ?? 0, color: s.color }))
      .filter((d) => d.value > 0),
    [data]
  );
  const total = SLICES.reduce((acc, s) => acc + (data[s.key] ?? 0), 0);

  return (
    <div className="chart-card" onClick={onClick} style={{ cursor: onClick ? "pointer" : undefined }}>
      <div className="chart-title">Obligation Status</div>
      {/* position:relative so the center label can be absolutely placed over the donut hole */}
      <div style={{ position: "relative" }}>
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
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number) => v.toLocaleString()} />
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
        {/* Center label — absolutely positioned over the donut hole (cx=40%, cy=50%) */}
        <div style={{
          position: "absolute", top: "50%", left: "26.6%",
          transform: "translate(-50%, -50%)",
          textAlign: "center", pointerEvents: "none",
        }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>
            {total.toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3 }}>total</div>
        </div>
      </div>
    </div>
  );
}