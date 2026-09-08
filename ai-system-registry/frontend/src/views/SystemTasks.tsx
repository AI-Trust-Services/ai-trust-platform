/**
 * SystemTasks - Full tasks view for a specific AI system.
 * Accessible at /systems/:systemId/tasks
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router";
import {
  ChevronRight, ChevronLeft, User, Clock, CheckCircle,
  FileText, Code, AlertCircle, ArrowLeft
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { deriveTasksFromSystem, getMyTasks } from "@/utils/taskUtils";
import type { AISystem, SystemTask, TaskStatus } from "@/types";

// Summary card component
interface SummaryCardProps {
  count: number;
  label: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  active?: boolean;
  onClick?: () => void;
}

function SummaryCard({ count, label, icon, iconBg, iconColor, active, onClick }: SummaryCardProps) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        active && "ring-2 ring-primary"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", iconBg, iconColor)}>
            {icon}
          </div>
          <div>
            <div className="text-2xl font-semibold">{count}</div>
            <div className="text-sm text-muted-foreground">{label}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Task row component
interface TaskRowProps {
  task: SystemTask;
  onClick: () => void;
}

function TaskRow({ task, onClick }: TaskRowProps) {
  const priorityColors = {
    high: "bg-red-100 text-red-700 border-red-200",
    medium: "bg-orange-100 text-orange-700 border-orange-200",
    low: "bg-green-100 text-green-700 border-green-200",
  };

  const statusColors: Record<TaskStatus, string> = {
    open: "bg-blue-100 text-blue-700 border-blue-200",
    in_progress: "bg-orange-100 text-orange-700 border-orange-200",
    waiting: "bg-gray-100 text-gray-700 border-gray-200",
    completed: "bg-green-100 text-green-700 border-green-200",
  };

  const statusLabels: Record<TaskStatus, string> = {
    open: "Open",
    in_progress: "In Progress",
    waiting: "Waiting",
    completed: "Completed",
  };

  const typeColors: Record<string, string> = {
    registration: "bg-purple-100 text-purple-700 border-purple-200",
    review: "bg-blue-100 text-blue-700 border-blue-200",
    compliance: "bg-orange-100 text-orange-700 border-orange-200",
  };

  const typeIcons: Record<string, React.ReactNode> = {
    registration: <FileText className="size-4" />,
    review: <Code className="size-4" />,
    compliance: <AlertCircle className="size-4" />,
  };

  return (
    <div
      className="flex cursor-pointer items-center gap-4 border-b border-border px-4 py-3 hover:bg-muted/30"
      onClick={onClick}
    >
      {/* Task Icon + Title */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", typeColors[task.type])}>
          {typeIcons[task.type]}
        </div>
        <div className="min-w-0">
          <div className="truncate font-medium">{task.title}</div>
          <div className="truncate text-sm text-muted-foreground">{task.description}</div>
        </div>
      </div>

      {/* Assignee */}
      <div className="w-36 shrink-0">
        <div className="flex items-center gap-2">
          <User className="size-4 text-muted-foreground" />
          <span className="truncate text-sm">{task.assignee || "Unassigned"}</span>
        </div>
        <div className="text-xs text-muted-foreground">{task.assigneeRole}</div>
      </div>

      {/* Stage */}
      <div className="flex w-28 shrink-0 items-center gap-1.5 text-sm">
        <div className="size-2 rounded-full bg-primary" />
        <span>{task.stage}</span>
      </div>

      {/* Priority */}
      <div className="w-24 shrink-0">
        <Badge className={cn("border text-xs", priorityColors[task.priority])}>
          {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
        </Badge>
      </div>

      {/* Status */}
      <div className="w-28 shrink-0">
        <Badge variant="outline" className={cn("border text-xs", statusColors[task.status])}>
          {statusLabels[task.status]}
        </Badge>
      </div>

      {/* Arrow */}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

export default function SystemTasks() {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { username } = usePermissions();

  const [system, setSystem] = useState<AISystem | null>(null);
  const [loading, setLoading] = useState(true);

  // Determine initial tab from URL params
  const assigneeParam = searchParams.get("assignee");
  const initialTab = assigneeParam === "me" ? "needs-me" : "all";
  const [activeTab, setActiveTab] = useState(initialTab);

  const loadSystem = useCallback(async () => {
    if (!systemId) return;
    setLoading(true);
    try {
      const data = await api.getSystem(systemId);
      setSystem(data);
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => {
    loadSystem();
  }, [loadSystem]);

  // Derive tasks from system
  const allTasks = useMemo(() => {
    if (!system) return [];
    return deriveTasksFromSystem(system, username);
  }, [system, username]);

  // Filter tasks by tab
  const filteredTasks = useMemo(() => {
    switch (activeTab) {
      case "needs-me":
        return getMyTasks(allTasks, username);
      case "in-progress":
        return allTasks.filter(t => t.status === "in_progress");
      case "waiting":
        return allTasks.filter(t => t.status === "waiting" || t.status === "open");
      case "completed":
        return allTasks.filter(t => t.status === "completed");
      default:
        return allTasks;
    }
  }, [allTasks, activeTab, username]);

  // Counts for summary cards
  const counts = useMemo(() => ({
    needsMe: getMyTasks(allTasks, username).length,
    inProgress: allTasks.filter(t => t.status === "in_progress").length,
    waiting: allTasks.filter(t => t.status === "waiting" || t.status === "open").length,
    completed: allTasks.filter(t => t.status === "completed").length,
  }), [allTasks, username]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    // Update URL params
    if (tab === "needs-me") {
      setSearchParams({ assignee: "me" });
    } else {
      setSearchParams({});
    }
  };

  const handleTaskClick = (task: SystemTask) => {
    if (task.external) {
      window.location.href = task.actionHref;
    } else {
      navigate(task.actionHref);
    }
  };

  if (loading || !system) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-6 py-3 text-sm">
        <Link to="/systems" className="text-primary hover:underline">AI Systems</Link>
        <ChevronRight className="size-4 text-muted-foreground" />
        <Link to={`/systems/${systemId}`} className="text-primary hover:underline">{system.name}</Link>
        <ChevronRight className="size-4 text-muted-foreground" />
        <span className="font-medium">Tasks</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/systems/${systemId}`)}>
            <ArrowLeft className="mr-2 size-4" />
            Back to overview
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Tasks</h1>
            <p className="text-sm text-muted-foreground">{system.name}</p>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Summary cards */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            count={counts.needsMe}
            label="Needs me"
            icon={<User className="size-5" />}
            iconBg="bg-purple-100"
            iconColor="text-purple-600"
            active={activeTab === "needs-me"}
            onClick={() => handleTabChange("needs-me")}
          />
          <SummaryCard
            count={counts.inProgress}
            label="In progress"
            icon={<Clock className="size-5" />}
            iconBg="bg-blue-100"
            iconColor="text-blue-600"
            active={activeTab === "in-progress"}
            onClick={() => handleTabChange("in-progress")}
          />
          <SummaryCard
            count={counts.waiting}
            label="Waiting"
            icon={<Clock className="size-5" />}
            iconBg="bg-orange-100"
            iconColor="text-orange-600"
            active={activeTab === "waiting"}
            onClick={() => handleTabChange("waiting")}
          />
          <SummaryCard
            count={counts.completed}
            label="Completed"
            icon={<CheckCircle className="size-5" />}
            iconBg="bg-green-100"
            iconColor="text-green-600"
            active={activeTab === "completed"}
            onClick={() => handleTabChange("completed")}
          />
        </div>

        {/* Tabs and task list */}
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="all">All ({allTasks.length})</TabsTrigger>
            <TabsTrigger value="needs-me">Needs me ({counts.needsMe})</TabsTrigger>
            <TabsTrigger value="in-progress">In progress ({counts.inProgress})</TabsTrigger>
            <TabsTrigger value="waiting">Waiting ({counts.waiting})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({counts.completed})</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4">
            <Card className="overflow-hidden">
              {/* Table header */}
              <div className="flex items-center gap-4 border-b border-border bg-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <div className="flex-1">Task</div>
                <div className="w-36 shrink-0">Assignee</div>
                <div className="w-28 shrink-0">Stage</div>
                <div className="w-24 shrink-0">Priority</div>
                <div className="w-28 shrink-0">Status</div>
                <div className="w-4 shrink-0" />
              </div>

              {/* Task rows */}
              {filteredTasks.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No tasks found for this filter.
                </div>
              ) : (
                filteredTasks.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onClick={() => handleTaskClick(task)}
                  />
                ))
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
