import { useState, useEffect, useCallback } from "react";
import { FileText, ArrowRight, Calendar, ChevronRight, ChevronUp, LayoutList, LayoutGrid, HelpCircle, ArrowUpDown, RefreshCw, Filter, Columns, Clock } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/api/client";
import { deriveTasksFromSystem, getMyTasks } from "@/utils/taskUtils";
import type { AISystem, SystemTask } from "@/types";

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

/* Task table row */
interface TaskTableRowProps {
  task: {
    icon: React.ReactNode;
    iconBg: string;
    iconColor: string;
    title: string;
    system: string;
    systemId: string;
    type: string;
    taskParam: "review" | "registration" | "compliance";
    typeColor: string;
    stage: string;
    due: string;
    dueColor?: string;
    priority: "high" | "medium" | "low";
    status: string;
    statusColor: string;
    // Additional fields for optional columns
    isWaitingOnOthers?: boolean;
    waitingForUser?: string | null;
    dueDateFormatted?: string;
    isOverdue?: boolean;
    isDueSoon?: boolean;
  };
  onClick: () => void;
  visibleColumns: {
    task: boolean;
    system: boolean;
    type: boolean;
    stage: boolean;
    assignee: boolean;
    priority: boolean;
    status: boolean;
    waitingFor: boolean;
    dueDate: boolean;
  };
}

