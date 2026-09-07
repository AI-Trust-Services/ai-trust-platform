import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, RotateCw, ListChecks, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import { StatusBadge } from "../components/Badges";
import KpiCard from "../components/KpiCard";
import DetailPanel, { DetailField, DetailSection } from "../components/DetailPanel";
import CreateObligationModal from "../components/CreateObligationModal";
import { OBLIGATION_STATUS_META, CONTROL_STATUS_META, EVIDENCE_STATUS_META, fmtDate } from "../utils";
import { usePermissions } from "../hooks/usePermissions";
import type { AISystem, Assessment, Control, Evidence, Obligation, ObligationDetail } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS = ["applicable", "in_progress", "fulfilled", "not_applicable", "overdue"] as const;
// Radix Select disallows an empty-string item value — sentinel for "All".
const ALL = "__all__";

export default function ObligationsPage() {
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
  const { can } = usePermissions();
  const mayWrite = can("assessments:write");
  const noWriteTitle = "Requires permission: assessments:write";

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
      <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1147E9] to-[#6C1AF4] text-white">
            <ListChecks className="size-5" />
          </span>
          <h1 className="text-lg font-semibold text-foreground">Obligations</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RotateCw /> Refresh</Button>
          <Button size="sm" disabled={!mayWrite} title={mayWrite ? undefined : noWriteTitle}
            onClick={() => setCreateOpen(true)}><Plus /> New Obligation</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 px-5 pt-4">
        <KpiCard label="Total" value={kpis.total} icon={ListChecks} color="#71717a" sub="all obligations" />
        <KpiCard label="Fulfilled" value={kpis.fulfilled} icon={CheckCircle2} color="#16a34a" sub={`${kpis.total ? Math.round(kpis.fulfilled / kpis.total * 100) : 0}% of total`} />
        <KpiCard label="In Progress" value={kpis.inProgress} icon={Clock} color="#1147E9" sub="being addressed" />
        <KpiCard label="Overdue" value={kpis.overdue} icon={AlertTriangle} color="#e05c00" sub="past due date" />
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
        <Input className="max-w-xs" placeholder="Search obligations…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={systemFilter || ALL} onValueChange={(v) => { setSystemFilter(v === ALL ? "" : v); setAssessmentFilter(""); }}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Systems</SelectItem>
            {systems.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={assessmentFilter || ALL} onValueChange={(v) => setAssessmentFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Assessments</SelectItem>
            {filteredAssessments.map((a) => <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter || ALL} onValueChange={(v) => setStatusFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{OBLIGATION_STATUS_META[s].label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="px-5 py-4">
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Obligation</TableHead>
                <TableHead>Article</TableHead>
                <TableHead>AI System</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No obligations found.</TableCell></TableRow>
              ) : filtered.map((o) => (
                <TableRow key={o.id} data-state={selected === o.id ? "selected" : undefined} className="cursor-pointer" onClick={() => openDetail(o)}>
                  <TableCell><div className="font-medium text-foreground">{o.title}</div><div className="text-xs text-muted-foreground">{o.id}</div></TableCell>
                  <TableCell className="text-xs">{o.article_ref || "—"}</TableCell>
                  <TableCell>{systemsById[o.ai_system_id]?.name ?? o.ai_system_id}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{o.owner || "—"}</TableCell>
                  <TableCell><StatusBadge meta={OBLIGATION_STATUS_META} value={o.status} /></TableCell>
                  <TableCell className={cn("text-[13px]", o.status === "overdue" ? "text-[var(--danger-fg)]" : "text-muted-foreground")}>{fmtDate(o.due_date)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <Select value={o.status} disabled={!mayWrite} onValueChange={(v) => changeStatus(o.id, v)}>
                        <SelectTrigger className="h-8 w-[150px]" title={mayWrite ? undefined : noWriteTitle}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{OBLIGATION_STATUS_META[s].label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                        disabled={!mayWrite} title={mayWrite ? "Delete this obligation" : noWriteTitle}
                        onClick={async () => {
                          if (!confirm(`Delete "${o.title}"?`)) return;
                          try { await api.deleteObligation(o.id); showToast("Deleted"); load(); closePanel(); }
                          catch (e) { showToast((e as Error).message, true); }
                        }}>Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <DetailPanel
        open={!!detail}
        title={detail?.title ?? ""}
        subtitle={detail ? (detail.article_ref ? `${detail.framework_id} — ${detail.article_ref}` : detail.framework_id) : undefined}
        badge={detail ? OBLIGATION_STATUS_META[detail.status]?.label : undefined}
        onClose={closePanel}
      >
        {detail && (
          <>
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
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{detail.description}</p>
              </DetailSection>
            )}
            <DetailSection title={`Related Controls (${detailControls.length})`}>
              {detailControls.length === 0
                ? <p className="text-[13px] text-muted-foreground">No controls linked.</p>
                : <ul className="flex flex-col gap-1.5">{detailControls.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2"><span className="truncate text-[13px] text-foreground">{c.title}</span><StatusBadge meta={CONTROL_STATUS_META} value={c.status} /></li>
                  ))}</ul>
              }
            </DetailSection>
            <DetailSection title={`Evidence (${detailEvidence.length})`}>
              {detailEvidence.length === 0
                ? <p className="text-[13px] text-muted-foreground">No evidence linked.</p>
                : <ul className="flex flex-col gap-1.5">{detailEvidence.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2"><span className="truncate text-[13px] text-foreground">{e.title}</span><StatusBadge meta={EVIDENCE_STATUS_META} value={e.status} /></li>
                  ))}</ul>
              }
            </DetailSection>
            <div className="px-5 pt-4">
              <Select value={detail.status} disabled={!mayWrite}
                onValueChange={async (v: string) => {
                  await changeStatus(detail.id, v);
                  setDetail((d) => d ? { ...d, status: v } : d);
                }}>
                <SelectTrigger className="w-full" title={mayWrite ? undefined : noWriteTitle}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{OBLIGATION_STATUS_META[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </DetailPanel>

      <CreateObligationModal open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={load} />
    </>
  );
}
