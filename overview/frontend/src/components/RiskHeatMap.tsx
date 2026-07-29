import type { RiskHeatCell } from "../types";
import { useMemo } from "react";

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
  if (combined < 0.45) return "#5a9e6f"; // light green
  if (combined < 0.60) return "#e9a922"; // amber
  if (combined < 0.75) return "#e05c00"; // orange
  return "#bb0000";                       // red
}

export default function RiskHeatMap({ data, onClick }: Props): JSX.Element {
  const lookup = useMemo(() => {
    const m: Record<string, RiskHeatCell> = {};
    for (const d of data) m[`${d.tier_x}:${d.residual_risk_y}`] = d;
    return m;
  }, [data]);

  const isEmpty = data.length === 0;

  return (
    <div className="chart-card" onClick={onClick} style={{ cursor: onClick ? "pointer" : undefined, display: "flex", flexDirection: "column" }}>
      <div className="chart-title">Risk Heat Map</div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>
        Systems by risk tier and compliance level — red cells need immediate attention
      </div>

      {isEmpty ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: 13 }}>
          No systems registered
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flex: 1 }}>
            {/* Y-axis labels */}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", paddingBottom: 20 }}>
              {Y_ROWS.map((row) => (
                <div key={row.y} style={{ fontSize: 10, color: "var(--text-secondary)", textAlign: "right", width: 50 }}>
                  {row.label}
                </div>
              ))}
            </div>
            {/* Grid + X labels */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                {Y_ROWS.map((row) => (
                  <div key={row.y} style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${X_COLS.length}, 1fr)`, gap: 3 }}>
                    {X_COLS.map((col) => {
                      const cell = lookup[`${col.x}:${row.y}`];
                      const count = cell?.count ?? 0;
                      const bg = count > 0 ? severityColor(col.x, row.y) : "#f0f1f2";
                      const opacity = count > 0 ? Math.min(0.4 + (count / 8) * 0.6, 1) : 1;
                      return (
                        <div
                          key={`${col.x}:${row.y}`}
                          title={count > 0 ? `${col.label} · ${row.desc} · ${count} system${count !== 1 ? "s" : ""}` : `${col.label} · ${row.label} · no systems`}
                          style={{
                            borderRadius: 4,
                            background: bg,
                            opacity,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            fontWeight: 600,
                            color: count > 0 ? "#fff" : "transparent",
                            minHeight: 28,
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
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${X_COLS.length}, 1fr)`, gap: 3 }}>
                {X_COLS.map((col) => (
                  <div key={col.x} style={{ fontSize: 10, color: "var(--text-secondary)", textAlign: "center" }}>
                    {col.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Color legend */}
          <div style={{ display: "flex", gap: 12, marginTop: 10, justifyContent: "center", flexWrap: "wrap" }}>
            {[
              { color: "#1a7a3c", label: "Low risk" },
              { color: "#e9a922", label: "Medium risk" },
              { color: "#e05c00", label: "High risk" },
              { color: "#bb0000", label: "Critical" },
            ].map((l) => (
              <div key={l.color} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-secondary)" }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color, flexShrink: 0 }} />
                {l.label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}