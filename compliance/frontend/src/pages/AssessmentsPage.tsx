import { useState, useEffect, useCallback, useMemo } from "react";
import LuigiClient from "@luigi-project/client";
import { Plus, RotateCw, ClipboardList, CheckCircle2, FileText, Clock } from "lucide-react";
import { api } from "../api/client";
import { registryClient } from "../api/registryClient";
import { useToast } from "../App";
import { StatusBadge, ScoreBar } from "../components/Badges";
import KpiCard from "../components/KpiCard";
import DetailPanel, { DetailField, DetailSection } from "../components/DetailPanel";
import CreateAssessmentModal from "../components/CreateAssessmentModal";
import AssessmentCharts from "../components/AssessmentCharts";
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

const ALL = "__all__";

// Statuses whose row opens the registry single-page assessment app instead of the
// legacy compliance DetailPanel — every status the single-page flow owns:
//   questionnaire_pending — the owner questionnaire
//   pending_review        — the CO review / CoIssueView
//   returned              — CO-bounced; owner regains edit and resubmits (editable)
//   approved              — finished, viewed read-only
// Other statuses (draft, submitted, under_review, inactive) stay on the DetailPanel.
const OPENS_IN_REGISTRY_APP = new Set([
  "questionnaire_pending",
  "pending_review",
  "returned",
  "approved",
]);

// One-shot hand-off from the registry MFE. The richer key carries the chosen system
// (and optionally framework) so the modal can skip straight to the right step. Read+cleared
// on arrival so closing the modal or navigating back never reopens it. The legacy boolean
// flag is still honored as an empty payload (open at system-select) for safety.
const PENDING_ASSESSMENT_KEY = "compliance.pendingAssessment";
const OPEN_CREATE_FLAG = "compliance.openCreateAssessment";
type PendingAssessment = { systemId?: string; frameworkId?: string };
function consumePendingAssessment(): PendingAssessment | null {
  const raw = localStorage.getItem(PENDING_ASSESSMENT_KEY);
  if (raw) {
    localStorage.removeItem(PENDING_ASSESSMENT_KEY);
    try {
      return JSON.parse(raw) as PendingAssessment;
    } catch {
      return {};
    }
  }
  if (localStorage.getItem(OPEN_CREATE_FLAG) === "1") {
    localStorage.removeItem(OPEN_CREATE_FLAG);
    return {};
  }
  return null;
}

// Registry MFE sets these to deep-link into Continue/View flows.
const VIEW_SYSTEM_KEY = "compliance.viewSystem";
const OPEN_ASSESSMENT_KEY = "compliance.openAssessment";
type ViewSystem = { systemId?: string; systemName?: string };
type OpenAssessment = { assessmentId?: string };
function consumeViewSystem(): ViewSystem | null {
  const raw = localStorage.getItem(VIEW_SYSTEM_KEY);
  if (!raw) return null;
  localStorage.removeItem(VIEW_SYSTEM_KEY);
  try { return JSON.parse(raw) as ViewSystem; } catch { return null; }
}
function consumeOpenAssessment(): OpenAssessment | null {
  const raw = localStorage.getItem(OPEN_ASSESSMENT_KEY);
  if (!raw) return null;
  localStorage.removeItem(OPEN_ASSESSMENT_KEY);
  try { return JSON.parse(raw) as OpenAssessment; } catch { return null; }
}


// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AssessmentsPage() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [systemsById, setSystemsById] = useState<Record<string, AISystem>>({});
  const [frameworksById, setFrameworksById] = useState<Record<string, Framework>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AssessmentDetail | null>(null);
  const [pendingAssessment, setPendingAssessment] = useState<PendingAssessment | null>(consumePendingAssessment);
  const [createOpen, setCreateOpen] = useState(() => pendingAssessment !== null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState(() => consumeViewSystem()?.systemName ?? "");
  const [pendingOpenAssessmentId, setPendingOpenAssessmentId] = useState<string | null>(() => consumeOpenAssessment()?.assessmentId ?? null);
  const [statusFilter, setStatusFilter] = useState("");

  // The registry MFE hands off via a localStorage flag + Luigi navigation. A fresh iframe load
  // is caught by the useState initializer above; when Luigi reveals a cached iframe instead,
  // no reload happens, so we also consume the flag on Luigi context updates.
  useEffect(() => {
    const id = LuigiClient.addContextUpdateListener(() => {
      const payload = consumePendingAssessment();
      if (payload) { setPendingAssessment(payload); setCreateOpen(true); }
      const vs = consumeViewSystem();
      if (vs?.systemName) setSearch(vs.systemName);
      const oa = consumeOpenAssessment();
      if (oa?.assessmentId) setPendingOpenAssessmentId(oa.assessmentId);
    });
    return () => { LuigiClient.removeContextUpdateListener(id); };
  }, []);

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

  // When the registry navigates here with a specific assessment to view, auto-open
  // its detail panel once assessments have loaded.
  useEffect(() => {
    if (!pendingOpenAssessmentId || assessments.length === 0) return;
    const a = assessments.find((r) => r.id === pendingOpenAssessmentId);
    if (a) { openDetail(a); setPendingOpenAssessmentId(null); }
  // openDetail is stable (no deps change it); assessments is the trigger
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessments, pendingOpenAssessmentId]);

  async function openDetail(a: Assessment) {
    // The owner questionnaire, CO review, and finished (approved) views all live
    // in the registry single-page assessment app (read-only when locked/approved),
    // not the legacy RcePanel/DetailPanel. Redirect those statuses there.
    if (OPENS_IN_REGISTRY_APP.has(a.status)) {
      openInRegistryApp(a);
      return;
    }
    setSelected(a.id);
    try {
      const detail = await api.getAssessment(a.id);
      setSelectedDetail(detail);
    } catch (e) {
      showToast(`Failed to load detail: ${(e as Error).message}`, true);
      return;
    }
  }

  function closePanel() {
    setSelected(null);
    setSelectedDetail(null);
  }

  // The owner questionnaire now lives in the registry's single-page assessment
  // app. Redirect there instead of opening the legacy QuestionnaireSection modal.
  function openInRegistryApp(a: Assessment) {
    localStorage.setItem(
      "registry.openAssessment",
      JSON.stringify({ systemId: a.ai_system_id }),
    );
    LuigiClient.linkManager().navigate("/home/ai-system-registry");
  }

  async function act(fn: (id: string) => Promise<Assessment>, id: string, successMsg: string | ((r: Assessment) => string)) {
    setBusy(id);
    try {
      const res = await fn(id);
      showToast(typeof successMsg === "function" ? successMsg(res) : successMsg);
      await load();
      if (selected === id) {
        const detail = await api.getAssessment(id);
        setSelectedDetail(detail);
      }
    } catch (e) {
      showToast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  // CO review actions
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
    submitted: assessments.filter((a) => a.status === "submitted" || a.status === "under_review" || a.status === "pending_review").length,
    draft: assessments.filter((a) => a.status === "draft" || a.status === "questionnaire_pending").length,
  }), [assessments]);

  // Sections available for a request-info bounce-back, paired with the owner it routes to.
  const panelTitle = selectedDetail?.title ?? "";
  const panelSubtitle = selectedDetail ? frameworksById[selectedDetail.framework_id]?.name : undefined;
  const panelBadge = selectedDetail ? ASSESSMENT_STATUS_META[selectedDetail.status]?.label : undefined;

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1147E9] to-[#6C1AF4] text-white">
            <ClipboardList className="size-5" />
          </span>
          <h1 className="text-lg font-semibold text-foreground">Assessments</h1>
        </div>
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
        <KpiCard label="Total" value={kpis.total} icon={ClipboardList} color="#71717a" sub="all assessments" />
        <KpiCard label="Approved" value={kpis.approved} icon={CheckCircle2} color="#16a34a" sub={`${kpis.total ? Math.round(kpis.approved / kpis.total * 100) : 0}% of total`} />
        <KpiCard label="In Review" value={kpis.submitted} icon={Clock} color="#1147E9" sub="awaiting approval" />
        <KpiCard label="Draft" value={kpis.draft} icon={FileText} color="#71717a" sub="work in progress" />
      </div>

      <div className="px-5 pt-4">
        <AssessmentCharts assessments={assessments} />
      </div>

      <div className="flex items-center gap-2 px-5 pt-3">
        <Input className="max-w-xs" placeholder="Search assessments…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={statusFilter || ALL} onValueChange={(v: string) => setStatusFilter(v === ALL ? "" : v)}>
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
                <TableRow key={a.id} data-state={selected === a.id ? "selected" : undefined} className="cursor-pointer" onClick={() => OPENS_IN_REGISTRY_APP.has(a.status) ? openInRegistryApp(a) : openDetail(a)}>
                  <TableCell>
                    <div className="font-medium text-foreground">{a.title}</div>
                    <div className="text-xs text-muted-foreground">{a.id}</div>
                    {a.status === "questionnaire_pending" && (
                      <div className="mt-0.5 text-[11px] text-[var(--brand)]">
                        Questionnaire pending — {systemsById[a.ai_system_id]?.workflow_status?.replace(/_/g, " ") ?? ""}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{systemsById[a.ai_system_id]?.name ?? a.ai_system_id}</TableCell>
                  <TableCell>{frameworksById[a.framework_id]?.name ?? a.framework_id}</TableCell>
                  <TableCell>{humanize(a.type)}</TableCell>
                  <TableCell><StatusBadge meta={ASSESSMENT_STATUS_META} value={a.status} /></TableCell>
                  <TableCell><ScoreBar score={a.score} /></TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{fmtDate(a.created_at)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {a.status === "draft" && (
                        <Button variant="ghost" size="sm" disabled={busy === a.id || !mayWrite}
                          title={mayWrite ? undefined : noWriteTitle}
                          onClick={() => act(api.submitAssessment, a.id, "Submitted")}>Submit</Button>
                      )}
                      {a.status !== "approved" && a.status !== "questionnaire_pending" && a.status !== "pending_review" && (
                        <Button variant="ghost" size="sm" disabled={busy === a.id || !mayApprove}
                          title={mayApprove ? undefined : noApproveTitle}
                          onClick={() => act(api.approveAssessment, a.id, (r) => `Approved — score ${r.score ?? "N/A"}%`)}>Approve</Button>
                      )}
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                        disabled={busy === a.id || !mayWrite} title={mayWrite ? undefined : noWriteTitle}
                        onClick={async () => {
                          if (!confirm(`Delete "${a.title}"?`)) return;
                          setBusy(a.id);
                          try {
                            await api.deleteAssessment(a.id);
                            if (a.status === "questionnaire_pending") {
                              try { await registryClient.resetWorkflow(a.ai_system_id); } catch { /* non-fatal */ }
                            }
                            showToast("Deleted"); closePanel(); await load();
                          }
                          catch (e) { showToast((e as Error).message, true); }
                          finally { setBusy(null); }
                        }}>Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Detail panel — all assessment states use the same Sheet */}
      <DetailPanel
        open={!!selectedDetail}
        title={panelTitle}
        subtitle={panelSubtitle}
        badge={panelBadge}
        onClose={closePanel}
      >
        {selectedDetail && (
          <>

            {/* ── Normal assessment info ── */}
            {selectedDetail.status !== "pending_review" && (
              <>
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
              </>
            )}
          </>
        )}
      </DetailPanel>

      <CreateAssessmentModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setPendingAssessment(null); }}
        onSuccess={load}
        initialSystemId={pendingAssessment?.systemId}
        initialFrameworkId={pendingAssessment?.frameworkId}
      />
    </>
  );
}
