import { useState } from "react";
import type { DashboardCard, ChartType, DataKey } from "../types";

interface Props {
  card: DashboardCard;
  onSave: (updated: DashboardCard) => void;
  onClose: () => void;
}

const DATA_KEYS: { value: DataKey; label: string }[] = [
  { value: "by_tier",              label: "Systems by Risk Tier" },
  { value: "by_lifecycle",         label: "Systems by Lifecycle State" },
  { value: "by_type",              label: "Systems by Type" },
  { value: "compliance_by_tier",   label: "Avg Compliance by Tier" },
  { value: "compliance_histogram", label: "Compliance Distribution" },
  { value: "by_model_type",        label: "Models by Type" },
  { value: "by_model_provider",    label: "Models by Provider" },
];

export default function EditCardModal({ card, onSave, onClose }: Props) {
  const [title, setTitle] = useState(card.title);
  const [type, setType] = useState<ChartType>(card.type as ChartType);
  const [dataKey, setDataKey] = useState<DataKey>(card.dataKey ?? "by_tier");

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>Edit Graph</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div style={{ padding: 24 }}>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <div className="form-group">
              <label>Title</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Chart Type</label>
              <select className="form-select" value={type} onChange={(e) => setType(e.target.value as ChartType)}>
                <option value="bar">Bar Chart</option>
                <option value="pie">Pie Chart</option>
              </select>
            </div>
            <div className="form-group">
              <label>Data Source</label>
              <select className="form-select" value={dataKey} onChange={(e) => setDataKey(e.target.value as DataKey)}>
                {DATA_KEYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => onSave({ ...card, title: title.trim() || card.title, type, dataKey })}>Save</button>
        </div>
      </div>
    </div>
  );
}
