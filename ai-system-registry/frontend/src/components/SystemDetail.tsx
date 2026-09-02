import { useState, useEffect, Fragment } from "react";
import { Loader2, ChevronDown, ChevronRight, Copy, FileText, Download, Sparkles } from "lucide-react";
import { TierBadge, LifecycleBadge, ComplianceBar } from "./Badges";
import { fmtDateTime, LIFECYCLE_LABELS, copyToClipboard, SELECT_CLASS, TIER_META } from "../utils";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import type { AISystem, ModelCard, WorkflowStep, ClassificationRationale, UserSummary } from "../types";
import {
  BUSINESS_QUESTIONS,
  AI_TECHNICAL_QUESTIONS,
  missingRequired,
  activeSubAssignee,
  getBusinessFieldValues,
  getAITechnicalFieldValues,
} from "../config/questionnaire";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type UserMap = Record<string, { firstName: string; lastName: string }>;

function userName(username: string, userMap?: UserMap): string {
  const u = userMap?.[username];
  const full = [u?.firstName, u?.lastName].filter(Boolean).join(" ");
  return full || username;
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      {title && <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>}
      {children}
    </div>
  );
}

function DetailGrid({ rows }: { rows: ([string, React.ReactNode] | false | null | undefined)[] }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-[13px]">
      {rows.filter((r): r is [string, React.ReactNode] => Array.isArray(r)).map(([label, value]) => (
        <Fragment key={label}>
          <span className="font-medium text-muted-foreground">{label}</span>
          <span className="text-foreground">{value}</span>
        </Fragment>
      ))}
    </div>
  );
}

