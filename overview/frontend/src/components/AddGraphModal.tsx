import { useState } from "react";
import type { DashboardCard, ChartType, DataKey, RecommendedChart } from "../types";

interface AddGraphModalProps {
  activeIds: Set<string>;
  onAdd: (card: DashboardCard) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

const RECOMMENDED: RecommendedChart[] = [
  { id: "kpi_total_systems",       title: "Total AI Systems",        desc: "All registered systems",          type: "kpi",   badge: "KPI"   },
  { id: "kpi_high_risk",           title: "High-Risk Systems",       desc: "Systems classified as high-risk", type: "kpi",   badge: "KPI"   },
  { id: "kpi_avg_compliance",      title: "Avg Compliance",          desc: "Average compliance % overall",    type: "kpi",   badge: "KPI"   },
  { id: "kpi_total_models",        title: "Total Model Cards",       desc: "All model cards",                 type: "kpi",   badge: "KPI"   },
  { id: "chart_by_tier",           title: "Systems by Risk Tier",    desc: "EU AI Act tier distribution",     type: "bar",   dataKey: "by_tier",              badge: "Bar"   },
  { id: "chart_by_lifecycle",      title: "Systems by Lifecycle",    desc: "Count per lifecycle state",       type: "bar",   dataKey: "by_lifecycle",         badge: "Bar"   },
  { id: "chart_compliance_tier",   title: "Compliance by Tier",      desc: "Avg compliance per tier",         type: "bar",   dataKey: "compliance_by_tier",   badge: "Bar"   },
  { id: "chart_compliance_hist",   title: "Compliance Distribution", desc: "Systems spread across 0–100%",    type: "bar",   dataKey: "compliance_histogram",  badge: "Bar"   },
  { id: "chart_by_type",           title: "Systems by Type",         desc: "Application, model, service…",    type: "pie",   dataKey: "by_type",              badge: "Pie"   },
  { id: "chart_by_model_type",     title: "Models by Type",          desc: "LLM, embedding, multimodal…",     type: "pie",   dataKey: "by_model_type",        badge: "Pie"   },
  { id: "chart_by_model_provider", title: "Models by Provider",      desc: "Top model providers",             type: "bar",   dataKey: "by_model_provider",    badge: "Bar"   },
  { id: "table_recent",            title: "Recent Registrations",    desc: "Last 10 registered systems",      type: "table", badge: "Table" },
];

const DATA_KEYS: { value: DataKey; label: string }[] = [
  { value: "by_tier",              label: "Systems by Risk Tier" },
  { value: "by_lifecycle",         label: "Systems by Lifecycle State" },
  { value: "by_type",              label: "Systems by Type" },
  { value: "compliance_by_tier",   label: "Avg Compliance by Tier" },
  { value: "compliance_histogram", label: "Compliance Distribution" },
  { value: "by_model_type",        label: "Models by Type" },
  { value: "by_model_provider",    label: "Models by Provider" },
];

export default function AddGraphModal({ activeIds, onAdd, onRemove, onClose }: AddGraphModalProps) {
  const [tab, setTab] = useState<"recommended" | "custom">("recommended");
  const [customTitle, setCustomTitle] = useState("");
  const [customType, setCustomType] = useState<ChartType>("bar");
  const [customDataKey, setCustomDataKey] = useState<DataKey>("by_tier");

  function handleAddCustom() {
    const title = customTitle.trim() || "Custom Chart";
    onAdd({ id: `custom_${customDataKey}_${customType}_${Date.now()}`, title, type: customType, dataKey: customDataKey });
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal add-graph-modal">
        <div className="modal-header">
          <h2>Add Graph</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="graph-modal-tabs">
          <div className={`graph-modal-tab${tab === "recommended" ? " active" : ""}`} onClick={() => setTab("recommended")}>Recommended</div>
          <div className={`graph-modal-tab${tab === "custom" ? " active" : ""}`} onClick={() => setTab("custom")}>Custom</div>
        </div>
        {tab === "recommended" && (
          <div className="graph-tab-panel">
            <div className="recommended-grid">
              {RECOMMENDED.map((rc) => {
                const added = activeIds.has(rc.id);
                return (
                  <div
                    key={rc.id}
                    className={`rec-card${added ? " added" : ""}`}
                    onClick={() => { if (added) { onRemove(rc.id); } else { onAdd(rc); } }}
                  >
                    <div className="rec-card-title">{rc.title}</div>
                    <div className="rec-card-desc">{rc.desc}</div>
                    <span className="rec-card-badge">{added ? "Added ✓" : rc.badge}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {tab === "custom" && (
          <div className="graph-tab-panel">
            <div className="form-grid">
              <div className="form-group">
                <label>Chart Title</label>
                <input type="text" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder="e.g. My Custom Chart" />
              </div>
              <div className="form-group">
                <label>Chart Type</label>
                <select className="form-select" value={customType} onChange={(e) => setCustomType(e.target.value as ChartType)}>
                  <option value="bar">Bar Chart</option>
                  <option value="pie">Pie Chart</option>
                </select>
              </div>
              <div className="form-group span2">
                <label>Data Source</label>
                <select className="form-select" value={customDataKey} onChange={(e) => setCustomDataKey(e.target.value as DataKey)}>
                  {DATA_KEYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn-primary" onClick={handleAddCustom}>Add to Dashboard</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
