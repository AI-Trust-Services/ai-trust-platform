import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useSearchParams, useNavigate } from "react-router";
import {
  Plus, Search, Filter, ChevronRight, ChevronDown, List, Grid3x3,
  BarChart3, Database
} from "lucide-react";
import SystemDetail from "../components/SystemDetail";
import type { UserMap } from "../components/SystemDetail";
import RegisterWizard from "../components/RegisterWizard";
import RegisterModeChooser from "../components/RegisterModeChooser";
import AssistedRegistration from "../components/AssistedRegistration";
import EngineerAssistedRegistration from "../components/EngineerAssistedRegistration";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import type { AISystem, ModelCard } from "../types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Lifecycle stage configuration
const LIFECYCLE_STAGES = [
  { key: "register", label: "Register", color: "bg-blue-500" },
  { key: "review", label: "Review", color: "bg-purple-500" },
  { key: "classify", label: "Classify", color: "bg-orange-500" },
  { key: "comply", label: "Comply", color: "bg-cyan-500" },
  { key: "operate", label: "Operate", color: "bg-green-500" },
];

// Map backend lifecycle values to our stages
function getLifecycleStage(lifecycle: string): { stage: string; index: number } {
  const mapping: Record<string, { stage: string; index: number }> = {
    development: { stage: "register", index: 0 },
    testing: { stage: "review", index: 1 },
    conformity: { stage: "classify", index: 2 },
    market: { stage: "comply", index: 3 },
    "post-market": { stage: "operate", index: 4 },
    decommissioned: { stage: "operate", index: 4 },
  };
  return mapping[lifecycle] || { stage: "register", index: 0 };
}

// Risk level badge component
function RiskBadge({ level }: { level: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    high: { bg: "bg-red-100", text: "text-red-700", label: "High" },
    "gpai-systemic": { bg: "bg-red-100", text: "text-red-700", label: "High" },
    prohibited: { bg: "bg-red-100", text: "text-red-700", label: "Prohibited" },
    medium: { bg: "bg-orange-100", text: "text-orange-700", label: "Medium" },
    "gpai-standard": { bg: "bg-orange-100", text: "text-orange-700", label: "Medium" },
    limited: { bg: "bg-orange-100", text: "text-orange-700", label: "Medium" },
    low: { bg: "bg-green-100", text: "text-green-700", label: "Low" },
    minimal: { bg: "bg-green-100", text: "text-green-700", label: "Low" },
  };
  const c = config[level] || config.low;
  return (
    <Badge className={cn("border-0 font-medium", c.bg, c.text)}>
      {c.label}
    </Badge>
  );
}

// Lifecycle progress indicator
function LifecycleProgress({ lifecycle }: { lifecycle: string }) {
  const { stage, index } = getLifecycleStage(lifecycle);
  const stageConfig = LIFECYCLE_STAGES[index];

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        <span className={cn("size-2 rounded-full", stageConfig.color)} />
        <span className="text-xs font-medium uppercase tracking-wide">
          {stageConfig.label}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        {LIFECYCLE_STAGES.map((s, i) => (
          <div
            key={s.key}
            className={cn(
              "size-1.5 rounded-full",
              i <= index ? stageConfig.color : "bg-muted"
            )}
          />
        ))}
      </div>
    </div>
  );
}

// System row component
interface SystemRowProps {
  system: AISystem;
  userMap: UserMap;
  onClick: () => void;
}

