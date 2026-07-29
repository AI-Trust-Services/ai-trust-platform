import { useState, useEffect, useCallback, useRef } from "react";
import Sortable from "sortablejs";
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { api, ALERTS_URL, COMPLIANCE_URL, REGISTRY_URL } from "../api/client";
import { useToast, useHeader } from "../App";
import { navigateTo } from "../hooks/useLuigi";
import type { ComplianceStats, DashboardCard, DateRange, OverviewStats, AlertEvent } from "../types";
import { TIER_COLORS, LIFECYCLE_COLORS } from "../utils";
import AttentionTable from "../components/AttentionTable";
import DashCard from "../components/DashCard";
import AddGraphModal from "../components/AddGraphModal";
import EditCardModal from "../components/EditCardModal";
import DateRangeFilter from "../components/DateRangeFilter";
import ObligationDonut from "../components/ObligationDonut";
import FrameworkBreakdown from "../components/FrameworkBreakdown";
import EvidenceGapCard from "../components/EvidenceGapCard";
import RiskHeatMap from "../components/RiskHeatMap";
import AlertFeed from "../components/AlertFeed";
import UpcomingDeadlines from "../components/UpcomingDeadlines";

const STORAGE_KEY = "ai_trust_overview_dashboard_v1";

function loadCards(): DashboardCard[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") || []; }
  catch { return []; }
}

