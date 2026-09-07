import { useState, useEffect, useCallback } from "react";
import { FileText, ArrowRight, Calendar, User, Search, Grid3x3, List, ChevronRight, ChevronUp, LayoutList, LayoutGrid, HelpCircle } from "lucide-react";
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

/* Vertical list row for tasks - matches first mockup */
function TaskRowVertical({ task, index }: { task: TaskCardProps; index: number }) {
  const navigate = useNavigate();
  const typeConfig = {
    review: {
      label: "REVIEW",
      icon: <FileText className="size-5" />,
      bgColor: "bg-blue-50",
      iconColor: "text-blue-600",
      actionBg: "bg-blue-600 hover:bg-blue-700",
    },
    continue: {
      label: "CONTINUE",
      icon: <ArrowRight className="size-5" />,
      bgColor: "bg-orange-50",
      iconColor: "text-orange-600",
      actionBg: "bg-orange-600 hover:bg-orange-700",
    },
    clarification: {
      label: "CLARIFICATION",
      icon: <HelpCircle className="size-5" />,
      bgColor: "bg-purple-50",
      iconColor: "text-purple-600",
      actionBg: "bg-purple-600 hover:bg-purple-700",
    },
  };

  const config = typeConfig[task.type];
  const isHighPriority = task.dueInfo?.toLowerCase().includes("today");

  // Map task type to URL task param
  const taskParam = task.type === "review" ? "review" : task.type === "continue" ? "registration" : null;
  const targetUrl = taskParam ? `/systems/${task.systemId}?task=${taskParam}` : `/systems/${task.systemId}`;

  return (
    <div
      className="flex cursor-pointer items-center gap-4 border-b border-border px-5 py-4 transition-colors last:border-b-0 hover:bg-muted/30"
      onClick={() => navigate(targetUrl)}
    >
      {/* Row Number */}
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/30 text-sm font-semibold text-muted-foreground">
        {index}
      </div>

      {/* Icon */}
      <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", config.bgColor, config.iconColor)}>
        {config.icon}
      </div>

      {/* Task Info */}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-xs font-bold uppercase tracking-wider text-orange-600">
          {config.label}
        </div>
        <div className="font-semibold text-foreground">{task.systemName}</div>
        <div className="text-sm text-muted-foreground">{task.description}</div>
      </div>

      {/* Due Date & Priority */}
      <div className="flex shrink-0 items-center gap-3">
        {task.dueInfo && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Calendar className="size-4" />
            <span>{task.dueInfo}</span>
          </div>
        )}
        <Badge className={cn("border text-xs", isHighPriority ? "border-red-200 bg-red-50 text-red-700" : "border-orange-200 bg-orange-50 text-orange-700")}>
          {isHighPriority ? "High" : "Medium"}
        </Badge>
      </div>

      {/* Action Button */}
      <Button
        size="sm"
        className={cn("shrink-0 text-white", config.actionBg)}
        onClick={(e) => {
          e.stopPropagation();
          navigate(targetUrl);
        }}
      >
        {task.actionLabel || "View"}
        <ArrowRight className="ml-1 size-4" />
      </Button>
    </div>
  );
}

