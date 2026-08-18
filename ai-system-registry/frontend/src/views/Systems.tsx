import { useState, useEffect, useCallback, useMemo } from "react";
import { TierBadge, LifecycleBadge, ComplianceBar, FormattedDate } from "../components/Badges";
import SystemDetail from "../components/SystemDetail";
import type { UserMap } from "../components/SystemDetail";
import RegisterWizard from "../components/RegisterWizard";
import RegisterModeChooser from "../components/RegisterModeChooser";
import AssistedRegistration from "../components/AssistedRegistration";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import type { AISystem, ModelCard } from "../types";

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_review: "Pending Review",
  approved: "Approved",
  rejected: "Rejected",
};

export default function Systems() {
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [models, setModels] = useState<ModelCard[]>([]);
  const [userMap, setUserMap] = useState<UserMap>({});
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("");
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [selectedSystem, setSelectedSystem] = useState<AISystem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [fillInSystem, setFillInSystem] = useState<AISystem | undefined>(undefined);
  const [ownerStage, setOwnerStage] = useState<"chooser" | "manual" | "assisted">("chooser");
  const { wizardOpen, setWizardOpen, mayRegister, username } = useModalControls();
  const showToast = useToast();

  // Owner flow always starts at the mode chooser; engineer fill-in skips it.
  useEffect(() => {
    if (wizardOpen && !fillInSystem) setOwnerStage("chooser");
  }, [wizardOpen, fillInSystem]);

  function closeWizard() {
    setWizardOpen(false);
    setFillInSystem(undefined);
    setOwnerStage("chooser");
  }

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

  useEffect(() => {
    Promise.all([
      api.getUsersByRole("ai_engineer").catch(() => []),
      api.getUsersByRole("ai_compliance_officer").catch(() => []),
    ]).then(([engineers, cos]) => {
      const map: UserMap = {};
      for (const u of [...engineers, ...cos]) {
        map[u.username] = { firstName: u.firstName, lastName: u.lastName };
      }
      setUserMap(map);
    });
  }, []);

  useEffect(() => { loadSystems(); loadModels(); }, [loadSystems, loadModels]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return systems.filter((sys) => {
      const matchSearch = !s || sys.name.toLowerCase().includes(s) ||
        sys.id.toLowerCase().includes(s) || (sys.provider || "").toLowerCase().includes(s);
      const matchTier = !tierFilter || sys.tier === tierFilter;
      const matchLc = !lifecycleFilter || sys.lifecycle === lifecycleFilter;
      const matchWf = !workflowFilter || sys.workflow_status === workflowFilter;
      return matchSearch && matchTier && matchLc && matchWf;
    });
  }, [systems, search, tierFilter, lifecycleFilter, workflowFilter]);

  function modelName(modelId: string | null) {
    const m = models.find((x) => x.id === modelId);
    return m ? m.name : modelId;
  }

  async function openSystem(s: AISystem) {
    // Engineer mode: assigned user + editable status → open wizard to fill in
    const isAssignee = username && s.assignee_username === username;
    if (isAssignee && (s.workflow_status === "draft" || s.workflow_status === "rejected")) {
      try {
        const fresh = await api.getSystem(s.id);
        setFillInSystem(fresh);
        setWizardOpen(true);
      } catch (e) {
        showToast(`Failed to load system: ${(e as Error).message}`, true);
      }
      return;
    }
    // Otherwise open the detail panel
    try {
      const fresh = await api.getSystem(s.id);
      setSelectedSystem(fresh);
      setDetailOpen(true);
    } catch (e) {
      showToast(`Failed to load system: ${(e as Error).message}`, true);
    }
  }

  function workflowStatusBadge(status: string) {
    const colors: Record<string, string> = {
      draft: "#8a9bb0",
      pending_review: "#e67e22",
      approved: "#27ae60",
      rejected: "#c0392b",
    };
    return (
      <span style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 600,
        color: "#fff",
        background: colors[status] || "#8a9bb0",
        letterSpacing: "0.3px",
      }}>
        {WORKFLOW_STATUS_LABELS[status] || status}
      </span>
    );
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
        <select className="filter-select" value={workflowFilter} onChange={(e) => setWorkflowFilter(e.target.value)}>
          <option value="">All Workflow States</option>
          <option value="draft">Draft</option>
          <option value="pending_review">Pending Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
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
                <th>Workflow</th>
                <th>Assignee</th>
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
                  <td colSpan={8}>{systems.length === 0 ? 'No systems registered yet. Click "Register System" to add one.' : "No systems match the current filters."}</td>
                </tr>
              ) : filtered.map((s) => (
                <tr key={s.id} onClick={() => openSystem(s)} style={{ cursor: "pointer" }}>
                  <td>
                    <div className="system-name">{s.name}</div>
                    <div className="system-sub">
                      {s.id} · v{s.version || "1.0.0"}
                      {s.model_id && <> · <span style={{ color: "var(--brand)" }}>{modelName(s.model_id)}</span></>}
                    </div>
                  </td>
                  <td>{workflowStatusBadge(s.workflow_status)}</td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                    {s.assignee_username ? (
                      <span title={s.assignee_username} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: 24, height: 24, borderRadius: "50%", background: "var(--brand)",
                          color: "#fff", fontSize: 10, fontWeight: 700, flexShrink: 0,
                        }}>
                          {(() => {
                            const u = userMap[s.assignee_username];
                            if (u?.firstName && u?.lastName) return (u.firstName[0] + u.lastName[0]).toUpperCase();
                            if (u?.firstName) return u.firstName.slice(0, 2).toUpperCase();
                            return s.assignee_username.slice(0, 2).toUpperCase();
                          })()}
                        </span>
                        {(() => {
                          const u = userMap[s.assignee_username];
                          const full = [u?.firstName, u?.lastName].filter(Boolean).join(" ");
                          return full || s.assignee_username;
                        })()}
                      </span>
                    ) : "—"}
                  </td>
                  <td><TierBadge tier={s.tier} workflowStatus={s.workflow_status} /></td>
                  <td><LifecycleBadge lc={s.lifecycle} /></td>
                  <td><ComplianceBar pct={s.compliance} /></td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}><FormattedDate iso={s.created_at} /></td>
                  <td>
                    <div className="actions" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-icon" title="Details" onClick={() => openSystem(s)}>⊙</button>
                      <button
                        className="btn-icon btn-danger"
                        title={mayRegister ? "Delete" : "Requires role: business owner or administrator"}
                        disabled={!mayRegister}
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

      {/* Engineer fill-in: skip chooser, open the technical wizard directly */}
      <RegisterWizard
        open={wizardOpen && !!fillInSystem}
        system={fillInSystem}
        onClose={closeWizard}
        onSuccess={() => { loadSystems(); loadModels(); }}
      />

      {/* Owner: choose manual vs AI-assisted */}
      <RegisterModeChooser
        open={wizardOpen && !fillInSystem && ownerStage === "chooser"}
        onClose={closeWizard}
        onManual={() => setOwnerStage("manual")}
        onAssisted={() => setOwnerStage("assisted")}
      />

      {/* Owner: classic manual stub */}
      <RegisterWizard
        open={wizardOpen && !fillInSystem && ownerStage === "manual"}
        onClose={closeWizard}
        onSuccess={() => { loadSystems(); loadModels(); }}
      />

      {/* Owner: conversational AI-assisted flow */}
      <AssistedRegistration
        open={wizardOpen && !fillInSystem && ownerStage === "assisted"}
        onClose={closeWizard}
        onSuccess={() => { loadSystems(); loadModels(); }}
      />

      <SystemDetail
        open={detailOpen}
        system={selectedSystem}
        models={models}
        userMap={userMap}
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
