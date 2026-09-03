import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, RotateCw, ClipboardList, CheckCircle2, FileText, Clock, Loader2, Sparkles, AlignJustify } from "lucide-react";
import { api } from "../api/client";
import { registryClient } from "../api/registryClient";
import { useToast } from "../App";
import { StatusBadge, ScoreBar } from "../components/Badges";
import KpiCard from "../components/KpiCard";
import DetailPanel, { DetailField, DetailSection } from "../components/DetailPanel";
import CreateAssessmentModal from "../components/CreateAssessmentModal";
import AssessmentCharts from "../components/AssessmentCharts";
import ScoreDonut from "../components/ScoreDonut";
import QuestionnaireSection from "../components/QuestionnaireSection";
import { ASSESSMENT_STATUS_META, fmtDate, humanize } from "../utils";
import { usePermissions } from "../hooks/usePermissions";
import { TECHNICAL_QUESTIONS } from "../config/questionnaire";
import type { Assessment, AssessmentDetail, AISystem, Framework, ClassificationRationale } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ALL = "__all__";

const VALID_TIERS = ["prohibited", "gpai-systemic", "gpai-standard", "high", "limited", "minimal"] as const;

// ── Questionnaire progress indicator ──────────────────────────────────────────

function QuestionnaireProgress({ workflowStatus, classificationVisible }: { workflowStatus: string; classificationVisible: boolean }) {
  const phases = ["Business", "Technical", "Classification", "Review"];
  const currentIndex = classificationVisible || workflowStatus === "pending_review" ? 2
    : workflowStatus === "technical_pending" ? 1
    : 0;

  return (
    <div className="flex items-center gap-0">
      {phases.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium",
            i === currentIndex ? "text-[var(--brand)]" : i < currentIndex ? "text-[var(--success)]" : "text-muted-foreground",
          )}>
            <span className={cn("flex size-5 items-center justify-center rounded-full text-[10px] font-bold",
              i === currentIndex ? "bg-[var(--brand)] text-white" : i < currentIndex ? "bg-[var(--success)] text-white" : "bg-muted text-muted-foreground",
            )}>{i + 1}</span>
            {label}
          </div>
          {i < phases.length - 1 && <span className="text-muted-foreground/40">›</span>}
        </div>
      ))}
    </div>
  );
}

// ── Risk Classification Step (inline, no Dialog) ───────────────────────────────

interface RiskClassificationStepProps {
  system: AISystem;
  assessmentId: string;
  onClose: () => void;
  onSuccess: () => void;
  showToast: (msg: string, err?: boolean) => void;
}

