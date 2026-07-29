import { useMemo } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import type { FrameworkScore } from "../types";

interface Props {
  data: FrameworkScore[];
  onClick?: () => void;
}

function scoreColor(score: number | null): string {
  if (score === null) return "#cccccc";
  if (score >= 80) return "#1a7a3c";
  if (score >= 50) return "#e05c00";
  return "#bb0000";
}

export default function FrameworkBreakdown({ data, onClick }: Props): JSX.Element {
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
      <div className="chart-card">
        <div className="chart-title">Framework Compliance</div>
        <div style={{ color: "var(--text-secondary)", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          No enabled frameworks
        </div>
      </div>
    );
  }

  return (
    <div className="chart-card" onClick={onClick} style={{ cursor: onClick ? "pointer" : undefined }}>
      <div className="chart-title">Framework Compliance</div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e6e8" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} width={36} />
          <Tooltip
            formatter={(v: number, _: string, props: { payload?: { fullName: string; fulfilled: number; total: number } }) =>
              [`${v}% (${props.payload?.fulfilled ?? 0}/${props.payload?.total ?? 0} fulfilled)`, props.payload?.fullName ?? ""]
            }
          />
          <Bar dataKey="score" radius={[3, 3, 0, 0]}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}