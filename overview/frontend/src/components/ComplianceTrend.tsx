import { useMemo } from "react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ChartTooltip, chartClass } from "@/components/ui/chart";
import { CardTitleBar } from "./CardTitleBar";

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
  { color: "var(--brand)", dash: false, label: "Avg compliance score" },
  { color: "var(--success)", dash: true,  label: "80% — on track" },
  { color: "var(--warning)", dash: true,  label: "50% — needs attention" },
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
    <Card
      className="flex break-inside-avoid flex-col p-4"
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : undefined }}
    >
      <CardTitleBar
        icon={TrendingUp}
        title="Compliance Score Trend"
        color="var(--brand)"
        sub={`avg score of approved assessments — last ${windowDays} days`}
      />

      {trendData.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-10 text-[13px] text-muted-foreground">
          No approved assessments in the last {windowDays} days
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1">
            <div className={chartClass}>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={trendData} margin={{ top: 8, right: 40, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.14} />
                      <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} unit="%" width={36} />
                  <Tooltip
                    cursor={{ stroke: "var(--border)" }}
                    content={<ChartTooltip valueFormatter={(v) => `${v}%`} nameFormatter={() => "Avg Score"} />}
                  />
                  <ReferenceLine y={80} stroke="var(--success)" strokeDasharray="4 2" />
                  <ReferenceLine y={50} stroke="var(--warning)" strokeDasharray="4 2" />
                  <Area
                    type="monotone"
                    dataKey="score"
                    stroke="none"
                    fill="url(#trendFill)"
                    tooltipType="none"
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="var(--brand)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "var(--brand)", strokeWidth: 0 }}
                    activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-2.5 flex flex-wrap justify-center gap-4">
            {LEGEND.map((l) => (
              <div key={l.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
    </Card>
  );
}
