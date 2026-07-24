import { useEffect, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import type { DashboardCard, OverviewStats, RecentSystem } from "../types";
import { TierBadge, FormattedDate } from "./Badges";
import {
  TIER_COLORS, LIFECYCLE_COLORS, PALETTE, HIST_COLORS,
} from "../utils";

interface Props {
  card: DashboardCard;
  stats: OverviewStats;
  onEdit?: (id: string) => void;
  onRemove: (id: string) => void;
}

function colorFor(dataKey: string | undefined, label: string, index: number): string {
  if (dataKey === "by_tier") return TIER_COLORS[label as keyof typeof TIER_COLORS] ?? PALETTE[index % PALETTE.length];
  if (dataKey === "by_lifecycle") return LIFECYCLE_COLORS[label] ?? PALETTE[index % PALETTE.length];
  if (dataKey === "compliance_histogram") return HIST_COLORS[index % HIST_COLORS.length];
  return PALETTE[index % PALETTE.length];
}

function KpiCardBody({ card, stats }: { card: DashboardCard; stats: OverviewStats }) {
  const map: Record<string, { val: string | number; color: string; sub: string }> = {
    kpi_total_systems:  { val: stats.total_systems, color: "blue", sub: "registered systems" },
    kpi_high_risk:      { val: stats.high_count, color: stats.high_count > 0 ? "orange" : "green", sub: "high-risk" },
    kpi_avg_compliance: { val: `${stats.avg_compliance}%`, color: stats.avg_compliance >= 80 ? "green" : stats.avg_compliance >= 50 ? "orange" : "red", sub: "avg compliance" },
    kpi_total_models:   { val: stats.total_models, color: "blue", sub: "model cards" },
  };
  const kpi = map[card.id] ?? { val: "—", color: "", sub: "" };
  return (
    <div className="dash-card-body">
      <div className={`dash-kpi-value ${kpi.color}`}>{kpi.val}</div>
      <div className="dash-kpi-sub">{kpi.sub}</div>
    </div>
  );
}

function ChartCardBody({ card, stats }: { card: DashboardCard; stats: OverviewStats }) {
  const rawData = card.dataKey ? (stats[card.dataKey] as Record<string, number> | undefined) ?? {} : {};
  const entries = Object.entries(rawData);

  if (!entries.length) {
    return (
      <div className="dash-card-body" style={{ alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: 13 }}>
        No data yet
      </div>
    );
  }

  const chartData = entries.map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
  const isCompliance = card.dataKey === "compliance_by_tier";
  const isPie = card.type === "pie" || card.type === "doughnut";
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <div className="dash-card-body">
      <div className="chart-wrap">
        {mounted && (
        <ResponsiveContainer width="100%" height={220}>
          {isPie ? (
            <PieChart>
              <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="70%">
                {chartData.map((entry, i) => (
                  <Cell key={entry.name} fill={colorFor(card.dataKey, entries[i][0], i)} />
                ))}
              </Pie>
              <Tooltip formatter={(val: number) => val.toLocaleString()} />
            </PieChart>
          ) : (
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e6e8" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11 }}
                tickFormatter={isCompliance ? (v: number) => `${v}%` : undefined}
              />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={110} />
              <Tooltip formatter={(val: number) => isCompliance ? `${val}%` : val.toLocaleString()} />
              <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={entry.name} fill={colorFor(card.dataKey, entries[i][0], i)} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function TableCardBody({ stats }: { stats: OverviewStats }) {
  const rows: RecentSystem[] = stats.recent ?? [];
  if (!rows.length) {
    return (
      <div className="dash-card-body" style={{ color: "var(--text-secondary)", fontSize: 13 }}>
        No systems yet
      </div>
    );
  }
  return (
    <div className="dash-card-body" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th>System</th>
            <th>Tier</th>
            <th>Registered</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <div style={{ fontWeight: 500 }}>{r.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{r.id}</div>
              </td>
              <td><TierBadge tier={r.tier} /></td>
              <td style={{ color: "var(--text-secondary)" }}><FormattedDate iso={r.created_at} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DashCard({ card, stats, onEdit, onRemove }: Props) {
  const isKpi   = card.type === "kpi";
  const isTable = card.type === "table";
  const cls     = isKpi ? "kpi" : isTable ? "table-card" : "chart";

  return (
    <div className={`dash-card ${cls}`} data-card-id={card.id}>
      <div className="dash-card-header">
        <span className="dash-card-title">{card.title}</span>
        <div className="dash-card-actions">
          {!isKpi && onEdit && (
            <button className="btn-icon" title="Edit" onClick={() => onEdit(card.id)}>✎</button>
          )}
          <span className="drag-handle">⠿</span>
          <button className="btn-icon" title="Remove" onClick={() => onRemove(card.id)}>✕</button>
        </div>
      </div>
      {isKpi   && <KpiCardBody   card={card} stats={stats} />}
      {isTable && <TableCardBody stats={stats} />}
      {!isKpi && !isTable && <ChartCardBody card={card} stats={stats} />}
    </div>
  );
}
