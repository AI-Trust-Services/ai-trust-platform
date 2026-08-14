import { useMemo } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import { ASSESSMENT_STATUS_META } from "../utils";
import type { Assessment } from "../types";
import { Card } from "@/components/ui/card";

const STATUS_COLORS: Record<string, string> = {
  draft:        "#94a3b8",
  submitted:    "#f59e0b",
  under_review: "#8b5cf6",
  approved:     "#16a34a",
};

const TYPE_COLORS: Record<string, string> = {
  compliance:           "#0a6ed1",
  risk:                 "#dc2626",
  privacy:              "#8b5cf6",
  security:             "#0891b2",
  fairness:             "#f59e0b",
  transparency:         "#16a34a",
  human_oversight:      "#db2777",
  operational_readiness:"#65a30d",
  third_party:          "#ea580c",
};

interface Props {
  assessments: Assessment[];
}

const chartTitle = "mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

export default function AssessmentCharts({ assessments }: Props) {
  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of assessments) counts[a.status] = (counts[a.status] ?? 0) + 1;
    return Object.entries(counts).map(([status, value]) => ({
      name: ASSESSMENT_STATUS_META[status]?.label ?? status,
      value,
      status,
    }));
  }, [assessments]);

  const typeData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of assessments) counts[a.type] = (counts[a.type] ?? 0) + 1;
    return Object.entries(counts).map(([type, value]) => ({
      type,
      name: type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      value,
    }));
  }, [assessments]);

  const trendData = useMemo(() => {
    const approved = assessments.filter((a) => a.status === "approved" && a.score !== null);
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
  }, [assessments]);

  if (assessments.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-4">
          <div className={chartTitle}>Assessments by Status</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2}>
                {statusData.map((entry) => (
                  <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number, name: string) => [v, name]} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <div className={chartTitle}>Assessments by Type</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2}>
                {typeData.map((entry) => (
                  <Cell key={entry.name} fill={TYPE_COLORS[entry.type] ?? "#94a3b8"} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number, name: string) => [v, name]} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {trendData.length > 0 && (
        <Card className="p-4">
          <div className={chartTitle}>Average Score Trend (Approved Assessments)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} unit="%" />
              <Tooltip formatter={(v: number) => [`${v}%`, "Avg Score"]} />
              <Line type="monotone" dataKey="score" stroke="#0a6ed1" strokeWidth={2} dot={{ r: 4, fill: "#0a6ed1" }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}
