import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, RotateCw, ShieldCheck, CheckCircle2, Layers, Clock } from "lucide-react";
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

const STATUS_OPTIONS = [
  "not_started", "planned", "in_implementation", "implemented",
  "under_review", "effective", "ineffective", "deactivated",
] as const;
// Radix Select disallows an empty-string item value — sentinel for "All". Note
// "__org__" is a real filter value (org-wide controls), distinct from this.
const ALL = "__all__";

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
      <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1147E9] to-[#6C1AF4] text-white">
            <ShieldCheck className="size-5" />
          </span>
          <h1 className="text-lg font-semibold text-foreground">Controls</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RotateCw /> Refresh</Button>
          <Button size="sm" disabled={!mayWrite} title={mayWrite ? undefined : noWriteTitle}
            onClick={() => setCreateOpen(true)}><Plus /> New Control</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 px-5 pt-4">
        <KpiCard label="Total" value={kpis.total} icon={ShieldCheck} color="#71717a" sub="all controls" />
        <KpiCard label="Effective" value={kpis.effective} icon={CheckCircle2} color="#16a34a" sub={`${kpis.total ? Math.round(kpis.effective / kpis.total * 100) : 0}% of total`} />
        <KpiCard label="Implemented" value={kpis.implemented} icon={Layers} color="#1147E9" sub="ready for review" />
        <KpiCard label="Not Started" value={kpis.notStarted} icon={Clock} color="#e05c00" sub="pending action" />
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
        <Input className="max-w-xs" placeholder="Search controls…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={statusFilter || ALL} onValueChange={(v) => setStatusFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{CONTROL_STATUS_META[s].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={categoryFilter || ALL} onValueChange={(v) => setCategoryFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{humanize(c)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={effectivenessFilter || ALL} onValueChange={(v) => setEffectivenessFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Effectiveness</SelectItem>
            {["high", "medium", "low"].map((e) => <SelectItem key={e} value={e}>{humanize(e)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={systemFilter || ALL} onValueChange={(v) => setSystemFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All AI Systems</SelectItem>
            {hasOrgWide && <SelectItem value="__org__">Org-wide</SelectItem>}
            {systemOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters ({activeFilterCount})</Button>
        )}
        <div className="flex-1" />
        <span className="text-[13px] text-muted-foreground">{filtered.length} of {controls.length}</span>
      </div>

      <div className="px-5 py-4">
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Control</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>AI System</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Effectiveness</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No controls yet.</TableCell></TableRow>
              ) : paged.map((c) => (
                <TableRow key={c.id} data-state={selected === c.id ? "selected" : undefined} className="cursor-pointer" onClick={() => openDetail(c)}>
                  <TableCell><div className="font-medium text-foreground">{c.title}</div><div className="text-xs text-muted-foreground">{c.id}</div></TableCell>
                  <TableCell className="text-[13px]">{humanize(c.category)}</TableCell>
                  <TableCell>{c.ai_system_id ? (systemsById[c.ai_system_id]?.name ?? c.ai_system_id) : <Badge variant="secondary" className="rounded-full font-medium">Org-wide</Badge>}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{c.owner || "—"}</TableCell>
                  <TableCell><StatusBadge meta={CONTROL_STATUS_META} value={c.status} /></TableCell>
                  <TableCell><Badge variant="secondary" className="rounded-full font-medium">{humanize(c.effectiveness)}</Badge></TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{fmtDate(c.due_date)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" disabled={!mayWrite} title={mayWrite ? "Link or unlink obligations" : noWriteTitle}
                        onClick={() => setLinkControl(c)}>Link Obligations</Button>
                      <Select value={c.status} disabled={!mayWrite} onValueChange={(v) => changeStatus(c.id, v)}>
                        <SelectTrigger className="h-8 w-[150px]" title={mayWrite ? undefined : noWriteTitle}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{CONTROL_STATUS_META[s].label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                        disabled={!mayWrite} title={mayWrite ? "Delete this control" : noWriteTitle}
                        onClick={async () => {
                          if (!confirm(`Delete "${c.title}"?`)) return;
                          try { await api.deleteControl(c.id); showToast("Deleted"); load(); closePanel(); }
                          catch (e) { showToast((e as Error).message, true); }
                        }}>Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Pagination
          page={safePage}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        />
      </div>

      <DetailPanel
        open={!!detail}
        title={detail?.title ?? ""}
        subtitle={detail ? humanize(detail.category) : undefined}
        badge={detail ? CONTROL_STATUS_META[detail.status]?.label : undefined}
        onClose={closePanel}
      >
        {detail && (
          <>
            <DetailSection title="General Information">
              <DetailField label="ID">{detail.id}</DetailField>
              <DetailField label="Category">{humanize(detail.category)}</DetailField>
              <DetailField label="AI System">{detail.ai_system_id ? (systemsById[detail.ai_system_id]?.name ?? detail.ai_system_id) : <Badge variant="secondary" className="rounded-full font-medium">Org-wide</Badge>}</DetailField>
              <DetailField label="Owner">{detail.owner || "—"}</DetailField>
              <DetailField label="Status"><StatusBadge meta={CONTROL_STATUS_META} value={detail.status} /></DetailField>
              <DetailField label="Effectiveness"><Badge variant="secondary" className="rounded-full font-medium">{humanize(detail.effectiveness)}</Badge></DetailField>
              <DetailField label="Due Date">{fmtDate(detail.due_date)}</DetailField>
            </DetailSection>
            {detail.description && (
              <DetailSection title="Description">
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{detail.description}</p>
              </DetailSection>
            )}
            <DetailSection title={`Related Obligations (${detailObligations.length})`}>
              {detailObligations.length === 0
                ? <p className="text-[13px] text-muted-foreground">No obligations linked. Use "Link Obligations".</p>
                : <ul className="flex flex-col gap-1.5">{detailObligations.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2"><span className="truncate text-[13px] text-foreground">{o.title}</span><StatusBadge meta={OBLIGATION_STATUS_META} value={o.status} /></li>
                  ))}</ul>
              }
            </DetailSection>
            <DetailSection title={`Evidence (${detailEvidence.length})`}>
              {detailEvidence.length === 0
                ? <p className="text-[13px] text-muted-foreground">No evidence yet.</p>
                : <ul className="flex flex-col gap-1.5">{detailEvidence.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2"><span className="truncate text-[13px] text-foreground">{e.title}</span><StatusBadge meta={EVIDENCE_STATUS_META} value={e.status} /></li>
                  ))}</ul>
              }
            </DetailSection>
            <div className="flex items-center gap-2 px-5 pt-4">
              <Button variant="outline" size="sm" disabled={!mayWrite} title={mayWrite ? undefined : noWriteTitle}
                onClick={() => setLinkControl(detail)}>Link Obligations</Button>
              <Select value={detail.status} disabled={!mayWrite}
                onValueChange={async (v: string) => {
                  await changeStatus(detail.id, v);
                  setDetail((d) => d ? { ...d, status: v } : d);
                }}>
                <SelectTrigger className="flex-1" title={mayWrite ? undefined : noWriteTitle}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{CONTROL_STATUS_META[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </DetailPanel>

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
