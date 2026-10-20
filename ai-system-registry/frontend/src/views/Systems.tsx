import { useState, useEffect, useCallback, useMemo } from "react";
import { Eye, Trash2, RefreshCw, MoreVertical, Play, ArrowRight, ChevronDown, Search } from "lucide-react";
import LuigiClient from "@luigi-project/client";
import { TierBadge, FormattedDate } from "../components/Badges";
import SystemDetail from "../components/SystemDetail";
import type { UserMap } from "../components/SystemDetail";
import RegisterModal from "../components/RegisterModal";
import InitialsAvatar from "../components/InitialsAvatar";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import { ORG_ROLE_LABELS } from "../constants/orgRoles";
import type { AISystem, ModelCard, AssessmentRow, AssessmentAction, OrgRole } from "../types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const EU_AI_ACT_ID = "FRM-EU-AI-ACT";

// Only "start" hands a system off to the compliance create-assessment modal via
// the localStorage flag the compliance MFE consumes. "continue"/"view" must NOT
// set the flag (that flag only ever opens the create modal), so they navigate to
// the plain assessments list. True per-system pre-filtering needs a follow-up on
// the compliance MFE (out of scope for #312).
function goToAssessments(systemId: string, action: AssessmentAction) {
  if (action === "start") {
    localStorage.setItem("compliance.pendingAssessment", JSON.stringify({ systemId, frameworkId: EU_AI_ACT_ID }));
  }
  LuigiClient.linkManager().navigate("/home/assessments");
}

const ACTION_LABEL: Record<AssessmentAction, string> = {
  start: "Start assessment",
  continue: "Continue assessment",
  view: "View assessment",
};

// Hardcoded filter option lists — per issue #312 these mirror the spec exactly
// rather than the backend enums. GPAI tiers are intentionally absent from the
// risk filter; "TBD"/"Product manufacturer" have no backend org_role, so their
// sentinel values never match a real row (by design — they filter to nothing).
const RISK_OPTIONS: { label: string; value: string }[] = [
  { label: "Pending", value: "pending" },
  { label: "Prohibited practice", value: "prohibited" },
  { label: "High risk", value: "high" },
  { label: "Transparency Obligations", value: "limited" },
  { label: "Minimal or No Risk", value: "minimal" },
];
const ROLE_OPTIONS: { label: string; value: string }[] = [
  { label: "TBD", value: "__tbd__" },
  { label: "Provider", value: "provider" },
  { label: "Deployer", value: "deployer" },
  { label: "Distributor", value: "distributor" },
  { label: "Importer", value: "importer" },
  { label: "Product manufacturer", value: "__product_manufacturer__" },
  { label: "Authorised representative", value: "authorised_representative" },
];

// ── OPEN ITEM (issue #312): "Owner / Created By" field source is undecided. ──
// There is no created_by column. Defaulting to business_owners (a username
// resolved to a full name via userMap). The Owner column, the Owner filter and
// the owner search all route through ownerKey/ownerLabel, so switching to a
// different field later is a one-line change here.
function ownerKey(s: AISystem): string {
  return s.business_owners ?? "";
}

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function filterLabel(defaultLabel: string, sel: Set<string>, options: { label: string; value: string }[]): string {
  if (sel.size === 0) return defaultLabel;
  if (sel.size === 1) return options.find((o) => o.value === [...sel][0])?.label ?? defaultLabel;
  return `${defaultLabel} (${sel.size})`;
}

function RoleBadge({ role }: { role: OrgRole }) {
  const cls =
    role === "provider" ? "bg-[#e8f0fb] text-[#1147E9]"
    : role === "deployer" ? "bg-[#d5f5e3] text-[#1a5c35]"
    : "bg-[#eaecee] text-[#556b82]";
  // Drop the article reference (e.g. "Provider (Art. 3(3))" → "Provider") for the compact table badge.
  const label = (ORG_ROLE_LABELS[role] ?? role).replace(/\s*\(.*\)\s*$/, "");
  return <Badge className={cn("rounded-full font-medium", cls)}>{label}</Badge>;
}