function FlagPanel({ title, flags }: { title: string; flags: [unknown, string][] }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-2.5 overflow-hidden rounded-md border border-border">
      <CollapsibleTrigger className="flex w-full items-center justify-between bg-muted/40 px-4 py-2.5 text-sm font-medium">
        {title} {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="p-4">
        <div className="grid grid-cols-2 gap-2">
          {flags.map(([val, label]) => (
            <label key={label} className="flex items-start gap-2 text-sm">
              <Checkbox checked={!!val} disabled className="mt-0.5" />
              <span className={val ? "text-foreground" : "text-muted-foreground"}>{label}</span>
            </label>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const STEP_LABELS: Record<string, string> = {
  registered:            "System Registered",
  section_assigned:      "Sections Assigned",
  business_submitted:    "Business Section Submitted",
  technical_submitted:   "Technical Section Submitted",
  assigned_engineer:     "Engineer Assigned",
  details_submitted:     "Submitted for Review",
  sub_assigned_business: "Business Section Delegated",
  sub_assigned_technical:"Technical Section Delegated",
  sub_completed_business:"Business Delegation Completed",
  sub_completed_technical:"Technical Delegation Completed",
  sub_reclaimed_business: "Business Delegation Reclaimed",
  sub_reclaimed_technical:"Technical Delegation Reclaimed",
  info_requested:        "Information Requested",
  info_submitted:        "Information Provided",
  approved:              "Approved",
  rejected:              "Rejected",
};

const WF_PHASES = [
  { key: "registered",  label: "Registered" },
  { key: "business",    label: "Business Review" },
  { key: "technical",   label: "Technical Review" },
  { key: "compliance",  label: "Compliance Review" },
  { key: "outcome",     label: "Outcome" },
];

function workflowPhase(status: string): number {
  if (status === "approved" || status === "rejected") return 5;
  // info_requested is part of the compliance-review loop (CO sent it back for detail).
  if (status === "pending_review" || status === "info_requested") return 4;
  if (status === "technical_pending") return 3;
  if (status === "business_pending") return 2;
  return 1;
}

function WorkflowProgress({
  system,
  onSystemUpdate,
  onFillSection,
  userMap,
}: {
  system: AISystem;
  onSystemUpdate: (updated: AISystem) => void;
  onFillSection?: (section: "business" | "technical") => void;
  userMap?: UserMap;
}) {
  const [panel, setPanel] = useState<"" | "approve" | "reject" | "requestInfo" | "delegate">("");
  const [note, setNote] = useState("");
  const [rejectSendTo, setRejectSendTo] = useState<"business" | "technical">("business");
  const [approveTier, setApproveTier] = useState<string>(system.tier);
  const [infoContributor, setInfoContributor] = useState("");
  const [resubmitNote, setResubmitNote] = useState("");
  const [acting, setActing] = useState(false);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [delegateUser, setDelegateUser] = useState("");
  const [delegatePool, setDelegatePool] = useState<UserSummary[]>([]);
  const { username } = useModalControls();
  const showToast = useToast();

  const canAct = system.workflow_status === "pending_review" && system.assignee_username === username;
  // Contributor the CO sent the system back to for more information.
  const canResubmitInfo = system.workflow_status === "info_requested" && system.assignee_username === username;

  // The section currently open for editing (if any), its owner, and the active delegate.
  const pendingSection: "business" | "technical" | null =
    system.workflow_status === "business_pending" ? "business"
    : system.workflow_status === "technical_pending" ? "technical"
    : null;
  const sectionOwner = pendingSection
    ? (pendingSection === "business" ? system.business_assignee_username : system.technical_assignee_username)
    : null;
  const activeSub = pendingSection ? activeSubAssignee(steps, pendingSection) : null;
  const isSectionOwner = !!sectionOwner && username === sectionOwner;
  const isDelegate = !!activeSub && username === activeSub;
  // The owner may fill only while holding the token (no active delegate); the delegate
  // may fill while it holds the token. This mirrors the backend section edit-lock.
  const canFillSection = !!pendingSection && ((isSectionOwner && !activeSub) || isDelegate);

  // The CO cannot approve until every required question is answered (backend enforces a
  // 422 as the safety net). Booleans/numbers and full_manual systems never contribute gaps.
  const bizMissing = missingRequired(BUSINESS_QUESTIONS, getBusinessFieldValues(system));
  const techMissing = system.registration_mode === "ai"
    ? missingRequired(AI_TECHNICAL_QUESTIONS, getAITechnicalFieldValues(system))
    : [];
  const approvalMissing = system.registration_mode === "full_manual" ? [] : [...bizMissing, ...techMissing];

  // Load workflow steps (delegation is derived from them) while a section is open.
  useEffect(() => {
    if (system.workflow_status === "business_pending" || system.workflow_status === "technical_pending") {
      api.getWorkflow(system.id).then(setSteps).catch(() => setSteps([]));
    } else {
      setSteps([]);
    }
  }, [system.id, system.workflow_status]);

  // Load the delegation pool (same role as the section) when the owner opens the panel.
  useEffect(() => {
    if (panel === "delegate" && pendingSection) {
      api.getUsersByRole(pendingSection === "business" ? "business_owner" : "ai_engineer")
        .then(setDelegatePool)
        .catch(() => setDelegatePool([]));
    }
  }, [panel, pendingSection, system.id]);

  // Contributors the CO can bounce the system to for more information.
  const infoContributors = [
    system.business_assignee_username ? ["business", system.business_assignee_username] as const : null,
    system.technical_assignee_username ? ["technical", system.technical_assignee_username] as const : null,
  ].filter(Boolean) as (readonly ["business" | "technical", string])[];

  function closePanel() { setPanel(""); setNote(""); }

  async function handleApprove() {
    setActing(true);
    try {
      // Only send a tier override when the CO actually changed it.
      const tierOverride = approveTier && approveTier !== system.tier ? approveTier : undefined;
      await api.approveSystem(system.id, note.trim() || undefined, tierOverride);
      onSystemUpdate(await api.getSystem(system.id));
      closePanel();
      showToast("System approved");
    } catch (e) {
      showToast(`Approve failed: ${(e as Error).message}`, true);
    } finally { setActing(false); }
  }

  async function handleReject() {
    if (!note.trim()) { showToast("Rejection note is required", true); return; }
    setActing(true);
    try {
      await api.rejectSystem(system.id, note, system.assignee_username || "", rejectSendTo);
      onSystemUpdate(await api.getSystem(system.id));
      closePanel();
      showToast("System rejected");
    } catch (e) {
      showToast(`Reject failed: ${(e as Error).message}`, true);
    } finally { setActing(false); }
  }

  async function handleRequestInfo() {
    if (!infoContributor) { showToast("Select who should provide the information", true); return; }
    if (!note.trim()) { showToast("Describe what information is needed", true); return; }
    setActing(true);
    try {
      await api.requestInfo(system.id, infoContributor, note);
      onSystemUpdate(await api.getSystem(system.id));
      closePanel();
      showToast("Information requested — contributor notified");
    } catch (e) {
      showToast(`Request failed: ${(e as Error).message}`, true);
    } finally { setActing(false); }
  }

  async function handleResubmitInfo() {
    setActing(true);
    try {
      await api.submitInfo(system.id, resubmitNote.trim() || undefined);
      onSystemUpdate(await api.getSystem(system.id));
      setResubmitNote("");
      showToast("Returned to compliance officer for review");
    } catch (e) {
      showToast(`Resubmit failed: ${(e as Error).message}`, true);
    } finally { setActing(false); }
  }

  async function handleDelegate() {
    if (!pendingSection) return;
    if (!delegateUser) { showToast("Select who to delegate to", true); return; }
    setActing(true);
    try {
      await api.subAssign(system.id, pendingSection, delegateUser, note.trim() || undefined);
      onSystemUpdate(await api.getSystem(system.id));
      setSteps(await api.getWorkflow(system.id).catch(() => []));
      setPanel(""); setDelegateUser(""); setNote("");
      showToast("Section delegated — contributor notified");
    } catch (e) {
      showToast(`Delegation failed: ${(e as Error).message}`, true);
    } finally { setActing(false); }
  }

  async function handleReclaim() {
    if (!pendingSection) return;
    setActing(true);
    try {
      await api.subReclaim(system.id, pendingSection);
      onSystemUpdate(await api.getSystem(system.id));
      setSteps(await api.getWorkflow(system.id).catch(() => []));
      showToast("Delegation reclaimed");
    } catch (e) {
      showToast(`Reclaim failed: ${(e as Error).message}`, true);
    } finally { setActing(false); }
  }

  const phase = workflowPhase(system.workflow_status);

  return (
    <div>
      <div className="flex items-center">
        {WF_PHASES.map((p, i) => {
          const phaseNum = i + 1;
          const isDone = phase > phaseNum;
          const isActive = phase === phaseNum;
          const isOutcome = p.key === "outcome";
          const outcomeLabel = system.workflow_status === "approved" ? "Approved" : system.workflow_status === "rejected" ? "Rejected" : "Outcome";
          const dotClass = isDone
            ? "bg-[var(--success)] text-white"
            : isActive
              ? isOutcome && system.workflow_status === "approved"
                ? "bg-[var(--success)] text-white"
                : isOutcome && system.workflow_status === "rejected"
                  ? "bg-[var(--danger-fg)] text-white"
                  : "bg-[var(--brand)] text-white"
              : "border border-border bg-card text-muted-foreground";
          const lineDone = isDone || (isActive && !isOutcome);
          return (
            <Fragment key={p.key}>
              <div className="flex flex-col items-center gap-1.5">
                <div className={cn("flex size-7 items-center justify-center rounded-full text-xs font-semibold", dotClass)}>
                  {isDone ? "✓" : phaseNum}
                </div>
                <div className={cn("whitespace-nowrap text-[11px]", isDone || isActive ? "font-medium text-foreground" : "text-muted-foreground")}>
                  {isOutcome ? outcomeLabel : p.label}
                </div>
              </div>
              {i < WF_PHASES.length - 1 && (
                <div className={cn("mx-1 mb-5 h-0.5 flex-1", lineDone ? "bg-[var(--brand)]" : "bg-border")} />
              )}
            </Fragment>
          );
        })}
      </div>

      {(system.business_assignee_username || system.technical_assignee_username || system.compliance_officer_username) && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-[13px] text-muted-foreground">
          {system.business_assignee_username && (
            <span><span className="font-semibold">Business: </span>{userName(system.business_assignee_username, userMap)}</span>
          )}
          {system.technical_assignee_username && (
            <span><span className="font-semibold">Technical: </span>{userName(system.technical_assignee_username, userMap)}</span>
          )}
          {system.compliance_officer_username && (
            <span><span className="font-semibold">CO: </span>{userName(system.compliance_officer_username, userMap)}</span>
          )}
        </div>
      )}

      {pendingSection && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {canFillSection && onFillSection && (
              <Button onClick={() => onFillSection(pendingSection)}>
                Fill {pendingSection === "business" ? "Business" : "Technical"} Section
              </Button>
            )}
            {isSectionOwner && !activeSub && panel !== "delegate" && (
              <Button variant="outline" onClick={() => { setPanel("delegate"); setDelegateUser(""); setNote(""); }} disabled={acting}>
                Delegate…
              </Button>
            )}
            {isSectionOwner && activeSub && (
              <>
                <span className="text-[13px] text-muted-foreground">
                  Delegated to <strong className="text-foreground">{userName(activeSub, userMap)}</strong>
                </span>
                <Button variant="ghost" onClick={handleReclaim} disabled={acting}>
                  {acting && <Loader2 className="animate-spin" />} Reclaim
                </Button>
              </>
            )}
          </div>

          {isSectionOwner && !activeSub && panel === "delegate" && (
            <div className="overflow-hidden rounded-md border border-border">
              <div className="bg-muted/40 px-4 py-2.5 text-sm font-medium">
                Delegate {pendingSection === "business" ? "Business" : "Technical"} Section
              </div>
              <div className="p-4">
                <p className="mb-3 text-[13px] text-muted-foreground">
                  Hand this section to another {pendingSection === "business" ? "business owner" : "engineer"} to fill in.
                  You remain the owner and can reclaim it at any time; only you submit it onward once it is returned.
                </p>
                <div className="mb-3 flex flex-col gap-1.5">
                  <Label htmlFor="delegate_user">Delegate to <span className="text-[var(--danger-fg)]">*</span></Label>
                  <select className={SELECT_CLASS} id="delegate_user" value={delegateUser} onChange={(e) => setDelegateUser(e.target.value)}>
                    <option value="">— select contributor —</option>
                    {delegatePool
                      .filter((u) => u.username !== username)
                      .map((u) => (
                        <option key={u.username} value={u.username}>{userName(u.username, userMap)}</option>
                      ))}
                  </select>
                </div>
                <div className="mb-3 flex flex-col gap-1.5">
                  <Label htmlFor="delegate_note">Note</Label>
                  <Textarea id="delegate_note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional context for the contributor…" />
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => { setPanel(""); setDelegateUser(""); setNote(""); }}>Cancel</Button>
                  <Button onClick={handleDelegate} disabled={acting}>
                    {acting && <Loader2 className="animate-spin" />} Delegate Section
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {canResubmitInfo && (
        <div className="mt-4 overflow-hidden rounded-md border border-border">
          <div className="bg-muted/40 px-4 py-2.5 text-sm font-medium">Information Requested by Compliance</div>
          <div className="p-4">
            <p className="mb-3 text-[13px] text-muted-foreground">
              The compliance officer sent this system back for more information. Add a note and return it for review.
            </p>
            <div className="mb-3 flex flex-col gap-1.5">
              <Label htmlFor="resubmit_note">Response Note</Label>
              <Textarea id="resubmit_note" rows={3} value={resubmitNote} onChange={(e) => setResubmitNote(e.target.value)} placeholder="Summarise the information you added…" />
            </div>
            <Button onClick={handleResubmitInfo} disabled={acting}>
              {acting && <Loader2 className="animate-spin" />} Resubmit to Compliance
            </Button>
          </div>
        </div>
      )}

      {canAct && panel === "" && (
        <div className="mt-4 flex gap-2">
          <Button onClick={() => { setPanel("approve"); setApproveTier(system.tier); setNote(""); }} disabled={acting}>
            Approve…
          </Button>
          <Button variant="outline" onClick={() => { setPanel("requestInfo"); setInfoContributor(""); setNote(""); }} disabled={acting}>
            Request Info…
          </Button>
          <Button variant="ghost" className="text-[var(--danger-fg)] hover:text-[var(--danger-fg)]"
            onClick={() => { setPanel("reject"); setRejectSendTo("business"); setNote(""); }}
            disabled={acting}>
            Reject…
          </Button>
        </div>
      )}

      {canAct && panel === "approve" && (
        <div className="mt-4 overflow-hidden rounded-md border border-border">
          <div className="bg-muted/40 px-4 py-2.5 text-sm font-medium">Approve System</div>
          <div className="p-4">
            {approvalMissing.length > 0 && (
              <Alert variant="warning" className="mb-3 flex-col items-start">
                <div className="font-medium">Cannot approve yet — {approvalMissing.length} required question{approvalMissing.length === 1 ? "" : "s"} unanswered:</div>
                <ul className="mt-1 list-disc pl-5">
                  {approvalMissing.map((q) => <li key={q.key}>{q.label}</li>)}
                </ul>
                <div className="mt-1.5">Use <strong>Request Info</strong> to have a contributor complete them.</div>
              </Alert>
            )}
            <div className="mb-3 flex flex-col gap-1.5">
              <Label htmlFor="approve_tier">Risk Tier</Label>
              <select className={SELECT_CLASS} id="approve_tier" value={approveTier} onChange={(e) => setApproveTier(e.target.value)}>
                {Object.entries(TIER_META)
                  .filter(([v]) => v !== "pending")
                  .map(([v, meta]) => <option key={v} value={v}>{meta.label}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">
                Override the inferred tier before approving. You hold liability for the final classification.
              </span>
            </div>
            <div className="mb-3 flex flex-col gap-1.5">
              <Label htmlFor="approve_note">Note</Label>
              <Textarea id="approve_note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional approval note…" />
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={closePanel}>Cancel</Button>
              <Button onClick={handleApprove} disabled={acting || approvalMissing.length > 0}>
                {acting && <Loader2 className="animate-spin" />} Confirm Approval
              </Button>
            </div>
          </div>
        </div>
      )}

      {canAct && panel === "requestInfo" && (
        <div className="mt-4 overflow-hidden rounded-md border border-border">
          <div className="bg-muted/40 px-4 py-2.5 text-sm font-medium">Request More Information</div>
          <div className="p-4">
            <div className="mb-3 flex flex-col gap-1.5">
              <Label htmlFor="info_contributor">Ask <span className="text-[var(--danger-fg)]">*</span></Label>
              <select className={SELECT_CLASS} id="info_contributor" value={infoContributor} onChange={(e) => setInfoContributor(e.target.value)}>
                <option value="">— select contributor —</option>
                {infoContributors.map(([section, uname]) => (
                  <option key={uname} value={uname}>
                    {userName(uname, userMap)} ({section === "business" ? "Business" : "Technical"})
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-3 flex flex-col gap-1.5">
              <Label htmlFor="info_note">What is needed <span className="text-[var(--danger-fg)]">*</span></Label>
              <Textarea id="info_note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe the information the contributor should provide…" />
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={closePanel}>Cancel</Button>
              <Button onClick={handleRequestInfo} disabled={acting}>
                {acting && <Loader2 className="animate-spin" />} Send Request
              </Button>
            </div>
          </div>
        </div>
      )}

      {canAct && panel === "reject" && (
        <div className="mt-4 overflow-hidden rounded-md border border-border">
          <div className="bg-muted/40 px-4 py-2.5 text-sm font-medium">Reject System</div>
          <div className="p-4">
            <div className="mb-3 flex flex-col gap-1.5">
              <Label htmlFor="reject_note">Rejection Note <span className="text-[var(--danger-fg)]">*</span></Label>
              <Textarea id="reject_note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain what needs to be changed…" />
            </div>
            <div className="mb-3 flex flex-col gap-1.5">
              <Label>Return to</Label>
              <div className="flex gap-4 text-sm">
                {(["business", "technical"] as const).map((opt) => (
                  <label key={opt} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="reject_send_to"
                      value={opt}
                      checked={rejectSendTo === opt}
                      onChange={() => setRejectSendTo(opt)}
                      className="accent-[var(--brand)]"
                    />
                    {opt === "business" ? "Business Section" : "Technical Section"}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={closePanel}>Cancel</Button>
              <Button variant="destructive" onClick={handleReject} disabled={acting}>
                {acting && <Loader2 className="animate-spin" />} Confirm Rejection
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowTab({ system, userMap }: { system: AISystem; userMap?: UserMap }) {
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [loading, setLoading] = useState(true);
  const showToast = useToast();

  useEffect(() => {
    setLoading(true);
    api.getWorkflow(system.id)
      .then(setSteps)
      .catch(() => showToast("Failed to load workflow history", true))
      .finally(() => setLoading(false));
  }, [system.id, system.workflow_status]);

  if (loading) return <div className="py-6 text-muted-foreground">Loading…</div>;

  // VERTICAL TIMELINE — kept as styled markup re-themed onto the new tokens.
  return (
    <div className="flex flex-col">
      {steps.map((s, i) => {
        const dotColor = s.step === "rejected" ? "bg-[var(--danger-fg)]" : s.step === "approved" ? "bg-[var(--success)]" : "bg-[var(--brand)]";
        return (
          <div key={s.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < steps.length - 1 && <span className="absolute left-[5px] top-3 h-full w-px bg-border" />}
            <span className={cn("relative z-10 mt-1 size-2.5 shrink-0 rounded-full", dotColor)} />
            <div className="-mt-0.5">
              <div className="text-sm font-medium">{STEP_LABELS[s.step] || s.step}</div>
              <div className="text-xs text-muted-foreground">
                by <strong className="text-foreground">{userName(s.actor_username, userMap)}</strong>
                {s.assignee_username && <> → assigned to <strong className="text-foreground">{userName(s.assignee_username, userMap)}</strong></>}
                <span className="ml-2 text-muted-foreground">{fmtDateTime(s.created_at)}</span>
              </div>
              {s.note && <div className="mt-1 rounded-md bg-muted px-2.5 py-1.5 text-[13px] italic">"{s.note}"</div>}
            </div>
          </div>
        );
      })}
      {steps.length === 0 && (
        <div className="text-[13px] text-muted-foreground">No workflow history yet.</div>
      )}
    </div>
  );
}

function EditForm({ system, models: _models, onSave, onClose }: { system: AISystem; models: ModelCard[]; onSave: (updated: AISystem) => void; onClose: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({
    name: system.name || "",
    version: system.version || "",
    provider: system.provider || "",
    org_name: system.org_name || "",
    org_role: system.org_role || "provider",
    provider_country: system.provider_country || "",
    system_type: system.system_type || "application",
    autonomy_level: system.autonomy_level || "decision_support",
    lifecycle: system.lifecycle || "development",
    application_url: system.application_url || "",
    description: system.description || "",
    intended_purpose: system.intended_purpose || "",
  });
  const [saving, setSaving] = useState(false);
  const showToast = useToast();
  const { mayWrite } = useModalControls();
  const NO_WRITE_TITLE = "Requires permission: systems:write";
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.updateSystem(system.id, form);
      showToast("System updated successfully");
      onSave(updated);
    } catch (e) {
      showToast(`Update failed: ${(e as Error).message}`, true);
    } finally { setSaving(false); }
  }

  return (
    <div>
      <Alert variant="info" className="mb-4">Changes to identity and purpose fields only. Classification flags are immutable after registration.</Alert>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5"><Label htmlFor="edit_name">System Name <span className="text-[var(--danger-fg)]">*</span></Label><Input type="text" id="edit_name" value={form.name} onChange={set("name")} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="edit_version">Version</Label><Input type="text" id="edit_version" value={form.version} onChange={set("version")} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="edit_provider">Provider</Label><Input type="text" id="edit_provider" value={form.provider} onChange={set("provider")} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="edit_org_name">Organisation</Label><Input type="text" id="edit_org_name" value={form.org_name} onChange={set("org_name")} /></div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit_org_role">Role</Label>
          <select className={SELECT_CLASS} id="edit_org_role" value={form.org_role} onChange={set("org_role")}>
            <option value="provider">Provider</option>
            <option value="deployer">Deployer</option>
            <option value="importer">Importer</option>
            <option value="distributor">Distributor</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="edit_country">Country</Label><Input type="text" id="edit_country" value={form.provider_country} onChange={set("provider_country")} maxLength={2} /></div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit_system_type">System Type</Label>
          <select className={SELECT_CLASS} id="edit_system_type" value={form.system_type} onChange={set("system_type")}>
            <option value="application">Application</option>
            <option value="model">Model</option>
            <option value="component">Component</option>
            <option value="service">Service</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit_autonomy">Autonomy Level</Label>
          <select className={SELECT_CLASS} id="edit_autonomy" value={form.autonomy_level} onChange={set("autonomy_level")}>
            <option value="decision_support">Decision support</option>
            <option value="human_in_the_loop">Human in the loop</option>
            <option value="human_on_the_loop">Human on the loop</option>
            <option value="fully_automated">Fully automated</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit_lifecycle">Lifecycle State</Label>
          <select className={SELECT_CLASS} id="edit_lifecycle" value={form.lifecycle} onChange={set("lifecycle")}>
            {Object.entries(LIFECYCLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="edit_app_url">Application URL</Label><Input type="url" id="edit_app_url" value={form.application_url} onChange={set("application_url")} /></div>
        <div className="col-span-2 flex flex-col gap-1.5"><Label htmlFor="edit_description">Description</Label><Textarea id="edit_description" rows={3} value={form.description} onChange={set("description")} /></div>
        <div className="col-span-2 flex flex-col gap-1.5"><Label htmlFor="edit_purpose">Intended Purpose</Label><Textarea id="edit_purpose" rows={3} value={form.intended_purpose} onChange={set("intended_purpose")} /></div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving || !mayWrite} title={mayWrite ? undefined : NO_WRITE_TITLE}>
          {saving && <Loader2 className="animate-spin" />} Save Changes
        </Button>
      </div>
    </div>
  );
}

function ModelTab({ system, models, onSystemUpdate }: { system: AISystem; models: ModelCard[]; onSystemUpdate: (updated: AISystem) => void }) {
  const [selectedModelId, setSelectedModelId] = useState(system.model_id || "");
  const [linking, setLinking] = useState(false);
  const showToast = useToast();
  const { mayWrite } = useModalControls();
  const NO_WRITE_TITLE = "Requires permission: systems:write";
  const linkedModel = models.find((m) => m.id === system.model_id);

  async function handleLink() {
    if (!selectedModelId) { showToast("Please select a model first", true); return; }
    setLinking(true);
    try {
      const updated = await api.linkModel(system.id, selectedModelId);
      showToast("Model linked successfully");
      onSystemUpdate(updated);
    } catch (e) {
      showToast(`Link failed: ${(e as Error).message}`, true);
    } finally { setLinking(false); }
  }

  async function handleUnlink() {
    try {
      const updated = await api.unlinkModel(system.id);
      showToast("Model unlinked");
      onSystemUpdate(updated);
    } catch (e) {
      showToast(`Unlink failed: ${(e as Error).message}`, true);
    }
  }

  return (
    <div>
      {system.model_id ? (
        <Section title="Currently Linked Model">
          <div className="rounded-md border border-border bg-muted/30 p-4">
            <div className="font-medium">{linkedModel ? linkedModel.name : system.model_id}</div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              {linkedModel ? `${linkedModel.provider} · ${linkedModel.model_type} · v${linkedModel.version}` : system.model_id}
              {linkedModel?.inference_url && (
                <> · <a href={linkedModel.inference_url} target="_blank" rel="noreferrer" className="text-[var(--brand)]">{linkedModel.inference_url}</a></>
              )}
            </div>
            {linkedModel?.description && <div className="mt-1.5 text-[13px] text-muted-foreground">{linkedModel.description}</div>}
          </div>
          <Button variant="ghost" className="mt-2" disabled={!mayWrite} title={mayWrite ? undefined : NO_WRITE_TITLE} onClick={handleUnlink}>Unlink Model</Button>
        </Section>
      ) : (
        <Alert variant="info" className="mb-4">No model card is linked to this system yet.</Alert>
      )}
      <Section title="Link a Model Card">
        <div className="mb-3 flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="modelLinkSelect">Select model from catalog</Label>
            <select className={SELECT_CLASS} id="modelLinkSelect" value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
              <option value="">— choose a model —</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.provider} · {m.model_type})</option>
              ))}
            </select>
          </div>
          <Button onClick={handleLink} disabled={linking || !mayWrite} title={mayWrite ? undefined : NO_WRITE_TITLE}>Link</Button>
        </div>
        <div className="text-xs text-muted-foreground">
          Linking a model records which LLM or AI model powers this system. One system can have at most one linked model.
        </div>
      </Section>
    </div>
  );
}

// CO-only view of the AI-inferred classification: reasoning, confidence, gaps, and per-flag detail.
function ClassificationRationalePanel({ rationale }: { rationale: ClassificationRationale }) {
  const pct = (c: number | null) => (c == null ? "—" : `${Math.round(c * 100)}%`);
  return (
    <div className="rounded-md border border-[var(--brand)]/30 bg-[var(--brand)]/5 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--brand)]">
        <Sparkles className="size-4" /> AI Classification Rationale
      </div>
      <div className="mb-3 text-xs text-muted-foreground">
        Inferred from the questionnaire answers. Visible only to you as the compliance officer — you decide the final tier.
      </div>
      {rationale.reasoning && (
        <div className="mb-3 text-[13px] leading-relaxed text-foreground">{rationale.reasoning}</div>
      )}
      <DetailGrid rows={[
        ["Confidence", pct(rationale.confidence)],
      ]} />
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

// Supporting documents attached in the full-manual override flow, with presigned download.
function RegistrationDocuments({ system }: { system: AISystem }) {
  const [downloading, setDownloading] = useState<number | null>(null);
  const showToast = useToast();
  const docs = system.registration_documents ?? [];

  async function handleDownload(index: number) {
    setDownloading(index);
    try {
      const { url } = await api.getDocumentDownloadUrl(system.id, index);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      showToast(`Download failed: ${(e as Error).message}`, true);
    } finally { setDownloading(null); }
  }

  if (docs.length === 0) return null;
  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {docs.map((doc, i) => (
        <div key={doc.minio_key} className="flex items-center gap-2.5 px-3 py-2.5 text-[13px]">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{doc.filename}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{fmtDateTime(doc.uploaded_at)}</span>
          <Button variant="ghost" size="sm" disabled={downloading === i} onClick={() => handleDownload(i)}>
            {downloading === i ? <Loader2 className="animate-spin" /> : <Download />} Download
          </Button>
        </div>
      ))}
    </div>
  );
}

export default function SystemDetail({ system: initialSystem, models, open, onClose, onDelete, onUpdate, onFillSection, userMap }: {
  system: AISystem | null;
  models: ModelCard[];
  open: boolean;
  onClose: () => void;
  onDelete: () => void;
  onUpdate: (updated: AISystem) => void;
  onFillSection?: (system: AISystem, section: "business" | "technical") => void;
  userMap?: UserMap;
}) {
  const [tab, setTab] = useState("overview");
  const [system, setSystem] = useState<AISystem | null>(initialSystem);
  const showToast = useToast();
  const { mayRegister, username } = useModalControls();

  useEffect(() => { setSystem(initialSystem); setTab("overview"); }, [initialSystem]);

  function handleSystemUpdate(updated: AISystem) {
    setSystem(updated);
    onUpdate(updated);
  }

  async function handleDelete() {
    if (!system) return;
    if (!confirm(`Delete "${system.name}"?\n\nThis action cannot be undone.`)) return;
    try {
      await api.deleteSystem(system.id);
      onClose();
      showToast("System deleted");
      onDelete();
    } catch (e) {
      showToast(`Delete failed: ${(e as Error).message}`, true);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        {system && (
          <>
            <SheetHeader>
              <SheetTitle>{system.name}</SheetTitle>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{system.id} · v{system.version}</span>
                <TierBadge tier={system.tier} workflowStatus={system.workflow_status} />
                <LifecycleBadge lc={system.lifecycle} />
              </div>
            </SheetHeader>

            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
              <div className="border-b border-border px-6 py-2.5">
                <TabsList>
                  {["overview", "workflow", "model", "edit"].map((t) => (
                    <TabsTrigger key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</TabsTrigger>
                  ))}
                </TabsList>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <TabsContent value="overview">
                  <Section>
                    <WorkflowProgress
                      system={system}
                      onSystemUpdate={handleSystemUpdate}
                      onFillSection={onFillSection ? (section) => onFillSection(system, section) : undefined}
                      userMap={userMap}
                    />
                  </Section>
                  {system.classification_rationale != null
                    && !Array.isArray(system.classification_rationale)
                    && system.compliance_officer_username === username && (
                    <Section>
                      <ClassificationRationalePanel rationale={system.classification_rationale} />
                    </Section>
                  )}
                  {system.registration_mode === "full_manual" && (system.registration_documents?.length ?? 0) > 0 && (
                    <Section title="Supporting Documents">
                      <RegistrationDocuments system={system} />
                    </Section>
                  )}
                  <Section title="Identity">
                    <DetailGrid rows={[
                      ["Name", system.name],
                      ["Version", system.version],
                      ["Provider", system.provider || "—"],
                      ["Organisation", system.org_name || "—"],
                      ["Role", system.org_role],
                      ["Country", system.provider_country],
                      ["System Type", system.system_type],
                      ["Autonomy Level", (system.autonomy_level || "").replace(/_/g, " ")],
                      !!system.application_url && ["Application URL", <a key="url" href={system.application_url} target="_blank" rel="noreferrer" className="text-[var(--brand)]">{system.application_url}</a>],
                    ]} />
                    <div className="mt-4 rounded-md border border-border bg-background p-3">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Telemetry Configuration</div>
                      <div className="mb-2 text-xs text-muted-foreground">Use this system ID as the telemetry service name (e.g. <code className="font-mono">OTEL_SERVICE_NAME</code>) to link telemetry to this system:</div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 font-mono text-xs">{system.id}</code>
                        <Button variant="ghost" size="sm" onClick={() => {
                          copyToClipboard(system.id)
                            .then(() => showToast("System ID copied"))
                            .catch(() => showToast("Copy failed", true));
                        }}><Copy /> Copy ID</Button>
                      </div>
                    </div>
                  </Section>
                  <Section title="Purpose">
                    <DetailGrid rows={[
                      ["Description", system.description || "—"],
                      ["Intended Purpose", system.intended_purpose || "—"],
                    ]} />
                  </Section>
                  <Section title="Classification">
                    <DetailGrid rows={[
                      ["Risk Tier", <TierBadge key="tier" tier={system.tier} workflowStatus={system.workflow_status} />],
                      ["Classification Basis", <span key="basis" className="text-[13px]">{system.basis}</span>],
                      system.annex_iii_area != null && ["Annex III Area", `Area ${system.annex_iii_area}`],
                      ["GPAI", system.is_gpai ? <span key="gpai" className="text-[var(--brand)]">Yes</span> : "No"],
                    ]} />
                  </Section>
                  <Section title="Risk Flags">
                    <FlagPanel title="Art. 5 — Prohibited Practice Flags" flags={[
                      [system.subliminal_manipulation, "Subliminal manipulation"],
                      [system.exploits_vulnerability, "Exploits vulnerability"],
                      [system.social_scoring_public, "Social scoring (public authority)"],
                      [system.real_time_biometric_public, "Real-time biometric ID in public"],
                      [system.emotion_recognition_workplace, "Emotion recognition (workplace/education)"],
                      [system.untargeted_facial_scraping, "Untargeted facial image scraping"],
                      [system.predictive_policing, "Predictive policing"],
                      [system.biometric_categorisation_sensitive, "Biometric categorisation (sensitive attrs.)"],
                    ]} />
                    <FlagPanel title="Annex III — High-Risk Flags" flags={[
                      [system.is_biometric_identification, "Biometric identification"],
                      [system.is_critical_infrastructure, "Critical infrastructure"],
                      [system.is_education_related, "Education & vocational training"],
                      [system.is_employment_related, "Employment & worker management"],
                      [system.is_credit_scoring, "Credit scoring"],
                      [system.is_public_service, "Public services"],
                      [system.is_law_enforcement, "Law enforcement"],
                      [system.is_migration, "Migration & border control"],
                      [system.is_judicial_admin, "Justice & democratic processes"],
                    ]} />
                    <FlagPanel title="Art. 50 — Limited Risk" flags={[
                      [system.is_chatbot, "Chatbot / direct user interaction"],
                      [system.generates_synthetic_content, "Generates synthetic content"],
                    ]} />
                  </Section>
                  <Section title="Lifecycle">
                    <DetailGrid rows={[
                      ["State", <LifecycleBadge key="lc" lc={system.lifecycle} />],
                      ["Compliance", <ComplianceBar key="comp" pct={system.compliance} />],
                      ["Registered", fmtDateTime(system.created_at)],
                      ["Last Updated", fmtDateTime(system.updated_at)],
                    ]} />
                  </Section>
                </TabsContent>

                <TabsContent value="workflow">
                  <WorkflowTab system={system} userMap={userMap} />
                </TabsContent>

                <TabsContent value="model">
                  <ModelTab system={system} models={models} onSystemUpdate={handleSystemUpdate} />
                </TabsContent>

                <TabsContent value="edit">
                  <EditForm system={system} models={models} onSave={handleSystemUpdate} onClose={onClose} />
                </TabsContent>
              </div>
            </Tabs>

            <SheetFooter className="flex-row items-center">
              <Button variant="destructive" onClick={handleDelete} disabled={!mayRegister}
                title={mayRegister ? undefined : "Requires role: business owner or administrator"}>Delete System</Button>
              <div className="flex-1" />
              <Button variant="ghost" onClick={onClose}>Close</Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
