import { useState, useEffect, useCallback, useMemo } from "react";
import { ModelTypeBadge } from "../components/Badges";
import ModelModal from "../components/ModelModal";
import ModelDetail from "../components/ModelDetail";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import type { ModelCard } from "../types";

export default function Models() {
  const [models, setModels] = useState<ModelCard[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelCard | null>(null);
  const [detailModelId, setDetailModelId] = useState<string | null>(null);
  const { modelCreateOpen, setModelCreateOpen, mayWrite } = useModalControls();
  const showToast = useToast();
  const noWriteTitle = "Requires permission: systems:write";

  const loadModels = useCallback(async () => {
    try {
      const data = await api.getModels();
      setModels(data);
    } catch (e) {
      showToast(`Failed to load models: ${(e as Error).message}`, true);
    }
  }, [showToast]);

  useEffect(() => { loadModels(); }, [loadModels]);

  // Open "Add Model" modal when triggered from App header button
  useEffect(() => {
    if (modelCreateOpen) {
      setEditingModel(null);
      setModalOpen(true);
      setModelCreateOpen(false);
    }
  }, [modelCreateOpen, setModelCreateOpen]);

  const providers = useMemo(
    () => [...new Set(models.map((m) => m.provider))].sort(),
    [models]
  );

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return models.filter((m) => {
      const matchSearch = !s || m.name.toLowerCase().includes(s) ||
        m.id.toLowerCase().includes(s) || m.provider.toLowerCase().includes(s);
      const matchType = !typeFilter || m.model_type === typeFilter;
      const matchProvider = !providerFilter || m.provider === providerFilter;
      return matchSearch && matchType && matchProvider;
    });
  }, [models, search, typeFilter, providerFilter]);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete model "${name}"?\n\nSystems linked to this model will have their link removed.`)) return;
    try {
      await api.deleteModel(id);
      showToast(`Model "${name}" deleted`);
      loadModels();
    } catch (e) {
      showToast(`Delete failed: ${(e as Error).message}`, true);
    }
  }

  return (
    <>
      <div className="toolbar">
        <input type="text" className="search-input" placeholder="Search models…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="filter-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          <option value="llm">LLM</option>
          <option value="embedding">Embedding</option>
          <option value="multimodal">Multimodal</option>
          <option value="classifier">Classifier</option>
        </select>
        <select className="filter-select" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
          <option value="">All Providers</option>
          {providers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="toolbar-spacer" />
        <button className="btn-ghost" onClick={loadModels}>↺ Refresh</button>
        <button className="btn-primary" disabled={!mayWrite} title={mayWrite ? undefined : noWriteTitle}
          onClick={() => { setEditingModel(null); setModalOpen(true); }}>+ Add Model</button>
      </div>

      <div className="content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
                <th>Type</th>
                <th>Version</th>
                <th>Weights</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="empty-row"><td colSpan={6}>No model cards found.</td></tr>
              ) : filtered.map((m) => (
                <tr key={m.id} onClick={() => setDetailModelId(m.id)} style={{ cursor: "pointer" }}>
                  <td>
                    <div className="system-name">{m.name}</div>
                    <div className="system-sub">{m.id}{m.description ? ` · ${m.description.slice(0, 60)}` : ""}</div>
                  </td>
                  <td style={{ fontSize: 13 }}>{m.provider}</td>
                  <td><ModelTypeBadge type={m.model_type} /></td>
                  <td style={{ fontSize: 13, color: "var(--text-secondary)" }}>{m.version || "—"}</td>
                  <td style={{ fontSize: 13 }}>
                    {m.open_weights
                      ? <span style={{ color: "#1a5c35", fontWeight: 500 }}>Open</span>
                      : <span style={{ color: "var(--text-secondary)" }}>Proprietary</span>}
                  </td>
                  <td>
                    <div className="actions">
                      <button className="btn-icon" title={mayWrite ? "Edit" : noWriteTitle} disabled={!mayWrite}
                        onClick={(e) => { e.stopPropagation(); setEditingModel(m); setModalOpen(true); }}>✎</button>
                      <button className="btn-icon btn-danger" title={mayWrite ? "Delete" : noWriteTitle} disabled={!mayWrite}
                        onClick={(e) => { e.stopPropagation(); handleDelete(m.id, m.name); }}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ModelModal
        open={modalOpen}
        editingModel={editingModel}
        onClose={() => setModalOpen(false)}
        onSuccess={loadModels}
      />
      <ModelDetail
        modelId={detailModelId}
        open={detailModelId !== null}
        onClose={() => setDetailModelId(null)}
        onUpdate={loadModels}
      />
    </>
  );
}