function TaskTableRow({ task, onClick, visibleColumns }: TaskTableRowProps) {
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
      {visibleColumns.system && (
        <div className="w-40 shrink-0 text-sm text-muted-foreground">{task.system}</div>
      )}

      {/* Task Type */}
      {visibleColumns.type && (
        <div className="w-32 shrink-0">
          <Badge variant="outline" className={cn("border text-xs", task.typeColor)}>
            {task.type}
          </Badge>
        </div>
      )}

      {/* Current Stage */}
      {visibleColumns.stage && (
        <div className="flex w-32 shrink-0 items-center gap-1.5 text-sm">
          <div className="size-2 rounded-full bg-primary" />
          <span>{task.stage}</span>
        </div>
      )}

      {/* Assignee */}
      {visibleColumns.assignee && (
        <div className={cn("w-28 shrink-0 text-sm", task.dueColor || "text-muted-foreground")}>
          {task.due}
        </div>
      )}

      {/* Waiting For (optional column) */}
      {visibleColumns.waitingFor && (
        <div className="w-28 shrink-0 text-sm text-muted-foreground">
          {task.waitingForUser || "—"}
        </div>
      )}

      {/* Due Date (optional column) */}
      {visibleColumns.dueDate && (
        <div className={cn(
          "w-28 shrink-0 text-sm",
          task.isOverdue ? "text-red-600 font-medium" : task.isDueSoon ? "text-orange-600" : "text-muted-foreground"
        )}>
          {task.dueDateFormatted}
          {task.isOverdue && <span className="ml-1 text-xs">(Overdue)</span>}
        </div>
      )}

      {/* Priority */}
      {visibleColumns.priority && (
        <div className="w-24 shrink-0">
          <Badge className={cn("border text-xs", priorityColors[task.priority])}>
            {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
          </Badge>
        </div>
      )}

      {/* Status */}
      {visibleColumns.status && (
        <div className="w-28 shrink-0">
          <Badge variant="outline" className={cn("border text-xs", task.statusColor)}>
            {task.status}
          </Badge>
        </div>
      )}

      {/* Arrow */}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

/* Sortable table header */
interface SortableHeaderProps {
  label: string;
  sortKey: string;
  currentSort: { key: string; direction: "asc" | "desc" } | null;
  onSort: (key: string) => void;
  className?: string;
}

function SortableHeader({ label, sortKey, currentSort, onSort, className }: SortableHeaderProps) {
  const isActive = currentSort?.key === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={cn("flex items-center gap-1 hover:text-foreground", className)}
    >
      {label}
      <ArrowUpDown className={cn("size-3", isActive && "text-primary")} />
    </button>
  );
}

export default function Today() {
  const { username } = usePermissions();
  const navigate = useNavigate();
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskViewMode, setTaskViewMode] = useState<"vertical" | "horizontal">("vertical");
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [allTasksExpanded, setAllTasksExpanded] = useState(true);
  const [taskSort, setTaskSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  // All Tasks filters
  const [taskDueFilter, setTaskDueFilter] = useState<string>("all");
  const [taskWaitingFilter, setTaskWaitingFilter] = useState<boolean>(false);
  // Column visibility for All Tasks
  const [visibleColumns, setVisibleColumns] = useState({
    task: true,
    system: true,
    type: true,
    stage: true,
    assignee: true,
    priority: true,
    status: true,
    waitingFor: false,
    dueDate: false,
  });

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
  // Only show systems where the current user has a role
  const mySystems = systems.filter(s => {
    // User is the owner
    if (s.owner_username === username) return true;
    // User is assigned as engineer/reviewer
    if (s.assignee_username === username) return true;
    // User is assigned as compliance officer
    if (s.compliance_officer_username === username) return true;
    return false;
  });

  // Derive tasks: "Your Tasks" = directly assigned to user, "All Tasks" = from all connected systems
  const yourTasks: SystemTask[] = [];
  const allConnectedTasks: SystemTask[] = [];

  mySystems.forEach(s => {
    const systemTasks = deriveTasksFromSystem(s, username);
    // All tasks from connected systems
    allConnectedTasks.push(...systemTasks);
    // Only tasks directly assigned to user
    const mySystemTasks = getMyTasks(systemTasks, username);
    yourTasks.push(...mySystemTasks);
  });

  // Get recent systems I'm involved with
  const myRecentSystems = [...mySystems].sort((a, b) =>
    new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
  );

  // Calculate counts for workload sidebar
  const assignedToMeCount = yourTasks.filter(t => t.status === "in_progress").length;
  const waitingCount = yourTasks.filter(t => t.status === "waiting").length;
  const inProgressCount = yourTasks.filter(t => t.status === "open").length;
  const totalWorkload = yourTasks.length;

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

  // Build "Your Tasks" for card display (directly assigned to user)
  const urgentTasks: TaskCardProps[] = yourTasks.map(task => {
    const system = systems.find(s => task.id.startsWith(s.id));
    return {
      type: task.type === "review" ? "review" : task.type === "registration" ? "continue" : "clarification",
      systemName: system?.name || "Unknown System",
      systemId: system?.id || "",
      description: task.description,
      dueInfo: task.status === "in_progress" ? "In progress" : "Due in 2 days",
      actionLabel: task.type === "review" ? "Start review" : task.type === "registration" ? "Continue" : "Open",
    };
  });

  // Build "All Tasks" for table display (all tasks from connected systems)
  const allTasks = allConnectedTasks.map(task => {
    const system = systems.find(s => task.id.startsWith(s.id));
    // Determine if task is waiting on someone
    const isWaitingOnOthers = task.assignee !== username && task.assignee !== null;
    const waitingForUser = isWaitingOnOthers ? task.assignee : null;
    // Mock due date - in production this would come from task data
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + Math.floor(Math.random() * 14)); // Random due date within 2 weeks
    const isOverdue = dueDate < new Date();
    const isDueSoon = !isOverdue && dueDate.getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000; // Within 3 days

    return {
      icon: task.type === "review" ? <FileText className="size-4" /> : <RefreshCw className="size-4" />,
      iconBg: task.type === "review" ? "bg-blue-50" : "bg-purple-50",
      iconColor: task.type === "review" ? "text-blue-600" : "text-purple-600",
      title: task.title,
      system: system?.name || "Unknown System",
      systemId: system?.id || "",
      type: task.type === "review" ? "Technical review" : task.type === "registration" ? "Registration" : "Compliance",
      taskParam: task.type as "review" | "registration" | "compliance",
      typeColor: task.type === "review" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-purple-50 text-purple-700 border-purple-200",
      stage: task.stage,
      assignee: task.assignee || "Unassigned",
      due: task.status === "in_progress" ? "In progress" : "Pending",
      dueColor: task.status === "in_progress" ? undefined : "text-orange-600",
      priority: task.priority as "high" | "medium" | "low",
      status: task.assignee === username ? "Assigned to me" : "In progress",
      statusColor: task.assignee === username ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-purple-50 text-purple-700 border-purple-200",
      // Additional fields for filters and optional columns
      isWaitingOnOthers,
      waitingForUser,
      dueDate,
      dueDateFormatted: dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      isOverdue,
      isDueSoon,
    };
  });

  // Filter tasks based on filter state
  const filteredTasks = allTasks.filter(task => {
    // Due date filter
    if (taskDueFilter === "overdue" && !task.isOverdue) return false;
    if (taskDueFilter === "due-soon" && !task.isDueSoon) return false;
    if (taskDueFilter === "today") {
      const today = new Date();
      if (task.dueDate.toDateString() !== today.toDateString()) return false;
    }
    // Waiting on others filter
    if (taskWaitingFilter && !task.isWaitingOnOthers) return false;
    return true;
  });

  // Handle task sorting
  const handleTaskSort = (key: string) => {
    setTaskSort(prev => {
      if (prev?.key === key) {
        return prev.direction === "asc" ? { key, direction: "desc" } : null;
      }
      return { key, direction: "asc" };
    });
  };

  // Sort tasks based on current sort state
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (!taskSort) return 0;
    const { key, direction } = taskSort;
    const multiplier = direction === "asc" ? 1 : -1;

    switch (key) {
      case "title":
        return multiplier * a.title.localeCompare(b.title);
      case "system":
        return multiplier * a.system.localeCompare(b.system);
      case "type":
        return multiplier * a.type.localeCompare(b.type);
      case "stage":
        return multiplier * a.stage.localeCompare(b.stage);
      case "priority": {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return multiplier * (priorityOrder[a.priority] - priorityOrder[b.priority]);
      }
      case "status":
        return multiplier * a.status.localeCompare(b.status);
      case "dueDate":
        return multiplier * (a.dueDate.getTime() - b.dueDate.getTime());
      default:
        return 0;
    }
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

        {/* Your Tasks Section - Tasks directly assigned to the user */}
        <div className="mb-6">
          {/* Task Section Header */}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">Your Tasks</h2>
                <Badge variant="secondary" className="rounded-full px-3 py-1 text-sm font-medium">
                  {urgentTasks.length} tasks
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Tasks directly assigned to you that require your action.
              </p>
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
                  List
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
                  Cards
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
                {tasksExpanded ? "Collapse" : "Expand"}
              </Button>
            </div>
          </div>

          {/* Your Tasks Content */}
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
                  No tasks assigned to you. You're all caught up!
                </CardContent>
              </Card>
            )
          )}
        </div>

        {/* All Tasks Section - All tasks from connected systems */}
        <div className="mb-6">
          {/* Section Header */}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">All Tasks</h2>
                <Badge variant="secondary" className="rounded-full px-3 py-1 text-sm font-medium">
                  {sortedTasks.length} tasks
                </Badge>
                {(taskDueFilter !== "all" || taskWaitingFilter) && (
                  <Badge variant="outline" className="text-xs">
                    Filtered
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                All tasks from AI systems you own, are assigned to, or collaborate on.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Filters */}
              <Select value={taskDueFilter} onValueChange={setTaskDueFilter}>
                <SelectTrigger className="h-9 w-[140px]">
                  <Clock className="mr-2 size-4" />
                  <SelectValue placeholder="Due date" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All dates</SelectItem>
                  <SelectItem value="today">Due today</SelectItem>
                  <SelectItem value="due-soon">Due soon (3 days)</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant={taskWaitingFilter ? "default" : "outline"}
                size="sm"
                onClick={() => setTaskWaitingFilter(!taskWaitingFilter)}
                className="h-9"
              >
                <Filter className="mr-2 size-4" />
                Waiting on others
              </Button>

              {/* Column Visibility */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9">
                    <Columns className="mr-2 size-4" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.waitingFor}
                    onCheckedChange={(checked) => setVisibleColumns(prev => ({ ...prev, waitingFor: checked }))}
                  >
                    Waiting for
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.dueDate}
                    onCheckedChange={(checked) => setVisibleColumns(prev => ({ ...prev, dueDate: checked }))}
                  >
                    Due date
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.type}
                    onCheckedChange={(checked) => setVisibleColumns(prev => ({ ...prev, type: checked }))}
                  >
                    Task Type
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.stage}
                    onCheckedChange={(checked) => setVisibleColumns(prev => ({ ...prev, stage: checked }))}
                  >
                    Current Stage
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.priority}
                    onCheckedChange={(checked) => setVisibleColumns(prev => ({ ...prev, priority: checked }))}
                  >
                    Priority
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAllTasksExpanded(!allTasksExpanded)}
                className="flex items-center gap-1 text-muted-foreground"
              >
                <ChevronUp className={cn("size-4 transition-transform", !allTasksExpanded && "rotate-180")} />
                {allTasksExpanded ? "Collapse" : "Expand"}
              </Button>
            </div>
          </div>

          {/* All Tasks Content */}
          {allTasksExpanded && (
            sortedTasks.length > 0 ? (
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  {/* Table Header with Sortable Columns */}
                  <div className="flex items-center gap-4 border-b border-border bg-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <SortableHeader label="Task" sortKey="title" currentSort={taskSort} onSort={handleTaskSort} className="flex-1" />
                    {visibleColumns.system && <SortableHeader label="AI System" sortKey="system" currentSort={taskSort} onSort={handleTaskSort} className="w-40 shrink-0" />}
                    {visibleColumns.type && <SortableHeader label="Task Type" sortKey="type" currentSort={taskSort} onSort={handleTaskSort} className="w-32 shrink-0" />}
                    {visibleColumns.stage && <SortableHeader label="Current Stage" sortKey="stage" currentSort={taskSort} onSort={handleTaskSort} className="w-32 shrink-0" />}
                    {visibleColumns.assignee && <div className="w-28 shrink-0">Assignee</div>}
                    {visibleColumns.waitingFor && <div className="w-28 shrink-0">Waiting for</div>}
                    {visibleColumns.dueDate && <SortableHeader label="Due Date" sortKey="dueDate" currentSort={taskSort} onSort={handleTaskSort} className="w-28 shrink-0" />}
                    {visibleColumns.priority && <SortableHeader label="Priority" sortKey="priority" currentSort={taskSort} onSort={handleTaskSort} className="w-24 shrink-0" />}
                    {visibleColumns.status && <SortableHeader label="Status" sortKey="status" currentSort={taskSort} onSort={handleTaskSort} className="w-28 shrink-0" />}
                    <div className="w-4 shrink-0"></div>
                  </div>

                  {/* Table Rows */}
                  {loading ? (
                    <div className="py-8 text-center text-muted-foreground">Loading...</div>
                  ) : (
                    sortedTasks.map((task, i) => (
                      <TaskTableRow
                        key={i}
                        task={task}
                        onClick={() => navigate(`/systems/${task.systemId}?task=${task.taskParam}`)}
                        visibleColumns={visibleColumns}
                      />
                    ))
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No tasks from your AI systems.
                </CardContent>
              </Card>
            )
          )}
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
                  {/* Assigned to me segment (blue) */}
                  {assignedToMeCount > 0 && (
                    <circle
                      cx="64"
                      cy="64"
                      r="52"
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="16"
                      strokeDasharray={`${(assignedToMeCount / Math.max(totalWorkload, 1)) * 327} 327`}
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
                      strokeDashoffset={`${-(assignedToMeCount / Math.max(totalWorkload, 1)) * 327}`}
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
                      strokeDashoffset={`${-((assignedToMeCount + inProgressCount) / Math.max(totalWorkload, 1)) * 327}`}
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
                  <span>Assigned to me</span>
                </div>
                <span className="font-semibold">{assignedToMeCount}</span>
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
              <Link to="/systems" className="text-xs font-medium text-primary hover:underline">
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
