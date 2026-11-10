import { useEffect, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend, LabelList,
} from "recharts";
import { Pencil, X, GripVertical, BarChart3, PieChart as PieChartIcon, Table as TableIcon, Hash } from "lucide-react";
import type { DashboardCard, OverviewStats, RecentSystem } from "../types";
import { TierBadge, FormattedDate } from "./Badges";
import {
  TIER_COLORS, LIFECYCLE_COLORS, PALETTE, HIST_COLORS, statusColor,
} from "../utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartTooltip, chartClass } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

interface Props {
  card: DashboardCard;
  stats: OverviewStats;
  onEdit?: (id: string) => void;
  onRemove: (id: string) => void;
}

const KPI_COLORS: Record<string, string> = {
  red: "var(--destructive)", orange: "var(--warning)", green: "var(--success)", blue: "var(--brand)",
};

function colorFor(dataKey: string | undefined, label: string, index: number, value: number): string {
  if (dataKey === "compliance_by_tier") return statusColor(value);
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
  const kpi = map[card.id] ?? { val: "—", color: "blue", sub: "" };
  return (
    <div className="flex flex-1 flex-col p-4">
      <div className="text-[28px] font-semibold leading-none tabular-nums text-foreground">{kpi.val}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: KPI_COLORS[kpi.color] }} />
        {kpi.sub}
      </div>
    </div>
  );
}

function ChartCardBody({ card, stats }: { card: DashboardCard; stats: OverviewStats }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawData = card.dataKey ? ((stats as any)[card.dataKey] as Record<string, number> | undefined) ?? {} : {};
  const entries = Object.entries(rawData);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!entries.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-[13px] text-muted-foreground">
        No data yet
      </div>
    );
  }

  const chartData = entries.map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
  const isCompliance = card.dataKey === "compliance_by_tier";
  const isPie = card.type === "pie" || card.type === "doughnut";
  const total = entries.reduce((acc, [, v]) => acc + v, 0);

  return (
    <div className="flex flex-1 flex-col p-4">
      <div className={cn("min-h-[220px] flex-1", chartClass)}>
        {mounted && (
        <ResponsiveContainer width="100%" height={240}>
          {isPie ? (
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%" cy="50%"
                outerRadius="60%"
                stroke="var(--card)"
                strokeWidth={2}
                label={({ value }) => `${((value / total) * 100).toFixed(0)}%`}
                labelLine={true}
              >
                {chartData.map((entry, i) => (
                  <Cell key={entry.name} fill={colorFor(card.dataKey, entries[i][0], i, entries[i][1])} />
                ))}
              </Pie>
              <Tooltip cursor={false} content={<ChartTooltip hideLabel valueFormatter={(v) => v.toLocaleString()} />} />
              <Legend
                iconType="circle"
                iconSize={8}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: string, entry: any) => `${value} (${(entry?.payload?.value ?? 0).toLocaleString()})`}
                wrapperStyle={{ fontSize: 11 }}
              />
            </PieChart>
          ) : (
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
              <CartesianGrid stroke="var(--border)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={isCompliance ? (v: number) => `${v}%` : undefined}
              />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={110} tickLine={false} axisLine={false} />
              <Tooltip cursor={false} content={<ChartTooltip valueFormatter={(v) => (isCompliance ? `${v}%` : v.toLocaleString())} />} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={28}>
                {chartData.map((entry, i) => (
                  <Cell key={entry.name} fill={colorFor(card.dataKey, entries[i][0], i, entries[i][1])} />
                ))}
                <LabelList
                  dataKey="value"
                  position="right"
                  style={{ fontSize: 11, fill: "var(--text-secondary)" }}
                  formatter={(v: number) => isCompliance ? `${v}%` : v.toLocaleString()}
                />
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
  const rows: RecentSystem[] = (stats.recent ?? []).slice(0, 5);
  if (!rows.length) {
    return (
      <div className="flex flex-1 flex-col p-4 text-[13px] text-muted-foreground">
        No systems yet
      </div>
    );
  }
  return (
    <div className="flex flex-1 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>System</TableHead>
            <TableHead>Tier</TableHead>
            <TableHead>Registered</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <div className="font-medium">{r.name}</div>
                <div className="text-[11px] text-muted-foreground">{r.id}</div>
              </TableCell>
              <TableCell><TierBadge tier={r.tier} /></TableCell>
              <TableCell className="text-muted-foreground"><FormattedDate iso={r.created_at} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function DashCard({ card, stats, onEdit, onRemove }: Props) {
  const isKpi   = card.type === "kpi";
  const isTable = card.type === "table";
  const HeadIcon = isKpi ? Hash
    : isTable ? TableIcon
    : (card.type === "pie" || card.type === "doughnut") ? PieChartIcon
    : BarChart3;

  return (
    <Card
      className={cn(
        "dash-card flex break-inside-avoid flex-col overflow-hidden p-0",
        isKpi ? "min-h-[100px]" : "min-h-[300px]",
      )}
      data-card-id={card.id}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <HeadIcon className="size-3.5" />
          </span>
          <span className="truncate text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{card.title}</span>
        </div>
        <div className="flex gap-1 print:hidden">
          {!isKpi && onEdit && (
            <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" title="Edit" onClick={() => onEdit(card.id)}>
              <Pencil />
            </Button>
          )}
          <span className="drag-handle flex cursor-grab items-center px-1 text-muted-foreground opacity-40 hover:opacity-100">
            <GripVertical className="size-4" />
          </span>
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" title="Remove" onClick={() => onRemove(card.id)}>
            <X />
          </Button>
        </div>
      </div>
      {isKpi   && <KpiCardBody   card={card} stats={stats} />}
      {isTable && <TableCardBody stats={stats} />}
      {!isKpi && !isTable && <ChartCardBody card={card} stats={stats} />}
    </Card>
  );
}
