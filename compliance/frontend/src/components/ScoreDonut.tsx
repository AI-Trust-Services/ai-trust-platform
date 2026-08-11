import { PieChart, Pie, Cell } from "recharts";
import { ScoreBar } from "./Badges";
import type { AssessmentDetail } from "../types";

interface Props {
  detail: AssessmentDetail;
}

export default function ScoreDonut({ detail }: Props) {
  if (detail.score === null) {
    return (
      <div style={{ padding: "8px 0" }}>
        <ScoreBar score={null} />
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>
          {detail.fulfilled_count} / {detail.obligation_count} obligations fulfilled
        </div>
      </div>
    );
  }

  const score = detail.score;
  const color = score >= 80 ? "#16a34a" : score >= 50 ? "#f59e0b" : "#dc2626";
  const data = [{ value: score }, { value: 100 - score }];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "8px 0" }}>
      <div style={{ position: "relative", width: 80, height: 80 }}>
        <PieChart width={80} height={80} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Pie data={data} dataKey="value" cx={40} cy={40} innerRadius={26} outerRadius={36} startAngle={90} endAngle={-270} paddingAngle={0}>
            <Cell fill={color} />
            <Cell fill="var(--border)" />
          </Pie>
        </PieChart>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color }}>
          {score}%
        </div>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{score}% compliant</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
          {detail.fulfilled_count} / {detail.obligation_count} obligations fulfilled
        </div>
      </div>
    </div>
  );
}
