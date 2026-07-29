import { useMemo } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import type { RiskHeatCell } from "../types";
import { TIER_COLORS, TIER_LABELS } from "../utils";

interface Props {
  data: RiskHeatCell[];
  onClick?: () => void;
}

const X_TICKS = [1, 2, 3, 4];
const X_LABELS: Record<number, string> = { 1: "Minimal", 2: "Limited", 3: "High", 4: "Prohibited" };
const Y_LABELS: Record<number, string> = { 10: "80–100%", 30: "60–80%", 50: "40–60%", 70: "20–40%", 90: "0–20%" };

function CustomDot(props: {
  cx?: number; cy?: number;
  payload?: RiskHeatCell;
}): JSX.Element {
  const { cx = 0, cy = 0, payload } = props;
  if (!payload) return <g />;
  const r = Math.max(8, Math.sqrt(payload.count) * 6);
  const fill = TIER_COLORS[payload.tier as keyof typeof TIER_COLORS] ?? "#0a6ed1";
  return (
    <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.75} stroke={fill} strokeWidth={1} />
  );
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: RiskHeatCell }[] }): JSX.Element | null {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const tierLabel = TIER_LABELS[d.tier as keyof typeof TIER_LABELS] ?? d.tier;
  const riskBand = Y_LABELS[d.residual_risk_y] ?? `${d.residual_risk_y}%`;
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px", fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{tierLabel}</div>
      <div style={{ color: "var(--text-secondary)" }}>Compliance: {riskBand}</div>
      <div style={{ color: "var(--text-secondary)" }}>{d.count} system{d.count !== 1 ? "s" : ""}</div>
    </div>
  );
}

export default function RiskHeatMap({ data, onClick }: Props): JSX.Element {
  const points = useMemo(() => data.map((d) => ({ ...d })), [data]);

  return (
    <div className="chart-card" onClick={onClick} style={{ cursor: onClick ? "pointer" : undefined }}>
      <div className="chart-title">Risk Heat Map</div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>
        X = inherent risk tier · Y = residual risk (100 − compliance%)
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e6e8" />
          <XAxis
            type="number"
            dataKey="tier_x"
            domain={[0.5, 4.5]}
            ticks={X_TICKS}
            tickFormatter={(v: number) => X_LABELS[v] ?? ""}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="residual_risk_y"
            domain={[0, 100]}
            ticks={[10, 30, 50, 70, 90]}
            tickFormatter={(v: number) => Y_LABELS[v] ?? `${v}%`}
            tick={{ fontSize: 11 }}
            width={64}
          />
          <Tooltip content={<CustomTooltip />} />
          <Scatter data={points} shape={<CustomDot />} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}