function SystemRow({ system, userMap, onClick }: SystemRowProps) {
  const owner = userMap[system.owner_username || ""] || {};
  const ownerName = [owner.firstName, owner.lastName].filter(Boolean).join(" ") || system.owner_username || "—";
  const ownerInitials = owner.firstName && owner.lastName
    ? (owner.firstName[0] + owner.lastName[0]).toUpperCase()
    : (system.owner_username || "?").slice(0, 2).toUpperCase();

  // Map tier to risk level for display
  const riskLevel = ["high", "gpai-systemic", "prohibited"].includes(system.tier)
    ? "high"
    : ["limited", "gpai-standard"].includes(system.tier)
      ? "medium"
      : "low";

  // Open tasks - placeholder until real task data is available
  // TODO: Replace with actual task count from backend when task API is implemented
  const openTasks: number | null = null;

  // Format date
  const lastUpdated = new Date(system.updated_at || system.created_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // Get icon based on system type (mock based on name)
  const getSystemIcon = () => {
    const name = system.name.toLowerCase();
    if (name.includes("talent") || name.includes("recruit")) return "👥";
    if (name.includes("schedule") || name.includes("meeting")) return "📅";
    if (name.includes("safety") || name.includes("watch")) return "🛡️";
    if (name.includes("market") || name.includes("content")) return "✨";
    if (name.includes("customer") || name.includes("support")) return "💬";
    if (name.includes("bio") || name.includes("identity")) return "🔐";
    if (name.includes("insight") || name.includes("analytics")) return "📊";
    if (name.includes("policy") || name.includes("compliance")) return "✓";
    return "🤖";
  };

  return (
    <div
      className="flex cursor-pointer items-center gap-4 border-b border-border px-4 py-3 transition-colors hover:bg-muted/30"
      onClick={onClick}
    >
      {/* AI System */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">
          {getSystemIcon()}
        </div>
        <div className="min-w-0">
          <div className="font-medium">{system.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {system.description || system.provider || "AI System"}
          </div>
        </div>
      </div>

      {/* Use Case */}
      <div className="w-44 shrink-0 text-sm text-muted-foreground">
        {system.use_case || system.intended_use || "—"}
      </div>

      {/* Lifecycle Stage */}
      <div className="w-32 shrink-0">
        <LifecycleProgress lifecycle={system.lifecycle} />
      </div>

      {/* Owner */}
      <div className="flex w-36 shrink-0 items-center gap-2">
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
            {ownerInitials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-sm">{ownerName}</div>
        </div>
      </div>

      {/* Risk Level */}
      <div className="w-20 shrink-0">
        <RiskBadge level={riskLevel} />
      </div>

      {/* Open Tasks */}
      <div className="w-20 shrink-0 text-center">
        <Badge variant="secondary" className="text-xs">
          {openTasks !== null ? openTasks : "—"}
        </Badge>
      </div>

      {/* Last Updated */}
      <div className="w-28 shrink-0 text-xs text-muted-foreground">
        {lastUpdated}
      </div>

      {/* Arrow */}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

export default function Systems() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [models, setModels] = useState<ModelCard[]>([]);
  const [userMap, setUserMap] = useState<UserMap>({});
  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [businessUnitFilter, setBusinessUnitFilter] = useState("all");
  const [sortBy, setSortBy] = useState("updated");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [selectedSystem, setSelectedSystem] = useState<AISystem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [fillInSystem, setFillInSystem] = useState<AISystem | undefined>(undefined);
  const [ownerStage, setOwnerStage] = useState<"chooser" | "manual" | "assisted">("chooser");
  const [engineerStage, setEngineerStage] = useState<"chooser" | "manual" | "assisted">("chooser");
  const { wizardOpen, setWizardOpen, mayRegister, username } = useModalControls();
  const showToast = useToast();

  // Handle ?register=true query param to auto-open registration
  useEffect(() => {
    if (searchParams.get("register") === "true" && mayRegister) {
      setWizardOpen(true);
      // Clear the query param
      setSearchParams({});
    }
  }, [searchParams, mayRegister, setWizardOpen, setSearchParams]);

  useEffect(() => {
    if (wizardOpen && !fillInSystem) setOwnerStage("chooser");
    if (wizardOpen && fillInSystem) setEngineerStage("chooser");
  }, [wizardOpen, fillInSystem]);

  function closeWizard() {
    setWizardOpen(false);
    setFillInSystem(undefined);
    setOwnerStage("chooser");
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
    ]).then(([engineers, cos, owners]) => {
      const map: UserMap = {};
      for (const u of [...engineers, ...cos, ...owners]) {
        map[u.username] = { firstName: u.firstName, lastName: u.lastName };
      }
      setUserMap(map);
    });
  }, []);

  useEffect(() => {
    loadSystems();
    loadModels();
  }, [loadSystems, loadModels]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    let result = systems.filter((sys) => {
      const matchSearch = !s || sys.name.toLowerCase().includes(s) ||
        sys.id.toLowerCase().includes(s) || (sys.provider || "").toLowerCase().includes(s);
      const matchLifecycle = lifecycleFilter === "all" || sys.lifecycle === lifecycleFilter;
      const matchRisk = riskFilter === "all" ||
        (riskFilter === "high" && ["high", "gpai-systemic", "prohibited"].includes(sys.tier)) ||
        (riskFilter === "medium" && ["limited", "gpai-standard"].includes(sys.tier)) ||
        (riskFilter === "low" && ["minimal"].includes(sys.tier));
      return matchSearch && matchLifecycle && matchRisk;
    });

    // Sort
    if (sortBy === "updated") {
      result.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
    } else if (sortBy === "name") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "risk") {
      const riskOrder = { prohibited: 0, high: 1, "gpai-systemic": 2, "gpai-standard": 3, limited: 4, minimal: 5 };
      result.sort((a, b) => (riskOrder[a.tier as keyof typeof riskOrder] ?? 5) - (riskOrder[b.tier as keyof typeof riskOrder] ?? 5));
    }

    return result;
  }, [systems, search, lifecycleFilter, riskFilter, sortBy]);

  // Portfolio summary stats
  const stats = useMemo(() => {
    const byLifecycle: Record<string, number> = {
      register: 0, review: 0, classify: 0, comply: 0, operate: 0,
    };
    const byRisk: Record<string, number> = { high: 0, medium: 0, low: 0 };

    systems.forEach((sys) => {
      const { stage } = getLifecycleStage(sys.lifecycle);
      byLifecycle[stage] = (byLifecycle[stage] || 0) + 1;

      if (["high", "gpai-systemic", "prohibited"].includes(sys.tier)) byRisk.high++;
      else if (["limited", "gpai-standard"].includes(sys.tier)) byRisk.medium++;
      else byRisk.low++;
    });

    return { total: systems.length, byLifecycle, byRisk };
  }, [systems]);

  function openSystem(s: AISystem) {
    // Always navigate to the System Workspace view
    // Technical registration tasks will be handled within the workspace
    navigate(`/systems/${s.id}`);
  }

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border bg-card px-6 py-5">
          <div>
            <h1 className="text-2xl font-semibold">AI Systems</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Browse and manage your AI system portfolio.
            </p>
          </div>
          <Button
            disabled={!mayRegister}
            title={mayRegister ? undefined : "Requires role: business owner or administrator"}
            onClick={() => setWizardOpen(true)}
          >
            <Plus className="mr-2 size-4" />
            Register AI system
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-6 py-4">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              className="pl-9"
              placeholder="Search AI systems..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Select value={lifecycleFilter} onValueChange={setLifecycleFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Lifecycle Stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="development">Register</SelectItem>
              <SelectItem value="testing">Review</SelectItem>
              <SelectItem value="conformity">Classify</SelectItem>
              <SelectItem value="market">Comply</SelectItem>
              <SelectItem value="post-market">Operate</SelectItem>
            </SelectContent>
          </Select>

          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Risk Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>

          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Owner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>

          <Select value={businessUnitFilter} onValueChange={setBusinessUnitFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Business Unit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="size-4" />
            Filters
          </Button>
        </div>

        {/* Table header */}
        <div className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
          <span className="text-sm text-muted-foreground">
            {filtered.length} AI systems
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Sort by:</span>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-8 w-[140px] border-0 bg-transparent shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updated">Last updated</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="risk">Risk level</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex rounded-lg border border-input p-0.5">
              <button
                className={cn(
                  "rounded p-1.5 transition-colors",
                  viewMode === "list" ? "bg-muted" : "hover:bg-muted/50"
                )}
                onClick={() => setViewMode("list")}
              >
                <List className="size-4" />
              </button>
              <button
                className={cn(
                  "rounded p-1.5 transition-colors",
                  viewMode === "grid" ? "bg-muted" : "hover:bg-muted/50"
                )}
                onClick={() => setViewMode("grid")}
              >
                <Grid3x3 className="size-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <Card className="m-6 overflow-hidden">
            {/* Table Header */}
            <div className="flex items-center gap-4 border-b border-border bg-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <div className="flex-1">AI System</div>
              <div className="w-44 shrink-0">Use Case</div>
              <div className="w-32 shrink-0">Lifecycle Stage</div>
              <div className="w-36 shrink-0">Owner</div>
              <div className="w-20 shrink-0">Risk Level</div>
              <div className="w-20 shrink-0 text-center">Open Tasks</div>
              <div className="w-28 shrink-0">Last Updated</div>
              <div className="w-4 shrink-0"></div>
            </div>

            {/* Rows */}
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                {systems.length === 0
                  ? 'No systems registered yet. Click "Register AI system" to add one.'
                  : "No systems match the current filters."}
              </div>
            ) : (
              filtered.map((sys) => (
                <SystemRow
                  key={sys.id}
                  system={sys}
                  userMap={userMap}
                  onClick={() => openSystem(sys)}
                />
              ))
            )}
          </Card>
        </div>
      </div>

      {/* Right Sidebar */}
      <aside className="hidden w-72 shrink-0 overflow-auto bg-card p-6 xl:block">
        {/* Portfolio Summary Card */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <h3 className="mb-4 text-sm font-semibold">Portfolio summary</h3>
            <div className="mb-4 text-center">
              <div className="text-4xl font-bold">{stats.total}</div>
              <div className="text-sm text-muted-foreground">Total AI systems</div>
            </div>

            {/* By Lifecycle Stage */}
            <div className="mb-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                By lifecycle stage
              </h4>
              <div className="space-y-2">
                {LIFECYCLE_STAGES.map((stage) => (
                  <div key={stage.key} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className={cn("size-2 rounded-full", stage.color)} />
                      <span>{stage.label}</span>
                    </div>
                    <span className="font-medium">{stats.byLifecycle[stage.key] || 0}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* By Risk Level */}
            <div className="mb-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                By risk level
              </h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="size-2 rounded-full bg-red-500" />
                    <span>High</span>
                  </div>
                  <span className="font-medium">{stats.byRisk.high}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="size-2 rounded-full bg-orange-500" />
                    <span>Medium</span>
                  </div>
                  <span className="font-medium">{stats.byRisk.medium}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="size-2 rounded-full bg-green-500" />
                    <span>Low</span>
                  </div>
                  <span className="font-medium">{stats.byRisk.low}</span>
                </div>
              </div>
            </div>

            <Button variant="outline" className="w-full gap-2">
              <BarChart3 className="size-4" />
              View analytics
            </Button>
          </CardContent>
        </Card>

        {/* Model Catalog Card */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <Database className="size-5 text-primary" />
              <h3 className="text-sm font-semibold">Model Catalog</h3>
            </div>
            <div className="mb-3 text-center">
              <div className="text-3xl font-bold text-primary">{models.length}</div>
              <div className="text-xs text-muted-foreground">Registered models</div>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              View and manage your organization's AI model cards and documentation.
            </p>
            <Button asChild variant="outline" size="sm" className="w-full gap-2">
              <Link to="/models">
                Open Model Catalog
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </aside>

      {/* Engineer: choose AI-assisted vs manual */}
      <RegisterModeChooser
        open={wizardOpen && !!fillInSystem && engineerStage === "chooser"}
        onClose={closeWizard}
        onAssisted={() => setEngineerStage("assisted")}
        onManual={() => setEngineerStage("manual")}
        title="Complete Technical Registration"
        assistedDescription="Upload a model card or technical spec and let the assistant extract the details. Review and confirm each field before submitting."
        manualDescription="Fill in the technical details and risk flags manually using the step-by-step form."
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

      {/* Owner: choose manual vs AI-assisted */}
      <RegisterModeChooser
        open={wizardOpen && !fillInSystem && ownerStage === "chooser"}
        onClose={closeWizard}
        onManual={() => setOwnerStage("manual")}
        onAssisted={() => setOwnerStage("assisted")}
      />

      {/* Owner: classic manual stub */}
      <RegisterWizard
        open={wizardOpen && !fillInSystem && ownerStage === "manual"}
        onClose={closeWizard}
        onSuccess={() => { loadSystems(); loadModels(); }}
      />

      {/* Owner: conversational AI-assisted flow */}
      <AssistedRegistration
        open={wizardOpen && !fillInSystem && ownerStage === "assisted"}
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
    </div>
  );
}
