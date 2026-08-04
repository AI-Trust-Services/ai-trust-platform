import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import { StatusBadge, ScoreBar } from "../components/Badges";
import KpiCard from "../components/KpiCard";
import DetailPanel, { DetailField, DetailSection } from "../components/DetailPanel";
import CreateAssessmentModal from "../components/CreateAssessmentModal";
import AssessmentCharts from "../components/AssessmentCharts";
import KebabMenu from "../components/KebabMenu";
import ScoreDonut from "../components/ScoreDonut";
import { ASSESSMENT_STATUS_META, fmtDate, humanize } from "../utils";
import { usePermissions } from "../hooks/usePermissions";
import type { Assessment, AssessmentDetail, AISystem, Framework } from "../types";

export default function AssessmentsPage(): JSX.Element {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [systemsById, setSystemsById] = useState<Record<string, AISystem>>({});
  const [frameworksById, setFrameworksById] = useState<Record<string, Framework>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AssessmentDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const showToast = useToast();
  const { can } = usePermissions();
  const mayWrite = can("assessments:write");
  const mayApprove = can("assessments:approve");
  const noWriteTitle = "Erfordert Berechtigung: assessments:write";
  const noApproveTitle = "Erfordert Berechtigung: assessments:approve";

  const load = useCallback(async () => {
    try {
      const [assess, sys, fw] = await Promise.all([
        api.getAssessments(), api.getSystems(), api.getFrameworks(),
      ]);
      setAssessments(assess);
      setSystemsById(Object.fromEntries(sys.map((s) => [s.id, s])));
      setFrameworksById(Object.fromEntries(fw.map((f) => [f.id, f])));
    } catch (e) {
      showToast(`Failed to load: ${(e as Error).message}`, true);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  async function openDetail(a: Assessment) {
    setSelected(a.id);
    try {
      setSelectedDetail(await api.getAssessment(a.id));
    } catch (e) {
      showToast(`Failed to load detail: ${(e as Error).message}`, true);
    }
  }

  function closePanel() { setSelected(null); setSelectedDetail(null); }

  async function act(fn: (id: string) => Promise<Assessment>, id: string, successMsg: string | ((r: Assessment) => string)) {
    setBusy(id);
    try {
      const res = await fn(id);
      showToast(typeof successMsg === "function" ? successMsg(res) : successMsg);
      await load();
      if (selected === id) setSelectedDetail(await api.getAssessment(id));
    } catch (e) {
      showToast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return assessments.filter((a) => {
      const matchSearch = !s || a.title.toLowerCase().includes(s) ||
        (systemsById[a.ai_system_id]?.name ?? "").toLowerCase().includes(s);
      return matchSearch && (!statusFilter || a.status === statusFilter);
    });
  }, [assessments, search, statusFilter, systemsById]);

  const kpis = useMemo(() => ({
    total: assessments.length,
    approved: assessments.filter((a) => a.status === "approved").length,
    submitted: assessments.filter((a) => a.status === "submitted" || a.status === "under_review").length,
    draft: assessments.filter((a) => a.status === "draft").length,
  }), [assessments]);

  return (
    <>
      <div className="page-header">
        <h1>Assessments</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-ghost" onClick={load}>↺ Refresh</button>
          <button
            className="btn-primary"
            disabled={!mayWrite}
            title={mayWrite ? undefined : noWriteTitle}
            onClick={() => setCreateOpen(true)}
          >+ New Assessment</button>
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard label="Total" value={kpis.total} />
        <KpiCard label="Approved" value={kpis.approved} sub={`${kpis.total ? Math.round(kpis.approved / kpis.total * 100) : 0}% of total`} />
        <KpiCard label="In Review" value={kpis.submitted} />
        <KpiCard label="Draft" value={kpis.draft} />
      </div>

      <AssessmentCharts assessments={assessments} />

      <div className="toolbar" style={{ marginTop: 12 }}>
        <input className="search-input" placeholder="Search assessments…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {Object.entries(ASSESSMENT_STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
        </select>
        <div className="toolbar-spacer" />
      </div>

      <div className="content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Assessment</th>
                <th>AI System</th>
                <th>Framework</th>
                <th>Type</th>
                <th>Status</th>
                <th>Score</th>
                <th>Created</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="empty-row"><td colSpan={8}>No assessments yet. Click "New Assessment" to begin.</td></tr>
              ) : filtered.map((a) => (
                <tr key={a.id} className={`clickable${selected === a.id ? " selected" : ""}`} onClick={() => openDetail(a)}>
                  <td><div className="row-name">{a.title}</div><div className="row-sub">{a.id}</div></td>
                  <td>{systemsById[a.ai_system_id]?.name ?? a.ai_system_id}</td>
                  <td>{frameworksById[a.framework_id]?.name ?? a.framework_id}</td>
                  <td>{humanize(a.type)}</td>
                  <td><StatusBadge meta={ASSESSMENT_STATUS_META} value={a.status} /></td>
                  <td><ScoreBar score={a.score} /></td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>{fmtDate(a.created_at)}</td>
                  <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                    <KebabMenu items={[
                      ...(a.status === "draft" ? [{
                        label: "Submit for Review",
                        disabled: busy === a.id || !mayWrite,
                        onClick: () => act(api.submitAssessment, a.id, "Submitted"),
                      }] : []),
                      ...(a.status !== "approved" ? [{
                        label: "Approve",
                        disabled: busy === a.id || !mayApprove,
                        onClick: () => act(api.approveAssessment, a.id, (r) => `Approved — score ${r.score ?? "N/A"}%`),
                      }] : []),
                      {
                        label: "Delete",
                        danger: true,
                        disabled: busy === a.id || !mayWrite,
                        onClick: async () => {
                          if (!confirm(`Delete "${a.title}"?`)) return;
                          setBusy(a.id);
                          try { await api.deleteAssessment(a.id); showToast("Deleted"); closePanel(); await load(); }
                          catch (e) { showToast((e as Error).message, true); }
                          finally { setBusy(null); }
                        },
                      },
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedDetail && (
        <DetailPanel
          title={selectedDetail.title}
          subtitle={frameworksById[selectedDetail.framework_id]?.name}
          badge={ASSESSMENT_STATUS_META[selectedDetail.status]?.label}
          onClose={closePanel}
        >
          <DetailSection title="Assessment Information">
            <DetailField label="ID">{selectedDetail.id}</DetailField>
            <DetailField label="AI System">{systemsById[selectedDetail.ai_system_id]?.name ?? selectedDetail.ai_system_id}</DetailField>
            <DetailField label="Framework">{frameworksById[selectedDetail.framework_id]?.name}</DetailField>
            <DetailField label="Type">{humanize(selectedDetail.type)}</DetailField>
            <DetailField label="Status"><StatusBadge meta={ASSESSMENT_STATUS_META} value={selectedDetail.status} /></DetailField>
            <DetailField label="Created">{fmtDate(selectedDetail.created_at)}</DetailField>
          </DetailSection>
          <DetailSection title="Score">
            <ScoreDonut detail={selectedDetail} />
          </DetailSection>
          {selectedDetail.notes && (
            <DetailSection title="Notes">
              <p className="dp-description">{selectedDetail.notes}</p>
            </DetailSection>
          )}
          <div className="dp-actions">
            {selectedDetail.status === "draft" && (
              <button className="btn-ghost btn-sm" disabled={busy === selectedDetail.id || !mayWrite}
                title={mayWrite ? undefined : noWriteTitle}
                onClick={() => act(api.submitAssessment, selectedDetail.id, "Submitted")}>Submit</button>
            )}
            {selectedDetail.status !== "approved" && (
              <button className="btn-ghost btn-sm" disabled={busy === selectedDetail.id || !mayApprove}
                title={mayApprove ? undefined : noApproveTitle}
                onClick={() => act(api.approveAssessment, selectedDetail.id, (r) => `Approved — score ${r.score ?? "N/A"}%`)}>Approve</button>
            )}
          </div>
        </DetailPanel>
      )}

      <CreateAssessmentModal open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={load} />
    </>
  );
}
