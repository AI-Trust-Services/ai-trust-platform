import { useState, useEffect, Fragment } from "react";
import { Loader2, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { TierBadge, LifecycleBadge, ComplianceBar } from "./Badges";
import { fmtDateTime, LIFECYCLE_LABELS, copyToClipboard, SELECT_CLASS } from "../utils";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import type { AISystem, ModelCard, WorkflowStep, UserSummary } from "../types";
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
  registered: "System Registered",
  assigned_engineer: "Engineer Assigned",
  details_submitted: "Submitted for Review",
  approved: "Approved",
  rejected: "Rejected",
};

const WF_PHASES = [
  { key: "registered",  label: "Registered" },
  { key: "in_progress", label: "Engineer Review" },
  { key: "review",      label: "Compliance Review" },
  { key: "outcome",     label: "Outcome" },
];

function workflowPhase(status: string): number {
  if (status === "approved" || status === "rejected") return 4;
  if (status === "pending_review") return 3;
  return 2;
}

function WorkflowProgress({
  system,
  onSystemUpdate,
  userMap,
}: {
  system: AISystem;
  onSystemUpdate: (updated: AISystem) => void;
  userMap?: UserMap;
}) {
  const [engineers, setEngineers] = useState<UserSummary[]>([]);
  const [lastSubmitter, setLastSubmitter] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [rejectAssignee, setRejectAssignee] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [acting, setActing] = useState(false);
  const { username } = useModalControls();
  const showToast = useToast();

  const canAct = system.workflow_status === "pending_review" && system.assignee_username === username;

  useEffect(() => {
    if (canAct) {
      api.getUsersByRole("ai_engineer").then(setEngineers).catch(() => {});
      api.getWorkflow(system.id).then((steps) => {
        const submitted = [...steps].reverse().find((s) => s.step === "details_submitted");
        if (submitted) setLastSubmitter(submitted.actor_username);
      }).catch(() => {});
    }
  }, [system.id, system.workflow_status, username]);

  async function handleApprove() {
    setActing(true);
    try {
      await api.approveSystem(system.id);
      onSystemUpdate(await api.getSystem(system.id));
      showToast("System approved");
    } catch (e) {
      showToast(`Approve failed: ${(e as Error).message}`, true);
    } finally { setActing(false); }
  }

  async function handleReject() {
    if (!rejectNote.trim()) { showToast("Rejection note is required", true); return; }
    if (!rejectAssignee) { showToast("Please reassign to an engineer", true); return; }
    setActing(true);
    try {
      await api.rejectSystem(system.id, rejectNote, rejectAssignee);
      onSystemUpdate(await api.getSystem(system.id));
      setRejectOpen(false); setRejectNote(""); setRejectAssignee("");
      showToast("System rejected and engineer notified");
    } catch (e) {
      showToast(`Reject failed: ${(e as Error).message}`, true);
    } finally { setActing(false); }
  }

  const phase = workflowPhase(system.workflow_status);

  // WORKFLOW STEPPER — no shadcn primitive maps to this; kept as styled markup
  // re-themed onto the new tokens. Logic and data unchanged.
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

      {(system.assignee_username || system.compliance_officer_username) && (
        <div className="mt-3 flex gap-6 text-[13px] text-muted-foreground">
          {system.workflow_status !== "approved" && system.assignee_username && (
            <span>
              <span className="font-semibold">Assigned to: </span>
              {userName(system.assignee_username, userMap)}
            </span>
          )}
          {system.compliance_officer_username && system.workflow_status !== "approved" && (
            <span>
              <span className="font-semibold">Compliance officer: </span>
              {userName(system.compliance_officer_username, userMap)}
            </span>
          )}
        </div>
      )}

      {canAct && !rejectOpen && (
        <div className="mt-4 flex gap-2">
          <Button onClick={handleApprove} disabled={acting}>
            {acting && <Loader2 className="animate-spin" />} Approve
          </Button>
          <Button variant="ghost" className="text-[var(--danger-fg)] hover:text-[var(--danger-fg)]"
            onClick={() => { setRejectOpen(true); setRejectAssignee(lastSubmitter || ""); }}
            disabled={acting}>
            Reject…
          </Button>
        </div>
      )}

      {canAct && rejectOpen && (
        <div className="mt-4 overflow-hidden rounded-md border border-border">
          <div className="bg-muted/40 px-4 py-2.5 text-sm font-medium">Reject System</div>
          <div className="p-4">
            <div className="mb-3 flex flex-col gap-1.5">
              <Label htmlFor="reject_note">Rejection Note <span className="text-[var(--danger-fg)]">*</span></Label>
              <Textarea id="reject_note" rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Explain what needs to be changed…" />
            </div>
            <div className="mb-3 flex flex-col gap-1.5">
              <Label htmlFor="reject_engineer">Reassign to AI Engineer <span className="text-[var(--danger-fg)]">*</span></Label>
              <select className={SELECT_CLASS} id="reject_engineer" value={rejectAssignee} onChange={(e) => setRejectAssignee(e.target.value)}>
                <option value="">— select an engineer —</option>
                {engineers.map((u) => (
                  <option key={u.username} value={u.username}>
                    {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.username} ({u.username})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { setRejectOpen(false); setRejectNote(""); setRejectAssignee(""); }}>Cancel</Button>
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

export default function SystemDetail({ system: initialSystem, models, open, onClose, onDelete, onUpdate, userMap }: {
  system: AISystem | null;
  models: ModelCard[];
  open: boolean;
  onClose: () => void;
  onDelete: () => void;
  onUpdate: (updated: AISystem) => void;
  userMap?: UserMap;
}) {
  const [tab, setTab] = useState("overview");
  const [system, setSystem] = useState<AISystem | null>(initialSystem);
  const showToast = useToast();
  const { mayRegister } = useModalControls();

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
                    <WorkflowProgress system={system} onSystemUpdate={handleSystemUpdate} userMap={userMap} />
                  </Section>
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
