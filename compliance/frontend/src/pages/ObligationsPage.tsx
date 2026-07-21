import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import { StatusBadge } from "../components/Badges";
import KpiCard from "../components/KpiCard";
import DetailPanel, { DetailField, DetailSection } from "../components/DetailPanel";
import CreateObligationModal from "../components/CreateObligationModal";
import { OBLIGATION_STATUS_META, CONTROL_STATUS_META, EVIDENCE_STATUS_META, fmtDate } from "../utils";
import type { AISystem, Assessment, Control, Evidence, Obligation, ObligationDetail } from "../types";

const STATUS_OPTIONS = ["applicable", "in_progress", "fulfilled", "not_applicable", "overdue"] as const;

export default function ObligationsPage(): JSX.Element {
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [systemsById, setSystemsById] = useState<Record<string, AISystem>>({});
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [systemFilter, setSystemFilter] = useState("");
  const [assessmentFilter, setAssessmentFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ObligationDetail | null>(null);
  const [detailControls, setDetailControls] = useState<Control[]>([]);
  const [detailEvidence, setDetailEvidence] = useState<Evidence[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const showToast = useToast();

  const load = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (assessmentFilter) params.assessment_id = assessmentFilter;
      else if (systemFilter) params.ai_system_id = systemFilter;
      const [obs, sys, assess] = await Promise.all([
        api.getObligations(params),
        api.getSystems(),
        api.getAssessments(),
      ]);
      setObligations(obs);
      setSystemsById(Object.fromEntries(sys.map((s) => [s.id, s])));
      setAssessments(assess);
    } catch (e) {
      showToast(`Failed to load: ${(e as Error).message}`, true);
    }
  }, [showToast, assessmentFilter, systemFilter]);

  useEffect(() => { load(); }, [load]);

  async function openDetail(o: Obligation) {
    setSelected(o.id);
    try {
      const [det, controls, evidence] = await Promise.all([
        api.getObligation(o.id),
        api.getControls({ obligation_id: o.id }),
        api.getEvidence({ obligation_id: o.id }),
      ]);
      setDetail(det);
      setDetailControls(controls);
      setDetailEvidence(evidence);
    } catch (e) {
      showToast(`Failed to load detail: ${(e as Error).message}`, true);
    }
  }

  function closePanel() { setSelected(null); setDetail(null); setDetailControls([]); setDetailEvidence([]); }

  async function changeStatus(id: string, status: string) {
    try {
      await api.updateObligation(id, { status });
      showToast("Status updated");
      setObligations((prev) => prev.map((o) => o.id === id ? { ...o, status } : o));
      if (selected === id) setDetail((d) => d ? { ...d, status } : d);
    } catch (e) {
      showToast((e as Error).message, true);
    }
  }

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return obligations.filter((o) =>
      (!s || o.title.toLowerCase().includes(s) || o.article_ref.toLowerCase().includes(s)) &&
      (!statusFilter || o.status === statusFilter)
    );
  }, [obligations, search, statusFilter]);

  const kpis = useMemo(() => ({
    total: obligations.length,
    fulfilled: obligations.filter((o) => o.status === "fulfilled").length,
    inProgress: obligations.filter((o) => o.status === "in_progress").length,
    overdue: obligations.filter((o) => o.status === "overdue").length,
  }), [obligations]);

  const systems = useMemo(() => Object.values(systemsById), [systemsById]);
  const filteredAssessments = useMemo(() =>
    systemFilter ? assessments.filter((a) => a.ai_system_id === systemFilter) : assessments,
  [assessments, systemFilter]);

  return (
    <>
      <div className="page-header">
        <h1>Obligations</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-ghost" onClick={load}>↺ Refresh</button>
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>+ New Obligation</button>
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard label="Total" value={kpis.total} />
        <KpiCard label="Fulfilled" value={kpis.fulfilled} sub={`${kpis.total ? Math.round(kpis.fulfilled / kpis.total * 100) : 0}% of total`} />
        <KpiCard label="In Progress" value={kpis.inProgress} />
        <KpiCard label="Overdue" value={kpis.overdue} />
      </div>

      <div className="toolbar" style={{ marginTop: 12 }}>
        <input className="search-input" placeholder="Search obligations…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="filter-select" value={systemFilter} onChange={(e) => { setSystemFilter(e.target.value); setAssessmentFilter(""); }}>
          <option value="">All Systems</option>
          {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="filter-select" value={assessmentFilter} onChange={(e) => setAssessmentFilter(e.target.value)}>
          <option value="">All Assessments</option>
          {filteredAssessments.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
        </select>
        <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{OBLIGATION_STATUS_META[s].label}</option>)}
        </select>
        <div className="toolbar-spacer" />
      </div>

      <div className="content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Obligation</th>
                <th>Article</th>
                <th>AI System</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Due</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="empty-row"><td colSpan={7}>No obligations found.</td></tr>
              ) : filtered.map((o) => (
                <tr key={o.id} className={`clickable${selected === o.id ? " selected" : ""}`} onClick={() => openDetail(o)}>
                  <td><div className="row-name">{o.title}</div><div className="row-sub">{o.id}</div></td>
                  <td style={{ fontSize: 12 }}>{o.article_ref || "—"}</td>
                  <td>{systemsById[o.ai_system_id]?.name ?? o.ai_system_id}</td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>{o.owner || "—"}</td>
                  <td><StatusBadge meta={OBLIGATION_STATUS_META} value={o.status} /></td>
                  <td style={{ color: o.status === "overdue" ? "#bb0000" : "var(--text-secondary)", fontSize: 13 }}>{fmtDate(o.due_date)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="actions">
                      <select className="inline-select" value={o.status} onChange={(e) => changeStatus(o.id, e.target.value)}>
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{OBLIGATION_STATUS_META[s].label}</option>)}
                      </select>
                      <button className="btn-ghost btn-sm btn-danger" data-tip="Delete this obligation"
                        onClick={async () => {
                          if (!confirm(`Delete "${o.title}"?`)) return;
                          try { await api.deleteObligation(o.id); showToast("Deleted"); load(); closePanel(); }
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
          subtitle={detail.article_ref ? `${detail.framework_id} — ${detail.article_ref}` : detail.framework_id}
          badge={OBLIGATION_STATUS_META[detail.status]?.label}
          onClose={closePanel}
        >
          <DetailSection title="Overview">
            <DetailField label="ID">{detail.id}</DetailField>
            <DetailField label="AI System">{systemsById[detail.ai_system_id]?.name ?? detail.ai_system_id}</DetailField>
            <DetailField label="Owner">{detail.owner || "—"}</DetailField>
            <DetailField label="Status"><StatusBadge meta={OBLIGATION_STATUS_META} value={detail.status} /></DetailField>
            <DetailField label="Due Date">{fmtDate(detail.due_date)}</DetailField>
            <DetailField label="Created">{fmtDate(detail.created_at)}</DetailField>
          </DetailSection>
          {detail.description && (
            <DetailSection title="Description">
              <p className="dp-description">{detail.description}</p>
            </DetailSection>
          )}
          <DetailSection title={`Related Controls (${detailControls.length})`}>
            {detailControls.length === 0
              ? <p className="dp-description" style={{ color: "var(--text-secondary)" }}>No controls linked.</p>
              : <ul className="dp-list">{detailControls.map((c) => (
                  <li key={c.id}><span className="dp-list-name">{c.title}</span><StatusBadge meta={CONTROL_STATUS_META} value={c.status} /></li>
                ))}</ul>
            }
          </DetailSection>
          <DetailSection title={`Evidence (${detailEvidence.length})`}>
            {detailEvidence.length === 0
              ? <p className="dp-description" style={{ color: "var(--text-secondary)" }}>No evidence linked.</p>
              : <ul className="dp-list">{detailEvidence.map((e) => (
                  <li key={e.id}><span className="dp-list-name">{e.title}</span><StatusBadge meta={EVIDENCE_STATUS_META} value={e.status} /></li>
                ))}</ul>
            }
          </DetailSection>
          <div className="dp-actions">
            <select className="form-select" value={detail.status}
              onChange={async (e) => {
                await changeStatus(detail.id, e.target.value);
                setDetail((d) => d ? { ...d, status: e.target.value } : d);
              }}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{OBLIGATION_STATUS_META[s].label}</option>)}
            </select>
          </div>
        </DetailPanel>
      )}

      <CreateObligationModal open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={load} />
    </>
  );
}
