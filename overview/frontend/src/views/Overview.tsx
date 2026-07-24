import { useState, useEffect, useCallback, useRef } from "react";
import Sortable from "sortablejs";
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { api } from "../api/client";
import { useToast } from "../App";
import type { OverviewStats, DashboardCard } from "../types";
import { TIER_COLORS, LIFECYCLE_COLORS } from "../utils";
import AttentionTable from "../components/AttentionTable";
import DashCard from "../components/DashCard";
import AddGraphModal from "../components/AddGraphModal";
import EditCardModal from "../components/EditCardModal";

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
  const [cards, setCards] = useState<DashboardCard[]>(loadCards);
  const [addOpen, setAddOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<DashboardCard | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const showToast = useToast();
  const sortableRef = useRef<Sortable | null>(null);
  const cardsRef = useRef<DashboardCard[]>(cards);
  cardsRef.current = cards;

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.getStats());
    } catch (e) {
      showToast(`Failed to load overview: ${(e as Error).message}`, true);
    }
  }, [showToast]);

  useEffect(() => { loadStats(); }, [loadStats]);

  // Callback ref: create Sortable exactly once when the grid node mounts,
  // destroy exactly once when it unmounts. The grid is conditionally rendered
  // (empty state renders a different element), so this fires with `null` on
  // unmount. Adding/removing cards keeps the same instance alive — SortableJS
  // delegates to children, so new cards are draggable without re-creating it.
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

  const tierEntries = Object.entries(stats?.by_tier ?? {});
  const complianceEntries = Object.entries(stats?.compliance_by_tier ?? {});
  const tierData = tierEntries.map(([name, value]) => ({ name: name.replace(/-/g, " "), value }));
  const complianceData = complianceEntries.map(([name, value]) => ({ name: name.replace(/-/g, " "), value }));

  const { avg_compliance = 0, total_systems = 0, high_risk_on_market = 0, fully_compliant = 0 } = stats ?? {};
  const complianceColor = avg_compliance >= 80 ? "#1a7a3c" : avg_compliance >= 50 ? "#e05c00" : "#bb0000";
  const highRiskColor   = high_risk_on_market > 0 ? "#e05c00" : "#1a7a3c";

  return (
    <div className="overview-body">
      {/* KPI row */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="kpi-card">
          <div className="kpi-label">Compliance Score</div>
          <div className="kpi-value" style={{ color: complianceColor }}>{avg_compliance}%</div>
          <div className="kpi-sub">average across all systems</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">AI Systems</div>
          <div className="kpi-value" style={{ color: "var(--brand)" }}>{total_systems}</div>
          <div className="kpi-sub">registered in platform</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">High-Risk on Market</div>
          <div className="kpi-value" style={{ color: highRiskColor }}>{high_risk_on_market}</div>
          <div className="kpi-sub">requiring Art. 72 monitoring</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Fully Compliant</div>
          <div className="kpi-value" style={{ color: "#1a7a3c" }}>{fully_compliant}</div>
          <div className="kpi-sub">of {total_systems} systems</div>
        </div>
      </div>

      {/* Fixed charts */}
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
                <Legend iconType="circle" iconSize={8} layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 12 }} />
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

      {/* Customizable dashboard */}
      <div>
        <div className="analytics-header">
          <span className="section-title" style={{ marginBottom: 0 }}>Analytics Dashboard</span>
          <button className="btn-primary" onClick={() => setAddOpen(true)}>+ Add Graph</button>
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
