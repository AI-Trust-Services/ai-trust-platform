import { useMemo } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, LabelList } from "recharts";
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

const COLOR_LEGEND = [
  { color: "#1a7a3c", label: "≥ 80% — On track" },
  { color: "#e05c00", label: "50–79% — Needs attention" },
  { color: "#bb0000", label: "< 50% — At risk" },
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
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ left: 0, right: 16, top: 16, bottom: 4 }}>
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
            <LabelList
              dataKey="score"
              position="top"
              style={{ fontSize: 11, fontWeight: 600, fill: "var(--text-secondary)" }}
              formatter={(v: number) => `${v}%`}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {/* Color coding legend */}
      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 8, flexWrap: "wrap" }}>
        {COLOR_LEGEND.map((l) => (
          <div key={l.color} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-secondary)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color, flexShrink: 0 }} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}