import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

interface Assessment {
  id: string;
  score: number | null;
  updated_at: string;
  status: string;
}

interface Props {
  assessments: Assessment[];
  windowDays: number;
  onClick?: () => void;
}

const LEGEND = [
  { color: "#0a6ed1", dash: false, label: "Avg compliance score" },
  { color: "#1a7a3c", dash: true,  label: "80% — on track" },
  { color: "#e05c00", dash: true,  label: "50% — needs attention" },
];

export default function ComplianceTrend({ assessments, windowDays, onClick }: Props) {
  const trendData = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);

    const approved = assessments.filter(
      (a) => a.status === "approved" && a.score !== null && new Date(a.updated_at) >= cutoff
    );

    if (approved.length === 0) return [];

    const byDay: Record<string, number[]> = {};
    for (const a of approved) {
      const day = new Date(a.updated_at).toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(a.score as number);
    }

    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, scores]) => ({
        day,
        score: Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10,
      }));
  }, [assessments, windowDays]);

  return (
    <div className="chart-card" onClick={onClick} style={{ cursor: onClick ? "pointer" : undefined, display: "flex", flexDirection: "column" }}>
      <div className="chart-title">
        Compliance Score Trend
        <span style={{ fontWeight: 400, color: "var(--text-secondary)", fontSize: 11, marginLeft: 8 }}>
          avg score of approved assessments — last {windowDays} days
        </span>
      </div>

      {trendData.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: 13 }}>
          No approved assessments in the last {windowDays} days
        </div>
      ) : (
        <>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 40, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e6e8" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} unit="%" width={36} />
                <Tooltip formatter={(v: number) => [`${v}%`, "Avg Score"]} />
                <ReferenceLine y={80} stroke="#1a7a3c" strokeDasharray="4 2" />
                <ReferenceLine y={50} stroke="#e05c00" strokeDasharray="4 2" />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#0a6ed1"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "#0a6ed1" }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
            {LEGEND.map((l) => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)" }}>
                <svg width="20" height="12">
                  {l.dash
                    ? <line x1="0" y1="6" x2="20" y2="6" stroke={l.color} strokeWidth="2" strokeDasharray="4 2" />
                    : <line x1="0" y1="6" x2="20" y2="6" stroke={l.color} strokeWidth="2" />
                  }
                </svg>
                {l.label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}