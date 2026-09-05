import { useState, useEffect, useCallback } from "react";
import { FileText, ArrowRight, Calendar, User, Search, Grid3x3, List, ChevronRight } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/api/client";
import { getTotalTaskCount } from "@/utils/taskUtils";
import type { AISystem } from "@/types";

// Map backend lifecycle to stage info
function getLifecycleStage(lifecycle: string): { label: string; index: number } {
  const mapping: Record<string, { label: string; index: number }> = {
    development: { label: "Register", index: 0 },
    testing: { label: "Review", index: 1 },
    conformity: { label: "Classify", index: 2 },
    market: { label: "Comply", index: 3 },
    "post-market": { label: "Operate", index: 4 },
    decommissioned: { label: "Operate", index: 4 },
  };
  return mapping[lifecycle] || { label: "Register", index: 0 };
}

// Get risk level from tier
function getRiskLevel(tier: string): "high" | "medium" | "low" {
  if (["high", "gpai-systemic", "prohibited"].includes(tier)) return "high";
  if (["limited", "gpai-standard"].includes(tier)) return "medium";
  return "low";
}

// Get system icon based on name/type
function getSystemIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("talent") || lower.includes("recruit")) return "👥";
  if (lower.includes("schedule") || lower.includes("meeting")) return "📅";
  if (lower.includes("safety") || lower.includes("watch")) return "🛡️";
  if (lower.includes("market") || lower.includes("content")) return "✨";
  if (lower.includes("customer") || lower.includes("support")) return "💬";
  if (lower.includes("bio") || lower.includes("identity")) return "🔐";
  if (lower.includes("insight") || lower.includes("analytics")) return "📊";
  if (lower.includes("policy") || lower.includes("compliance")) return "✓";
  if (lower.includes("document")) return "📄";
  return "🤖";
}

interface TaskCardProps {
  type: "review" | "continue" | "clarification";
  systemName: string;
  systemId: string;
  description: string;
  dueInfo?: string;
  actionLabel?: string;
  onClick?: () => void;
}

