import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import Sortable from "sortablejs";
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend, LabelList, Label,
} from "recharts";
import {
  RotateCcw, Download, Plus, Loader2,
  Boxes, ShieldAlert, Gauge, ClipboardList, FileWarning, Bell,
  PieChart as PieChartIcon, BarChart3, type LucideIcon,
} from "lucide-react";
import { api, ALERTS_URL, COMPLIANCE_URL, REGISTRY_URL } from "../api/client";
import { useToast, useHeader } from "../App";
import { navigateTo } from "../hooks/useLuigi";
import type { ComplianceStats, DashboardCard, DateRange, OverviewStats, AlertEvent } from "../types";
import { TIER_COLORS, statusColor } from "../utils";
import AttentionTable from "../components/AttentionTable";
import DashCard from "../components/DashCard";
import AddGraphModal from "../components/AddGraphModal";
import EditCardModal from "../components/EditCardModal";
import DateRangeFilter from "../components/DateRangeFilter";
import ObligationDonut from "../components/ObligationDonut";
import FrameworkBreakdown from "../components/FrameworkBreakdown";
import EvidenceGapCard from "../components/EvidenceGapCard";
import AlertFeed from "../components/AlertFeed";
import ComplianceTrend from "../components/ComplianceTrend";
import UpcomingDeadlines from "../components/UpcomingDeadlines";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartTooltip, chartClass } from "@/components/ui/chart";
import { CardTitleBar } from "../components/CardTitleBar";

const STORAGE_KEY = "ai_trust_overview_dashboard_v1";

function loadCards(): DashboardCard[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") || []; }
  catch { return []; }
}

