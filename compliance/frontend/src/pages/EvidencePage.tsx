import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, RotateCw, Download, Upload, Check, X } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import { StatusBadge } from "../components/Badges";
import KpiCard from "../components/KpiCard";
import DetailPanel, { DetailField, DetailSection } from "../components/DetailPanel";
import UploadEvidenceModal from "../components/UploadEvidenceModal";
import UploadVersionModal from "../components/UploadVersionModal";
import { EVIDENCE_STATUS_META, EVIDENCE_TYPES, CONTROL_STATUS_META, OBLIGATION_STATUS_META, fmtDate, humanize } from "../utils";
import { usePermissions } from "../hooks/usePermissions";
import type { AISystem, Control, Evidence, EvidenceDetail, EvidenceVersion, Obligation } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// Radix Select disallows an empty-string item value — sentinel for "All".
const ALL = "__all__";

export default function EvidencePage() {
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [systemsById, setSystemsById] = useState<Record<string, AISystem>>({});
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [systemFilter, setSystemFilter] = useState("");
  const [uploaderFilter, setUploaderFilter] = useState("");
  const [expiryFilter, setExpiryFilter] = useState<"all" | "expiring" | "expired">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<EvidenceDetail | null>(null);
  const [detailControls, setDetailControls] = useState<Control[]>([]);
  const [detailObligations, setDetailObligations] = useState<Obligation[]>([]);
  const [versions, setVersions] = useState<EvidenceVersion[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const showToast = useToast();
  const { can } = usePermissions();
  const mayWrite = can("evidence:write");
  const mayApprove = can("evidence:approve");
  const noWriteTitle = "Requires permission: evidence:write";
  const noApproveTitle = "Requires permission: evidence:approve";

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
      const det = await api.getEvidenceItem(e.id);
      setDetail(det);
      const [controls, obligations, vers] = await Promise.all([
        api.getControls({ evidence_id: e.id }),
        api.getObligations({ evidence_id: e.id }),
        api.getEvidenceVersions(e.id),
      ]);
      setDetailControls(controls);
      setDetailObligations(obligations);
      setVersions(vers);
    } catch (err) {
      showToast(`Failed to load detail: ${(err as Error).message}`, true);
    }
  }

  function closePanel() { setSelected(null); setDetail(null); setDetailControls([]); setDetailObligations([]); setVersions([]); }

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
    const today = new Date();
    const in30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    return evidence.filter((e) => {
      if (s && !e.title.toLowerCase().includes(s) && !(e.file_name ?? "").toLowerCase().includes(s) && !(e.uploaded_by ?? "").toLowerCase().includes(s)) return false;
      if (statusFilter && e.status !== statusFilter) return false;
      if (typeFilter && e.evidence_type !== typeFilter) return false;
      if (systemFilter && e.ai_system_id !== systemFilter) return false;
      if (uploaderFilter && e.uploaded_by !== uploaderFilter) return false;
      if (expiryFilter === "expired") {
        if (e.status !== "expired") return false;
      }
      if (expiryFilter === "expiring") {
        if (!e.validity_until) return false;
        const d = new Date(e.validity_until);
        if (!(d >= today && d <= in30)) return false;
      }
      return true;
    });
  }, [evidence, search, statusFilter, typeFilter, systemFilter, uploaderFilter, expiryFilter]);

  const uploaders = useMemo(() => [...new Set(evidence.map((e) => e.uploaded_by).filter(Boolean))].sort(), [evidence]);
  const systems = useMemo(() => Object.values(systemsById), [systemsById]);

  const kpis = useMemo(() => ({
    total: evidence.length,
    approved: evidence.filter((e) => e.status === "approved").length,
    pending: evidence.filter((e) => e.status === "pending" || e.status === "under_review").length,
    expired: evidence.filter((e) => e.status === "expired" || e.status === "rejected").length,
  }), [evidence]);

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
        <h1 className="text-lg font-semibold text-foreground">Evidence</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RotateCw /> Refresh</Button>
          <Button
            size="sm"
            disabled={!mayWrite}
            title={mayWrite ? undefined : noWriteTitle}
            onClick={() => setUploadOpen(true)}
          ><Plus /> Upload Evidence</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 px-5 pt-4">
        <KpiCard label="Total" value={kpis.total} />
        <KpiCard label="Approved" value={kpis.approved} sub={`${kpis.total ? Math.round(kpis.approved / kpis.total * 100) : 0}% of total`} />
        <KpiCard label="Pending Review" value={kpis.pending} />
        <KpiCard label="Expired / Rejected" value={kpis.expired} />
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
        <Input className="max-w-xs" placeholder="Search by title, file, uploader…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={statusFilter || ALL} onValueChange={(v) => setStatusFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Statuses</SelectItem>
            {Object.entries(EVIDENCE_STATUS_META).map(([v, m]) => <SelectItem key={v} value={v}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter || ALL} onValueChange={(v) => setTypeFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Types</SelectItem>
            {EVIDENCE_TYPES.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={systemFilter || ALL} onValueChange={(v) => setSystemFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Systems</SelectItem>
            {systems.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={uploaderFilter || ALL} onValueChange={(v) => setUploaderFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Uploaders</SelectItem>
            {uploaders.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={expiryFilter} onValueChange={(v) => setExpiryFilter(v as "all" | "expiring" | "expired")}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Expiry</SelectItem>
            <SelectItem value="expiring">Expiring Soon (≤30d)</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="px-5 py-4">
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Evidence</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>AI System</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Valid Until</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No evidence yet. Click "Upload Evidence" to add proof.</TableCell></TableRow>
              ) : filtered.map((e) => (
                <TableRow key={e.id} data-state={selected === e.id ? "selected" : undefined} className="cursor-pointer" onClick={() => openDetail(e)}>
                  <TableCell><div className="font-medium text-foreground">{e.title}</div><div className="text-xs text-muted-foreground">{e.id}</div></TableCell>
                  <TableCell className="text-[13px]">{humanize(e.evidence_type)}</TableCell>
                  <TableCell>{e.ai_system_id ? (systemsById[e.ai_system_id]?.name ?? e.ai_system_id) : "—"}</TableCell>
                  <TableCell><Badge variant="secondary" className="rounded-full font-medium">v{e.version_label}</Badge></TableCell>
                  <TableCell><StatusBadge meta={EVIDENCE_STATUS_META} value={e.status} /></TableCell>
                  <TableCell>{e.file_name ? <Badge variant="secondary" className="max-w-[160px] truncate rounded-full font-medium">{e.file_name}</Badge> : "—"}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{fmtDate(e.validity_until)}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{fmtDate(e.created_at)}</TableCell>
                  <TableCell onClick={(ev) => ev.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      {e.status !== "approved" && (
                        <Button variant="ghost" size="sm"
                          disabled={!mayApprove} title={mayApprove ? "Mark as approved — triggers compliance cascade" : noApproveTitle}
                          onClick={() => act(api.approveEvidence, e.id, "Approved")}>Approve</Button>
                      )}
                      {e.status !== "rejected" && (
                        <Button variant="ghost" size="sm"
                          disabled={!mayApprove} title={mayApprove ? "Mark as rejected" : noApproveTitle}
                          onClick={() => act(api.rejectEvidence, e.id, "Rejected")}>Reject</Button>
                      )}
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                        disabled={!mayWrite} title={mayWrite ? "Delete evidence and remove file" : noWriteTitle}
                        onClick={async () => {
                          if (!confirm(`Delete "${e.title}"?`)) return;
                          try { await api.deleteEvidence(e.id); showToast("Deleted"); load(); closePanel(); }
                          catch (err) { showToast((err as Error).message, true); }
                        }}>Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
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
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{detail.description}</p>
            </DetailSection>
          )}
          {(detailControls.length > 0 || detailObligations.length > 0 || detail.assessment_id) && (
            <DetailSection title="Linked To">
              {detailControls.length > 0 && (
                <>
                  <div className="pb-0.5 pt-1 text-xs font-semibold text-muted-foreground">Controls</div>
                  <ul className="flex flex-col gap-1.5">{detailControls.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2"><span className="truncate text-[13px] text-foreground">{c.title}</span><StatusBadge meta={CONTROL_STATUS_META} value={c.status} /></li>
                  ))}</ul>
                </>
              )}
              {detailObligations.length > 0 && (
                <>
                  <div className="pb-0.5 pt-2 text-xs font-semibold text-muted-foreground">Obligations</div>
                  <ul className="flex flex-col gap-1.5">{detailObligations.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2"><span className="truncate text-[13px] text-foreground">{o.title}</span><StatusBadge meta={OBLIGATION_STATUS_META} value={o.status} /></li>
                  ))}</ul>
                </>
              )}
              {detail.assessment_id && (
                <DetailField label="Assessment">{detail.assessment_id}</DetailField>
              )}
            </DetailSection>
          )}
          <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
            {detail.file_name && (
              <Button variant="outline" size="sm" onClick={() => copyDownloadUrl(detail.id)}><Download /> Download URL</Button>
            )}
            <Button variant="outline" size="sm" disabled={!mayWrite} title={mayWrite ? undefined : noWriteTitle}
              onClick={() => setVersionOpen(true)}><Upload /> New Version</Button>
            {detail.status !== "approved" && (
              <Button size="sm" disabled={!mayApprove} title={mayApprove ? undefined : noApproveTitle}
                onClick={() => act(api.approveEvidence, detail.id, "Approved")}><Check /> Approve</Button>
            )}
            {detail.status !== "rejected" && (
              <Button variant="outline" size="sm" disabled={!mayApprove} title={mayApprove ? undefined : noApproveTitle}
                onClick={() => act(api.rejectEvidence, detail.id, "Rejected")}><X /> Reject</Button>
            )}
          </div>

          {/* Version history */}
          {detail.version_label && (
            <DetailSection title="Evidence History">
              <ul className="flex flex-col gap-2.5">
                {/* Current version at top with green dot */}
                <li className="flex flex-col items-start gap-0.5">
                  <div className="flex w-full items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full bg-[var(--success)]" />
                    <span className="text-[13px] font-semibold text-foreground">v{detail.version_label} — {detail.file_name} <Badge variant="secondary" className="rounded-full text-[10px] font-medium">current</Badge></span>
                    <span className="ml-auto text-[11px] text-muted-foreground">{fmtDate(detail.updated_at)}</span>
                  </div>
                  {detail.uploaded_by && (
                    <div className="pl-4 text-[11px] text-muted-foreground">{detail.uploaded_by}</div>
                  )}
                </li>
                {/* Previous versions, newest first */}
                {[...versions].reverse().map((v) => (
                  <li key={v.id} className="flex flex-col items-start gap-0.5">
                    <div className="flex w-full items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full bg-muted-foreground" />
                      <span className="text-[13px] text-foreground">v{v.version_label} — {v.file_name}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{fmtDate(v.created_at)}</span>
                    </div>
                    {v.uploaded_by && (
                      <div className="pl-4 text-[11px] text-muted-foreground">{v.uploaded_by}</div>
                    )}
                  </li>
                ))}
              </ul>
            </DetailSection>
          )}
        </DetailPanel>
      )}

      <UploadEvidenceModal open={uploadOpen} onClose={() => setUploadOpen(false)} onSuccess={load} />
      <UploadVersionModal
        open={versionOpen}
        evidence={detail}
        onClose={() => setVersionOpen(false)}
        onSuccess={async (updated) => {
          setDetail(updated);
          const vers = await api.getEvidenceVersions(updated.id);
          setVersions(vers);
          load();
        }}
      />
    </>
  );
}
