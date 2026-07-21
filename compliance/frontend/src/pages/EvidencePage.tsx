import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import { StatusBadge } from "../components/Badges";
import KpiCard from "../components/KpiCard";
import DetailPanel, { DetailField, DetailSection } from "../components/DetailPanel";
import UploadEvidenceModal from "../components/UploadEvidenceModal";
import { EVIDENCE_STATUS_META, CONTROL_STATUS_META, OBLIGATION_STATUS_META, fmtDate, humanize } from "../utils";
import type { AISystem, Control, Evidence, EvidenceDetail, Obligation } from "../types";

export default function EvidencePage(): JSX.Element {
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [systemsById, setSystemsById] = useState<Record<string, AISystem>>({});
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<EvidenceDetail | null>(null);
  const [detailControls, setDetailControls] = useState<Control[]>([]);
  const [detailObligations, setDetailObligations] = useState<Obligation[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const showToast = useToast();

  const load = useCallback(async () => {
    try {
      const [ev, sys] = await Promise.all([api.getEvidence(), api.getSystems()]);
      setEvidence(ev);
      setSystemsById(Object.fromEntries(sys.map((s) => [s.id, s])));
    } catch (e) {
      showToast(`Failed to load: ${(e as Error).message}`, true);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  async function openDetail(e: Evidence) {
    setSelected(e.id);
    try {
      // The evidence detail is the critical piece — load it first so the panel
      // still opens even if the linked controls/obligations lookups fail.
      const det = await api.getEvidenceItem(e.id);
      setDetail(det);
      const [controls, obligations] = await Promise.all([
        api.getControls({ evidence_id: e.id }),
        api.getObligations({ evidence_id: e.id }),
      ]);
      setDetailControls(controls);
      setDetailObligations(obligations);
    } catch (err) {
      showToast(`Failed to load detail: ${(err as Error).message}`, true);
    }
  }

  function closePanel() { setSelected(null); setDetail(null); setDetailControls([]); setDetailObligations([]); }

  async function act(fn: (id: string) => Promise<Evidence>, id: string, msg: string) {
    try {
      await fn(id);
      showToast(msg);
      load();
      if (selected === id) {
        const det = await api.getEvidenceItem(id);
        setDetail(det);
      }
    } catch (e) {
      showToast((e as Error).message, true);
    }
  }

  async function copyDownloadUrl(id: string) {
    try {
      const { url } = await api.getDownloadUrl(id);
      await navigator.clipboard.writeText(url);
      showToast("Download URL copied to clipboard (valid 1 hour)");
    } catch (e) {
      showToast((e as Error).message, true);
    }
  }

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return evidence.filter((e) =>
      (!s || e.title.toLowerCase().includes(s) || (e.file_name ?? "").toLowerCase().includes(s)) &&
      (!statusFilter || e.status === statusFilter)
    );
  }, [evidence, search, statusFilter]);

  const kpis = useMemo(() => ({
    total: evidence.length,
    approved: evidence.filter((e) => e.status === "approved").length,
    pending: evidence.filter((e) => e.status === "pending" || e.status === "under_review").length,
    expired: evidence.filter((e) => e.status === "expired" || e.status === "rejected").length,
  }), [evidence]);

  return (
    <>
      <div className="page-header">
        <h1>Evidence</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-ghost" onClick={load}>↺ Refresh</button>
          <button className="btn-primary" onClick={() => setUploadOpen(true)}>+ Upload Evidence</button>
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard label="Total" value={kpis.total} />
        <KpiCard label="Approved" value={kpis.approved} sub={`${kpis.total ? Math.round(kpis.approved / kpis.total * 100) : 0}% of total`} />
        <KpiCard label="Pending Review" value={kpis.pending} />
        <KpiCard label="Expired / Rejected" value={kpis.expired} />
      </div>

      <div className="toolbar" style={{ marginTop: 12 }}>
        <input className="search-input" placeholder="Search evidence…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {Object.entries(EVIDENCE_STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
        </select>
        <div className="toolbar-spacer" />
      </div>

      <div className="content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Evidence</th>
                <th>Type</th>
                <th>AI System</th>
                <th>Status</th>
                <th>File</th>
                <th>Valid Until</th>
                <th>Uploaded</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="empty-row"><td colSpan={8}>No evidence yet. Click "Upload Evidence" to add proof.</td></tr>
              ) : filtered.map((e) => (
                <tr key={e.id} className={`clickable${selected === e.id ? " selected" : ""}`} onClick={() => openDetail(e)}>
                  <td><div className="row-name">{e.title}</div><div className="row-sub">{e.id}</div></td>
                  <td style={{ fontSize: 13 }}>{humanize(e.evidence_type)}</td>
                  <td>{e.ai_system_id ? (systemsById[e.ai_system_id]?.name ?? e.ai_system_id) : "—"}</td>
                  <td><StatusBadge meta={EVIDENCE_STATUS_META} value={e.status} /></td>
                  <td>{e.file_name ? <span className="chip">{e.file_name}</span> : "—"}</td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>{fmtDate(e.validity_until)}</td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>{fmtDate(e.created_at)}</td>
                  <td onClick={(ev) => ev.stopPropagation()}>
                    <div className="actions">
                      {e.status !== "approved" && (
                        <button className="btn-ghost btn-sm" data-tip="Mark as approved — triggers compliance cascade"
                          onClick={() => act(api.approveEvidence, e.id, "Approved")}>Approve</button>
                      )}
                      {e.status !== "rejected" && (
                        <button className="btn-ghost btn-sm" data-tip="Mark as rejected"
                          onClick={() => act(api.rejectEvidence, e.id, "Rejected")}>Reject</button>
                      )}
                      <button className="btn-ghost btn-sm btn-danger" data-tip="Delete evidence and remove file"
                        onClick={async () => {
                          if (!confirm(`Delete "${e.title}"?`)) return;
                          try { await api.deleteEvidence(e.id); showToast("Deleted"); load(); closePanel(); }
                          catch (err) { showToast((err as Error).message, true); }
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
          subtitle={humanize(detail.evidence_type)}
          badge={EVIDENCE_STATUS_META[detail.status]?.label}
          onClose={closePanel}
        >
          <DetailSection title="General Information">
            <DetailField label="ID">{detail.id}</DetailField>
            <DetailField label="AI System">{detail.ai_system_id ? (systemsById[detail.ai_system_id]?.name ?? detail.ai_system_id) : "—"}</DetailField>
            <DetailField label="Type">{humanize(detail.evidence_type)}</DetailField>
            <DetailField label="Status"><StatusBadge meta={EVIDENCE_STATUS_META} value={detail.status} /></DetailField>
            <DetailField label="Uploaded By">{detail.uploaded_by || "—"}</DetailField>
            <DetailField label="Uploaded">{fmtDate(detail.created_at)}</DetailField>
            <DetailField label="Valid From">{fmtDate(detail.validity_from)}</DetailField>
            <DetailField label="Valid Until">{fmtDate(detail.validity_until)}</DetailField>
          </DetailSection>
          {detail.file_name && (
            <DetailSection title="File">
              <DetailField label="Name">{detail.file_name}</DetailField>
              <DetailField label="Size">{detail.file_size ? `${(detail.file_size / 1024).toFixed(1)} KB` : "—"}</DetailField>
              <DetailField label="Type">{detail.mime_type || "—"}</DetailField>
            </DetailSection>
          )}
          {detail.description && (
            <DetailSection title="Description">
              <p className="dp-description">{detail.description}</p>
            </DetailSection>
          )}
          {(detailControls.length > 0 || detailObligations.length > 0 || detail.assessment_id) && (
            <DetailSection title="Linked To">
              {detailControls.length > 0 && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", padding: "4px 0 2px" }}>Controls</div>
                  <ul className="dp-list">{detailControls.map((c) => (
                    <li key={c.id}><span className="dp-list-name">{c.title}</span><StatusBadge meta={CONTROL_STATUS_META} value={c.status} /></li>
                  ))}</ul>
                </>
              )}
              {detailObligations.length > 0 && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", padding: "8px 0 2px" }}>Obligations</div>
                  <ul className="dp-list">{detailObligations.map((o) => (
                    <li key={o.id}><span className="dp-list-name">{o.title}</span><StatusBadge meta={OBLIGATION_STATUS_META} value={o.status} /></li>
                  ))}</ul>
                </>
              )}
              {detail.assessment_id && (
                <DetailField label="Assessment">{detail.assessment_id}</DetailField>
              )}
            </DetailSection>
          )}
          <div className="dp-actions">
            {detail.file_name && (
              <button className="btn-ghost btn-sm" onClick={() => copyDownloadUrl(detail.id)}>⬇ Download URL</button>
            )}
            {detail.status !== "approved" && (
              <button className="btn-primary btn-sm" onClick={() => act(api.approveEvidence, detail.id, "Approved")}>✓ Approve</button>
            )}
            {detail.status !== "rejected" && (
              <button className="btn-ghost btn-sm" onClick={() => act(api.rejectEvidence, detail.id, "Rejected")}>✗ Reject</button>
            )}
          </div>
        </DetailPanel>
      )}

      <UploadEvidenceModal open={uploadOpen} onClose={() => setUploadOpen(false)} onSuccess={load} />
    </>
  );
}
