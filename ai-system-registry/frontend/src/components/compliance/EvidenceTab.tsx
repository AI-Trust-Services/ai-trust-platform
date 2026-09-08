/**
 * EvidenceTab — Embedded evidence view for SystemWorkspace.
 * Displays evidence filtered by the current AI system.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Paperclip, CheckCircle2, Clock, AlertTriangle, RotateCw, ExternalLink, Download } from "lucide-react";
import { api } from "../../api/client";
import { navigateToPath } from "../../hooks/useLuigi";
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
import type { Evidence, EvidenceDetail, Control, Obligation } from "../../types";
import { EVIDENCE_STATUS_META, CONTROL_STATUS_META, OBLIGATION_STATUS_META, fmtDate, humanize, getStatusColor } from "../../utils/compliance";

const ALL = "__all__";
const EVIDENCE_TYPES = [
  "document", "policy_document", "technical_doc", "test_report",
  "monitoring_data", "approval_record", "audit_log", "training_record",
  "certificate", "screenshot", "api_log",
];

interface EvidenceTabProps {
  systemId: string;
  systemName: string;
}

export default function EvidenceTab({ systemId, systemName }: EvidenceTabProps) {
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [selected, setSelected] = useState<EvidenceDetail | null>(null);
  const [detailControls, setDetailControls] = useState<Control[]>([]);
  const [detailObligations, setDetailObligations] = useState<Obligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ev = await api.compliance.getEvidence({ ai_system_id: systemId });
      setEvidence(ev);
    } catch (e) {
      console.error("Failed to load evidence:", e);
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => { load(); }, [load]);

  async function openDetail(e: Evidence) {
    try {
      const [det, controls, obligations] = await Promise.all([
        api.compliance.getEvidenceItem(e.id),
        api.compliance.getControls({ evidence_id: e.id }),
        api.compliance.getObligations({ evidence_id: e.id }),
      ]);
      setSelected(det);
      setDetailControls(controls);
      setDetailObligations(obligations);
    } catch (err) {
      console.error("Failed to load evidence detail:", err);
    }
  }

  async function copyDownloadUrl(id: string) {
    try {
      const { url } = await api.compliance.getDownloadUrl(id);
      await navigator.clipboard.writeText(url);
      // Could show toast here
    } catch (e) {
      console.error("Failed to get download URL:", e);
    }
  }

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return evidence.filter((e) => {
      if (s && !e.title.toLowerCase().includes(s) && !(e.file_name ?? "").toLowerCase().includes(s)) return false;
      if (statusFilter && e.status !== statusFilter) return false;
      if (typeFilter && e.evidence_type !== typeFilter) return false;
      return true;
    });
  }, [evidence, search, statusFilter, typeFilter]);

  const kpis = useMemo(() => ({
    total: evidence.length,
    approved: evidence.filter((e) => e.status === "approved").length,
    pending: evidence.filter((e) => e.status === "pending" || e.status === "under_review").length,
    expired: evidence.filter((e) => e.status === "expired" || e.status === "rejected").length,
  }), [evidence]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RotateCw className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Evidence</h2>
          <p className="text-sm text-muted-foreground">Supporting evidence for {systemName}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RotateCw className="mr-2 size-4" /> Refresh
          </Button>
          <Button size="sm" onClick={() => navigateToPath(`/home/evidence`)}>
            <ExternalLink className="mr-2 size-4" /> Open in Compliance
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-gray-100">
              <Paperclip className="size-5 text-gray-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{kpis.total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-green-100">
              <CheckCircle2 className="size-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{kpis.approved}</p>
              <p className="text-xs text-muted-foreground">Approved</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-100">
              <Clock className="size-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{kpis.pending}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-orange-100">
              <AlertTriangle className="size-5 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{kpis.expired}</p>
              <p className="text-xs text-muted-foreground">Expired/Rejected</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search evidence…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={statusFilter || ALL} onValueChange={(v) => setStatusFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Statuses</SelectItem>
            {Object.entries(EVIDENCE_STATUS_META).map(([v, m]) => (
              <SelectItem key={v} value={v}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter || ALL} onValueChange={(v) => setTypeFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Types</SelectItem>
            {EVIDENCE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {evidence.length}</span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Evidence</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Valid Until</TableHead>
              <TableHead>Uploaded By</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  {evidence.length === 0
                    ? "No evidence yet. Upload evidence in the Compliance module."
                    : "No evidence matches your filters."}
                </TableCell>
              </TableRow>
            ) : filtered.map((e) => (
              <TableRow
                key={e.id}
                className="cursor-pointer"
                onClick={() => openDetail(e)}
              >
                <TableCell>
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-muted-foreground">{e.id}</div>
                </TableCell>
                <TableCell className="text-sm">{humanize(e.evidence_type)}</TableCell>
                <TableCell>
                  <Badge variant="secondary">v{e.version_label}</Badge>
                </TableCell>
                <TableCell>
                  <Badge className={getStatusColor(EVIDENCE_STATUS_META[e.status]?.cls || "")}>
                    {EVIDENCE_STATUS_META[e.status]?.label ?? e.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {e.file_name ? (
                    <Badge variant="secondary" className="max-w-[140px] truncate">
                      {e.file_name}
                    </Badge>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">{fmtDate(e.validity_until)}</TableCell>
                <TableCell>
                  {e.uploaded_by ? (
                    <div className="flex items-center gap-2">
                      <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                        {e.uploaded_by.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="text-sm">{e.uploaded_by}</span>
                    </div>
                  ) : "—"}
                </TableCell>
                <TableCell onClick={(ev) => ev.stopPropagation()}>
                  {e.file_name && (
                    <Button variant="ghost" size="sm" onClick={() => copyDownloadUrl(e.id)}>
                      <Download className="size-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Detail Panel */}
      {selected && (
        <Card className="mt-4 p-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold">{selected.title}</h3>
              <p className="text-sm text-muted-foreground">{humanize(selected.evidence_type)}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setSelected(null); setDetailControls([]); setDetailObligations([]); }}>×</Button>
          </div>

          {selected.description && (
            <p className="mt-3 text-sm text-muted-foreground">{selected.description}</p>
          )}

          <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Status</p>
              <Badge className={getStatusColor(EVIDENCE_STATUS_META[selected.status]?.cls || "")}>
                {EVIDENCE_STATUS_META[selected.status]?.label}
              </Badge>
            </div>
            <div>
              <p className="text-muted-foreground">File</p>
              <p>{selected.file_name || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Valid Until</p>
              <p>{fmtDate(selected.validity_until)}</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-6">
            {/* Related Controls */}
            <div>
              <h4 className="mb-2 text-sm font-medium">Linked Controls ({detailControls.length})</h4>
              {detailControls.length === 0 ? (
                <p className="text-sm text-muted-foreground">No controls linked.</p>
              ) : (
                <ul className="space-y-1">
                  {detailControls.map((c) => (
                    <li key={c.id} className="flex items-center justify-between text-sm">
                      <span className="truncate">{c.title}</span>
                      <Badge variant="outline" className={getStatusColor(CONTROL_STATUS_META[c.status]?.cls || "")}>
                        {CONTROL_STATUS_META[c.status]?.label}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Related Obligations */}
            <div>
              <h4 className="mb-2 text-sm font-medium">Linked Obligations ({detailObligations.length})</h4>
              {detailObligations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No obligations linked.</p>
              ) : (
                <ul className="space-y-1">
                  {detailObligations.map((o) => (
                    <li key={o.id} className="flex items-center justify-between text-sm">
                      <span className="truncate">{o.title}</span>
                      <Badge variant="outline" className={getStatusColor(OBLIGATION_STATUS_META[o.status]?.cls || "")}>
                        {OBLIGATION_STATUS_META[o.status]?.label}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {selected.file_name && (
            <div className="mt-4">
              <Button variant="outline" size="sm" onClick={() => copyDownloadUrl(selected.id)}>
                <Download className="mr-2 size-4" /> Copy Download URL
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