function saveCards(cards: DashboardCard[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

interface KpiTileProps {
  label: string;
  value: ReactNode;
  color: string;
  sub: string;
  icon: LucideIcon;
  onClick: () => void;
}

function KpiTile({ label, value, color, sub, icon: Icon, onClick }: KpiTileProps) {
  return (
    <Card
      className="cursor-pointer gap-0 overflow-hidden p-5 transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--ring)_35%,var(--border))] hover:shadow-[var(--shadow-md)] print:translate-y-0 print:shadow-none"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
          <div className="my-1 text-[30px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">{value}</div>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
        {sub}
      </div>
    </Card>
  );
}

export default function Overview() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [complianceStats, setComplianceStats] = useState<ComplianceStats | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<AlertEvent[]>([]);
  const [assessments, setAssessments] = useState<{ id: string; score: number | null; updated_at: string; status: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>({ preset: "30d", days: 30 });
  const [cards, setCards] = useState<DashboardCard[]>(loadCards);
  const [addOpen, setAddOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<DashboardCard | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const showToast = useToast();
  const { alertCount } = useHeader();

  const sortableRef = useRef<Sortable | null>(null);
  const cardsRef = useRef<DashboardCard[]>(cards);
  cardsRef.current = cards;

  const refresh = useCallback(async () => {
    setLoading(true);
    // Cutoff for the assessment trend query — scope to the selected window (YYYY-MM-DD).
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - dateRange.days);
    const updatedAfter = cutoff.toISOString().slice(0, 10);
    try {
      const [s, cs, aa, assess] = await Promise.all([
        api.getStats(),
        api.getComplianceStats(dateRange.days),
        // Alerts and assessments degrade independently — a down alerts/compliance
        // backend must not fail the whole dashboard, so swallow their errors and
        // fall back to empty lists.
        api.getActiveAlerts().catch(() => [] as AlertEvent[]),
        api.getAssessments(updatedAfter).catch(() => []),
      ]);
      setStats(s);
      setComplianceStats(cs);
      setActiveAlerts(aa.slice(0, 5));
      setAssessments(assess);
    } catch (e) {
      showToast(`Failed to load dashboard: ${(e as Error).message}`, true);
    } finally {
      setLoading(false);
    }
  }, [dateRange.days, showToast]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const gridRefCallback = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      sortableRef.current = Sortable.create(node, {
        animation: 150,
        ghostClass: "sortable-ghost",
        handle: ".drag-handle",
        onEnd() {
          const newOrder = [...node.querySelectorAll<HTMLElement>(".dash-card")]
            .map((el) => el.dataset.cardId)
            .filter((id): id is string => !!id);
          const reordered = newOrder
            .map((id) => cardsRef.current.find((c) => c.id === id))
            .filter((c): c is DashboardCard => !!c);
          saveCards(reordered);
          setCards(reordered);
        },
      });
    } else {
      sortableRef.current?.destroy();
      sortableRef.current = null;
    }
  }, []);

  function addCard(card: DashboardCard) {
    if (cards.find((c) => c.id === card.id)) { showToast("Already on dashboard", true); return; }
    setCards((prev) => { const next = [...prev, card]; saveCards(next); return next; });
  }
  function removeCard(id: string) {
    setCards((prev) => { const next = prev.filter((c) => c.id !== id); saveCards(next); return next; });
  }
  function saveEdit(updated: DashboardCard) {
    setCards((prev) => { const next = prev.map((c) => c.id === updated.id ? updated : c); saveCards(next); return next; });
    setEditingCard(null);
    showToast("Graph updated");
  }
  function resetToDefaults() {
    if (!confirm("Reset dashboard to default layout? This will remove your current configuration.")) return;
    setCards([]);
    saveCards([]);
    showToast("Dashboard reset");
  }

  // Derived KPI values
  const { avg_compliance = 0, total_systems = 0, high_risk_on_market = 0 } = stats ?? {};
  const complianceColor = statusColor(avg_compliance);
  const highRiskColor   = high_risk_on_market > 0 ? "var(--warning)" : "var(--success)";

  const openObligations = complianceStats
    ? (complianceStats.obligation_status.applicable ?? 0)
      + (complianceStats.obligation_status.in_progress ?? 0)
      + (complianceStats.obligation_status.overdue ?? 0)
    : null;
  const evidenceGapCount = complianceStats
    ? (complianceStats.evidence_gap.expired ?? 0) + (complianceStats.evidence_gap.expiring_soon ?? 0)
    : null;
  const oblColor   = openObligations === null ? "var(--brand)" : openObligations > 0 ? "var(--warning)" : "var(--success)";
  const evdColor   = evidenceGapCount === null ? "var(--brand)" : evidenceGapCount > 0 ? "var(--destructive)" : "var(--success)";
  const alertColor = alertCount > 0 ? "var(--destructive)" : "var(--success)";

  // Chart data for existing fixed charts (kept as-is)
  const tierEntries = Object.entries(stats?.by_tier ?? {});
  const complianceEntries = Object.entries(stats?.compliance_by_tier ?? {});
  const tierData = tierEntries.map(([name, value]) => ({ name: name.replace(/-/g, " "), value }));
  const complianceData = complianceEntries.map(([name, value]) => ({ name: name.replace(/-/g, " "), value }));

  return (
    <div className="flex flex-col gap-5 p-8">

      {/* Controls bar */}
      <div className="flex items-center justify-between print:hidden">
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RotateCcw /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Download /> Export PDF
          </Button>
        </div>
      </div>

      {/* 6-tile KPI row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6 print:grid-cols-6">
        <KpiTile label="AI Systems" value={total_systems} color="var(--brand)"
          icon={Boxes} sub="registered in platform"
          onClick={() => navigateTo("/home/ai-system-registry", REGISTRY_URL)} />
        <KpiTile label="High-Risk Systems" value={high_risk_on_market} color={highRiskColor}
          icon={ShieldAlert} sub="on market / post-market"
          onClick={() => navigateTo("/home/ai-system-registry", REGISTRY_URL)} />
        <KpiTile label="Compliance Score" value={`${avg_compliance}%`} color={complianceColor}
          icon={Gauge} sub="average across all systems"
          onClick={() => navigateTo("/home/assessments", COMPLIANCE_URL)} />
        <KpiTile label="Open Obligations" value={openObligations ?? "—"} color={oblColor}
          icon={ClipboardList} sub="applicable + in progress + overdue"
          onClick={() => navigateTo("/home/obligations", COMPLIANCE_URL)} />
        <KpiTile label="Evidence Gap" value={evidenceGapCount ?? "—"} color={evdColor}
          icon={FileWarning} sub="expired or expiring soon"
          onClick={() => navigateTo("/home/evidence", COMPLIANCE_URL)} />
        <KpiTile label="Open Alerts" value={alertCount} color={alertColor}
          icon={Bell} sub="unhandled alerts"
          onClick={() => navigateTo("/home/alerts", ALERTS_URL)} />
      </div>

      {/* Fixed 3-col widget row: obligation donut | framework bar | evidence gap */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
        <ObligationDonut
          data={complianceStats?.obligation_status ?? { applicable: 0, in_progress: 0, overdue: 0, fulfilled: 0, not_applicable: 0 }}
          onClick={() => navigateTo("/home/obligations", COMPLIANCE_URL)}
        />
        <FrameworkBreakdown
          data={complianceStats?.framework_compliance ?? []}
          onClick={() => navigateTo("/home/assessments", COMPLIANCE_URL)}
        />
        <EvidenceGapCard
          data={complianceStats?.evidence_gap ?? { expired: 0, expiring_soon: 0, missing: 0 }}
          windowDays={dateRange.days}
          onClick={() => navigateTo("/home/evidence", COMPLIANCE_URL)}
        />
      </div>

      {/* 2-col row: compliance trend | alert feed */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 print:grid-cols-2">
        <ComplianceTrend
          assessments={assessments}
          windowDays={dateRange.days}
          onClick={() => navigateTo("/home/assessments", COMPLIANCE_URL)}
        />
        <AlertFeed alerts={activeAlerts} loading={loading && activeAlerts.length === 0} />
      </div>

      {/* Upcoming deadlines */}
      <UpcomingDeadlines
        deadlines={complianceStats?.upcoming_deadlines ?? []}
        windowDays={dateRange.days}
      />

      {/* Existing fixed charts (registry data) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 print:grid-cols-2">
        <Card className="break-inside-avoid p-4">
          <CardTitleBar icon={PieChartIcon} title="Systems by Risk Tier" color="var(--brand)" />
          {mounted && (
            <div className={chartClass}>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={tierData} dataKey="value" nameKey="name" cx="40%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} stroke="var(--card)" strokeWidth={2}>
                  {tierEntries.map(([tier]) => (
                    <Cell key={tier} fill={TIER_COLORS[tier as keyof typeof TIER_COLORS] ?? "#1147E9"} />
                  ))}
                  <Label
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    content={({ viewBox }: any) => {
                      const { cx = 0, cy = 0 } = viewBox ?? {};
                      return (
                        <>
                          <text x={cx} y={cy - 6} textAnchor="middle" dominantBaseline="middle"
                            style={{ fontSize: 22, fontWeight: 700, fill: "var(--text)" }}>
                            {total_systems.toLocaleString()}
                          </text>
                          <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="middle"
                            style={{ fontSize: 11, fill: "var(--text-secondary)" }}>
                            total
                          </text>
                        </>
                      );
                    }}
                    position="center"
                  />
                </Pie>
                <Tooltip cursor={false} content={<ChartTooltip hideLabel valueFormatter={(v) => v.toLocaleString()} />} />
                <Legend
                  iconType="circle" iconSize={8} layout="vertical" align="right" verticalAlign="middle"
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: string, entry: any) => `${value} (${(entry?.payload?.value ?? 0).toLocaleString()})`}
                  wrapperStyle={{ fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card className="break-inside-avoid p-4">
          <CardTitleBar icon={BarChart3} title="Avg Compliance by Tier" color="var(--brand)" />
          {mounted && (
            <div className={chartClass}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={complianceData} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
                <CartesianGrid stroke="var(--border)" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={110} tickLine={false} axisLine={false} />
                <Tooltip cursor={false} content={<ChartTooltip valueFormatter={(v) => `${v}%`} />} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={24}>
                  {complianceEntries.map(([tier, value]) => (
                    <Cell key={tier} fill={statusColor(value)} />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="right"
                    style={{ fontSize: 11, fill: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}
                    formatter={(v: number) => `${v}%`}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Attention table */}
      {stats && stats.attention.length > 0 && (
        <AttentionTable systems={stats.attention} />
      )}

      {/* Customisable analytics dashboard */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[15px] font-semibold tracking-[-0.01em]">Analytics Dashboard</span>
            <span className="text-xs text-muted-foreground">Your saved charts</span>
          </div>
          <div className="flex gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={resetToDefaults}>
              <RotateCcw /> Reset
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus /> Add Graph
            </Button>
          </div>
        </div>
        {cards.length === 0 ? (
          <Card className="flex flex-col items-center justify-center gap-2 border-dashed py-12 text-center">
            <h3 className="text-sm font-semibold">Analytics dashboard is empty</h3>
            <p className="text-[13px] text-muted-foreground">Add charts to customise your overview.</p>
            <Button className="mt-2" size="sm" onClick={() => setAddOpen(true)}>
              <Plus /> Add Graph
            </Button>
          </Card>
        ) : (
          <div
            className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 print:grid-cols-3"
            ref={gridRefCallback}
          >
            {stats && cards.map((card) => (
              <DashCard
                key={card.id}
                card={card}
                stats={stats}
                onEdit={(id) => setEditingCard(cards.find((c) => c.id === id) ?? null)}
                onRemove={removeCard}
              />
            ))}
          </div>
        )}
      </div>

      {addOpen && (
        <AddGraphModal
          activeIds={new Set(cards.map((c) => c.id))}
          stats={stats}
          onAdd={addCard}
          onRemove={removeCard}
          onClose={() => setAddOpen(false)}
        />
      )}
      {editingCard && (
        <EditCardModal
          card={editingCard}
          onSave={saveEdit}
          onClose={() => setEditingCard(null)}
        />
      )}
    </div>
  );
}
