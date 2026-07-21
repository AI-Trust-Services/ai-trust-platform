import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import { StatusBadge } from "../components/Badges";
import KpiCard from "../components/KpiCard";
import DetailPanel, { DetailField, DetailSection } from "../components/DetailPanel";
import CreateControlModal from "../components/CreateControlModal";
import LinkObligationModal from "../components/LinkObligationModal";
import { CONTROL_STATUS_META, OBLIGATION_STATUS_META, EVIDENCE_STATUS_META, fmtDate, humanize } from "../utils";
import type { AISystem, Control, ControlDetail, Evidence, Obligation } from "../types";

const STATUS_OPTIONS = [
  "not_started", "planned", "in_implementation", "implemented",
  "under_review", "effective", "ineffective", "deactivated",
] as const;

export default function ControlsPage(): JSX.Element {
  const [controls, setControls] = useState<Control[]>([]);
  const [systemsById, setSystemsById] = useState<Record<string, AISystem>>({});
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ControlDetail | null>(null);
  const [detailObligations, setDetailObligations] = useState<Obligation[]>([]);
  const [detailEvidence, setDetailEvidence] = useState<Evidence[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [linkControl, setLinkControl] = useState<Control | null>(null);
  const showToast = useToast();

  const load = useCallback(async () => {
    try {
      const [ctl, sys] = await Promise.all([api.getControls(), api.getSystems()]);
      setControls(ctl);
      setSystemsById(Object.fromEntries(sys.map((s) => [s.id, s])));
    } catch (e) {
      showToast(`Failed to load: ${(e as Error).message}`, true);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  async function openDetail(c: Control | { id: string }) {
    setSelected(c.id);
    try {
      const [det, evidence, obligations] = await Promise.all([
        api.getControl(c.id),
        api.getEvidence({ control_id: c.id }),
        api.getObligations({ control_id: c.id }),
      ]);
      setDetail(det);
      setDetailObligations(obligations);
      setDetailEvidence(evidence);
    } catch (e) {
      showToast(`Failed to load detail: ${(e as Error).message}`, true);
    }
  }

  function closePanel() { setSelected(null); setDetail(null); setDetailObligations([]); setDetailEvidence([]); }

  async function changeStatus(id: string, status: string) {
    try {
      await api.updateControl(id, { status });
      showToast("Status updated");
      setControls((prev) => prev.map((c) => c.id === id ? { ...c, status } : c));
      if (selected === id) setDetail((d) => d ? { ...d, status } : d);
    } catch (e) {
      showToast((e as Error).message, true);
    }
  }

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return controls.filter((c) =>
      (!s || c.title.toLowerCase().includes(s)) &&
      (!categoryFilter || c.category === categoryFilter)
    );
  }, [controls, search, categoryFilter]);

  const categories = useMemo(() => [...new Set(controls.map((c) => c.category))].sort(), [controls]);

  const kpis = useMemo(() => ({
    total: controls.length,
    effective: controls.filter((c) => c.status === "effective").length,
    implemented: controls.filter((c) => c.status === "implemented").length,
    notStarted: controls.filter((c) => c.status === "not_started").length,
  }), [controls]);

  return (
    <>
      <div className="page-header">
        <h1>Controls</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-ghost" onClick={load}>↺ Refresh</button>
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>+ New Control</button>
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard label="Total" value={kpis.total} />
        <KpiCard label="Effective" value={kpis.effective} sub={`${kpis.total ? Math.round(kpis.effective / kpis.total * 100) : 0}% of total`} />
        <KpiCard label="Implemented" value={kpis.implemented} />
        <KpiCard label="Not Started" value={kpis.notStarted} />
      </div>

      <div className="toolbar" style={{ marginTop: 12 }}>
        <input className="search-input" placeholder="Search controls…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="filter-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
        </select>
        <div className="toolbar-spacer" />
      </div>

      <div className="content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Control</th>
                <th>Category</th>
                <th>AI System</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Effectiveness</th>
                <th>Due</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="empty-row"><td colSpan={8}>No controls yet.</td></tr>
              ) : filtered.map((c) => (
                <tr key={c.id} className={`clickable${selected === c.id ? " selected" : ""}`} onClick={() => openDetail(c)}>
                  <td><div className="row-name">{c.title}</div><div className="row-sub">{c.id}</div></td>
                  <td style={{ fontSize: 13 }}>{humanize(c.category)}</td>
                  <td>{c.ai_system_id ? (systemsById[c.ai_system_id]?.name ?? c.ai_system_id) : <span className="chip">Org-wide</span>}</td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>{c.owner || "—"}</td>
                  <td><StatusBadge meta={CONTROL_STATUS_META} value={c.status} /></td>
                  <td><span className="chip">{humanize(c.effectiveness)}</span></td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>{fmtDate(c.due_date)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="actions">
                      <button className="btn-ghost btn-sm" data-tip="Link or unlink obligations" onClick={() => setLinkControl(c)}>Link Obligations</button>
                      <select className="inline-select" value={c.status} onChange={(e) => changeStatus(c.id, e.target.value)}>
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{CONTROL_STATUS_META[s].label}</option>)}
                      </select>
                      <button className="btn-ghost btn-sm btn-danger" data-tip="Delete this control"
                        onClick={async () => {
                          if (!confirm(`Delete "${c.title}"?`)) return;
                          try { await api.deleteControl(c.id); showToast("Deleted"); load(); closePanel(); }
                          catch (e) { showToast((e as Error).message, true); }
                        }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <DetailPanel
          title={detail.title}
          subtitle={humanize(detail.category)}
          badge={CONTROL_STATUS_META[detail.status]?.label}
          onClose={closePanel}
        >
          <DetailSection title="General Information">
            <DetailField label="ID">{detail.id}</DetailField>
            <DetailField label="Category">{humanize(detail.category)}</DetailField>
            <DetailField label="AI System">{detail.ai_system_id ? (systemsById[detail.ai_system_id]?.name ?? detail.ai_system_id) : <span className="chip">Org-wide</span>}</DetailField>
            <DetailField label="Owner">{detail.owner || "—"}</DetailField>
            <DetailField label="Status"><StatusBadge meta={CONTROL_STATUS_META} value={detail.status} /></DetailField>
            <DetailField label="Effectiveness"><span className="chip">{humanize(detail.effectiveness)}</span></DetailField>
            <DetailField label="Due Date">{fmtDate(detail.due_date)}</DetailField>
          </DetailSection>
          {detail.description && (
            <DetailSection title="Description">
              <p className="dp-description">{detail.description}</p>
            </DetailSection>
          )}
          <DetailSection title={`Related Obligations (${detailObligations.length})`}>
            {detailObligations.length === 0
              ? <p className="dp-description" style={{ color: "var(--text-secondary)" }}>No obligations linked. Use "Link Obligations".</p>
              : <ul className="dp-list">{detailObligations.map((o) => (
                  <li key={o.id}><span className="dp-list-name">{o.title}</span><StatusBadge meta={OBLIGATION_STATUS_META} value={o.status} /></li>
                ))}</ul>
            }
          </DetailSection>
          <DetailSection title={`Evidence (${detailEvidence.length})`}>
            {detailEvidence.length === 0
              ? <p className="dp-description" style={{ color: "var(--text-secondary)" }}>No evidence yet.</p>
              : <ul className="dp-list">{detailEvidence.map((e) => (
                  <li key={e.id}><span className="dp-list-name">{e.title}</span><StatusBadge meta={EVIDENCE_STATUS_META} value={e.status} /></li>
                ))}</ul>
            }
          </DetailSection>
          <div className="dp-actions">
            <button className="btn-ghost btn-sm" onClick={() => setLinkControl(detail)}>Link Obligations</button>
            <select className="form-select" value={detail.status}
              onChange={async (e) => {
                await changeStatus(detail.id, e.target.value);
                setDetail((d) => d ? { ...d, status: e.target.value } : d);
              }}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{CONTROL_STATUS_META[s].label}</option>)}
            </select>
          </div>
        </DetailPanel>
      )}

      <CreateControlModal open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={load} />
      <LinkObligationModal
        open={!!linkControl}
        control={linkControl}
        onClose={() => setLinkControl(null)}
        onSuccess={() => { load(); if (selected && detail) openDetail(detail); }}
      />
    </>
  );
}