/* Horizontal card for tasks - matches second mockup */
function TaskCardHorizontal({ type, systemName, systemId, description, actionLabel }: Omit<TaskCardProps, "dueInfo" | "onClick">) {
  const navigate = useNavigate();
  const typeConfig = {
    review: {
      label: "REVIEW",
      icon: <FileText className="size-5" />,
      bgColor: "bg-blue-50",
      iconColor: "text-blue-600",
      borderColor: "border-l-blue-500",
      badgeColor: "bg-red-50 text-red-600 border-red-200",
    },
    continue: {
      label: "CONTINUE",
      icon: <ArrowRight className="size-5" />,
      bgColor: "bg-orange-50",
      iconColor: "text-orange-600",
      borderColor: "border-l-orange-500",
      badgeColor: "bg-orange-50 text-orange-600 border-orange-200",
    },
    clarification: {
      label: "CLARIFICATION",
      icon: <HelpCircle className="size-5" />,
      bgColor: "bg-purple-50",
      iconColor: "text-purple-600",
      borderColor: "border-l-purple-500",
      badgeColor: "bg-purple-50 text-purple-600 border-purple-200",
    },
  };

  const config = typeConfig[type];

  // Map task type to URL task param
  const taskParam = type === "review" ? "review" : type === "continue" ? "registration" : null;
  const targetUrl = taskParam ? `/systems/${systemId}?task=${taskParam}` : `/systems/${systemId}`;

  return (
    <Card
      className={cn("cursor-pointer border-l-4 transition-shadow hover:shadow-md", config.borderColor)}
      onClick={() => navigate(targetUrl)}
    >
      <CardContent className="flex h-full flex-col p-4">
        {/* Icon and Badge */}
        <div className="mb-3 flex items-start justify-between">
          <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", config.bgColor, config.iconColor)}>
            {config.icon}
          </div>
          <Badge variant="outline" className={cn("border text-xs font-medium", config.badgeColor)}>
            {config.label}
          </Badge>
        </div>

        {/* Content */}
        <div className="mb-4 flex-1">
          <div className="mb-1 font-semibold text-foreground">{systemName}</div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        {/* Action Button */}
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-center border-primary text-primary hover:bg-primary hover:text-primary-foreground"
          onClick={(e) => {
            e.stopPropagation();
            navigate(targetUrl);
          }}
        >
          {actionLabel || "View"}
          <ArrowRight className="ml-1 size-4" />
        </Button>
      </CardContent>
    </Card>
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
  const [taskViewMode, setTaskViewMode] = useState<"vertical" | "horizontal">("vertical");
  const [tasksExpanded, setTasksExpanded] = useState(true);

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

  // Filter systems user is involved with (owner, assignee, or has pending tasks for them)
  // For engineers: show all draft and pending_review systems as they may need to work on them
  const mySystems = systems.filter(s => {
    // User is the owner
    if (s.owner_username === username) return true;
    // User is assigned as engineer
    if (s.assigned_engineer === username) return true;
    // All draft systems (engineers help with registration)
    if (s.workflow_status === "draft") return true;
    // All pending review systems (engineers do technical reviews)
    if (s.workflow_status === "pending_review") return true;
    // Systems awaiting information from the owner
    if (s.workflow_status === "information_requested") return true;
    return false;
  });

  // Derive tasks from user's systems
  const draftSystems = mySystems.filter(s => s.workflow_status === "draft");
  const pendingReviewSystems = mySystems.filter(s => s.workflow_status === "pending_review");
  const myRecentSystems = [...mySystems].sort((a, b) =>
    new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
  ).slice(0, 4);

  // Build ALL tasks from real data
  const urgentTasks: TaskCardProps[] = [];

  // Add ALL pending reviews as "review" tasks
  pendingReviewSystems.forEach(s => {
    urgentTasks.push({
      type: "review",
      systemName: s.name,
      systemId: s.id,
      description: "Pending technical review",
      dueInfo: "Due today",
      actionLabel: "Start review",
    });
  });

  // Add ALL drafts as "continue" tasks
  draftSystems.forEach(s => {
    urgentTasks.push({
      type: "continue",
      systemName: s.name,
      systemId: s.id,
      description: "Complete the registration",
      dueInfo: "Due in 2 days",
      actionLabel: "Continue",
    });
  });

  // Add clarification tasks for systems needing attention
  systems.filter(s => s.workflow_status === "information_requested").forEach(s => {
    urgentTasks.push({
      type: "clarification",
      systemName: s.name,
      systemId: s.id,
      description: "Clarification needed",
      dueInfo: "Due in 5 days",
      actionLabel: "Respond",
    });
  });

  // Calculate workload counts for ring chart
  const needsMeCount = pendingReviewSystems.length;
  const inProgressCount = draftSystems.length;
  const waitingCount = systems.filter(s => s.workflow_status === "information_requested").length;
  const totalWorkload = needsMeCount + inProgressCount + waitingCount;

  // Recent activity from user's systems
  const recentActivity = myRecentSystems.slice(0, 3).map(s => {
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

        {/* Your Tasks Section */}
        <div className="mb-6">
          {/* Task Section Header */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">Your Tasks</h2>
              <Badge variant="secondary" className="rounded-full px-3 py-1 text-sm font-medium">
                {urgentTasks.length} active tasks
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {/* View Toggle */}
              <div className="flex rounded-lg border border-input bg-background p-1">
                <button
                  onClick={() => setTaskViewMode("vertical")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    taskViewMode === "vertical"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <LayoutList className="size-4" />
                  Vertical
                </button>
                <button
                  onClick={() => setTaskViewMode("horizontal")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    taskViewMode === "horizontal"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <LayoutGrid className="size-4" />
                  Horizontal
                </button>
              </div>
              {/* Collapse Button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTasksExpanded(!tasksExpanded)}
                className="flex items-center gap-1 text-muted-foreground"
              >
                <ChevronUp className={cn("size-4 transition-transform", !tasksExpanded && "rotate-180")} />
                Collapse
              </Button>
            </div>
          </div>

          {/* Task Content */}
          {tasksExpanded && (
            urgentTasks.length > 0 ? (
              taskViewMode === "vertical" ? (
                /* Vertical List View */
                <Card className="overflow-hidden">
                  <CardContent className="p-0">
                    {urgentTasks.map((task, i) => (
                      <TaskRowVertical key={i} task={task} index={i + 1} />
                    ))}
                  </CardContent>
                </Card>
              ) : (
                /* Horizontal Card View */
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {urgentTasks.map((task, i) => (
                    <TaskCardHorizontal key={i} {...task} />
                  ))}
                </div>
              )
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No tasks require your attention. You're all caught up!
                </CardContent>
              </Card>
            )
          )}
        </div>

        {/* View All Tasks Link */}
        <Link
          to="/work"
          className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          View all tasks
          <ArrowRight className="size-4" />
        </Link>

        {/* Your AI Systems Preview */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Your AI Systems</h2>
              <p className="text-sm text-muted-foreground">
                AI systems you own, are assigned to, or have recently worked on.
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
                ) : myRecentSystems.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    No AI systems you're involved with yet.
                  </div>
                ) : (
                  myRecentSystems.map((system) => (
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

      {/* Right Sidebar - Workload & Activity */}
      <aside className="hidden w-80 shrink-0 overflow-auto bg-card p-6 xl:block">
        {/* Workload Today Card (Ring Chart) */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <h3 className="mb-4 text-sm font-semibold">Workload today</h3>
            <div className="flex items-center justify-center">
              <div className="relative size-32">
                {/* Donut chart visualization */}
                <svg className="size-full -rotate-90 transform" viewBox="0 0 128 128">
                  {/* Background circle */}
                  <circle
                    cx="64"
                    cy="64"
                    r="52"
                    fill="none"
                    stroke="#e5e7eb"
                    strokeWidth="16"
                  />
                  {/* Needs me segment (blue) */}
                  {needsMeCount > 0 && (
                    <circle
                      cx="64"
                      cy="64"
                      r="52"
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="16"
                      strokeDasharray={`${(needsMeCount / Math.max(totalWorkload, 1)) * 327} 327`}
                      strokeDashoffset="0"
                    />
                  )}
                  {/* In progress segment (purple) */}
                  {inProgressCount > 0 && (
                    <circle
                      cx="64"
                      cy="64"
                      r="52"
                      fill="none"
                      stroke="#a855f7"
                      strokeWidth="16"
                      strokeDasharray={`${(inProgressCount / Math.max(totalWorkload, 1)) * 327} 327`}
                      strokeDashoffset={`${-(needsMeCount / Math.max(totalWorkload, 1)) * 327}`}
                    />
                  )}
                  {/* Waiting segment (orange) */}
                  {waitingCount > 0 && (
                    <circle
                      cx="64"
                      cy="64"
                      r="52"
                      fill="none"
                      stroke="#f97316"
                      strokeWidth="16"
                      strokeDasharray={`${(waitingCount / Math.max(totalWorkload, 1)) * 327} 327`}
                      strokeDashoffset={`${-((needsMeCount + inProgressCount) / Math.max(totalWorkload, 1)) * 327}`}
                    />
                  )}
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-3xl font-bold">{totalWorkload}</div>
                    <div className="text-xs text-muted-foreground">tasks</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="size-2.5 rounded-full bg-blue-500" />
                  <span>Needs me</span>
                </div>
                <span className="font-semibold">{needsMeCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="size-2.5 rounded-full bg-purple-500" />
                  <span>In progress</span>
                </div>
                <span className="font-semibold">{inProgressCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="size-2.5 rounded-full bg-orange-500" />
                  <span>Waiting</span>
                </div>
                <span className="font-semibold">{waitingCount}</span>
              </div>
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
