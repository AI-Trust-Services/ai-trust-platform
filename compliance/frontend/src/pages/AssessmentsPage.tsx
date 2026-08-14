import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, RotateCw } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// Radix Select disallows an empty-string item value — sentinel for "All".
const ALL = "__all__";

export default function AssessmentsPage() {
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
  const noWriteTitle = "Requires permission: assessments:write";
  const noApproveTitle = "Requires permission: assessments:approve";

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
      <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
        <h1 className="text-lg font-semibold text-foreground">Assessments</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RotateCw /> Refresh</Button>
          <Button
            size="sm"
            disabled={!mayWrite}
            title={mayWrite ? undefined : noWriteTitle}
            onClick={() => setCreateOpen(true)}
          ><Plus /> New Assessment</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 px-5 pt-4">
        <KpiCard label="Total" value={kpis.total} />
        <KpiCard label="Approved" value={kpis.approved} sub={`${kpis.total ? Math.round(kpis.approved / kpis.total * 100) : 0}% of total`} />
        <KpiCard label="In Review" value={kpis.submitted} />
        <KpiCard label="Draft" value={kpis.draft} />
      </div>

      <div className="px-5 pt-4">
        <AssessmentCharts assessments={assessments} />
      </div>

      <div className="flex items-center gap-2 px-5 pt-3">
        <Input className="max-w-xs" placeholder="Search assessments…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={statusFilter || ALL} onValueChange={(v) => setStatusFilter(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Statuses</SelectItem>
            {Object.entries(ASSESSMENT_STATUS_META).map(([v, m]) => <SelectItem key={v} value={v}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="px-5 py-4">
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assessment</TableHead>
                <TableHead>AI System</TableHead>
                <TableHead>Framework</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No assessments yet. Click "New Assessment" to begin.</TableCell></TableRow>
              ) : filtered.map((a) => (
                <TableRow key={a.id} data-state={selected === a.id ? "selected" : undefined} className="cursor-pointer" onClick={() => openDetail(a)}>
                  <TableCell><div className="font-medium text-foreground">{a.title}</div><div className="text-xs text-muted-foreground">{a.id}</div></TableCell>
                  <TableCell>{systemsById[a.ai_system_id]?.name ?? a.ai_system_id}</TableCell>
                  <TableCell>{frameworksById[a.framework_id]?.name ?? a.framework_id}</TableCell>
                  <TableCell>{humanize(a.type)}</TableCell>
                  <TableCell><StatusBadge meta={ASSESSMENT_STATUS_META} value={a.status} /></TableCell>
                  <TableCell><ScoreBar score={a.score} /></TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{fmtDate(a.created_at)}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
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
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{selectedDetail.notes}</p>
            </DetailSection>
          )}
          <div className="flex gap-2 px-5 pt-4">
            {selectedDetail.status === "draft" && (
              <Button variant="outline" size="sm" disabled={busy === selectedDetail.id || !mayWrite}
                title={mayWrite ? undefined : noWriteTitle}
                onClick={() => act(api.submitAssessment, selectedDetail.id, "Submitted")}>Submit</Button>
            )}
            {selectedDetail.status !== "approved" && (
              <Button variant="outline" size="sm" disabled={busy === selectedDetail.id || !mayApprove}
                title={mayApprove ? undefined : noApproveTitle}
                onClick={() => act(api.approveAssessment, selectedDetail.id, (r) => `Approved — score ${r.score ?? "N/A"}%`)}>Approve</Button>
            )}
          </div>
        </DetailPanel>
      )}

      <CreateAssessmentModal open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={load} />
    </>
  );
}
