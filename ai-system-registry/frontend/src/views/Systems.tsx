import { useState, useEffect, useCallback, useMemo } from "react";
import { Eye, Trash2, RefreshCw, Sparkles, ClipboardList } from "lucide-react";
import { TierBadge, LifecycleBadge, ComplianceBar, FormattedDate } from "../components/Badges";
import SystemDetail from "../components/SystemDetail";
import type { UserMap } from "../components/SystemDetail";
import RegisterWizard from "../components/RegisterWizard";
import RegisterModeChooser from "../components/RegisterModeChooser";
import EngineerAssistedRegistration from "../components/EngineerAssistedRegistration";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import { SELECT_CLASS } from "../utils";
import type { AISystem, ModelCard } from "../types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  business_pending: "Business Review",
  technical_pending: "Technical Review",
  pending_review: "Compliance Review",
  info_requested: "Information Requested",
  approved: "Approved",
  rejected: "Rejected",
};

export default function Systems() {
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [models, setModels] = useState<ModelCard[]>([]);
  const [userMap, setUserMap] = useState<UserMap>({});
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("");
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [selectedSystem, setSelectedSystem] = useState<AISystem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [fillInSystem, setFillInSystem] = useState<AISystem | undefined>(undefined);
  const [engineerStage, setEngineerStage] = useState<"chooser" | "manual" | "assisted">("chooser");
  const { wizardOpen, setWizardOpen, mayRegister, username } = useModalControls();
  const showToast = useToast();

  useEffect(() => {
    if (wizardOpen && fillInSystem) setEngineerStage("chooser");
  }, [wizardOpen, fillInSystem]);

  function closeWizard() {
    setWizardOpen(false);
    setFillInSystem(undefined);
    setEngineerStage("chooser");
  }

  const loadSystems = useCallback(async () => {
    try {
      const data = await api.getSystems();
      setSystems(data);
    } catch (e) {
      showToast(`Failed to load systems: ${(e as Error).message}`, true);
    }
  }, [showToast]);

  const loadModels = useCallback(async () => {
    try {
      const data = await api.getModels();
      setModels(data);
    } catch (e) {
      showToast(`Failed to load model catalog: ${(e as Error).message}`, true);
    }
  }, [showToast]);

  useEffect(() => {
    Promise.all([
      api.getUsersByRole("ai_engineer").catch(() => []),
      api.getUsersByRole("ai_compliance_officer").catch(() => []),
      api.getUsersByRole("business_owner").catch(() => []),
    ]).then(([engineers, cos, biz]) => {
      const map: UserMap = {};
      for (const u of [...engineers, ...cos, ...biz]) {
        map[u.username] = { firstName: u.firstName, lastName: u.lastName };
      }
      setUserMap(map);
    });
  }, []);

  useEffect(() => { loadSystems(); loadModels(); }, [loadSystems, loadModels]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return systems.filter((sys) => {
      const matchSearch = !s || sys.name.toLowerCase().includes(s) ||
        sys.id.toLowerCase().includes(s) || (sys.provider || "").toLowerCase().includes(s);
      const matchTier = !tierFilter || sys.tier === tierFilter;
      const matchLc = !lifecycleFilter || sys.lifecycle === lifecycleFilter;
      const matchWf = !workflowFilter || sys.workflow_status === workflowFilter;
      return matchSearch && matchTier && matchLc && matchWf;
    });
  }, [systems, search, tierFilter, lifecycleFilter, workflowFilter]);

  function modelName(modelId: string | null) {
    const m = models.find((x) => x.id === modelId);
    return m ? m.name : modelId;
  }

  async function openSystem(s: AISystem) {
    const isAssignee = username && s.assignee_username === username;
    if (isAssignee && s.workflow_status === "rejected") {
      try {
        const fresh = await api.getSystem(s.id);
        setFillInSystem(fresh);
        setWizardOpen(true);
      } catch (e) {
        showToast(`Failed to load system: ${(e as Error).message}`, true);
      }
      return;
    }
    try {
      const fresh = await api.getSystem(s.id);
      setSelectedSystem(fresh);
      setDetailOpen(true);
    } catch (e) {
      showToast(`Failed to load system: ${(e as Error).message}`, true);
    }
  }

  function workflowStatusBadge(status: string) {
    const colors: Record<string, string> = {
      draft: "bg-[#8a9bb0]",
      business_pending: "bg-[#7b5ea7]",
      technical_pending: "bg-[#2980b9]",
      pending_review: "bg-[#e67e22]",
      info_requested: "bg-[#d35400]",
      approved: "bg-[#27ae60]",
      rejected: "bg-[#c0392b]",
    };
    return (
      <Badge className={cn("rounded-full text-white", colors[status] || "bg-[#8a9bb0]")}>
        {WORKFLOW_STATUS_LABELS[status] || status}
      </Badge>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-6 py-3">
        <Input type="text" className="w-56" placeholder="Search systems…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={cn(SELECT_CLASS, "w-auto")} value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
          <option value="">All Risk Tiers</option>
          <option value="prohibited">Prohibited</option>
          <option value="high">High-Risk</option>
          <option value="gpai-systemic">GPAI Systemic</option>
          <option value="gpai-standard">GPAI Standard</option>
          <option value="limited">Limited</option>
          <option value="minimal">Minimal</option>
          <option value="pending">Pending</option>
        </select>
        <select className={cn(SELECT_CLASS, "w-auto")} value={lifecycleFilter} onChange={(e) => setLifecycleFilter(e.target.value)}>
          <option value="">All Lifecycle States</option>
          <option value="development">Development</option>
          <option value="testing">Testing</option>
          <option value="conformity">Conformity</option>
          <option value="market">On Market</option>
          <option value="post-market">Post-Market</option>
          <option value="decommissioned">Decommissioned</option>
        </select>
        <select className={cn(SELECT_CLASS, "w-auto")} value={workflowFilter} onChange={(e) => setWorkflowFilter(e.target.value)}>
          <option value="">All Workflow States</option>
          <option value="draft">Draft</option>
          <option value="business_pending">Business Review</option>
          <option value="technical_pending">Technical Review</option>
          <option value="pending_review">Compliance Review</option>
          <option value="info_requested">Information Requested</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <div className="flex-1" />
        <Button variant="ghost" onClick={loadSystems}><RefreshCw /> Refresh</Button>
      </div>

      <div className="px-6 py-5">
        <Card className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>System</TableHead>
                <TableHead>Workflow</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Risk Tier</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>Compliance</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    {systems.length === 0 ? 'No systems registered yet. Click "Register System" to add one.' : "No systems match the current filters."}
                  </TableCell>
                </TableRow>
              ) : filtered.map((s) => (
                <TableRow key={s.id} onClick={() => openSystem(s)} className="cursor-pointer">
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.id} · v{s.version || "1.0.0"}
                      {s.model_id && <> · <span className="text-[var(--brand)]">{modelName(s.model_id)}</span></>}
                    </div>
                  </TableCell>
                  <TableCell>{workflowStatusBadge(s.workflow_status)}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {s.assignee_username ? (
                      <span title={s.assignee_username} className="flex items-center gap-1.5">
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-[10px] font-bold text-white">
                          {(() => {
                            const u = userMap[s.assignee_username];
                            if (u?.firstName && u?.lastName) return (u.firstName[0] + u.lastName[0]).toUpperCase();
                            if (u?.firstName) return u.firstName.slice(0, 2).toUpperCase();
                            return s.assignee_username.slice(0, 2).toUpperCase();
                          })()}
                        </span>
                        {(() => {
                          const u = userMap[s.assignee_username];
                          const full = [u?.firstName, u?.lastName].filter(Boolean).join(" ");
                          return full || s.assignee_username;
                        })()}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell><TierBadge tier={s.tier} workflowStatus={s.workflow_status} /></TableCell>
                  <TableCell><LifecycleBadge lc={s.lifecycle} /></TableCell>
                  <TableCell><ComplianceBar pct={s.compliance} /></TableCell>
                  <TableCell className="text-[13px] text-muted-foreground"><FormattedDate iso={s.created_at} /></TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="size-8" title="Details" onClick={() => openSystem(s)}>
                        <Eye />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-[var(--danger-fg)]"
                        title={mayRegister ? "Delete" : "Requires role: business owner or administrator"}
                        disabled={!mayRegister}
                        onClick={async () => {
                          if (!confirm(`Delete "${s.name}"?\n\nThis action cannot be undone.`)) return;
                          try {
                            await api.deleteSystem(s.id);
                            showToast("System deleted");
                            loadSystems();
                          } catch (e) {
                            showToast(`Delete failed: ${(e as Error).message}`, true);
                          }
                        }}
                      ><Trash2 /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Owner: simple registration wizard (name + description only) */}
      <RegisterWizard
        open={wizardOpen && !fillInSystem}
        onClose={closeWizard}
        onSuccess={() => { loadSystems(); loadModels(); }}
      />

      {/* Engineer: choose AI-assisted vs manual */}
      <RegisterModeChooser
        open={wizardOpen && !!fillInSystem && engineerStage === "chooser"}
        onClose={closeWizard}
        title="Complete Technical Registration"
        options={[
          {
            key: "assisted",
            icon: <Sparkles className="size-5" />,
            iconClass: "bg-[var(--brand)]/10 text-[var(--brand)]",
            title: "AI-Assisted",
            description: "Upload a model card or technical spec and let the assistant extract the details. Review and confirm each field before submitting.",
            onClick: () => setEngineerStage("assisted"),
          },
          {
            key: "manual",
            icon: <ClipboardList className="size-5" />,
            title: "Manual",
            description: "Fill in the technical details and risk flags manually using the step-by-step form.",
            onClick: () => setEngineerStage("manual"),
          },
        ]}
      />

      {/* Engineer: AI-assisted technical flow */}
      <EngineerAssistedRegistration
        open={wizardOpen && !!fillInSystem && engineerStage === "assisted"}
        system={fillInSystem!}
        onClose={closeWizard}
        onSuccess={() => { loadSystems(); loadModels(); closeWizard(); }}
      />

      {/* Engineer: classic manual wizard */}
      <RegisterWizard
        open={wizardOpen && !!fillInSystem && engineerStage === "manual"}
        system={fillInSystem}
        onClose={closeWizard}
        onSuccess={() => { loadSystems(); loadModels(); }}
      />

      <SystemDetail
        open={detailOpen}
        system={selectedSystem}
        models={models}
        userMap={userMap}
        onClose={() => setDetailOpen(false)}
        onDelete={() => { setDetailOpen(false); loadSystems(); }}
        onUpdate={(updated) => {
          setSelectedSystem(updated);
          loadSystems();
        }}
      />
    </>
  );
}