function saveCards(cards: DashboardCard[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

export default function Overview() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [complianceStats, setComplianceStats] = useState<ComplianceStats | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<AlertEvent[]>([]);
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
    try {
      const [s, cs, aa] = await Promise.all([
        api.getStats(),
        api.getComplianceStats(dateRange.days),
        // Alerts degrade independently — a down alerts backend must not fail the
        // whole dashboard, so swallow its error and fall back to an empty list.
        api.getActiveAlerts().catch(() => [] as AlertEvent[]),
      ]);
      setStats(s);
      setComplianceStats(cs);
      setActiveAlerts(aa.slice(0, 10));
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
  const complianceColor = avg_compliance >= 80 ? "#1a7a3c" : avg_compliance >= 50 ? "#e05c00" : "#bb0000";
  const highRiskColor   = high_risk_on_market > 0 ? "#e05c00" : "#1a7a3c";

  const openObligations = complianceStats
    ? (complianceStats.obligation_status.applicable ?? 0)
      + (complianceStats.obligation_status.in_progress ?? 0)
      + (complianceStats.obligation_status.overdue ?? 0)
    : null;
  const evidenceGapCount = complianceStats
    ? (complianceStats.evidence_gap.expired ?? 0) + (complianceStats.evidence_gap.expiring_soon ?? 0)
    : null;
  const oblColor   = openObligations === null ? "var(--brand)" : openObligations > 0 ? "#e05c00" : "#1a7a3c";
  const evdColor   = evidenceGapCount === null ? "var(--brand)" : evidenceGapCount > 0 ? "#bb0000" : "#1a7a3c";
  const alertColor = alertCount > 0 ? "#bb0000" : "#1a7a3c";

  // Chart data for existing fixed charts (kept as-is)
  const tierEntries = Object.entries(stats?.by_tier ?? {});
  const complianceEntries = Object.entries(stats?.compliance_by_tier ?? {});
  const tierData = tierEntries.map(([name, value]) => ({ name: name.replace(/-/g, " "), value }));
  const complianceData = complianceEntries.map(([name, value]) => ({ name: name.replace(/-/g, " "), value }));

  return (
    <div className="overview-body">

      {/* Controls bar */}
      <div className="dashboard-controls">
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
        <div className="dashboard-actions">
          {loading && <span className="spinner" />}
          <button className="btn-ghost" onClick={refresh} disabled={loading}>↺ Refresh</button>
          <button className="btn-ghost" onClick={() => window.print()}>⬇ Export PDF</button>
        </div>
      </div>

      {/* 6-tile KPI row */}
      <div className="kpi-grid kpi-grid-6">
        <div className="kpi-card clickable" onClick={() => navigateTo("/home/ai-system-registry", REGISTRY_URL)}>
          <div className="kpi-label">AI Systems</div>
          <div className="kpi-value" style={{ color: "var(--brand)" }}>{total_systems}</div>
          <div className="kpi-sub">registered in platform</div>
        </div>
        <div className="kpi-card clickable" onClick={() => navigateTo("/home/ai-system-registry", REGISTRY_URL)}>
          <div className="kpi-label">High-Risk Systems</div>
          <div className="kpi-value" style={{ color: highRiskColor }}>{high_risk_on_market}</div>
          <div className="kpi-sub">on market / post-market</div>
        </div>
        <div className="kpi-card clickable" onClick={() => navigateTo("/home/assessments", COMPLIANCE_URL)}>
          <div className="kpi-label">Compliance Score</div>
          <div className="kpi-value" style={{ color: complianceColor }}>{avg_compliance}%</div>
          <div className="kpi-sub">average across all systems</div>
        </div>
        <div className="kpi-card clickable" onClick={() => navigateTo("/home/obligations", COMPLIANCE_URL)}>
          <div className="kpi-label">Open Obligations</div>
          <div className="kpi-value" style={{ color: oblColor }}>{openObligations ?? "—"}</div>
          <div className="kpi-sub">applicable + in progress + overdue</div>
        </div>
        <div className="kpi-card clickable" onClick={() => navigateTo("/home/evidence", COMPLIANCE_URL)}>
          <div className="kpi-label">Evidence Gap</div>
          <div className="kpi-value" style={{ color: evdColor }}>{evidenceGapCount ?? "—"}</div>
          <div className="kpi-sub">expired or expiring soon</div>
        </div>
        <div className="kpi-card clickable" onClick={() => navigateTo("/home/alerts", ALERTS_URL)}>
          <div className="kpi-label">Open Alerts</div>
          <div className="kpi-value" style={{ color: alertColor }}>{alertCount}</div>
          <div className="kpi-sub">unhandled alerts</div>
        </div>
      </div>

      {/* Fixed 3-col widget row: obligation donut | framework bar | evidence gap */}
      <div className="fixed-widgets-grid">
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

      {/* 2-col row: risk heat map | alert feed */}
      <div className="charts-row">
        <RiskHeatMap
          data={complianceStats?.risk_heatmap ?? []}
          onClick={() => navigateTo("/home/ai-system-registry", REGISTRY_URL)}
        />
        <AlertFeed alerts={activeAlerts} loading={loading && activeAlerts.length === 0} />
      </div>

      {/* Upcoming deadlines */}
      <UpcomingDeadlines
        deadlines={complianceStats?.upcoming_deadlines ?? []}
        windowDays={dateRange.days}
      />

      {/* Existing fixed charts (registry data) */}
      <div className="charts-row">
        <div className="chart-card">
          <div className="chart-title">Systems by Risk Tier</div>
          {mounted && (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={tierData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2}>
                  {tierEntries.map(([tier]) => (
                    <Cell key={tier} fill={TIER_COLORS[tier as keyof typeof TIER_COLORS] ?? "#0a6ed1"} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => v.toLocaleString()} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  layout="vertical"
                  align="right"
                  verticalAlign="middle"
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: string, entry: any) => `${value} (${(entry?.payload?.value ?? 0).toLocaleString()})`}
                  wrapperStyle={{ fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="chart-card">
          <div className="chart-title">Avg Compliance by Tier</div>
          {mounted && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={complianceData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e6e8" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={110} />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                  {complianceEntries.map(([tier]) => (
                    <Cell key={tier} fill={LIFECYCLE_COLORS[tier] ?? TIER_COLORS[tier as keyof typeof TIER_COLORS] ?? "#0a6ed1"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Attention table */}
      {stats && stats.attention.length > 0 && (
        <AttentionTable systems={stats.attention} />
      )}

      {/* Customisable analytics dashboard (unchanged) */}
      <div>
        <div className="analytics-header">
          <span className="section-title" style={{ marginBottom: 0 }}>Analytics Dashboard</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-ghost" onClick={resetToDefaults}>↺ Reset</button>
            <button className="btn-primary" onClick={() => setAddOpen(true)}>+ Add Graph</button>
          </div>
        </div>
        {cards.length === 0 ? (
          <div className="empty-dashboard">
            <h3>Analytics dashboard is empty</h3>
            <p>Add charts to customise your overview.</p>
            <button className="btn-primary" onClick={() => setAddOpen(true)}>+ Add Graph</button>
          </div>
        ) : (
          <div className="dashboard-grid" ref={gridRefCallback}>
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