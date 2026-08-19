import { useState, useEffect, useCallback, useMemo } from "react";
import { TierBadge, LifecycleBadge, ComplianceBar, FormattedDate } from "../components/Badges";
import SystemDetail from "../components/SystemDetail";
import RegisterWizard from "../components/RegisterWizard";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import type { AISystem, ModelCard } from "../types";

export default function Systems() {
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [models, setModels] = useState<ModelCard[]>([]);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("");
  const [selectedSystem, setSelectedSystem] = useState<AISystem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const { wizardOpen, setWizardOpen, mayWrite } = useModalControls();
  const showToast = useToast();
  const noWriteTitle = "Requires permission: systems:write";

  const loadSystems = useCallback(async () => {
    try {
      const data = await api.getSystems();
      setSystems(data);
    } catch (e) {
      showToast(`Failed to load systems: ${(e as Error).message}`, true);
    }
  }, [showToast]);

  const loadModels = useCallback(async () => {
    try {
      const data = await api.getModels();
      setModels(data);
    } catch (e) {
      showToast(`Failed to load model catalog: ${(e as Error).message}`, true);
    }
  }, [showToast]);

  useEffect(() => { loadSystems(); loadModels(); }, [loadSystems, loadModels]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return systems.filter((sys) => {
      const matchSearch = !s || sys.name.toLowerCase().includes(s) ||
        sys.id.toLowerCase().includes(s) || (sys.provider || "").toLowerCase().includes(s);
      const matchTier = !tierFilter || sys.tier === tierFilter;
      const matchLc = !lifecycleFilter || sys.lifecycle === lifecycleFilter;
      return matchSearch && matchTier && matchLc;
    });
  }, [systems, search, tierFilter, lifecycleFilter]);

  // TODO: needs discussion — should the system list show linked model names or a count? (N:M)
  // function modelName(modelId: string | null) {
  //   const m = models.find((x) => x.id === modelId);
  //   return m ? m.name : modelId;
  // }

  async function openDetail(id: string) {
    try {
      const s = await api.getSystem(id);
      setSelectedSystem(s);
      setDetailOpen(true);
    } catch (e) {
      showToast(`Failed to load system: ${(e as Error).message}`, true);
    }
  }

  return (
    <>
      <div className="toolbar">
        <input type="text" className="search-input" placeholder="Search systems…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="filter-select" value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
          <option value="">All Risk Tiers</option>
          <option value="prohibited">Prohibited</option>
          <option value="high">High-Risk</option>
          <option value="gpai-systemic">GPAI Systemic</option>
          <option value="gpai-standard">GPAI Standard</option>
          <option value="limited">Limited</option>
          <option value="minimal">Minimal</option>
        </select>
        <select className="filter-select" value={lifecycleFilter} onChange={(e) => setLifecycleFilter(e.target.value)}>
          <option value="">All Lifecycle States</option>
          <option value="development">Development</option>
          <option value="testing">Testing</option>
          <option value="conformity">Conformity</option>
          <option value="market">On Market</option>
          <option value="post-market">Post-Market</option>
          <option value="decommissioned">Decommissioned</option>
        </select>
        <div className="toolbar-spacer" />
        <button className="btn-ghost" onClick={loadSystems}>↺ Refresh</button>
      </div>

      <div className="content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>System</th>
                <th>Risk Tier</th>
                <th>Lifecycle</th>
                <th>Compliance</th>
                <th>Registered</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={6}>{systems.length === 0 ? 'No systems registered yet. Click "Register System" to add one.' : "No systems match the current filters."}</td>
                </tr>
              ) : filtered.map((s) => (
                <tr key={s.id} onClick={() => openDetail(s.id)}>
                  <td>
                    <div className="system-name">{s.name}</div>
                    <div className="system-sub">
                      {s.id} · v{s.version || "1.0.0"}
                      {/* TODO: needs discussion — What to do? show linked model names or count? (N:M) */}
                      {/* {s.model_id && <> · <span style={{ color: "var(--brand)" }}>{modelName(s.model_id)}</span></>} */}
                    </div>
                  </td>
                  <td><TierBadge tier={s.tier} /></td>
                  <td><LifecycleBadge lc={s.lifecycle} /></td>
                  <td><ComplianceBar pct={s.compliance} /></td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}><FormattedDate iso={s.created_at} /></td>
                  <td>
                    <div className="actions" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-icon" title="Details" onClick={() => openDetail(s.id)}>⊙</button>
                      <button
                        className="btn-icon btn-danger"
                        title={mayWrite ? "Delete" : noWriteTitle}
                        disabled={!mayWrite}
                        onClick={async () => {
                          if (!confirm(`Delete "${s.name}"?\n\nThis action cannot be undone.`)) return;
                          try {
                            await api.deleteSystem(s.id);
                            showToast("System deleted");
                            loadSystems();
                          } catch (e) {
                            showToast(`Delete failed: ${(e as Error).message}`, true);
                          }
                        }}
                      >✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <RegisterWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={() => { loadSystems(); loadModels(); }}
      />

      <SystemDetail
        open={detailOpen}
        system={selectedSystem}
        models={models}
        onClose={() => setDetailOpen(false)}
        onDelete={() => { setDetailOpen(false); loadSystems(); }}
        onUpdate={(updated) => {
          setSelectedSystem(updated);
          loadSystems();
        }}
      />
    </>
  );
}