function RiskClassificationStep({ system, assessmentId, onClose, onSuccess, showToast }: RiskClassificationStepProps) {
  const [mode, setMode] = useState<"" | "ai" | "manual" | "external">("");
  const [manualFlags, setManualFlags] = useState<Record<string, unknown>>({});
  const [externalTier, setExternalTier] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const flags: Record<string, unknown> = {};
    for (const q of TECHNICAL_QUESTIONS) {
      flags[q.key] = (system as unknown as Record<string, unknown>)[q.key] ?? (q.type === "number" ? 0 : false);
    }
    setManualFlags(flags);
    setMode("");
    setExternalTier("");
  }, [system.id]);

  async function handleAI() {
    setBusy(true);
    try {
      await registryClient.updateSystem(system.id, { registration_mode: "ai" });
      await registryClient.submitTechnicalSection(system.id);
      await api.advanceFromClassification(assessmentId);
      showToast("Risk classification complete — obligations and controls generated");
      onSuccess();
    } catch (e) {
      showToast(`Classification failed: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function handleManual() {
    setBusy(true);
    try {
      const flagData: Record<string, unknown> = { registration_mode: "manual_questionnaire" };
      for (const q of TECHNICAL_QUESTIONS) {
        const val = manualFlags[q.key];
        if (val != null) flagData[q.key] = q.type === "number" ? Number(val) : Boolean(val);
      }
      await registryClient.updateSystem(system.id, flagData);
      await registryClient.submitTechnicalSection(system.id);
      await api.advanceFromClassification(assessmentId);
      showToast("Risk classification complete — obligations and controls generated");
      onSuccess();
    } catch (e) {
      showToast(`Classification failed: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function handleExternal() {
    if (!externalTier) { showToast("Select a risk tier", true); return; }
    setBusy(true);
    try {
      await registryClient.updateSystem(system.id, { tier: externalTier });
      await api.advanceFromClassification(assessmentId);
      showToast("System tier set — obligations and controls generated");
      onSuccess();
    } catch (e) {
      showToast(`Update failed: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-0">
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {mode === "" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Choose how to determine the risk tier for this system under the EU AI Act.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMode("ai")}
                className="flex flex-col items-start gap-2 rounded-lg border-2 border-[var(--brand)]/30 bg-[var(--brand)]/5 p-4 text-left transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand)]/10"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-[var(--brand)]/15 text-[var(--brand)]">
                  <Sparkles className="size-5" />
                </div>
                <div className="font-semibold text-sm">AI-Assisted</div>
                <div className="text-xs text-muted-foreground">
                  The AI reads the technical answers and infers the risk tier automatically. The compliance officer can review and override.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode("manual")}
                className="flex flex-col items-start gap-2 rounded-lg border-2 border-border p-4 text-left transition-colors hover:border-foreground"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <AlignJustify className="size-5" />
                </div>
                <div className="font-semibold text-sm">Manual Flags</div>
                <div className="text-xs text-muted-foreground">
                  Toggle the EU AI Act classification flags directly. The tier is derived deterministically from your selections.
                </div>
              </button>
            </div>
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setMode("external")}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                I have already done risk classification externally
              </button>
            </div>
          </div>
        )}

        {mode === "ai" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-[var(--brand)]/30 bg-[var(--brand)]/5 p-4">
              <div className="flex items-center gap-2 font-medium text-sm"><Sparkles className="size-4 text-[var(--brand)]" /> AI-Assisted Classification</div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                The AI will analyse the technical answers and infer the EU AI Act risk flags. The deterministic classifier then assigns the tier. The compliance officer sees the AI's reasoning before approving.
              </p>
            </div>
            <p className="text-sm text-muted-foreground">Click "Run AI Classification" to proceed. The process takes a few seconds.</p>
          </div>
        )}

        {mode === "manual" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Toggle all applicable flags. The tier is derived automatically from your selections.</p>
            {TECHNICAL_QUESTIONS.map((q) => {
              const val = manualFlags[q.key];
              if (q.type === "number") {
                return (
                  <div key={q.key} className="flex flex-col gap-1">
                    <Label className="text-xs font-medium">{q.label}</Label>
                    <Input type="number" value={val != null ? String(val) : "0"} onChange={(e) => setManualFlags((f) => ({ ...f, [q.key]: parseFloat(e.target.value) || 0 }))} className="text-sm" />
                    <span className="text-xs text-muted-foreground">{q.hint}</span>
                  </div>
                );
              }
              return (
                <label key={q.key} className="flex items-start gap-2.5 rounded-md border border-border p-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(val)}
                    onChange={(e) => setManualFlags((f) => ({ ...f, [q.key]: e.target.checked }))}
                    className="mt-0.5 shrink-0"
                  />
                  <div>
                    <div className="font-medium text-[13px]">{q.label}</div>
                    <div className="text-xs text-muted-foreground">{q.hint}</div>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        {mode === "external" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">Select the risk tier that was determined externally. Obligations and controls will be generated for this tier.</p>
            <div className="flex flex-col gap-1.5">
              <Label>Risk Tier <span className="text-destructive">*</span></Label>
              <Select value={externalTier} onValueChange={setExternalTier}>
                <SelectTrigger><SelectValue placeholder="Select tier…" /></SelectTrigger>
                <SelectContent>
                  {VALID_TIERS.map((t) => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        <Button variant="ghost" onClick={mode ? () => setMode("") : onClose}>{mode ? "← Back" : "Cancel"}</Button>
        {mode === "ai" && (
          <Button onClick={handleAI} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Run AI Classification
          </Button>
        )}
        {mode === "manual" && (
          <Button onClick={handleManual} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Apply Classification
          </Button>
        )}
        {mode === "external" && (
          <Button onClick={handleExternal} disabled={busy || !externalTier}>
            {busy && <Loader2 className="animate-spin" />} Set Tier & Continue
          </Button>
        )}
      </div>
    </div>
  );
}

// ── AI Classification Rationale Panel ─────────────────────────────────────────

function ClassificationRationalePanel({ rationale }: { rationale: ClassificationRationale }) {
  const pct = (c: number | null) => (c == null ? "—" : `${Math.round(c * 100)}%`);
  return (
    <div className="rounded-md border border-[var(--brand)]/30 bg-[var(--brand)]/5 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--brand)]">
        <Sparkles className="size-4" /> AI Classification Rationale
      </div>
      <div className="mb-3 text-xs text-muted-foreground">
        Inferred from the questionnaire answers. You decide the final tier.
      </div>
      {rationale.reasoning && (
        <div className="mb-3 text-[13px] leading-relaxed text-foreground">{rationale.reasoning}</div>
      )}
      <div className="mb-2 grid grid-cols-[140px_1fr] gap-x-4 text-[13px]">
        <span className="font-medium text-muted-foreground">Confidence</span>
        <span>{pct(rationale.confidence)}</span>
      </div>
      {rationale.org_role && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inferred Role</div>
          <div className="flex flex-wrap items-start gap-2 text-[13px]">
            <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-xs capitalize">{rationale.org_role}</span>
            {rationale.org_role_rationale && <span className="text-muted-foreground">{rationale.org_role_rationale}</span>}
          </div>
        </div>
      )}
      {rationale.missing_info.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Missing Information</div>
          <ul className="list-disc pl-5 text-[13px] text-foreground">
            {rationale.missing_info.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}
      {rationale.flags.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inferred Flags</div>
          <div className="flex flex-col gap-2">
            {rationale.flags.map((f, i) => (
              <div key={i} className="rounded-md border border-border bg-card p-2.5 text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{f.flag}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={cn("rounded px-1.5 py-0.5 font-medium", f.value ? "bg-[var(--brand)]/15 text-[var(--brand)]" : "bg-muted text-muted-foreground")}>
                      {typeof f.value === "boolean" ? (f.value ? "Yes" : "No") : String(f.value)}
                    </span>
                    <span>conf. {pct(f.confidence)}</span>
                  </span>
                </div>
                {f.rationale && <div className="mt-1 text-muted-foreground">{f.rationale}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AssessmentsPage() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [systemsById, setSystemsById] = useState<Record<string, AISystem>>({});
  const [frameworksById, setFrameworksById] = useState<Record<string, Framework>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AssessmentDetail | null>(null);
  const [selectedSystem, setSelectedSystem] = useState<AISystem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Questionnaire phase state (used when status === "questionnaire_pending")
  const [qSection, setQSection] = useState<"business" | "technical">("business");
  const [qClassification, setQClassification] = useState(false);

  // CO review state (used when status === "pending_review")
  type RcePanel = "" | "approve" | "reject" | "requestInfo";
  const [rcePanel, setRcePanel] = useState<RcePanel>("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rceSummary, setRceSummary] = useState<{ tier: string | null; org_role: string | null; registration_mode: string | null; classification_rationale: any } | null>(null);
  const [rceNote, setRceNote] = useState("");
  const [approveTier, setApproveTier] = useState("");
  const [approveOrgRole, setApproveOrgRole] = useState("provider");
  const [rejectSendTo, setRejectSendTo] = useState<"business" | "technical">("business");
  const [infoContributor, setInfoContributor] = useState("");
  const [rceActing, setRceActing] = useState(false);

  // Center-dialog state for questionnaire / classification
  const [qDialogOpen, setQDialogOpen] = useState(false);
  const [qAssessmentId, setQAssessmentId] = useState("");

  const showToast = useToast();
  const { can, username } = usePermissions();
  const mayWrite = can("assessments:write");
  const mayApprove = can("systems:approve");
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
    setRcePanel("");
    setRceSummary(null);
    setQClassification(false);
    try {
      const detail = await api.getAssessment(a.id);
      setSelectedDetail(detail);
    } catch (e) {
      showToast(`Failed to load detail: ${(e as Error).message}`, true);
      return;
    }
    const sysData = systemsById[a.ai_system_id];
    if (sysData) {
      try {
        const freshSys = await registryClient.getSystem(sysData.id);
        setSelectedSystem(freshSys);
        if (a.status === "questionnaire_pending") {
          setQClassification(freshSys.workflow_status === "pending_review");
          setQSection(freshSys.workflow_status === "technical_pending" ? "technical" : "business");
        } else if (a.status === "pending_review") {
          setApproveTier(freshSys.tier !== "pending" ? freshSys.tier : "");
          setApproveOrgRole(freshSys.org_role || "provider");
          registryClient.getRceSummary(freshSys.id).then(setRceSummary).catch(() => setRceSummary(null));
        }
      } catch {
        // system load failure is non-fatal
      }
    }
  }

  function closePanel() {
    setSelected(null);
    setSelectedDetail(null);
    setSelectedSystem(null);
    setQClassification(false);
    setRcePanel("");
    setRceSummary(null);
  }

  async function openQuestionnaire(a: Assessment) {
    setQClassification(false);
    setQDialogOpen(false);
    const sysData = systemsById[a.ai_system_id];
    if (!sysData) { showToast("System not found", true); return; }
    try {
      const freshSys = await registryClient.getSystem(sysData.id);
      setSelectedSystem(freshSys);
      setQAssessmentId(a.id);

      const isTechnicalPending = freshSys.workflow_status === "technical_pending";
      const techAssignee = freshSys.technical_assignee_username;

      // If technical section is pending and belongs to someone else, don't open
      if (isTechnicalPending && techAssignee && techAssignee !== username) {
        showToast(`Technical section is assigned to ${techAssignee} — waiting for them to complete it.`);
        return;
      }

      setQClassification(freshSys.workflow_status === "pending_review");
      setQSection(isTechnicalPending ? "technical" : "business");
      setQDialogOpen(true);
    } catch (e) {
      showToast(`Failed to load: ${(e as Error).message}`, true);
    }
  }

  function closeQuestionnaire() {
    setQDialogOpen(false);
    setQAssessmentId("");
    setSelectedSystem(null);
    setQClassification(false);
  }

  async function onQuestionnaireSectionSuccess() {
    if (!selectedSystem) return;
    try {
      const freshSys = await registryClient.getSystem(selectedSystem.id);
      setSelectedSystem(freshSys);
      if (qSection === "technical") {
        setQClassification(true);
      } else if (freshSys.workflow_status === "technical_pending") {
        // If someone else owns the technical section, close — they'll handle it
        const techAssignee = freshSys.technical_assignee_username;
        if (techAssignee && techAssignee !== username) {
          showToast(`Business section submitted. ${techAssignee} has been notified to complete the technical section.`);
          closeQuestionnaire();
          await load();
        } else {
          setQSection("technical");
        }
      } else if (freshSys.workflow_status === "pending_review") {
        setQClassification(true);
      }
    } catch {
      if (qSection === "business") setQSection("technical");
      else setQClassification(true);
    }
  }

  async function onClassificationSuccess() {
    closeQuestionnaire();
    await load();
    showToast("Assessment ready for review");
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
  async function handleRceApprove() {
    if (!selectedSystem || !selectedDetail) return;
    setRceActing(true);
    try {
      const tierOverride = approveTier && approveTier !== selectedSystem.tier ? approveTier : undefined;
      const roleOverride = approveOrgRole && approveOrgRole !== selectedSystem.org_role ? approveOrgRole : undefined;
      await registryClient.approveSystem(selectedSystem.id, rceNote.trim() || undefined, tierOverride, roleOverride);
      await api.approveAssessment(selectedDetail.id);
      showToast("Assessment approved");
      closePanel();
      await load();
    } catch (e) {
      showToast(`Approve failed: ${(e as Error).message}`, true);
    } finally {
      setRceActing(false);
    }
  }

  async function handleRceReject() {
    if (!selectedSystem || !rceNote.trim()) { showToast("Rejection note is required", true); return; }
    setRceActing(true);
    try {
      await registryClient.rejectSystem(selectedSystem.id, rceNote, selectedSystem.assignee_username || "", rejectSendTo);
      showToast("System rejected — returned for revision");
      closePanel();
      await load();
    } catch (e) {
      showToast(`Reject failed: ${(e as Error).message}`, true);
    } finally {
      setRceActing(false);
    }
  }

  async function handleRceRequestInfo() {
    if (!selectedSystem || !infoContributor) { showToast("Select who should provide the information", true); return; }
    if (!rceNote.trim()) { showToast("Describe what information is needed", true); return; }
    setRceActing(true);
    try {
      await registryClient.requestInfo(selectedSystem.id, infoContributor, rceNote);
      showToast("Information requested — contributor notified");
      closePanel();
      await load();
    } catch (e) {
      showToast(`Request failed: ${(e as Error).message}`, true);
    } finally {
      setRceActing(false);
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
    submitted: assessments.filter((a) => a.status === "submitted" || a.status === "under_review" || a.status === "pending_review").length,
    draft: assessments.filter((a) => a.status === "draft").length,
  }), [assessments]);

  // Info contributors for request-info dropdown
  const infoContributors = selectedSystem ? [
    selectedSystem.business_assignee_username ? ["business", selectedSystem.business_assignee_username] as const : null,
    selectedSystem.technical_assignee_username ? ["technical", selectedSystem.technical_assignee_username] as const : null,
  ].filter(Boolean) as (readonly ["business" | "technical", string])[] : [];

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
                <TableRow key={a.id} data-state={selected === a.id ? "selected" : undefined} className="cursor-pointer" onClick={() => a.status === "questionnaire_pending" ? openQuestionnaire(a) : openDetail(a)}>
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
            {/* ── Pending review: CO review panel ── */}
            {selectedDetail.status === "pending_review" && (
              <div className="flex flex-col gap-4 px-5 py-4">
                <DetailSection title="Assessment Information">
                  <DetailField label="ID">{selectedDetail.id}</DetailField>
                  <DetailField label="AI System">{systemsById[selectedDetail.ai_system_id]?.name ?? selectedDetail.ai_system_id}</DetailField>
                  <DetailField label="Framework">{frameworksById[selectedDetail.framework_id]?.name}</DetailField>
                  <DetailField label="Status"><StatusBadge meta={ASSESSMENT_STATUS_META} value={selectedDetail.status} /></DetailField>
                </DetailSection>

                {/* AI rationale (object with reasoning/flags) */}
                {rceSummary?.classification_rationale &&
                  typeof rceSummary.classification_rationale === "object" &&
                  !Array.isArray(rceSummary.classification_rationale) &&
                  (rceSummary.classification_rationale as ClassificationRationale).flags !== undefined && (
                  <ClassificationRationalePanel rationale={rceSummary.classification_rationale as ClassificationRationale} />
                )}
                {/* Simple array-of-flags rationale */}
                {rceSummary?.classification_rationale && Array.isArray(rceSummary.classification_rationale) && (
                  <div className="rounded-md border border-border bg-muted/30 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <Sparkles className="size-4" /> Classification Flags
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {(rceSummary.classification_rationale as Array<{ flag: string; value: boolean | number; rationale: string }>).map((f, i) => (
                        <div key={i} className="flex items-start gap-2 text-[13px]">
                          <span className={cn("mt-0.5 rounded px-1.5 py-0.5 text-xs font-medium", f.value ? "bg-[var(--brand)]/15 text-[var(--brand)]" : "bg-muted text-muted-foreground")}>
                            {typeof f.value === "boolean" ? (f.value ? "Yes" : "No") : String(f.value)}
                          </span>
                          <div>
                            <span className="font-medium">{f.flag}</span>
                            {f.rationale && <span className="ml-1 text-muted-foreground">— {f.rationale}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* RCE summary: tier + role */}
                {rceSummary && (
                  <div className="flex flex-wrap gap-3 text-[13px]">
                    <div><span className="font-medium text-muted-foreground">Inferred tier: </span>
                      <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs">{rceSummary.tier ?? "—"}</span>
                    </div>
                    <div><span className="font-medium text-muted-foreground">Role: </span>
                      <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs capitalize">{rceSummary.org_role ?? "—"}</span>
                    </div>
                  </div>
                )}

                {/* CO actions */}
                {mayApprove && rcePanel === "" && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button onClick={() => setRcePanel("approve")} disabled={rceActing}>Approve…</Button>
                    <Button variant="outline" onClick={() => { setRcePanel("requestInfo"); setInfoContributor(""); setRceNote(""); }} disabled={rceActing}>Request Info…</Button>
                    <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { setRcePanel("reject"); setRejectSendTo("business"); setRceNote(""); }} disabled={rceActing}>Reject…</Button>
                  </div>
                )}

                {mayApprove && rcePanel === "approve" && (
                  <div className="overflow-hidden rounded-md border border-border">
                    <div className="bg-muted/40 px-4 py-2.5 text-sm font-medium">Approve Assessment</div>
                    <div className="flex flex-col gap-3 p-4">
                      <div className="flex flex-col gap-1.5">
                        <Label>Risk Tier</Label>
                        <Select value={approveTier} onValueChange={setApproveTier}>
                          <SelectTrigger><SelectValue placeholder="Select tier…" /></SelectTrigger>
                          <SelectContent>
                            {VALID_TIERS.map((t) => (
                              <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, " ")}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-xs text-muted-foreground">Override the inferred tier if incorrect. You hold liability for the final classification.</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Organisational Role</Label>
                        <Select value={approveOrgRole} onValueChange={setApproveOrgRole}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="provider">Provider (Art. 3(3))</SelectItem>
                            <SelectItem value="deployer">Deployer (Art. 3(4))</SelectItem>
                            <SelectItem value="both">Both Provider and Deployer</SelectItem>
                            <SelectItem value="importer">Importer</SelectItem>
                            <SelectItem value="distributor">Distributor</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Note</Label>
                        <Textarea value={rceNote} onChange={(e) => setRceNote(e.target.value)} rows={2} placeholder="Optional approval note…" />
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => setRcePanel("")}>Cancel</Button>
                        <Button onClick={handleRceApprove} disabled={rceActing}>
                          {rceActing && <Loader2 className="animate-spin" />} Confirm Approval
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {mayApprove && rcePanel === "requestInfo" && (
                  <div className="overflow-hidden rounded-md border border-border">
                    <div className="bg-muted/40 px-4 py-2.5 text-sm font-medium">Request More Information</div>
                    <div className="flex flex-col gap-3 p-4">
                      <div className="flex flex-col gap-1.5">
                        <Label>Ask <span className="text-destructive">*</span></Label>
                        <Select value={infoContributor} onValueChange={setInfoContributor}>
                          <SelectTrigger><SelectValue placeholder="— select contributor —" /></SelectTrigger>
                          <SelectContent>
                            {infoContributors.map(([section, uname]) => (
                              <SelectItem key={uname} value={uname}>{uname} ({section === "business" ? "Business" : "Technical"})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>What is needed <span className="text-destructive">*</span></Label>
                        <Textarea value={rceNote} onChange={(e) => setRceNote(e.target.value)} rows={3} placeholder="Describe the information the contributor should provide…" />
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => setRcePanel("")}>Cancel</Button>
                        <Button onClick={handleRceRequestInfo} disabled={rceActing}>
                          {rceActing && <Loader2 className="animate-spin" />} Send Request
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {mayApprove && rcePanel === "reject" && (
                  <div className="overflow-hidden rounded-md border border-border">
                    <div className="bg-muted/40 px-4 py-2.5 text-sm font-medium">Reject Assessment</div>
                    <div className="flex flex-col gap-3 p-4">
                      <div className="flex flex-col gap-1.5">
                        <Label>Rejection Note <span className="text-destructive">*</span></Label>
                        <Textarea value={rceNote} onChange={(e) => setRceNote(e.target.value)} rows={3} placeholder="Explain what needs to be changed…" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Return to</Label>
                        <div className="flex gap-4 text-sm">
                          {(["business", "technical"] as const).map((opt) => (
                            <label key={opt} className="flex cursor-pointer items-center gap-2">
                              <input type="radio" name="reject_send_to" value={opt} checked={rejectSendTo === opt} onChange={() => setRejectSendTo(opt)} className="accent-[var(--brand)]" />
                              {opt === "business" ? "Business Section" : "Technical Section"}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => setRcePanel("")}>Cancel</Button>
                        <Button variant="destructive" onClick={handleRceReject} disabled={rceActing}>
                          {rceActing && <Loader2 className="animate-spin" />} Confirm Rejection
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {!mayApprove && (
                  <p className="text-sm text-muted-foreground">{noApproveTitle}</p>
                )}
              </div>
            )}

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

      <CreateAssessmentModal open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={load} />

      {/* Center dialogs: questionnaire + classification (outside side panel) */}
      {selectedSystem && qAssessmentId && (
        <>
          <QuestionnaireSection
            open={qDialogOpen && !qClassification}
            system={selectedSystem}
            section={qSection}
            username={username}
            headerExtra={<QuestionnaireProgress workflowStatus={selectedSystem.workflow_status} classificationVisible={false} />}
            onClose={closeQuestionnaire}
            onSuccess={onQuestionnaireSectionSuccess}
            showToast={showToast}
          />
          <Dialog open={qDialogOpen && qClassification} onOpenChange={(o) => { if (!o) closeQuestionnaire(); }}>
            <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 p-0">
              <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
                <DialogTitle className="text-base">Risk Classification — {selectedSystem.name}</DialogTitle>
                <div className="mt-2">
                  <QuestionnaireProgress workflowStatus={selectedSystem.workflow_status} classificationVisible={true} />
                </div>
              </DialogHeader>
              <div className="flex-1 overflow-y-auto">
                <RiskClassificationStep
                  system={selectedSystem}
                  assessmentId={qAssessmentId}
                  onClose={closeQuestionnaire}
                  onSuccess={onClassificationSuccess}
                  showToast={showToast}
                />
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </>
  );
}
