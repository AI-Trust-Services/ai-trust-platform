import { PieChart, Pie, Cell } from "recharts";
import { ScoreBar } from "./Badges";
import type { AssessmentDetail } from "../types";

interface Props {
  detail: AssessmentDetail;
}

export default function ScoreDonut({ detail }: Props) {
  if (detail.score === null) {
    return (
      <div className="py-2">
        <ScoreBar score={null} />
        <div className="mt-1.5 text-xs text-muted-foreground">
          {detail.fulfilled_count} / {detail.obligation_count} obligations fulfilled
        </div>
      </div>
    );
  }

  const score = detail.score;
  const color = score >= 80 ? "var(--success)" : score >= 50 ? "var(--warning)" : "var(--destructive)";
  const data = [{ value: score }, { value: 100 - score }];

  return (
    <div className="flex items-center gap-4 py-2">
      <div className="relative size-20">
        <PieChart width={80} height={80} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Pie data={data} dataKey="value" cx={40} cy={40} innerRadius={26} outerRadius={36} startAngle={90} endAngle={-270} paddingAngle={0}>
            <Cell fill={color} />
            <Cell fill="var(--border)" />
          </Pie>
        </PieChart>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold" style={{ color }}>
          {score}%
        </div>
      </div>
      <div>
        <div className="text-[13px] font-semibold text-foreground">{score}% compliant</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {detail.fulfilled_count} / {detail.obligation_count} obligations fulfilled
        </div>
      </div>
    </div>
  );
}
