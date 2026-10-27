import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import LuigiClient from "@luigi-project/client";
import {
  ChevronLeft, ChevronDown, MoreVertical, Trash2, Download, Upload,
  CheckCircle2, FileText, RefreshCw, AlertTriangle,
  File, RotateCcw, Eye, X, Plus, Shield, ListChecks, Clock,
  LayoutGrid, ClipboardList, FolderOpen, Hash, Home, CalendarDays,
  Settings2, TrendingUp, PencilLine, Sparkles, ShieldCheck,
  Users,
} from "lucide-react";
import { TierBadge, FormattedDate } from "../components/Badges";
import InitialsAvatar from "../components/InitialsAvatar";
import { api, auditApi } from "../api/client";
import { useToast, useModalControls } from "../App";
import { fmtDate, fmtDateTime, LIFECYCLE_LABELS, SELECT_CLASS } from "../utils";
import type { AISystem, ComplianceAssessment, AuditEvent, IndexedDocument } from "../types";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type UserMap = Record<string, { firstName: string; lastName: string }>;

function startRiskClassification(systemId: string) {
  localStorage.setItem("compliance.pendingAssessment", JSON.stringify({ systemId }));
  LuigiClient.linkManager().navigate("/home/assessments");
}

function userName(username: string | null | undefined, userMap: UserMap): string {
  if (!username) return "—";
  const u = userMap[username];
  const full = [u?.firstName, u?.lastName].filter(Boolean).join(" ");
  return full || username;
}

// ── Progress Steps ────────────────────────────────────────────────────────────

function deriveProgress(assessments: ComplianceAssessment[]) {
  const hasAny = assessments.length > 0;
  const underReview = assessments.some((a) => ["submitted", "pending_review", "under_review"].includes(a.status));
  const approved = assessments.some((a) => a.status === "approved");
  return [
    { label: "1. Register AI system", done: true },
    { label: "2. Draft assessment started", done: hasAny, actionable: !hasAny },
    { label: "3. Assessment under review", done: underReview || approved, actionable: hasAny && !underReview && !approved },
    { label: "4. Risk classification approved", done: approved },
  ];
}

