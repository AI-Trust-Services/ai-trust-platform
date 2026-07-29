import { useState, useEffect } from "react";
import type { DashboardCard, OverviewStats, RecommendedChart } from "../types";
import DashCard from "./DashCard";

interface AddGraphModalProps {
  activeIds: Set<string>;
  stats: OverviewStats | null;
  onAdd: (card: DashboardCard) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

// KPI cards are excluded — the 6-tile KPI row already shows these permanently.
const REGISTRY_CHARTS: RecommendedChart[] = [
  { id: "chart_by_tier",           title: "Systems by Risk Tier",    desc: "EU AI Act tier distribution",    type: "bar",   dataKey: "by_tier",             badge: "Bar"   },
  { id: "chart_by_lifecycle",      title: "Systems by Lifecycle",    desc: "Count per lifecycle state",      type: "bar",   dataKey: "by_lifecycle",        badge: "Bar"   },
  { id: "chart_compliance_tier",   title: "Compliance by Tier",      desc: "Avg compliance per tier",        type: "bar",   dataKey: "compliance_by_tier",  badge: "Bar"   },
  { id: "chart_compliance_hist",   title: "Compliance Distribution", desc: "Systems spread across 0–100%",  type: "bar",   dataKey: "compliance_histogram", badge: "Bar"   },
  { id: "chart_by_type",           title: "Systems by Type",         desc: "Application, model, service…",  type: "pie",   dataKey: "by_type",             badge: "Pie"   },
  { id: "chart_by_model_type",     title: "Models by Type",          desc: "LLM, embedding, multimodal…",   type: "pie",   dataKey: "by_model_type",       badge: "Pie"   },
  { id: "chart_by_model_provider", title: "Models by Provider",      desc: "Top model providers",            type: "bar",   dataKey: "by_model_provider",   badge: "Bar"   },
  { id: "table_recent",            title: "Recent Registrations",    desc: "Last 10 registered systems",    type: "table", badge: "Table" },
];

export default function AddGraphModal({ activeIds, stats, onAdd, onRemove, onClose }: AddGraphModalProps) {
  const [preview, setPreview] = useState<RecommendedChart | null>(REGISTRY_CHARTS[0]);

  // Disable background scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  function handleClick(rc: RecommendedChart) {
    if (activeIds.has(rc.id)) onRemove(rc.id);
    else onAdd(rc);
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal add-graph-modal">
        <div className="modal-header">
          <h2>Add Graph</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="add-graph-body">
          {/* Left: card list */}
          <div className="add-graph-list">
            <div className="rec-section-title">Registry</div>
            {REGISTRY_CHARTS.map((rc) => {
              const added = activeIds.has(rc.id);
              return (
                <div
                  key={rc.id}
                  className={`rec-list-item${added ? " added" : ""}${preview?.id === rc.id ? " focused" : ""}`}
                  onMouseEnter={() => setPreview(rc)}
                  onClick={() => handleClick(rc)}
                >
                  <div style={{ flex: 1 }}>
                    <div className="rec-list-title">{rc.title}</div>
                    <div className="rec-list-desc">{rc.desc}</div>
                  </div>
                  <span className="rec-card-badge">{added ? "✓" : rc.badge}</span>
                </div>
              );
            })}
          </div>

          {/* Right: preview pane */}
          <div className="add-graph-preview">
            {preview && stats ? (
              <>
                <div className="rec-section-title" style={{ marginBottom: 8 }}>Preview</div>
                <DashCard card={preview} stats={stats} onRemove={() => {}} />
              </>
            ) : (
              <div className="add-graph-preview-empty">Hover a card to preview</div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}