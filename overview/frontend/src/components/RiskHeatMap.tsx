import type { RiskHeatCell } from "../types";
import { useMemo } from "react";
import { Grid3x3 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CardTitleBar } from "./CardTitleBar";

interface Props {
  data: RiskHeatCell[];
  onClick?: () => void;
}

const X_COLS = [
  { x: 1, label: "Minimal" },
  { x: 2, label: "Limited" },
  { x: 3, label: "High" },
  { x: 4, label: "Prohibited" },
];

// Y rows ordered best → worst (80–100% at top)
const Y_ROWS = [
  { y: 10, label: "80–100%", desc: "High compliance" },
  { y: 30, label: "60–80%",  desc: "Good compliance" },
  { y: 50, label: "40–60%",  desc: "Medium compliance" },
  { y: 70, label: "20–40%",  desc: "Low compliance" },
  { y: 90, label: "0–20%",   desc: "Critical — very low compliance" },
];

// Severity color: combines tier (x) and compliance (y = residual risk).
// High tier + low compliance = red. Low tier + high compliance = green.
function severityColor(tierX: number, residualY: number): string {
  // residualY: 10=good(80-100%), 90=bad(0-20%). tierX: 1=minimal, 4=prohibited.
  // Score 0–1 where 1 = most severe
  const tierSeverity  = (tierX - 1) / 3;        // 0..1
  const compSeverity  = (residualY - 10) / 80;   // 0..1 (10=best, 90=worst)
  const combined = (tierSeverity * 0.5) + (compSeverity * 0.5);

  if (combined < 0.25) return "#1a7a3c"; // green
  if (combined < 0.45) return "#3d9e6b"; // light green
  if (combined < 0.60) return "#e9a922"; // amber
  if (combined < 0.75) return "#e05c00"; // orange
  return "#bb0000";                       // red
}

export default function RiskHeatMap({ data, onClick }: Props) {
  const lookup = useMemo(() => {
    const m: Record<string, RiskHeatCell> = {};
    for (const d of data) m[`${d.tier_x}:${d.residual_risk_y}`] = d;
    return m;
  }, [data]);

  const isEmpty = data.length === 0;

  return (
    <Card
      className="flex break-inside-avoid flex-col p-4"
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : undefined }}
    >
      <CardTitleBar
        icon={Grid3x3}
        title="Risk Heat Map"
        color="#bb0000"
        sub="Systems by risk tier and compliance level — red cells need immediate attention"
      />

      {isEmpty ? (
        <div className="flex flex-1 items-center justify-center py-10 text-[13px] text-muted-foreground">
          No systems registered
        </div>
      ) : (
        <>
          <div className="flex flex-1 gap-2">
            {/* Y-axis labels */}
            <div className="flex flex-col justify-around pb-5">
              {Y_ROWS.map((row) => (
                <div key={row.y} className="w-[50px] text-right text-[10px] text-muted-foreground">
                  {row.label}
                </div>
              ))}
            </div>
            {/* Grid + X labels */}
            <div className="flex flex-1 flex-col gap-[3px]">
              <div className="flex flex-1 flex-col gap-[3px]">
                {Y_ROWS.map((row) => (
                  <div key={row.y} className="grid flex-1 gap-[3px]" style={{ gridTemplateColumns: `repeat(${X_COLS.length}, 1fr)` }}>
                    {X_COLS.map((col) => {
                      const cell = lookup[`${col.x}:${row.y}`];
                      const count = cell?.count ?? 0;
                      const bg = count > 0 ? severityColor(col.x, row.y) : "#f0f1f2";
                      const opacity = count > 0 ? Math.min(0.4 + (count / 8) * 0.6, 1) : 1;
                      return (
                        <div
                          key={`${col.x}:${row.y}`}
                          title={count > 0 ? `${col.label} · ${row.desc} · ${count} system${count !== 1 ? "s" : ""}` : `${col.label} · ${row.label} · no systems`}
                          className="flex min-h-7 items-center justify-center rounded text-[11px] font-semibold"
                          style={{
                            background: bg,
                            opacity,
                            color: count > 0 ? "#fff" : "transparent",
                          }}
                        >
                          {count > 0 ? count : ""}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              {/* X-axis labels */}
              <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${X_COLS.length}, 1fr)` }}>
                {X_COLS.map((col) => (
                  <div key={col.x} className="text-center text-[10px] text-muted-foreground">
                    {col.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Color legend */}
          <div className="mt-2.5 flex flex-wrap justify-center gap-3">
            {[
              { color: "#1a7a3c", label: "Low risk" },
              { color: "#e9a922", label: "Medium risk" },
              { color: "#e05c00", label: "High risk" },
              { color: "#bb0000", label: "Critical" },
            ].map((l) => (
              <div key={l.color} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: l.color }} />
                {l.label}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