export default function Systems() {
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [models, setModels] = useState<ModelCard[]>([]);
  const [userMap, setUserMap] = useState<UserMap>({});
  const [assessmentsBySystem, setAssessmentsBySystem] = useState<Record<string, AssessmentRow[]>>({});
  const [search, setSearch] = useState("");
  const [riskSel, setRiskSel] = useState<Set<string>>(new Set());
  const [roleSel, setRoleSel] = useState<Set<string>>(new Set());
  const [ownerSel, setOwnerSel] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSystem, setSelectedSystem] = useState<AISystem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AISystem | null>(null);
  const { wizardOpen, setWizardOpen, mayWrite, mayApprove } = useModalControls();
  const showToast = useToast();

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [sys, assessments, allUsers, mdls] = await Promise.all([
        api.getSystems(),
        api.getAllAssessments().catch(() => [] as AssessmentRow[]),
        api.getAllUsers().catch(() => []),
        api.getModels().catch(() => [] as ModelCard[]),
      ]);
      setSystems(sys);
      setModels(mdls);
      const map: UserMap = {};
      for (const u of allUsers) map[u.username] = { firstName: u.firstName, lastName: u.lastName };
      setUserMap(map);
      const byId: Record<string, AssessmentRow[]> = {};
      for (const row of assessments) (byId[row.ai_system_id] ??= []).push(row);
      setAssessmentsBySystem(byId);
    } catch (e) {
      showToast(`Failed to load systems: ${(e as Error).message}`, true);
    } finally {
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const ownerLabel = useCallback((s: AISystem) => {
    const key = ownerKey(s);
    if (!key) return "—";
    const u = userMap[key];
    const full = [u?.firstName, u?.lastName].filter(Boolean).join(" ");
    return full || key;
  }, [userMap]);

  const ownerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of systems) {
      const k = ownerKey(s);
      if (k && !seen.has(k)) seen.set(k, ownerLabel(s));
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [systems, ownerLabel]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return systems.filter((s) => {
      const matchSearch = !q || s.name.toLowerCase().includes(q) || ownerLabel(s).toLowerCase().includes(q);
      const matchRisk = riskSel.size === 0 || riskSel.has(s.tier);
      const matchRole = roleSel.size === 0 || roleSel.has(s.org_role);
      const matchOwner = ownerSel.size === 0 || ownerSel.has(ownerKey(s));
      return matchSearch && matchRisk && matchRole && matchOwner;
    });
  }, [systems, search, riskSel, roleSel, ownerSel, ownerLabel]);

  function assessmentAction(systemId: string): AssessmentAction {
    const rows = assessmentsBySystem[systemId] ?? [];
    if (rows.length === 0) return "start";
    if (rows.some((r) => r.status === "approved")) return "view";
    return "continue";
  }

  async function openSystem(s: AISystem) {
    try {
      const fresh = await api.getSystem(s.id);
      setSelectedSystem(fresh);
      setDetailOpen(true);
    } catch (e) {
      showToast(`Failed to load system: ${(e as Error).message}`, true);
    }
  }

  function canDelete(s: AISystem): boolean {
    return mayApprove || (mayWrite && s.workflow_status === "draft");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await api.deleteSystem(deleteTarget.id);
      showToast("System deleted");
      setDeleteTarget(null);
      loadAll();
    } catch (e) {
      showToast(`Delete failed: ${(e as Error).message}`, true);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-6 py-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            className="w-full pl-9"
            placeholder="Search by system name or owner name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1" />

        <FilterDropdown
          label={filterLabel("All Risk Classifications", riskSel, RISK_OPTIONS)}
          options={RISK_OPTIONS}
          selected={riskSel}
          onToggle={(v) => setRiskSel((s) => toggle(s, v))}
        />
        <FilterDropdown
          label={filterLabel("All Organisation Roles", roleSel, ROLE_OPTIONS)}
          options={ROLE_OPTIONS}
          selected={roleSel}
          onToggle={(v) => setRoleSel((s) => toggle(s, v))}
        />
        <FilterDropdown
          label={filterLabel("All Owners", ownerSel, ownerOptions)}
          options={ownerOptions}
          selected={ownerSel}
          onToggle={(v) => setOwnerSel((s) => toggle(s, v))}
        />

        <Button variant="ghost" onClick={loadAll} disabled={refreshing}>
          <RefreshCw className={cn(refreshing && "animate-spin")} /> Refresh
        </Button>
      </div>

      <div className="px-6 py-5">
        <Card className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="normal-case">System Name</TableHead>
                <TableHead className="normal-case">Owner / Created By</TableHead>
                <TableHead className="normal-case">Risk Classification</TableHead>
                <TableHead className="normal-case">Organisation Role</TableHead>
                <TableHead className="normal-case">Registration Date</TableHead>
                <TableHead className="normal-case">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    {systems.length === 0 ? 'No systems registered yet. Click "Register System" to add one.' : "No systems match the current filters."}
                  </TableCell>
                </TableRow>
              ) : filtered.map((s) => {
                const action = assessmentAction(s.id);
                return (
                  <TableRow key={s.id} onClick={() => openSystem(s)} className="cursor-pointer">
                    <TableCell>
                      <div className="font-medium underline underline-offset-2">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.id} · v{s.version}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <InitialsAvatar name={ownerLabel(s)} />
                        <span className="text-[13px]">{ownerLabel(s)}</span>
                      </div>
                    </TableCell>
                    <TableCell><TierBadge tier={s.tier} workflowStatus={s.workflow_status} /></TableCell>
                    <TableCell>{s.org_role ? <RoleBadge role={s.org_role} /> : <span className="text-[13px] text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-[13px] text-muted-foreground"><FormattedDate iso={s.created_at} /></TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="icon" className="size-8" title="View details" onClick={() => openSystem(s)}>
                          <Eye />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" className="size-8" title="More actions">
                              <MoreVertical />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => goToAssessments(s.id, action)}>
                              {action === "start" ? <Play /> : <ArrowRight />}
                              {ACTION_LABEL[action]}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={!canDelete(s)}
                              onSelect={() => setDeleteTarget(s)}
                            >
                              <Trash2 /> Delete system
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
        </Card>
      </div>

      <RegisterModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={() => { loadAll(); }}
      />

      <SystemDetail
        open={detailOpen}
        system={selectedSystem}
        models={models}
        userMap={userMap}
        onClose={() => setDetailOpen(false)}
        onDelete={() => { setDetailOpen(false); loadAll(); }}
        onUpdate={(updated) => {
          setSelectedSystem(updated);
          loadAll();
        }}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>This action cannot be undone. The system is permanently removed from the registry.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FilterDropdown({
  label, options, selected, onToggle,
}: {
  label: string;
  options: { label: string; value: string }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-1">
          {label} <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        {options.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No options</div>
        ) : options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={selected.has(o.value)}
            onCheckedChange={() => onToggle(o.value)}
            onSelect={(e) => e.preventDefault()}
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
