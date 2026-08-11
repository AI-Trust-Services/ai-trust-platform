import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import { StatusBadge } from "../components/Badges";
import KpiCard from "../components/KpiCard";
import DetailPanel, { DetailField, DetailSection } from "../components/DetailPanel";
import CreateControlModal from "../components/CreateControlModal";
import LinkObligationModal from "../components/LinkObligationModal";
import Pagination from "../components/Pagination";
import { CONTROL_STATUS_META, OBLIGATION_STATUS_META, EVIDENCE_STATUS_META, fmtDate, humanize } from "../utils";
import { usePermissions } from "../hooks/usePermissions";
import type { AISystem, Control, ControlDetail, Evidence, Obligation } from "../types";

const STATUS_OPTIONS = [
  "not_started", "planned", "in_implementation", "implemented",
  "under_review", "effective", "ineffective", "deactivated",
] as const;

export default function ControlsPage() {
  const [controls, setControls] = useState<Control[]>([]);
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [systemsById, setSystemsById] = useState<Record<string, AISystem>>({});
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [systemFilter, setSystemFilter] = useState("");
  const [effectivenessFilter, setEffectivenessFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ControlDetail | null>(null);
  const [detailObligations, setDetailObligations] = useState<Obligation[]>([]);
  const [detailEvidence, setDetailEvidence] = useState<Evidence[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [linkControl, setLinkControl] = useState<Control | null>(null);
  const showToast = useToast();
  const { can } = usePermissions();
  const mayWrite = can("assessments:write");
  const noWriteTitle = "Requires permission: assessments:write";

  const load = useCallback(async () => {
    try {
      const [ctl, sys] = await Promise.all([api.getControls(), api.getSystems()]);
      setControls(ctl);
      setSystems(sys);
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
      (!s || c.title.toLowerCase().includes(s) || c.id.toLowerCase().includes(s)) &&
      (!categoryFilter || c.category === categoryFilter) &&
      (!statusFilter || c.status === statusFilter) &&
      (!effectivenessFilter || c.effectiveness === effectivenessFilter) &&
      (!systemFilter || (systemFilter === "__org__" ? !c.ai_system_id : c.ai_system_id === systemFilter))
    );
  }, [controls, search, categoryFilter, statusFilter, effectivenessFilter, systemFilter]);

  // Reset to the first page whenever the filtered set changes.
  useEffect(() => { setPage(1); }, [search, categoryFilter, statusFilter, effectivenessFilter, systemFilter]);

  // Clamp to a valid page — the list can shrink under us (delete, status change
  // filtering a row out) while `page` stays high, which would show an empty table.
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize]
  );

  const categories = useMemo(() => [...new Set(controls.map((c) => c.category))].sort(), [controls]);
  const systemOptions = useMemo(() => {
    // Only systems that have controls; ordered latest-first (API returns systems
    // ordered by created_at desc, so preserve that order rather than re-sorting).
    const withControls = new Set<string>();
    controls.forEach((c) => { if (c.ai_system_id) withControls.add(c.ai_system_id); });
    return systems
      .filter((s) => withControls.has(s.id))
      .map((s) => ({ id: s.id, name: s.name }));
  }, [controls, systems]);
  const hasOrgWide = useMemo(() => controls.some((c) => !c.ai_system_id), [controls]);
  const activeFilterCount =
    (categoryFilter ? 1 : 0) + (statusFilter ? 1 : 0) +
    (effectivenessFilter ? 1 : 0) + (systemFilter ? 1 : 0);

  function clearFilters() {
    setSearch(""); setCategoryFilter(""); setStatusFilter("");
    setEffectivenessFilter(""); setSystemFilter("");
  }

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
          <button className="btn-primary" disabled={!mayWrite} title={mayWrite ? undefined : noWriteTitle}
            onClick={() => setCreateOpen(true)}>+ New Control</button>
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
        <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{CONTROL_STATUS_META[s].label}</option>)}
        </select>
        <select className="filter-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
        </select>
        <select className="filter-select" value={effectivenessFilter} onChange={(e) => setEffectivenessFilter(e.target.value)}>
          <option value="">All Effectiveness</option>
          {["high", "medium", "low"].map((e) => <option key={e} value={e}>{humanize(e)}</option>)}
        </select>
        <select className="filter-select" value={systemFilter} onChange={(e) => setSystemFilter(e.target.value)}>
          <option value="">All AI Systems</option>
          {hasOrgWide && <option value="__org__">Org-wide</option>}
          {systemOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {activeFilterCount > 0 && (
          <button className="btn-ghost btn-sm" onClick={clearFilters}>Clear filters ({activeFilterCount})</button>
        )}
        <div className="toolbar-spacer" />
        <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{filtered.length} of {controls.length}</span>
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
              ) : paged.map((c) => (
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
                      <button className="btn-ghost btn-sm" data-tip="Link or unlink obligations"
                        disabled={!mayWrite} title={mayWrite ? undefined : noWriteTitle}
                        onClick={() => setLinkControl(c)}>Link Obligations</button>
                      <select className="inline-select" value={c.status} disabled={!mayWrite}
                        title={mayWrite ? undefined : noWriteTitle}
                        onChange={(e) => changeStatus(c.id, e.target.value)}>
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{CONTROL_STATUS_META[s].label}</option>)}
                      </select>
                      <button className="btn-ghost btn-sm btn-danger" data-tip="Delete this control"
                        disabled={!mayWrite} title={mayWrite ? undefined : noWriteTitle}
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
        <Pagination
          page={safePage}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        />
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
            <button className="btn-ghost btn-sm" disabled={!mayWrite} title={mayWrite ? undefined : noWriteTitle}
              onClick={() => setLinkControl(detail)}>Link Obligations</button>
            <select className="form-select" value={detail.status} disabled={!mayWrite}
              title={mayWrite ? undefined : noWriteTitle}
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