function TaskCard({ type, systemName, systemId, description, dueInfo, actionLabel, onClick }: TaskCardProps) {
  const navigate = useNavigate();
  const typeConfig = {
    review: {
      label: "REVIEW",
      icon: <FileText className="size-5" />,
      bgColor: "bg-blue-50",
      iconColor: "text-blue-600",
      borderColor: "border-blue-200",
    },
    continue: {
      label: "CONTINUE",
      icon: <ArrowRight className="size-5" />,
      bgColor: "bg-orange-50",
      iconColor: "text-orange-600",
      borderColor: "border-orange-200",
    },
    clarification: {
      label: "CLARIFICATION",
      icon: <User className="size-5" />,
      bgColor: "bg-purple-50",
      iconColor: "text-purple-600",
      borderColor: "border-purple-200",
    },
  };

  const config = typeConfig[type];

  return (
    <Card
      className={cn("cursor-pointer border transition-shadow hover:shadow-md", config.borderColor)}
      onClick={() => navigate(`/systems/${systemId}`)}
    >
      <CardContent className="p-4">
        <div className="mb-3 flex items-start gap-3">
          <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", config.bgColor, config.iconColor)}>
            {config.icon}
          </div>
          <div className="flex-1">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {config.label}
            </div>
            <div className="font-semibold">{systemName}</div>
          </div>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">{description}</p>
        {dueInfo && (
          <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="size-3" />
            <span>{dueInfo}</span>
          </div>
        )}
        {actionLabel && (
          <Button variant="link" size="sm" className="h-auto p-0 text-primary">
            {actionLabel}
            <ArrowRight className="ml-1 size-3" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

interface WorkSummaryProps {
  title: string;
  count: number;
  items: { label: string; count: number }[];
  variant?: "default" | "warning" | "success";
}

function WorkSummary({ title, count, items, variant = "default" }: WorkSummaryProps) {
  const colors = {
    default: "text-foreground",
    warning: "text-orange-600",
    success: "text-green-600",
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className={cn("text-sm font-semibold", colors[variant])}>{title}</h4>
        <Badge variant="secondary" className="text-xs">
          {count}
        </Badge>
      </div>
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{item.label}</span>
          <span className="font-medium text-foreground">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

function SystemRow({ system, username, onClick }: { system: AISystem; username: string; onClick: () => void }) {
  const { label: stageName, index: stageProgress } = getLifecycleStage(system.lifecycle);
  const riskLevel = getRiskLevel(system.tier);
  const icon = getSystemIcon(system.name);

  const riskColors = {
    high: "bg-red-100 text-red-700 border-red-200",
    medium: "bg-orange-100 text-orange-700 border-orange-200",
    low: "bg-green-100 text-green-700 border-green-200",
  };

  const ownerName = system.owner_username || "—";
  const ownerInitials = ownerName === "—" ? "—" : ownerName.slice(0, 2).toUpperCase();

  const updated = new Date(system.updated_at || system.created_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // Get real task count using shared utility
  const taskCount = getTotalTaskCount(system, username);

  return (
    <div
      className="flex cursor-pointer items-center gap-4 border-b border-border px-4 py-3 hover:bg-muted/30"
      onClick={onClick}
    >
      {/* System */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <span className="text-lg">{icon}</span>
        </div>
        <div className="min-w-0">
          <div className="font-medium">{system.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {system.description || system.provider || "AI System"}
          </div>
        </div>
      </div>

      {/* Risk Level */}
      <div className="w-24 shrink-0">
        <Badge className={cn("border text-xs", riskColors[riskLevel])}>
          {riskLevel === "high" ? "High" : riskLevel === "medium" ? "Medium" : "Low"}
        </Badge>
      </div>

      {/* Current Stage with Progress */}
      <div className="w-48 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center">
            <div className="size-2 rounded-full bg-primary" />
            <div className={cn("h-0.5 w-4", stageProgress >= 1 ? "bg-primary" : "bg-muted")} />
            <div className={cn("size-2 rounded-full", stageProgress >= 1 ? "bg-primary" : "bg-muted")} />
            <div className={cn("h-0.5 w-4", stageProgress >= 2 ? "bg-primary" : "bg-muted")} />
            <div className={cn("size-2 rounded-full", stageProgress >= 2 ? "bg-primary" : "bg-muted")} />
          </div>
          <span className="text-xs text-muted-foreground">{stageName}</span>
        </div>
      </div>

      {/* Owner */}
      <div className="flex w-40 shrink-0 items-center gap-2">
        <Avatar className="size-7">
          <AvatarFallback className="bg-primary text-xs text-primary-foreground">
            {ownerInitials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{ownerName}</div>
          <div className="truncate text-xs text-muted-foreground">Owner</div>
        </div>
      </div>

      {/* Open Tasks */}
      <div className="w-20 shrink-0 text-center">
        <Badge variant="secondary" className="text-xs">
          {taskCount}
        </Badge>
      </div>

      {/* Updated */}
      <div className="w-24 shrink-0 text-xs text-muted-foreground">{updated}</div>

      {/* Arrow */}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

export default function Today() {
  const { username } = usePermissions();
  const navigate = useNavigate();
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSystems = useCallback(async () => {
    try {
      const data = await api.getSystems();
      setSystems(data);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSystems();
  }, [loadSystems]);

  // Get greeting based on time of day
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // Extract first name from username
  const firstName = username ? username.split(/[@.]/)[0] : "there";
  const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  // Derive tasks from systems
  const draftSystems = systems.filter(s => s.workflow_status === "draft");
  const pendingReviewSystems = systems.filter(s => s.workflow_status === "pending_review");
  const recentSystems = [...systems].sort((a, b) =>
    new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
  ).slice(0, 4);

  // Build urgent tasks from real data
  const urgentTasks: TaskCardProps[] = [];

  // Add pending reviews as "review" tasks
  pendingReviewSystems.slice(0, 1).forEach(s => {
    urgentTasks.push({
      type: "review",
      systemName: s.name,
      systemId: s.id,
      description: "Pending technical review",
      dueInfo: "Due today",
    });
  });

  // Add drafts as "continue" tasks
  draftSystems.slice(0, 1).forEach(s => {
    urgentTasks.push({
      type: "continue",
      systemName: s.name,
      systemId: s.id,
      description: "Complete the registration",
      actionLabel: "Continue",
    });
  });

  // Add a system if we have room
  if (urgentTasks.length < 3 && recentSystems.length > 0) {
    const s = recentSystems.find(sys => !urgentTasks.some(t => t.systemId === sys.id));
    if (s) {
      urgentTasks.push({
        type: "clarification",
        systemName: s.name,
        systemId: s.id,
        description: "Review system details",
        actionLabel: "View details",
      });
    }
  }

  // Work summary based on real data
  const workSummary = {
    needsMe: {
      count: draftSystems.length + pendingReviewSystems.length,
      items: [
        { label: "Review new systems", count: pendingReviewSystems.length },
        { label: "Complete registrations", count: draftSystems.length },
        { label: "Answer clarifications", count: 0 },
      ],
    },
    waitingOnOthers: {
      count: systems.filter(s => s.workflow_status === "approved").length,
      items: [
        { label: "Approved systems", count: systems.filter(s => s.workflow_status === "approved").length },
      ],
    },
    completed: {
      count: systems.filter(s => s.workflow_status === "approved").length,
      items: [{ label: "Completed", count: systems.filter(s => s.workflow_status === "approved").length }],
    },
  };

  // Recent activity from real systems
  const recentActivity = recentSystems.slice(0, 3).map(s => {
    const date = new Date(s.updated_at || s.created_at);
    const isToday = date.toDateString() === new Date().toDateString();
    const time = isToday
      ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

    return {
      action: s.workflow_status === "draft" ? "Registration started" : s.workflow_status === "pending_review" ? "Submitted for review" : "Updated",
      system: s.name,
      time,
    };
  });

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Greeting */}
        <div className="mb-6">
          <h1 className="mb-1 text-2xl font-semibold text-foreground">
            {greeting}, {displayName}
          </h1>
          <p className="text-sm text-muted-foreground">Here's what needs your attention today.</p>
        </div>

        {/* Urgent Tasks */}
        {urgentTasks.length > 0 ? (
          <div className="mb-4 grid gap-4 md:grid-cols-3">
            {urgentTasks.map((task, i) => (
              <TaskCard key={i} {...task} />
            ))}
          </div>
        ) : (
          <Card className="mb-4">
            <CardContent className="py-8 text-center text-muted-foreground">
              No urgent tasks. You're all caught up!
            </CardContent>
          </Card>
        )}

        {/* View All Link */}
        <Link
          to="/work"
          className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          View all work
          <ArrowRight className="size-4" />
        </Link>

        {/* AI Systems Preview */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">AI Systems</h2>
              <p className="text-sm text-muted-foreground">
                Your organization's AI systems and their current status.
              </p>
            </div>
            <Button onClick={() => {
              window.location.hash = "#/systems?register=true";
            }}>
              + Register AI system
            </Button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3">
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search systems..." className="pl-9" />
            </div>
            <select className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option>All stages</option>
            </select>
            <select className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option>All risk levels</option>
            </select>
            <div className="flex gap-1 rounded-lg border border-input p-1">
              <button className="rounded p-1 hover:bg-muted">
                <Grid3x3 className="size-4" />
              </button>
              <button className="rounded bg-muted p-1">
                <List className="size-4" />
              </button>
            </div>
          </div>

          {/* Systems Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                {/* Table Header */}
                <div className="flex items-center gap-4 border-b border-border bg-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <div className="flex-1">System</div>
                  <div className="w-24 shrink-0">Risk Level</div>
                  <div className="w-48 shrink-0">Current Stage</div>
                  <div className="w-40 shrink-0">Owner</div>
                  <div className="w-20 shrink-0 text-center">Open Tasks</div>
                  <div className="w-24 shrink-0">Updated</div>
                  <div className="w-4 shrink-0"></div>
                </div>

                {/* Table Rows */}
                {loading ? (
                  <div className="py-8 text-center text-muted-foreground">Loading...</div>
                ) : recentSystems.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    No AI systems registered yet.
                  </div>
                ) : (
                  recentSystems.map((system) => (
                    <SystemRow
                      key={system.id}
                      system={system}
                      username={username}
                      onClick={() => navigate(`/systems/${system.id}`)}
                    />
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Link
            to="/systems"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View all AI systems
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>

      {/* Right Sidebar - My Work Summary */}
      <aside className="hidden w-80 shrink-0 overflow-auto bg-card p-6 xl:block">
        {/* My Work Card */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">My Work</h3>
              <Link to="/work" className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            </div>

            <div className="space-y-5">
              <WorkSummary
                title="Needs me"
                count={workSummary.needsMe.count}
                items={workSummary.needsMe.items}
                variant="default"
              />
              <WorkSummary
                title="Waiting on others"
                count={workSummary.waitingOnOthers.count}
                items={workSummary.waitingOnOthers.items}
                variant="warning"
              />
              <WorkSummary
                title="Completed"
                count={workSummary.completed.count}
                items={workSummary.completed.items}
                variant="success"
              />
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity Card */}
        <Card>
          <CardContent className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Recent activity</h3>
              <Link to="/work" className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            </div>
            <div className="space-y-3">
              {recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity</p>
              ) : (
                recentActivity.map((activity, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    <div className="flex-1">
                      <p className="font-medium">{activity.action}</p>
                      <p className="text-xs text-muted-foreground">{activity.system}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{activity.time}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
