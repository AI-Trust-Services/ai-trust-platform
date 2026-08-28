import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import {
  User, Clock, RefreshCw, CheckCircle, ChevronRight,
  FileText, MessageSquare, Code, Calendar, AlertCircle,
  Sparkles, Info
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";
import type { AISystem } from "@/types";

interface SummaryCardProps {
  count: number;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
}

function SummaryCard({ count, label, subtitle, icon, iconBg, iconColor }: SummaryCardProps) {
  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", iconBg, iconColor)}>
              {icon}
            </div>
            <div>
              <div className="text-2xl font-semibold">{count}</div>
              <div className="text-sm font-medium">{label}</div>
              <div className="text-xs text-muted-foreground">{subtitle}</div>
            </div>
          </div>
          <ChevronRight className="size-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

interface CategoryCardProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  iconBg: string;
  iconColor: string;
}

function CategoryCard({ icon, label, count, iconBg, iconColor }: CategoryCardProps) {
  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md">
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconBg, iconColor)}>
            {icon}
          </div>
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">{count}</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

// Get lifecycle stage label from backend value
function getStageLabel(lifecycle: string): string {
  const mapping: Record<string, string> = {
    development: "Register",
    testing: "Review",
    conformity: "Classify",
    market: "Comply",
    "post-market": "Operate",
    decommissioned: "Operate",
  };
  return mapping[lifecycle] || "Register";
}

// Get risk level from tier
function getRiskLevel(tier: string): "high" | "medium" | "low" {
  if (["high", "gpai-systemic", "prohibited"].includes(tier)) return "high";
  if (["limited", "gpai-standard"].includes(tier)) return "medium";
  return "low";
}

interface TaskRowProps {
  task: {
    icon: React.ReactNode;
    iconBg: string;
    iconColor: string;
    title: string;
    system: string;
    systemId: string;
    type: string;
    typeColor: string;
    stage: string;
    due: string;
    dueColor?: string;
    priority: "high" | "medium" | "low";
    status: string;
    statusColor: string;
  };
  onClick: () => void;
}

