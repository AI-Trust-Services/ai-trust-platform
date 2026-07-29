import { useMemo } from "react";
import type { RiskHeatCell } from "../types";
import { TIER_COLORS, TIER_LABELS } from "../utils";

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

const Y_ROWS = [
  { y: 90, label: "0–20%",   desc: "Very high risk" },
  { y: 70, label: "20–40%",  desc: "High risk"      },
  { y: 50, label: "40–60%",  desc: "Medium risk"    },
  { y: 30, label: "60–80%",  desc: "Low risk"       },
  { y: 10, label: "80–100%", desc: "Very low risk"  },
];

export default function RiskHeatMap({ data, onClick }: Props): JSX.Element {
  // Build lookup: "tier_x:residual_y" -> cell
  const lookup = useMemo(() => {
    const m: Record<string, RiskHeatCell> = {};
    for (const d of data) m[`${d.tier_x}:${d.residual_risk_y}`] = d;
    return m;
  }, [data]);

  // Map tier_x back to a tier string for colour lookup
  const tierByX = useMemo(() => {
    const m: Record<number, string> = {};
    for (const d of data) m[d.tier_x] = d.tier;
    return m;
  }, [data]);

  return (
    <div className="chart-card" onClick={onClick} style={{ cursor: onClick ? "pointer" : undefined, display: "flex", flexDirection: "column" }}>
      <div className="chart-title">Risk Heat Map</div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>
        X = inherent risk tier · Y = residual risk (100 − compliance%)
      </div>
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
          {/* Grid rows */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
            {Y_ROWS.map((row) => (
              <div key={row.y} style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${X_COLS.length}, 1fr)`, gap: 3 }}>
                {X_COLS.map((col) => {
                  const cell = lookup[`${col.x}:${row.y}`];
                  const count = cell?.count ?? 0;
                  const tier = tierByX[col.x] ?? "";
                  const bg = count > 0 ? (TIER_COLORS[tier as keyof typeof TIER_COLORS] ?? "#0a6ed1") : "#f0f1f2";
                  const opacity = count > 0 ? Math.min(0.35 + (count / 8) * 0.65, 1) : 1;
                  return (
                    <div
                      key={`${col.x}:${row.y}`}
                      title={count > 0 ? `${TIER_LABELS[tier as keyof typeof TIER_LABELS] ?? tier} · ${row.desc} · ${count} system${count !== 1 ? "s" : ""}` : undefined}
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
    </div>
  );
}