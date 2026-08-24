import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ModelCard, ModelSystemResponse } from "../types";
import { TierBadge, LifecycleBadge, ModelTypeBadge } from "./Badges";

export default function ModelDetail({ modelId, open, onClose }: {
  modelId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [model, setModel] = useState<ModelCard | null>(null);
  const [systems, setSystems] = useState<ModelSystemResponse[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!modelId) return;
    setLoading(true);
    Promise.all([api.getModelCard(modelId), api.getModelSystems(modelId)])
      .then(([m, s]) => { setModel(m); setSystems(s); })
      .finally(() => setLoading(false));
  }, [modelId]);

  return (
    <>
      <div className={`detail-overlay${open ? " open" : ""}`} onClick={onClose} />
      <div className={`detail-panel${open ? " open" : ""}`}>
        {loading || !model ? (
          <div style={{ padding: 32, color: "var(--text-secondary)", fontSize: 13 }}>
            {loading ? "Loading…" : null}
          </div>
        ) : (
          <>
            <div className="modal-header">
              <div>
                <h2>{model.name}</h2>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                  {model.id} &nbsp;
                  <ModelTypeBadge type={model.model_type} />
                  {model.open_weights && <span className="badge badge-info" style={{ marginLeft: 4 }}>Open weights</span>}
                </div>
              </div>
              <button className="btn-close" onClick={onClose}>×</button>
            </div>

            <div className="tab-panel active">
              <div className="detail-section">
                <h3>Model Details</h3>
                <div className="detail-grid">
                  <span className="detail-label">Provider</span>
                  <span className="detail-value">{model.provider || "—"}</span>
                  <span className="detail-label">Version</span>
                  <span className="detail-value">{model.version || "—"}</span>
                  <span className="detail-label">Type</span>
                  <span className="detail-value"><ModelTypeBadge type={model.model_type} /></span>
                  <span className="detail-label">Weights</span>
                  <span className="detail-value">
                    {model.open_weights
                      ? <span style={{ color: "#1a5c35", fontWeight: 500 }}>Open</span>
                      : <span style={{ color: "var(--text-secondary)" }}>Proprietary</span>}
                  </span>
                  {model.inference_url && <>
                    <span className="detail-label">Inference URL</span>
                    <span className="detail-value">
                      <a href={model.inference_url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>
                        {model.inference_url}
                      </a>
                    </span>
                  </>}
                  {model.description && <>
                    <span className="detail-label">Description</span>
                    <span className="detail-value">{model.description}</span>
                  </>}
                </div>
              </div>

              <div className="detail-section">
                <h3>Linked AI Systems</h3>
                {systems.length === 0 ? (
                  <div className="msg-strip info">No systems linked to this model.</div>
                ) : (
                  systems.map((s) => (
                    <div key={s.id} className="model-link-box linked">
                      <div className="model-link-name">{s.name}</div>
                      <div className="model-link-meta">
                        {s.id} &nbsp;
                        <TierBadge tier={s.tier as any} /> <LifecycleBadge lc={s.lifecycle as any} />
                        {s.role && <> · <span style={{ color: "var(--brand)" }}>{s.role}</span></>}
                        &nbsp; {Math.round(s.compliance * 100)}% compliance
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
