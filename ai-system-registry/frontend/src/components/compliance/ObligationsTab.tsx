/**
 * ObligationsTab — Embedded obligations view for SystemWorkspace.
 * Displays obligations filtered by the current AI system.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { ListChecks, CheckCircle2, Clock, AlertTriangle, RotateCw, ExternalLink } from "lucide-react";
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
import type { Obligation, ObligationDetail, Control, Evidence } from "../../types";
import { OBLIGATION_STATUS_META, CONTROL_STATUS_META, EVIDENCE_STATUS_META, fmtDate, getStatusColor } from "../../utils/compliance";

const ALL = "__all__";
const STATUS_OPTIONS = ["applicable", "in_progress", "fulfilled", "not_applicable", "overdue"] as const;

interface ObligationsTabProps {
  systemId: string;
  systemName: string;
}

export default function ObligationsTab({ systemId, systemName }: ObligationsTabProps) {
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [selected, setSelected] = useState<ObligationDetail | null>(null);
  const [detailControls, setDetailControls] = useState<Control[]>([]);
  const [detailEvidence, setDetailEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const obs = await api.compliance.getObligations({ ai_system_id: systemId });
      setObligations(obs);
    } catch (e) {
      console.error("Failed to load obligations:", e);
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => { load(); }, [load]);

  async function openDetail(o: Obligation) {
    try {
      const [det, controls, evidence] = await Promise.all([
        api.compliance.getObligation(o.id),
        api.compliance.getControls({ obligation_id: o.id }),
        api.compliance.getEvidence({ obligation_id: o.id }),
      ]);
      setSelected(det);
      setDetailControls(controls);
      setDetailEvidence(evidence);
    } catch (e) {
      console.error("Failed to load obligation detail:", e);
    }
  }

  async function changeStatus(id: string, status: string) {
    try {
      await api.compliance.updateObligation(id, { status });
      setObligations((prev) => prev.map((o) => o.id === id ? { ...o, status } : o));
      if (selected?.id === id) setSelected((d) => d ? { ...d, status } : d);
    } catch (e) {
      console.error("Failed to update status:", e);
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
          <h2 className="text-lg font-semibold">Obligations</h2>
          <p className="text-sm text-muted-foreground">Regulatory obligations for {systemName}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RotateCw className="mr-2 size-4" /> Refresh
          </Button>
          <Button size="sm" onClick={() => navigateToPath(`/home/obligations`)}>
            <ExternalLink className="mr-2 size-4" /> Open in Compliance
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-gray-100">
              <ListChecks className="size-5 text-gray-600" />
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
              <p className="text-2xl font-semibold">{kpis.fulfilled}</p>
              <p className="text-xs text-muted-foreground">Fulfilled</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-100">
              <Clock className="size-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{kpis.inProgress}</p>
              <p className="text-xs text-muted-foreground">In Progress</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-orange-100">
              <AlertTriangle className="size-5 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{kpis.overdue}</p>
              <p className="text-xs text-muted-foreground">Overdue</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search obligations…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={statusFilter || ALL} onValueChange={(v) => setStatusFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{OBLIGATION_STATUS_META[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Obligation</TableHead>
              <TableHead>Article</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Change Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  {obligations.length === 0
                    ? "No obligations yet. Generate them from an assessment."
                    : "No obligations match your filters."}
                </TableCell>
              </TableRow>
            ) : filtered.map((o) => (
              <TableRow
                key={o.id}
                className="cursor-pointer"
                onClick={() => openDetail(o)}
              >
                <TableCell>
                  <div className="font-medium">{o.title}</div>
                  <div className="text-xs text-muted-foreground">{o.id}</div>
                </TableCell>
                <TableCell className="text-xs">{o.article_ref || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{o.owner || "—"}</TableCell>
                <TableCell>
                  <Badge className={getStatusColor(OBLIGATION_STATUS_META[o.status]?.cls || "")}>
                    {OBLIGATION_STATUS_META[o.status]?.label ?? o.status}
                  </Badge>
                </TableCell>
                <TableCell className={o.status === "overdue" ? "text-red-600" : "text-muted-foreground"}>
                  {fmtDate(o.due_date)}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Select value={o.status} onValueChange={(v) => changeStatus(o.id, v)}>
                    <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>{OBLIGATION_STATUS_META[s].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
              <p className="text-sm text-muted-foreground">{selected.article_ref}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setSelected(null); setDetailControls([]); setDetailEvidence([]); }}>×</Button>
          </div>

          {selected.description && (
            <p className="mt-3 text-sm text-muted-foreground">{selected.description}</p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-6">
            {/* Related Controls */}
            <div>
              <h4 className="mb-2 text-sm font-medium">Related Controls ({detailControls.length})</h4>
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

            {/* Related Evidence */}
            <div>
              <h4 className="mb-2 text-sm font-medium">Evidence ({detailEvidence.length})</h4>
              {detailEvidence.length === 0 ? (
                <p className="text-sm text-muted-foreground">No evidence linked.</p>
              ) : (
                <ul className="space-y-1">
                  {detailEvidence.map((e) => (
                    <li key={e.id} className="flex items-center justify-between text-sm">
                      <span className="truncate">{e.title}</span>
                      <Badge variant="outline" className={getStatusColor(EVIDENCE_STATUS_META[e.status]?.cls || "")}>
                        {EVIDENCE_STATUS_META[e.status]?.label}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