function TaskRow({ task, onClick }: TaskRowProps) {
  const priorityColors = {
    high: "bg-red-100 text-red-700 border-red-200",
    medium: "bg-orange-100 text-orange-700 border-orange-200",
    low: "bg-green-100 text-green-700 border-green-200",
  };

  return (
    <div
      className="flex cursor-pointer items-center gap-4 border-b border-border px-4 py-3 hover:bg-muted/30"
      onClick={onClick}
    >
      {/* Task Icon + Title */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", task.iconBg, task.iconColor)}>
          {task.icon}
        </div>
        <span className="font-medium">{task.title}</span>
      </div>

      {/* AI System */}
      <div className="w-40 shrink-0 text-sm text-muted-foreground">{task.system}</div>

      {/* Task Type */}
      <div className="w-32 shrink-0">
        <Badge variant="outline" className={cn("border text-xs", task.typeColor)}>
          {task.type}
        </Badge>
      </div>

      {/* Current Stage */}
      <div className="flex w-32 shrink-0 items-center gap-1.5 text-sm">
        <div className="size-2 rounded-full bg-primary" />
        <span>{task.stage}</span>
      </div>

      {/* Due */}
      <div className={cn("w-28 shrink-0 text-sm", task.dueColor || "text-muted-foreground")}>
        {task.due}
      </div>

      {/* Priority */}
      <div className="w-24 shrink-0">
        <Badge className={cn("border text-xs", priorityColors[task.priority])}>
          {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
        </Badge>
      </div>

      {/* Status */}
      <div className="w-28 shrink-0">
        <Badge variant="outline" className={cn("border text-xs", task.statusColor)}>
          {task.status}
        </Badge>
      </div>

      {/* Arrow */}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

export default function MyWork() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("needs-me");
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

  // Derive work items from systems
  const draftSystems = systems.filter(s => s.workflow_status === "draft");
  const pendingReviewSystems = systems.filter(s => s.workflow_status === "pending_review");
  const approvedSystems = systems.filter(s => s.workflow_status === "approved");

  // Calculate counts
  const needsMeCount = draftSystems.length + pendingReviewSystems.length;
  const waitingCount = 0; // No real "waiting" status yet
  const inProgressCount = systems.filter(s => s.workflow_status === "draft").length;
  const completedCount = approvedSystems.length;

  const summaryCards = [
    {
      count: needsMeCount,
      label: "Needs me",
      subtitle: "Tasks need your action",
      icon: <User className="size-5" />,
      iconBg: "bg-purple-50",
      iconColor: "text-purple-600",
    },
    {
      count: waitingCount,
      label: "Waiting on others",
      subtitle: "Awaiting updates",
      icon: <Clock className="size-5" />,
      iconBg: "bg-orange-50",
      iconColor: "text-orange-600",
    },
    {
      count: inProgressCount,
      label: "In progress",
      subtitle: "Active tasks",
      icon: <RefreshCw className="size-5" />,
      iconBg: "bg-blue-50",
      iconColor: "text-blue-600",
    },
    {
      count: completedCount,
      label: "Completed",
      subtitle: "This month",
      icon: <CheckCircle className="size-5" />,
      iconBg: "bg-green-50",
      iconColor: "text-green-600",
    },
  ];

  const categories = [
    {
      icon: <FileText className="size-4" />,
      label: "Review new systems",
      count: pendingReviewSystems.length,
      iconBg: "bg-blue-50",
      iconColor: "text-blue-600",
    },
    {
      icon: <RefreshCw className="size-4" />,
      label: "Continue registrations",
      count: draftSystems.length,
      iconBg: "bg-purple-50",
      iconColor: "text-purple-600",
    },
    {
      icon: <MessageSquare className="size-4" />,
      label: "Answer clarifications",
      count: 0,
      iconBg: "bg-orange-50",
      iconColor: "text-orange-600",
    },
    {
      icon: <Code className="size-4" />,
      label: "Review system changes",
      count: 0,
      iconBg: "bg-green-50",
      iconColor: "text-green-600",
    },
  ];

  // Build tasks from real systems
  const tasks = [
    ...pendingReviewSystems.map(s => ({
      icon: <FileText className="size-4" />,
      iconBg: "bg-blue-50",
      iconColor: "text-blue-600",
      title: "Review technical information",
      system: s.name,
      systemId: s.id,
      type: "Technical review",
      typeColor: "bg-blue-50 text-blue-700 border-blue-200",
      stage: getStageLabel(s.lifecycle),
      due: "Pending",
      dueColor: "text-orange-600",
      priority: (getRiskLevel(s.tier) === "high" ? "high" : "medium") as "high" | "medium" | "low",
      status: "Needs me",
      statusColor: "bg-blue-50 text-blue-700 border-blue-200",
    })),
    ...draftSystems.map(s => ({
      icon: <RefreshCw className="size-4" />,
      iconBg: "bg-purple-50",
      iconColor: "text-purple-600",
      title: "Complete registration",
      system: s.name,
      systemId: s.id,
      type: "Registration",
      typeColor: "bg-purple-50 text-purple-700 border-purple-200",
      stage: getStageLabel(s.lifecycle),
      due: "In progress",
      priority: "medium" as const,
      status: "In progress",
      statusColor: "bg-purple-50 text-purple-700 border-purple-200",
    })),
  ];

  // Upcoming due dates from real data
  const upcomingDueDates = tasks.slice(0, 4).map((t, i) => ({
    label: i === 0 ? "Priority" : "Pending",
    task: t.title,
    system: t.system,
    color: i === 0 ? "text-red-600" : "text-orange-600",
    icon: <Calendar className="size-3" />,
  }));

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="mb-1 text-2xl font-semibold">My Work</h1>
            <p className="text-sm text-muted-foreground">
              Track the work you are responsible for across AI systems.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Workload today</span>
            <Info className="size-4 text-muted-foreground" />
          </div>
        </div>

        {/* Summary Cards */}
        <div className="mb-6 grid gap-4 md:grid-cols-4">
          {summaryCards.map((card, i) => (
            <SummaryCard key={i} {...card} />
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="needs-me">Needs me</TabsTrigger>
            <TabsTrigger value="waiting">Waiting on others</TabsTrigger>
            <TabsTrigger value="in-progress">In progress</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>

          <TabsContent value="needs-me" className="space-y-4">
            {/* Category Cards */}
            <div className="grid gap-3 md:grid-cols-4">
              {categories.map((cat, i) => (
                <CategoryCard key={i} {...cat} />
              ))}
            </div>

            {/* Tasks Table */}
            <div>
              <h3 className="mb-3 text-sm font-semibold">Tasks ({tasks.length})</h3>
              <Card>
                <CardContent className="p-0">
                  {/* Table Header */}
                  <div className="flex items-center gap-4 border-b border-border bg-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <div className="flex-1">Task</div>
                    <div className="w-40 shrink-0">AI System</div>
                    <div className="w-32 shrink-0">Task Type</div>
                    <div className="w-32 shrink-0">Current Stage</div>
                    <div className="w-28 shrink-0">Due</div>
                    <div className="w-24 shrink-0">Priority</div>
                    <div className="w-28 shrink-0">Status</div>
                    <div className="w-4 shrink-0"></div>
                  </div>

                  {/* Table Rows */}
                  {loading ? (
                    <div className="py-8 text-center text-muted-foreground">Loading...</div>
                  ) : tasks.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      No tasks require your attention. You're all caught up!
                    </div>
                  ) : (
                    tasks.map((task, i) => (
                      <TaskRow
                        key={i}
                        task={task}
                        onClick={() => navigate(`/systems/${task.systemId}`)}
                      />
                    ))
                  )}
                </CardContent>
              </Card>

              {tasks.length > 0 && (
                <div className="mt-3 text-center">
                  <span className="text-sm text-muted-foreground">
                    Showing {tasks.length} of {tasks.length} tasks
                  </span>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="waiting">
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No tasks waiting on others
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="in-progress">
            {draftSystems.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  No tasks in progress
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="flex items-center gap-4 border-b border-border bg-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <div className="flex-1">Task</div>
                    <div className="w-40 shrink-0">AI System</div>
                    <div className="w-32 shrink-0">Task Type</div>
                    <div className="w-32 shrink-0">Current Stage</div>
                    <div className="w-28 shrink-0">Due</div>
                    <div className="w-24 shrink-0">Priority</div>
                    <div className="w-28 shrink-0">Status</div>
                    <div className="w-4 shrink-0"></div>
                  </div>
                  {tasks.filter(t => t.status === "In progress").map((task, i) => (
                    <TaskRow
                      key={i}
                      task={task}
                      onClick={() => navigate(`/systems/${task.systemId}`)}
                    />
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="completed">
            {approvedSystems.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  No completed tasks
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="flex items-center gap-4 border-b border-border bg-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <div className="flex-1">System</div>
                    <div className="w-40 shrink-0">Status</div>
                    <div className="w-32 shrink-0">Stage</div>
                  </div>
                  {approvedSystems.map((s, i) => (
                    <div
                      key={i}
                      className="flex cursor-pointer items-center gap-4 border-b border-border px-4 py-3 hover:bg-muted/30"
                      onClick={() => navigate(`/systems/${s.id}`)}
                    >
                      <div className="flex-1 font-medium">{s.name}</div>
                      <div className="w-40 shrink-0">
                        <Badge className="border-0 bg-green-100 text-green-700">Approved</Badge>
                      </div>
                      <div className="w-32 shrink-0 text-sm text-muted-foreground">
                        {getStageLabel(s.lifecycle)}
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Right Sidebar */}
      <aside className="hidden w-80 shrink-0 overflow-auto bg-card p-6 xl:block">
        {/* Workload Today Card */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <h3 className="mb-4 text-sm font-semibold">Workload today</h3>
            <div className="flex items-center justify-center">
              <div className="relative size-32">
                {/* Simple donut chart visualization */}
                <svg className="size-full -rotate-90 transform">
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    fill="none"
                    stroke="#e5e7eb"
                    strokeWidth="16"
                  />
                  {needsMeCount > 0 && (
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="16"
                      strokeDasharray={`${(needsMeCount / Math.max(needsMeCount + inProgressCount + waitingCount, 1)) * 352} 352`}
                      strokeDashoffset="0"
                    />
                  )}
                  {inProgressCount > 0 && (
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      fill="none"
                      stroke="#a855f7"
                      strokeWidth="16"
                      strokeDasharray={`${(inProgressCount / Math.max(needsMeCount + inProgressCount + waitingCount, 1)) * 352} 352`}
                      strokeDashoffset={`${-(needsMeCount / Math.max(needsMeCount + inProgressCount + waitingCount, 1)) * 352}`}
                    />
                  )}
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-2xl font-bold">{needsMeCount + inProgressCount + waitingCount}</div>
                    <div className="text-xs text-muted-foreground">tasks</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-blue-500" />
                  <span>Needs me</span>
                </div>
                <span className="font-medium">{needsMeCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-purple-500" />
                  <span>In progress</span>
                </div>
                <span className="font-medium">{inProgressCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-orange-500" />
                  <span>Waiting</span>
                </div>
                <span className="font-medium">{waitingCount}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Upcoming Due Dates Card */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Upcoming tasks</h3>
              <Button variant="link" className="h-auto p-0 text-xs text-primary">
                View all
              </Button>
            </div>
            <div className="space-y-3">
              {upcomingDueDates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No upcoming tasks</p>
              ) : (
                upcomingDueDates.map((item, i) => (
                  <div key={i} className="space-y-1">
                    <div className={cn("flex items-center gap-1.5 text-xs font-medium", item.color)}>
                      {item.icon}
                      <span>{item.label}</span>
                    </div>
                    <div className="text-sm font-medium">{item.task}</div>
                    <div className="text-xs text-muted-foreground">{item.system}</div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Helpful Tip Card */}
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="size-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-blue-900">Helpful tip</h3>
            </div>
            <p className="mb-3 text-sm text-blue-900">
              {tasks.length === 0
                ? "You're all caught up! Consider reviewing completed systems or exploring the AI Systems catalog."
                : "Tackle high priority tasks first to keep reviews moving forward."}
            </p>
            <Button variant="link" className="h-auto p-0 text-sm text-blue-600">
              View tips
            </Button>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