function ProgressSteps({ steps }: { steps: ReturnType<typeof deriveProgress> }) {
  return (
    <div className="space-y-4">
      {steps.map((step, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
            step.done
              ? "bg-[var(--success,#16a34a)] text-white"
              : "border-2 border-muted-foreground/30 text-muted-foreground/60",
          )}>
            {step.done ? <CheckCircle2 className="size-3.5" /> : i + 1}
          </div>
          <div className="pt-0.5">
            <span className={cn("text-[13px]", step.done ? "font-medium text-foreground" : "text-muted-foreground")}>
              {step.label}
            </span>
            {step.actionable && (
              <div className="mt-1">
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                  Action required
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── History Panel ─────────────────────────────────────────────────────────────

function HistoryPanel({ systemId }: { systemId: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (o: number, replace: boolean) => {
    setLoading(true);
    try {
      const res = await auditApi.listEvents(systemId, 5, o);
      setEvents((prev) => replace ? res.items : [...prev, ...res.items]);
      setTotal(res.total);
      setOffset(o + res.items.length);
    } catch { /* audit service unavailable — fail soft */ }
    setLoading(false);
  }, [systemId]);

  useEffect(() => { load(0, true); }, [load]);

  function downloadCsv() {
    if (!events.length) return;
    const header = "Date,Actor,Action";
    const rows = events.map((e) => `"${fmtDateTime(e.created_at)}","${e.actor_username}","${e.action}"`);
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${systemId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Clock className="size-3" /> History
        </h3>
        <Button variant="ghost" size="icon" className="size-6" title="Download as CSV" onClick={downloadCsv}>
          <Download className="size-3" />
        </Button>
      </div>
      {events.length === 0 && !loading && (
        <p className="text-[12px] text-muted-foreground">No audit events recorded.</p>
      )}
      <div className="space-y-3">
        {events.map((e) => (
          <div key={e.id} className="flex items-start gap-2">
            <div className="mt-[5px] size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
            <div className="min-w-0">
              <div className="text-[11px] text-muted-foreground">{fmtDateTime(e.created_at)}</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <InitialsAvatar name={e.actor_username} className="size-4 text-[8px]" />
                <span className="text-[12px] font-medium">{e.actor_username}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {events.length < total && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 w-full text-[12px]"
          onClick={() => load(offset, false)}
          disabled={loading}
        >
          {loading ? "Loading…" : "Show older"}
        </Button>
      )}
    </div>
  );
}

// ── Roles Dialog ──────────────────────────────────────────────────────────────

type AllUser = { username: string; firstName: string; lastName: string; role: string };

function RolesDialog({
  open, system, allUsers, currentUsername, onClose, onSaved,
}: {
  open: boolean;
  system: AISystem;
  allUsers: AllUser[];
  currentUsername: string;
  onClose: () => void;
  onSaved: (updated: AISystem) => void;
}) {
  const showToast = useToast();
  const [owner, setOwner] = useState(system.business_owners ?? "");
  const [contributors, setContributors] = useState<string[]>(system.contributors ?? []);
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ownerError, setOwnerError] = useState(false);

  useEffect(() => {
    if (open) {
      setOwner(system.business_owners ?? "");
      setContributors(system.contributors ?? []);
      setSearch("");
      setOwnerError(false);
    }
  }, [open, system]);

  const isCurrentUserOwner = currentUsername === owner;

  // Deduplicate so a user can't appear twice even if backend data is inconsistent.
  const allMembers = [...new Set([owner, ...contributors].filter(Boolean))];

  const showSuggestions = searchFocused || search.trim().length > 0;
  const suggestions = showSuggestions
    ? allUsers.filter(
        (u) => u.role !== "ai_compliance_officer" &&
          !allMembers.includes(u.username) &&
          (!search.trim() ||
           u.username.toLowerCase().includes(search.toLowerCase()) ||
           `${u.firstName} ${u.lastName}`.toLowerCase().includes(search.toLowerCase())),
      ).slice(0, 6)
    : [];

  function addUser(un: string) {
    if (!owner) { setOwner(un); }
    else if (!contributors.includes(un)) { setContributors((c) => [...c, un]); }
    setSearch("");
    setSearchFocused(false);
  }

  function addFromSearch() {
    if (suggestions.length > 0) addUser(suggestions[0].username);
  }

  function setRole(un: string, role: "owner" | "contributor" | "remove") {
    if (role === "remove") {
      if (un === owner) setOwner("");
      else setContributors((c) => c.filter((x) => x !== un));
    } else if (role === "owner") {
      if (owner && owner !== un) {
        setContributors((c) => [...c.filter((x) => x !== un), owner]);
      } else {
        setContributors((c) => c.filter((x) => x !== un));
      }
      setOwner(un);
    } else {
      if (un === owner) {
        setOwner("");
        setContributors((c) => (c.includes(un) ? c : [...c, un]));
      }
    }
  }

  async function save() {
    if (!owner) { setOwnerError(true); return; }
    setOwnerError(false);
    setSaving(true);
    try {
      const updated = await api.updateSystem(system.id, {
        business_owners: owner,
        contributors,
      });
      showToast("Roles updated");
      onSaved(updated);
      onClose();
    } catch (e) {
      showToast(`Failed to save roles: ${(e as Error).message}`, true);
    }
    setSaving(false);
  }

  function memberLabel(u: AllUser) {
    const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
    return full || u.username;
  }

  const memberUsers = allMembers
    .map((un) => allUsers.find((u) => u.username === un) ?? { username: un, firstName: "", lastName: "", role: "" });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" /> Roles for {system.name}
          </DialogTitle>
          <DialogDescription>Designate owners and others to support in the completion of this system's compliance.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {isCurrentUserOwner && (
            <div className="relative flex gap-2">
              <div className="relative flex-1">
                <Input
                  placeholder="Search for user…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setOwnerError(false); }}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                />
                {suggestions.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-md">
                    {suggestions.map((u) => (
                      <button
                        key={u.username}
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addUser(u.username)}
                      >
                        <InitialsAvatar name={memberLabel(u)} className="size-6 text-[10px]" />
                        <div className="min-w-0 flex-1 text-left">
                          <div className="font-medium">{memberLabel(u)}</div>
                          <div className="text-xs text-muted-foreground">{u.username}</div>
                        </div>
                        <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                type="button"
                className="shrink-0 bg-[var(--brand,#1147E9)] text-white hover:opacity-90"
                onMouseDown={(e) => e.preventDefault()}
                onClick={addFromSearch}
              >
                Add
              </Button>
            </div>
          )}
          {ownerError && (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertTriangle className="size-3.5" /> At least one owner is required.
            </p>
          )}
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {memberUsers.map((u) => {
              const isMemberOwner = u.username === owner;
              const isMe = u.username === currentUsername;
              return (
                <div key={u.username} className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                  <InitialsAvatar name={memberLabel(u)} className="size-9 text-[12px]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">
                      {memberLabel(u)}{isMe ? " (You)" : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">{isMemberOwner ? "Owner" : "Contributor"}</div>
                  </div>
                  {isCurrentUserOwner ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex items-center gap-1 text-sm font-medium text-[var(--brand,#1147E9)] hover:opacity-80"
                        >
                          {isMemberOwner ? "Owner" : "Contributor"}
                          <ChevronDown className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setRole(u.username, "owner")}>Owner</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setRole(u.username, "contributor")}>Contributor</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setRole(u.username, "remove")}>Remove</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="text-sm font-medium text-[var(--brand,#1147E9)]">
                      {isMemberOwner ? "Owner" : "Contributor"}
                    </span>
                  )}
                </div>
              );
            })}
            {memberUsers.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No members yet. Use the search above to add someone.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          {isCurrentUserOwner ? (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={save}
                disabled={saving}
                className="bg-[var(--brand,#1147E9)] text-white hover:opacity-90"
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Assessment helpers ────────────────────────────────────────────────────────

function assessmentStepLabel(status: string): string {
  switch (status) {
    case "draft": case "questionnaire_pending": return "1. Draft assessment started";
    case "submitted": case "pending_review": case "under_review": return "3. Assessment under review";
    case "approved": return "4. Risk classification approved";
    case "inactive": return "Superseded";
    default: return status;
  }
}

function assessmentStepProgress(status: string): number {
  if (["draft", "questionnaire_pending"].includes(status)) return 1;
  if (["submitted", "pending_review", "under_review"].includes(status)) return 3;
  if (status === "approved") return 4;
  return 0;
}

function getFileImpact(assessments: ComplianceAssessment[]): "approved" | "submitted" | "draft" | "none" {
  if (assessments.some((a) => a.status === "approved")) return "approved";
  if (assessments.some((a) => ["submitted", "pending_review", "under_review"].includes(a.status))) return "submitted";
  if (assessments.some((a) => ["draft", "questionnaire_pending"].includes(a.status))) return "draft";
  return "none";
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  system, assessments, userMap, onSystemUpdate, onFilesRefresh, editMode, onEditModeChange,
}: {
  system: AISystem;
  assessments: ComplianceAssessment[];
  userMap: UserMap;
  onSystemUpdate: (s: AISystem) => void;
  onFilesRefresh: () => void;
  editMode: boolean;
  onEditModeChange: (v: boolean) => void;
}) {
  const showToast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: system.name,
    intended_purpose: system.intended_purpose,
    lifecycle: system.lifecycle,
    planned_rollout_date: system.planned_rollout_date ?? "",
    git_repo_url: system.git_repo_url ?? "",
  });

  useEffect(() => {
    setForm({
      name: system.name,
      intended_purpose: system.intended_purpose,
      lifecycle: system.lifecycle,
      planned_rollout_date: system.planned_rollout_date ?? "",
      git_repo_url: system.git_repo_url ?? "",
    });
  }, [system]);

  async function saveEdit() {
    setSaving(true);
    try {
      const updated = await api.updateSystem(system.id, {
        name: form.name,
        intended_purpose: form.intended_purpose,
        lifecycle: form.lifecycle as AISystem["lifecycle"],
        planned_rollout_date: form.planned_rollout_date || null,
        git_repo_url: form.git_repo_url || null,
      });
      onSystemUpdate(updated);
      onEditModeChange(false);
      showToast("System details saved");
    } catch (e) {
      showToast(`Save failed: ${(e as Error).message}`, true);
    }
    setSaving(false);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";
    let failed = 0;
    await Promise.all(files.map((file) =>
      api.uploadDocumentIndexed(system.id, file).catch(() => { failed++; }),
    ));
    showToast(failed === 0
      ? `${files.length} file${files.length > 1 ? "s" : ""} uploaded`
      : `${files.length - failed} uploaded, ${failed} failed`,
      failed > 0,
    );
    onFilesRefresh();
  }

  const approvedAssessment = assessments.find((a) => a.status === "approved");
  const steps = deriveProgress(assessments);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Left column */}
      <div className="space-y-6 lg:col-span-2">

        {/* Next Steps */}
        <Card className="p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="size-4 text-muted-foreground" /> Next Steps
          </h2>
          <div className="space-y-3">
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <ClipboardList className="mt-0.5 size-4 shrink-0 text-[var(--brand,#1147E9)]" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Start the EU AI Act Assessment</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Complete a risk assessment to receive your EU AI Act classification.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => startRiskClassification(system.id)}>
                  {assessments.length === 0 ? "Start" : "Continue"}
                </Button>
              </div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <Upload className="mt-0.5 size-4 shrink-0 text-[var(--brand,#1147E9)]" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Upload additional documentation files</p>
                    <span className="text-[11px] text-muted-foreground">Optional</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    PDF, DOCX, or Markdown — used to pre-fill the compliance questionnaire.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="size-3.5" /> Upload
                </Button>
              </div>
            </div>
          </div>
          <input ref={fileInputRef} type="file" multiple className="hidden" accept=".pdf,.docx,.md" onChange={handleFileUpload} />
        </Card>

        {/* Risk Classification */}
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Shield className="size-4 text-muted-foreground" /> Risk Classification
          </h2>
          {approvedAssessment ? (
            <div className="flex items-center gap-3">
              <TierBadge
                tier={system.tier}
                workflowStatus={system.workflow_status}
                isChatbot={system.is_chatbot}
                generatesSyntheticContent={system.generates_synthetic_content}
              />
              <span className="text-sm text-muted-foreground">
                Approved by {userName(approvedAssessment.confirmed_by, userMap)}
                {approvedAssessment.confirmed_by && ` · ${fmtDate(approvedAssessment.updated_at)}`}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No risk classification has been issued yet. Complete an assessment to receive your classification.
            </p>
          )}
        </Card>

        {/* System Details */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Settings2 className="size-4 text-muted-foreground" /> AI System Details
            </h2>
          </div>
          {editMode ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Intended Purpose</label>
                <Textarea
                  value={form.intended_purpose}
                  rows={3}
                  onChange={(e) => setForm((f) => ({ ...f, intended_purpose: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Development Stage</label>
                <select
                  className={SELECT_CLASS}
                  value={form.lifecycle}
                  onChange={(e) => setForm((f) => ({ ...f, lifecycle: e.target.value as AISystem["lifecycle"] }))}
                >
                  {Object.entries(LIFECYCLE_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Planned Roll-out Date</label>
                <Input
                  type="date"
                  value={form.planned_rollout_date}
                  onChange={(e) => setForm((f) => ({ ...f, planned_rollout_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">GitHub Repository</label>
                <Input
                  type="url"
                  placeholder="https://github.com/…"
                  value={form.git_repo_url}
                  onChange={(e) => setForm((f) => ({ ...f, git_repo_url: e.target.value }))}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={saveEdit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
                <Button variant="outline" onClick={() => onEditModeChange(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-2 text-sm">
              {([
                ["Name", system.name],
                ["Intended Purpose", system.intended_purpose],
                ["Development Stage", LIFECYCLE_LABELS[system.lifecycle] ?? system.lifecycle],
                ["Planned Roll-out", system.planned_rollout_date ? fmtDate(system.planned_rollout_date) : "—"],
                ["GitHub Repository", system.git_repo_url
                  ? <a href={system.git_repo_url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">{system.git_repo_url}</a>
                  : "—"],
                ["Provider", system.provider],
              ] as [string, React.ReactNode][]).map(([k, v]) => (
                <>
                  <dt key={`k-${k}`} className="font-medium text-muted-foreground">{k}</dt>
                  <dd key={`v-${k}`}>{v}</dd>
                </>
              ))}
            </dl>
          )}
        </Card>
      </div>

      {/* Right sidebar */}
      <div className="space-y-6">
        <div>
          <h2 className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="size-3.5" /> EU AI Act Progress
          </h2>
          <ProgressSteps steps={steps} />
        </div>
        <div className="border-t border-border pt-5">
          <HistoryPanel systemId={system.id} />
        </div>
      </div>
    </div>
  );
}

// ── Assessments Tab ───────────────────────────────────────────────────────────

function AssessmentsTab({
  system, assessments, userMap, onRefresh,
}: {
  system: AISystem;
  assessments: ComplianceAssessment[];
  userMap: UserMap;
  onRefresh: () => void;
}) {
  const showToast = useToast();
  const [deleteTarget, setDeleteTarget] = useState<ComplianceAssessment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const approvedAssessment = assessments.find((a) => a.status === "approved");
  const draftAssessment = assessments.find((a) =>
    ["draft", "questionnaire_pending"].includes(a.status),
  );
  const reviewAssessment = assessments.find((a) =>
    ["submitted", "pending_review", "under_review"].includes(a.status),
  );

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteAssessment(deleteTarget.id);
      showToast("Assessment deleted");
      setDeleteTarget(null);
      onRefresh();
    } catch (e) {
      showToast(`Delete failed: ${(e as Error).message}`, true);
    }
    setDeleting(false);
  }

  async function submitToCompliance(a: ComplianceAssessment) {
    setSubmitting(true);
    try {
      await api.submitAssessment(a.id);
      showToast("Assessment submitted to compliance officer");
      onRefresh();
    } catch (e) {
      showToast(`Submit failed: ${(e as Error).message}`, true);
    }
    setSubmitting(false);
  }

  function goToCompliance() {
    LuigiClient.linkManager().navigate("/home/assessments");
  }

  // Sequential index within non-inactive assessments for display name.
  const seqIndex = (a: ComplianceAssessment) =>
    assessments.filter((x) => x.status !== "inactive").indexOf(a) + 1 || assessments.indexOf(a) + 1;

  return (
    <div className="space-y-6">
      {/* Risk Classification section (Fix 1) */}
      <div>
        <h2 className="mb-3 text-base font-semibold">Risk Classification</h2>
        <Card className="p-5">
          {assessments.length === 0 ? (
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <div>
                <p className="text-sm font-medium">No assessment started</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Complete an assessment to receive your EU AI Act risk classification.
                </p>
              </div>
              <Button size="sm" className="ml-auto shrink-0" onClick={() => startRiskClassification(system.id)}>
                Start assessment
              </Button>
            </div>
          ) : approvedAssessment ? (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="size-4 shrink-0 text-[var(--success,#16a34a)]" />
              <div>
                <p className="text-sm font-medium">Risk classification approved</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Confirmed by {userName(approvedAssessment.confirmed_by, userMap)}
                </p>
              </div>
              <TierBadge
                tier={system.tier}
                workflowStatus={system.workflow_status}
                isChatbot={system.is_chatbot}
                generatesSyntheticContent={system.generates_synthetic_content}
              />
              <Button size="sm" variant="outline" className="ml-auto shrink-0" onClick={goToCompliance}>
                View results
              </Button>
            </div>
          ) : draftAssessment ? (
            <div className="flex items-start gap-3">
              <ClipboardList className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-semibold">
                  Assessment {seqIndex(draftAssessment)} is ready to be submitted
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Complete the assessment of the AI system to enable your compliance officer to issue a risk classification.
                </p>
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                  disabled={submitting}
                  onClick={() => submitToCompliance(draftAssessment)}
                >
                  {submitting ? "Submitting…" : "Submit to compliance officer"}
                </button>
              </div>
            </div>
          ) : reviewAssessment ? (
            <div className="flex items-center gap-3">
              <RefreshCw className="size-4 shrink-0 text-[var(--brand,#1147E9)]" />
              <p className="text-sm">
                Assessment under review —{" "}
                <button className="text-primary underline underline-offset-2" onClick={goToCompliance}>
                  Continue in Compliance
                </button>
              </p>
            </div>
          ) : null}
        </Card>
      </div>

      {/* Table (Fix 2 — heading, Fix 3 — column name, Fix 5 — name format, Fix 7 — progress bar, Fix 9 — buttons) */}
      <div>
        <h2 className="mb-3 text-base font-semibold">EU AI Act Assessments</h2>
        <Card className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="normal-case">Assessment</TableHead>
                <TableHead className="normal-case">Date</TableHead>
                <TableHead className="normal-case">Workflow</TableHead>
                <TableHead className="normal-case">Preliminary Risk Classification</TableHead>
                <TableHead className="normal-case">Confirmed by</TableHead>
                <TableHead className="normal-case">AI Assisted</TableHead>
                <TableHead className="normal-case">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assessments.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No assessments yet.
                  </TableCell>
                </TableRow>
              ) : assessments.map((a) => {
                const isDraft = ["draft", "questionnaire_pending"].includes(a.status);
                const isUnderReview = ["submitted", "pending_review", "under_review"].includes(a.status);
                const isApproved = a.status === "approved";
                const isInactive = a.status === "inactive";
                const progress = assessmentStepProgress(a.status);
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="text-sm font-medium">Assessment {seqIndex(a)}</div>
                      <div className="text-xs text-muted-foreground">{a.framework_id}</div>
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">
                      <FormattedDate iso={a.created_at} />
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        "text-[12px]",
                        isInactive && "text-muted-foreground",
                        isApproved && "font-medium text-[var(--success,#16a34a)]",
                      )}>
                        {assessmentStepLabel(a.status)}
                      </span>
                      {!isInactive && (
                        <div className="mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-[var(--brand,#1147E9)]"
                            style={{ width: `${(progress / 4) * 100}%` }}
                          />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {isApproved ? (
                        <TierBadge
                          tier={system.tier}
                          workflowStatus={system.workflow_status}
                          isChatbot={system.is_chatbot}
                          generatesSyntheticContent={system.generates_synthetic_content}
                        />
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {a.confirmed_by ? (
                        <div className="flex items-center gap-1.5">
                          <InitialsAvatar name={userName(a.confirmed_by, userMap)} className="size-6 text-[10px]" />
                          <span className="text-[13px]">{userName(a.confirmed_by, userMap)}</span>
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-[13px]">
                      {system.registration_mode === "ai" ? "Yes" : "No"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {isDraft && (
                          <>
                            <Button
                              size="sm"
                              className="gap-1"
                              onClick={goToCompliance}
                            >
                              <PencilLine className="size-3" /> Edit
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="size-7">
                                  <MoreVertical className="size-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => submitToCompliance(a)} disabled={submitting}>
                                  Submit to compliance officer
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={goToCompliance}>
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(a)}>
                                  <Trash2 className="size-3.5" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        )}
                        {(isUnderReview || isApproved || isInactive) && (
                          <>
                            <Button size="sm" variant="outline" onClick={goToCompliance}>
                              View results
                            </Button>
                            {!isInactive && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="size-7">
                                    <MoreVertical className="size-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {isUnderReview && (
                                    <DropdownMenuItem onSelect={() => submitToCompliance(a)} disabled={submitting}>
                                      Submit to compliance officer
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem onSelect={goToCompliance}>
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(a)}>
                                    <Trash2 className="size-3.5" /> Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete assessment?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>Assessment {deleteTarget ? seqIndex(deleteTarget) : ""}</strong>? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Files Tab ─────────────────────────────────────────────────────────────────

function docStatusLabel(doc: IndexedDocument): string {
  if (doc.status === "indexed") return "Processed";
  if (doc.status === "failed") return "Failed";
  if (doc.status === "pending") return "Pending…";
  const stageMap: Record<string, string> = {
    parsing: "Parsing document…",
    embedding: "Generating embeddings…",
    storing: "Storing chunks…",
  };
  return stageMap[doc.stage ?? ""] ?? "Processing…";
}

type FileAction = "delete" | "replace";

function FilesTab({
  system, assessments, files, onRefresh,
}: {
  system: AISystem;
  assessments: ComplianceAssessment[];
  files: IndexedDocument[];
  onRefresh: () => void;
}) {
  const showToast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<IndexedDocument | null>(null);
  const [pendingAction, setPendingAction] = useState<{ file: IndexedDocument; action: FileAction } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const impact = getFileImpact(assessments);

  const needsWarning = impact !== "none";
  const warningText = impact === "approved"
    ? "Replacing or deleting this document will reset the risk classification. The system will be marked as unclassified and a new assessment will be required."
    : "This document is used in an active assessment. Proceeding will abort the current classification progress.";

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";
    setUploading(true);
    let failed = 0;
    await Promise.all(files.map((file) =>
      api.uploadDocumentIndexed(system.id, file).catch(() => { failed++; }),
    ));
    showToast(failed === 0
      ? `${files.length} file${files.length > 1 ? "s" : ""} uploaded`
      : `${files.length - failed} uploaded, ${failed} failed`,
      failed > 0,
    );
    onRefresh();
    setUploading(false);
  }

  function initiateAction(file: IndexedDocument, action: FileAction) {
    if (!needsWarning) {
      void executeAction(file, action, null);
    } else {
      setPendingAction({ file, action });
    }
  }

  async function executeAction(file: IndexedDocument, action: FileAction, replacementFile: File | null) {
    setConfirming(true);
    try {
      // 1. Handle assessment impact first
      if (impact === "approved") {
        const approvedA = assessments.find((a) => a.status === "approved");
        if (approvedA) await api.historicizeAssessment(approvedA.id);
      } else if (impact === "submitted") {
        const submittedA = assessments.find((a) => ["submitted", "pending_review", "under_review"].includes(a.status));
        if (submittedA) await api.abortAssessment(submittedA.id);
      } else if (impact === "draft") {
        const draftA = assessments.find((a) => ["draft", "questionnaire_pending"].includes(a.status));
        if (draftA) await api.abortAssessment(draftA.id);
      }

      // 2. Upload replacement if replace action
      if (action === "replace" && replacementFile) {
        await api.uploadDocumentIndexed(system.id, replacementFile);
      }

      // 3. Delete the original file
      await api.deleteIndexedDocument(file.id);

      showToast(action === "delete" ? "File deleted" : "File replaced");
      setPendingAction(null);
      onRefresh();
    } catch (e) {
      showToast(`Operation failed: ${(e as Error).message}`, true);
    }
    setConfirming(false);
  }

  async function handleReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !pendingAction) return;
    await executeAction(pendingAction.file, "replace", file);
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    if (pendingAction.action === "replace") {
      replaceInputRef.current?.click();
      return;
    }
    await executeAction(pendingAction.file, "delete", null);
  }

  async function downloadFile(doc: IndexedDocument) {
    try {
      const { url } = await api.getDocumentDownloadUrlIndexed(doc.id);
      window.open(url, "_blank");
    } catch (e) {
      showToast(`Download failed: ${(e as Error).message}`, true);
    }
  }

  return (
    <div className="space-y-6">
      {/* Fix 1: "Important to know" heading + Fix 2: colored icons + Fix 3: Figma copy */}
      <div>
        <h2 className="mb-3 text-base font-semibold">Important to know</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="p-4">
            <ClipboardList className="mb-2 size-5 text-[var(--brand,#1147E9)]" />
            <h3 className="mb-1.5 text-sm font-semibold">Required documentation</h3>
            <p className="text-xs text-muted-foreground">
              High-risk AI systems need technical documentation, a risk management file and data governance records. Keep them here to stay audit-ready.
            </p>
          </Card>
          <Card className="p-4">
            <Sparkles className="mb-2 size-5 text-[var(--brand,#1147E9)]" />
            <h3 className="mb-1.5 text-sm font-semibold">Pre-fill your assessment</h3>
            <p className="text-xs text-muted-foreground">
              Our AI reads your uploaded files and automatically drafts answers in your compliance assessment — less manual data entry for you.
            </p>
          </Card>
          <Card className="p-4">
            <ShieldCheck className="mb-2 size-5 text-[var(--success,#16a34a)]" />
            <h3 className="mb-1.5 text-sm font-semibold">Keep information accurate</h3>
            <p className="text-xs text-muted-foreground">
              Pre-filled answers are only as good as your files. Upload the latest versions and review each AI suggestion before you confirm it.
            </p>
          </Card>
        </div>
      </div>

      {/* Fix 4: plain "Files" heading + updated subtitle, Fix 5: filled Upload button */}
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Files</h2>
            <p className="text-xs text-muted-foreground">Upload your AI System's documentation files here.</p>
          </div>
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <RefreshCw className="animate-spin size-3.5" /> : <Upload className="size-3.5" />}
            {uploading ? "Uploading…" : "Upload file"}
          </Button>
          <input ref={fileInputRef} type="file" multiple className="hidden" accept=".pdf,.docx,.md" onChange={handleUpload} />
        </div>

        <div className="flex">
          <div className={cn("min-w-0 overflow-x-auto", previewFile ? "flex-1" : "w-full")}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="normal-case">Filename</TableHead>
                  <TableHead className="normal-case">Upload Date</TableHead>
                  <TableHead className="normal-case">Version</TableHead>
                  <TableHead className="normal-case">Indexed</TableHead>
                  <TableHead className="normal-case">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      No files uploaded yet.
                    </TableCell>
                  </TableRow>
                ) : files.map((doc) => {
                  const isProcessing = doc.status === "pending" || doc.status === "processing";
                  const statusLabel = docStatusLabel(doc);
                  const ext = doc.filename.split(".").pop()?.toUpperCase() ?? "";
                  const versionLabel = doc.version_label.startsWith("v") ? doc.version_label : `v${doc.version_label}`;
                  return (
                    <TableRow
                      key={doc.id}
                      className={cn("cursor-pointer", previewFile?.id === doc.id && "bg-accent/50")}
                      onClick={() => setPreviewFile((prev) => prev?.id === doc.id ? null : doc)}
                    >
                      {/* Fix 7: filename as link, Fix 8: type below */}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <button
                              type="button"
                              className="max-w-[220px] truncate text-sm text-primary underline underline-offset-2 hover:opacity-80 text-left"
                              onClick={(e) => { e.stopPropagation(); void downloadFile(doc); }}
                            >
                              {doc.filename}
                            </button>
                            {ext && (
                              <div className="text-[11px] text-muted-foreground">{ext}</div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">
                        <FormattedDate iso={doc.created_at} />
                      </TableCell>
                      {/* Fix 9: version with "v" prefix */}
                      <TableCell className="text-[13px] text-muted-foreground">{versionLabel}</TableCell>
                      <TableCell>
                        <span className={cn(
                          "flex items-center gap-1.5 text-[12px] font-medium",
                          doc.status === "indexed" && "text-[var(--success,#16a34a)]",
                          doc.status === "failed" && "text-destructive",
                          isProcessing && "text-amber-600",
                        )}>
                          {isProcessing && <RefreshCw className="size-3 animate-spin" />}
                          {statusLabel}
                        </span>
                      </TableCell>
                      {/* Fix 7 (action buttons): outlined icon buttons */}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline" size="icon" className="size-7"
                            title="Replace"
                            onClick={() => initiateAction(doc, "replace")}
                          >
                            <RotateCcw className="size-3.5" />
                          </Button>
                          <Button
                            variant="outline" size="icon" className="size-7"
                            title="Download"
                            onClick={() => downloadFile(doc)}
                          >
                            <Download className="size-3.5" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="icon" className="size-7">
                                <MoreVertical className="size-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setPreviewFile(doc)}>
                                <Eye className="size-3.5" /> View
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => downloadFile(doc)}>
                                <Download className="size-3.5" /> Download
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onSelect={() => initiateAction(doc, "replace")}>
                                <RotateCcw className="size-3.5" /> Replace
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => initiateAction(doc, "delete")}
                              >
                                <Trash2 className="size-3.5" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Preview panel — fixed 288px, no gap because it's flush against the table wrapper */}
          {previewFile && (() => {
            // Use live data from files[] so status updates are reflected as polling runs.
            const live = files.find((f) => f.id === previewFile.id) ?? previewFile;
            const isProcessing = live.status === "pending" || live.status === "processing";
            return (
              <div className="w-72 shrink-0 border-l border-border">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <h3 className="text-sm font-semibold">Document Details</h3>
                  <Button variant="ghost" size="icon" className="size-6" onClick={() => setPreviewFile(null)}>
                    <X className="size-3.5" />
                  </Button>
                </div>
                <div className="space-y-3 p-4 text-sm">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Filename</p>
                    <p className="mt-1 break-all text-[13px]">{live.filename}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</p>
                    <p className={cn(
                      "mt-1 flex items-center gap-1.5 text-[13px] font-medium",
                      live.status === "indexed" && "text-[var(--success,#16a34a)]",
                      live.status === "failed" && "text-destructive",
                      isProcessing && "text-amber-600",
                    )}>
                      {isProcessing && <RefreshCw className="size-3 animate-spin" />}
                      {docStatusLabel(live)}
                    </p>
                  </div>
                  {live.stage && live.status === "processing" && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Current Step</p>
                      <p className="mt-1 text-[13px] capitalize">{live.stage}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Version</p>
                    <p className="mt-1 text-[13px]">{live.version_label}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Chunks extracted</p>
                    <p className="mt-1 text-[13px]">{live.chunk_count > 0 ? live.chunk_count : isProcessing ? "—" : "0"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Uploaded</p>
                    <p className="mt-1 text-[13px]">{fmtDateTime(live.created_at)}</p>
                  </div>
                  {live.indexed_at && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Processed at</p>
                      <p className="mt-1 text-[13px]">{fmtDateTime(live.indexed_at)}</p>
                    </div>
                  )}
                  {live.error && (
                    <div className="rounded-md bg-destructive/10 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-destructive">Error</p>
                      <p className="mt-1 text-[12px] text-destructive">{live.error}</p>
                    </div>
                  )}
                </div>
                <div className="border-t border-border px-4 py-3">
                  <Button size="sm" variant="outline" className="w-full" onClick={() => downloadFile(live)}>
                    <Download className="size-3.5" /> Download
                  </Button>
                </div>
              </div>
            );
          })()}
        </div>
      </Card>

      {/* Impact warning modal */}
      <Dialog open={!!pendingAction} onOpenChange={(v) => { if (!v) setPendingAction(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.action === "delete" ? "Delete" : "Replace"} document?
            </DialogTitle>
            <DialogDescription>{warningText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={confirmPendingAction} disabled={confirming}>
              {confirming ? "Processing…" : `${pendingAction?.action === "delete" ? "Delete" : "Replace"} anyway`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <input
        ref={replaceInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.docx,.md"
        onChange={handleReplaceFile}
      />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SystemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const showToast = useToast();
  const { mayWrite, mayApprove, username } = useModalControls();

  // Save current path to sessionStorage so a browser refresh can restore it.
  // The cleanup runs on normal navigation away (but NOT on page refresh), so
  // it's only present in sessionStorage if the user actually refreshed.
  useEffect(() => {
    if (!id) return;
    sessionStorage.setItem("lastSystemPath", `/systems/${id}`);
    return () => sessionStorage.removeItem("lastSystemPath");
  }, [id]);

  const [system, setSystem] = useState<AISystem | null>(null);
  const [loading, setLoading] = useState(true);
  const [assessments, setAssessments] = useState<ComplianceAssessment[]>([]);
  const [files, setFiles] = useState<IndexedDocument[]>([]);
  const [userMap, setUserMap] = useState<UserMap>({});
  const [allUsers, setAllUsers] = useState<AllUser[]>([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [rolesOpen, setRolesOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const loadAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [sys, assm, docs, users] = await Promise.all([
        api.getSystem(id),
        api.getAssessmentsForSystem(id).catch(() => [] as ComplianceAssessment[]),
        api.listIndexedDocuments(id).catch(() => [] as IndexedDocument[]),
        api.getAllUsers().catch(() => []),
      ]);
      setSystem(sys);
      setAssessments(assm);
      setFiles(docs);
      const map: UserMap = {};
      const allU: AllUser[] = [];
      for (const u of users) {
        map[u.username] = { firstName: u.firstName, lastName: u.lastName };
        allU.push({ username: u.username, firstName: u.firstName, lastName: u.lastName, role: u.role });
      }
      setUserMap(map);
      setAllUsers(allU);
    } catch (e) {
      showToast(`Failed to load system: ${(e as Error).message}`, true);
    }
    setLoading(false);
  }, [id, showToast]);

  const refreshAssessmentsAndFiles = useCallback(async () => {
    if (!id) return;
    const [assm, docs] = await Promise.all([
      api.getAssessmentsForSystem(id).catch(() => [] as ComplianceAssessment[]),
      api.listIndexedDocuments(id).catch(() => [] as IndexedDocument[]),
    ]);
    setAssessments(assm);
    setFiles(docs);
  }, [id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Poll every 3s while any file is still being processed.
  useEffect(() => {
    const hasActive = files.some((f) => f.status === "pending" || f.status === "processing");
    if (!hasActive || !id) return;
    const t = setInterval(async () => {
      const docs = await api.listIndexedDocuments(id).catch(() => null);
      if (docs) setFiles(docs);
    }, 3000);
    return () => clearInterval(t);
  }, [files, id]);

  async function confirmDelete() {
    if (!system) return;
    setDeleting(true);
    try {
      await api.deleteSystem(system.id);
      void api.deleteIndexedDocumentsForSystem(system.id).catch(() => {});
      showToast("System deleted");
      navigate("/systems");
    } catch (e) {
      showToast(`Delete failed: ${(e as Error).message}`, true);
    }
    setDeleting(false);
  }

  function canDelete(): boolean {
    return mayApprove || (isSystemOwner && mayWrite && system?.workflow_status === "draft");
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <RefreshCw className="animate-spin" />
      </div>
    );
  }

  if (!system) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <File className="size-8" />
        <p>System not found</p>
        <Button variant="outline" onClick={() => navigate("/systems")}>Back to systems</Button>
      </div>
    );
  }

  const ownerName = userName(system.business_owners, userMap);
  const isSystemOwner = username === system.business_owners;
  const members = [...new Set([
    system.business_owners,
    ...(system.contributors ?? []),
  ].filter((u): u is string => !!u))];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4">
        {/* Breadcrumb */}
        <button
          type="button"
          className="mb-3 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => navigate("/systems")}
        >
          <Home className="size-3.5" />
          <ChevronLeft className="size-3 -mx-0.5" />
          AI Systems Registry
        </button>

        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold">{system.name}</h1>
              <TierBadge
                tier={system.tier}
                workflowStatus={system.workflow_status}
                isChatbot={system.is_chatbot}
                generatesSyntheticContent={system.generates_synthetic_content}
              />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Hash className="size-3" />{system.id}</span>
              <span>Created by: {ownerName}</span>
              <span className="flex items-center gap-1"><CalendarDays className="size-3" />Updated: {fmtDateTime(system.updated_at)}</span>
            </p>
          </div>

          {/* Avatar cluster → roles dialog */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex -space-x-2 hover:opacity-80"
              title="Manage roles"
              onClick={() => setRolesOpen(true)}
            >
              {members.slice(0, 3).map((u) => (
                <InitialsAvatar key={u} name={userName(u, userMap)} className="size-7 ring-2 ring-background" />
              ))}
              {members.length > 3 && (
                <div className="flex size-7 items-center justify-center rounded-full bg-muted ring-2 ring-background text-[10px] font-medium">
                  +{members.length - 3}
                </div>
              )}
            </button>

            <Button
              size="sm" variant="outline"
              onClick={() => { setActiveTab("overview"); setEditMode(true); }}
            >
              Edit details
            </Button>

            <Button size="sm" onClick={() => startRiskClassification(system.id)}>
              Start new assessment
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-8">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => startRiskClassification(system.id)}>
                  Start assessment
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setRolesOpen(true)}>
                  Manage roles
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!canDelete()}
                  onSelect={() => setDeleteOpen(true)}
                >
                  <Trash2 className="size-3.5" /> Delete system
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 py-5">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-5">
            <TabsTrigger value="overview" className="flex items-center gap-1.5">
              <LayoutGrid className="size-3.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="assessments" className="flex items-center gap-1.5">
              <ClipboardList className="size-3.5" /> Assessments
              {assessments.length > 0 && (
                <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                  {assessments.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="files" className="flex items-center gap-1.5">
              <FolderOpen className="size-3.5" /> Files
              {files.length > 0 && (
                <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                  {files.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab
              system={system}
              assessments={assessments}
              userMap={userMap}
              onSystemUpdate={(updated) => { setSystem(updated); }}
              onFilesRefresh={refreshAssessmentsAndFiles}
              editMode={editMode}
              onEditModeChange={setEditMode}
            />
          </TabsContent>

          <TabsContent value="assessments">
            <AssessmentsTab
              system={system}
              assessments={assessments}
              userMap={userMap}
              onRefresh={refreshAssessmentsAndFiles}
            />
          </TabsContent>

          <TabsContent value="files">
            <FilesTab
              system={system}
              assessments={assessments}
              files={files}
              onRefresh={refreshAssessmentsAndFiles}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Roles dialog */}
      {system && (
        <RolesDialog
          open={rolesOpen}
          system={system}
          allUsers={allUsers}
          currentUsername={username}
          onClose={() => setRolesOpen(false)}
          onSaved={(updated) => { setSystem(updated); }}
        />
      )}

      {/* Delete system confirm */}
      <Dialog open={deleteOpen} onOpenChange={(v) => { if (!v) setDeleteOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {system.name}?</DialogTitle>
            <DialogDescription>This action cannot be undone. The system is permanently removed from the registry.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
