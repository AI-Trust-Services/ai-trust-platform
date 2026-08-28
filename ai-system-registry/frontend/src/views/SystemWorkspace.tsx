import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router";
import {
  ChevronRight, ChevronLeft, MoreHorizontal, CheckCircle2,
  Circle, Info, ArrowRight, FileText, ClipboardList, Shield, Files,
  Activity, FolderOpen, StickyNote, Database, BarChart3, Bell, Search as SearchIcon,
  Users, Building2, Calendar, ExternalLink, Sparkles, Edit
} from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import { usePermissions } from "../hooks/usePermissions";
import { getPrimarySystemAction } from "../utils/systemActions";
import { deriveTasksFromSystem, getMyTasks } from "../utils/taskUtils";
import type { AISystem, ModelCard } from "../types";
import type { UserMap } from "../components/SystemDetail";
import { AssessmentsTab, ObligationsTab, ControlsTab, EvidenceTab } from "../components/compliance";
import ModelPickerModal from "../components/ModelPickerModal";
import EngineerAssistedRegistration from "../components/EngineerAssistedRegistration";
import RegisterWizard from "../components/RegisterWizard";
import ActivityTab from "../components/ActivityTab";
import NotesTab from "../components/NotesTab";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// Lifecycle stages
const LIFECYCLE_STAGES = [
  { key: "register", label: "Register" },
  { key: "review", label: "Review" },
  { key: "classify", label: "Classify" },
  { key: "comply", label: "Comply" },
  { key: "operate", label: "Operate" },
];

// Map backend lifecycle values to our stages
function getLifecycleStageIndex(lifecycle: string): number {
  const mapping: Record<string, number> = {
    development: 0,
    testing: 1,
    conformity: 2,
    market: 3,
    "post-market": 4,
    decommissioned: 4,
  };
  return mapping[lifecycle] ?? 0;
}

// Risk level badge
function RiskBadge({ tier }: { tier: string }) {
  const config: Record<string, { label: string; className: string }> = {
    prohibited: { label: "Prohibited", className: "bg-red-100 text-red-700" },
    high: { label: "High Risk", className: "bg-red-100 text-red-700" },
    "gpai-systemic": { label: "GPAI Systemic", className: "bg-red-100 text-red-700" },
    "gpai-standard": { label: "GPAI Standard", className: "bg-orange-100 text-orange-700" },
    limited: { label: "Limited Risk", className: "bg-orange-100 text-orange-700" },
    minimal: { label: "Minimal Risk", className: "bg-green-100 text-green-700" },
  };
  const c = config[tier] || { label: tier, className: "bg-gray-100 text-gray-700" };
  return <Badge className={cn("border-0", c.className)}>{c.label}</Badge>;
}

// Lifecycle progress bar
function LifecycleBar({ currentIndex }: { currentIndex: number }) {
  return (
    <div className="flex items-center justify-center gap-0 py-6">
      {LIFECYCLE_STAGES.map((stage, i) => {
        const isCompleted = i < currentIndex;
        const isCurrent = i === currentIndex;
        const isFuture = i > currentIndex;

        return (
          <div key={stage.key} className="flex items-center">
            {/* Connector line before (except first) */}
            {i > 0 && (
              <div
                className={cn(
                  "h-0.5 w-16",
                  isCompleted || isCurrent ? "bg-primary" : "bg-muted"
                )}
              />
            )}

            {/* Stage indicator */}
            <div className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  "flex items-center justify-center rounded-full transition-all",
                  isCurrent
                    ? "size-10 bg-primary text-primary-foreground ring-4 ring-primary/20"
                    : isCompleted
                      ? "size-8 bg-primary text-primary-foreground"
                      : "size-8 bg-muted text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <CheckCircle2 className="size-5" />
                ) : isCurrent ? (
                  <Circle className="size-5 fill-current" />
                ) : (
                  <Circle className="size-4" />
                )}
              </div>
              <span
                className={cn(
                  "text-xs font-medium uppercase tracking-wide",
                  isCurrent
                    ? "text-primary"
                    : isCompleted
                      ? "text-muted-foreground"
                      : "text-muted-foreground/60"
                )}
              >
                {stage.label}
              </span>
            </div>

            {/* Connector line after (except last) */}
            {i < LIFECYCLE_STAGES.length - 1 && (
              <div
                className={cn(
                  "h-0.5 w-16",
                  isCompleted ? "bg-primary" : "bg-muted"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Current status banner
function StatusBanner({ system, currentUsername, onOpenTasks }: { system: AISystem; currentUsername: string; onOpenTasks: () => void }) {
  const stageIndex = getLifecycleStageIndex(system.lifecycle);
  const stageName = LIFECYCLE_STAGES[stageIndex]?.label || "Unknown";

  // Derive status message from real system data
  let statusMessage = `This system is currently in the ${stageName} stage.`;
  let assigneeMessage = "";

  if (system.workflow_status === "draft") {
    statusMessage = `This system registration is in progress.`;
    assigneeMessage = system.owner_username ? `${system.owner_username} is completing the registration.` : "Registration not yet complete.";
  } else if (system.workflow_status === "pending_review") {
    statusMessage = `This system is pending technical review.`;
    assigneeMessage = system.assignee_username ? `Assigned to ${system.assignee_username} for review.` : "Awaiting assignment.";
  } else if (system.workflow_status === "approved") {
    statusMessage = `This system has been approved and is in the ${stageName} stage.`;
    assigneeMessage = system.assignee_username ? `Last reviewed by ${system.assignee_username}.` : "";
  }

  // Use shared task derivation logic
  const allTasks = deriveTasksFromSystem(system, currentUsername);
  const myTasks = getMyTasks(allTasks, currentUsername);
  const myTaskCount = myTasks.length;
  const totalTaskCount = allTasks.length;

  // Show "Open my tasks" if user has tasks, otherwise "View tasks" for total
  const showMyTasks = myTaskCount > 0;

  return (
    <div className="mx-6 mb-6 flex items-center justify-between rounded-lg bg-accent px-5 py-4">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 size-5 text-primary" />
        <div>
          <p className="font-medium text-foreground">{statusMessage}</p>
          {assigneeMessage && <p className="text-sm text-muted-foreground">{assigneeMessage}</p>}
        </div>
      </div>
      {totalTaskCount > 0 && (
        <Button variant="outline" size="sm" onClick={onOpenTasks}>
          {showMyTasks ? `Open my tasks (${myTaskCount})` : `View tasks (${totalTaskCount})`}
        </Button>
      )}
    </div>
  );
}

// System summary card - truncated text
function SystemSummary({ system }: { system: AISystem }) {
  const [expanded, setExpanded] = useState(false);
  const description = system.description || system.intended_use || "No description provided.";
  // Limit to ~60% of original length when not expanded
  const maxLen = 150;
  const truncated = description.length > maxLen && !expanded;
  const displayText = truncated ? description.slice(0, maxLen) + "..." : description;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">System summary</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {displayText}
        </p>
        {description.length > maxLen && (
          <Button
            variant="link"
            className="mt-2 h-auto p-0 text-sm"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Show less" : "Show more"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// AI Act category card
function AIActCategory({ system }: { system: AISystem }) {
  const category = system.tier === "high" || system.tier === "gpai-systemic"
    ? "Annex III"
    : system.tier === "prohibited"
      ? "Article 5"
      : "—";

  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">AI Act category</div>
      <div className="flex items-center gap-2">
        <FileText className="size-4 text-primary" />
        <div>
          <div className="font-medium">{category}</div>
          <div className="text-xs text-muted-foreground">
            {system.tier === "high" ? "High-Risk AI System" : system.tier}
          </div>
        </div>
      </div>
    </div>
  );
}

// Key information card
function KeyInformation({ system, onViewDetails }: { system: AISystem; onViewDetails: () => void }) {
  const items = [
    { label: "Intended purpose", value: system.intended_use || "—" },
    { label: "Model / Provider", value: system.provider || "—" },
    { label: "Automation level", value: "Partially automated", extra: "Level 3/4" },
    { label: "Human oversight", value: "Required" },
    { label: "Data categories", value: system.data_categories || "—" },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Key information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div key={item.label} className="flex items-start justify-between gap-4">
            <span className="text-sm text-muted-foreground">{item.label}</span>
            <div className="text-right">
              <span className="text-sm">{item.value}</span>
              {item.extra && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {item.extra}
                </Badge>
              )}
            </div>
          </div>
        ))}
        <Button variant="link" className="h-auto p-0 text-sm" onClick={onViewDetails}>
          View all system details <ArrowRight className="ml-1 size-3" />
        </Button>
      </CardContent>
    </Card>
  );
}

// Current tasks card - derived from system workflow status
function CurrentTasks({ system, onStartTask, onViewAllTasks }: { system: AISystem; onStartTask: (taskType: string) => void; onViewAllTasks: () => void }) {
  const stageIndex = getLifecycleStageIndex(system.lifecycle);
  const stageName = LIFECYCLE_STAGES[stageIndex]?.label || "Unknown";

  // Derive tasks from system state
  const tasks: Array<{
    id: string;
    title: string;
    subtitle: string;
    dueDate: string;
    dueLabel: string;
    assignee: string;
    assigneeRole: string;
    priority: string;
    priorityColor: string;
    taskType: string;
  }> = [];

  if (system.workflow_status === "draft") {
    tasks.push({
      id: "registration",
      title: "Complete system registration",
      subtitle: "Registration in progress",
      dueDate: "—",
      dueLabel: "In progress",
      assignee: system.owner_username || "Unassigned",
      assigneeRole: "Owner",
      priority: "Medium",
      priorityColor: "bg-orange-100 text-orange-700",
      taskType: "registration",
    });
  }

  if (system.workflow_status === "pending_review") {
    tasks.push({
      id: "review",
      title: "Review technical information",
      subtitle: "Technical review required",
      dueDate: "—",
      dueLabel: "Pending",
      assignee: system.assignee_username || system.owner_username || "Unassigned",
      assigneeRole: "Assignee",
      priority: "High",
      priorityColor: "bg-red-100 text-red-700",
      taskType: "review",
    });
  }

  if (system.tier === "high" || system.tier === "gpai-systemic") {
    tasks.push({
      id: "compliance",
      title: "Complete compliance assessment",
      subtitle: `${stageName} Assessment`,
      dueDate: "—",
      dueLabel: "Required",
      assignee: system.compliance_officer_username || system.assignee_username || "Unassigned",
      assigneeRole: "Compliance Officer",
      priority: "High",
      priorityColor: "bg-red-100 text-red-700",
      taskType: "compliance",
    });
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Current tasks ({tasks.length})</CardTitle>
        <Button variant="link" className="h-auto p-0 text-sm" onClick={onViewAllTasks}>
          View all system tasks <ArrowRight className="ml-1 size-3" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending tasks for this system.</p>
        ) : (
          tasks.map((task, i) => (
            <div key={task.id} className="space-y-2">
              <div className="flex items-start gap-2">
                <Circle className={cn("mt-1 size-2 shrink-0", i === 0 ? "fill-blue-500 text-blue-500" : "fill-orange-500 text-orange-500")} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{task.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{task.subtitle}</div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <div className="text-muted-foreground">{task.dueLabel}</div>
                </div>
              </div>
              <div className="ml-4 flex flex-wrap items-center gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 text-xs text-muted-foreground">Assigned</span>
                  <Avatar className="size-5 shrink-0">
                    <AvatarFallback className="bg-primary text-[7px] text-primary-foreground">
                      {task.assignee.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate text-xs">{task.assignee}</span>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <Badge className={cn("border-0 text-[10px]", task.priorityColor)}>
                    {task.priority}
                  </Badge>
                  <Button
                    size="sm"
                    variant={i === 0 ? "default" : "outline"}
                    className="h-7 px-2 text-xs"
                    onClick={() => onStartTask(task.taskType)}
                  >
                    {i === 0 ? "Start" : "Open"}
                  </Button>
                </div>
              </div>
              {i < tasks.length - 1 && <Separator className="mt-4" />}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// Recent activity card - derived from system data
function RecentActivity({ system, onViewAll }: { system: AISystem; onViewAll: () => void }) {
  // Build activity from system state
  const activities: Array<{
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    subtitle: string;
    time: string;
    iconBg: string;
    iconColor: string;
  }> = [];

  const createdDate = new Date(system.created_at);
  const updatedDate = new Date(system.updated_at || system.created_at);
  const formatDate = (d: Date) => {
    const isToday = d.toDateString() === new Date().toDateString();
    return isToday
      ? `Today, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
      : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  // Add activity based on workflow status
  if (system.workflow_status === "approved") {
    activities.push({
      icon: CheckCircle2,
      title: "System approved",
      subtitle: `by ${system.assignee_username || "system"}`,
      time: formatDate(updatedDate),
      iconBg: "bg-green-100",
      iconColor: "text-green-600",
    });
  }

  if (system.workflow_status === "pending_review") {
    activities.push({
      icon: FileText,
      title: "Submitted for review",
      subtitle: `by ${system.owner_username || "owner"}`,
      time: formatDate(updatedDate),
      iconBg: "bg-orange-100",
      iconColor: "text-orange-600",
    });
  }

  if (system.tier && system.tier !== "pending") {
    activities.push({
      icon: CheckCircle2,
      title: `Classification: ${system.tier}`,
      subtitle: "Auto-classified",
      time: formatDate(updatedDate),
      iconBg: "bg-blue-100",
      iconColor: "text-blue-600",
    });
  }

  // Always show creation
  activities.push({
    icon: FileText,
    title: "System registered",
    subtitle: `by ${system.owner_username || "owner"}`,
    time: formatDate(createdDate),
    iconBg: "bg-purple-100",
    iconColor: "text-purple-600",
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Recent activity</CardTitle>
        <Button variant="link" className="h-auto p-0 text-sm" onClick={onViewAll}>
          View all <ArrowRight className="ml-1 size-3" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {activities.slice(0, 4).map((activity, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", activity.iconBg)}>
              <activity.icon className={cn("size-4", activity.iconColor)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{activity.title}</div>
              <div className="text-xs text-muted-foreground">{activity.subtitle}</div>
            </div>
            <div className="text-xs text-muted-foreground whitespace-nowrap">{activity.time}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// Details tab - comprehensive system information with missing field highlighting
function DetailsTab({ system, onEdit, onAIAssist }: { system: AISystem; onEdit: () => void; onAIAssist: () => void }) {
  const LIFECYCLE_LABELS: Record<string, string> = {
    development: "Development",
    testing: "Testing",
    conformity: "Conformity Assessment",
    market: "On Market",
    "post-market": "Post-Market",
    decommissioned: "Decommissioned",
  };

  // Define required and recommended fields with their labels
  const FIELD_DEFINITIONS = {
    required: [
      { key: "name", label: "System Name" },
      { key: "description", label: "Description" },
      { key: "intended_purpose", label: "Intended Purpose", fallback: "intended_use" },
      { key: "provider", label: "Provider" },
      { key: "version", label: "Version" },
      { key: "owner_username", label: "Owner" },
    ],
    recommended: [
      { key: "org_name", label: "Organisation" },
      { key: "provider_country", label: "Country" },
      { key: "use_case", label: "Use Case" },
      { key: "people_affected", label: "People Affected" },
      { key: "data_categories", label: "Data Categories" },
      { key: "department", label: "Department" },
      { key: "application_url", label: "Application URL" },
      { key: "assignee_username", label: "Assignee" },
    ],
  };

  // Check if a field has a value
  const hasValue = (key: string, fallback?: string): boolean => {
    const val = (system as Record<string, unknown>)[key];
    if (val !== null && val !== undefined && val !== "") return true;
    if (fallback) {
      const fallbackVal = (system as Record<string, unknown>)[fallback];
      return fallbackVal !== null && fallbackVal !== undefined && fallbackVal !== "";
    }
    return false;
  };

  // Calculate completion stats
  const requiredFilled = FIELD_DEFINITIONS.required.filter(f => hasValue(f.key, f.fallback)).length;
  const requiredTotal = FIELD_DEFINITIONS.required.length;
  const recommendedFilled = FIELD_DEFINITIONS.recommended.filter(f => hasValue(f.key)).length;
  const recommendedTotal = FIELD_DEFINITIONS.recommended.length;
  const totalFilled = requiredFilled + recommendedFilled;
  const totalFields = requiredTotal + recommendedTotal;
  const completionPct = Math.round((totalFilled / totalFields) * 100);

  // Get missing fields
  const missingRequired = FIELD_DEFINITIONS.required.filter(f => !hasValue(f.key, f.fallback));
  const missingRecommended = FIELD_DEFINITIONS.recommended.filter(f => !hasValue(f.key));

  const DetailRow = ({ label, value, required, missing }: { label: string; value: React.ReactNode; required?: boolean; missing?: boolean }) => (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className={cn(
        "text-sm",
        missing ? "text-destructive font-medium" : "text-muted-foreground"
      )}>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      <span className={cn(
        "text-sm text-right",
        missing ? "text-muted-foreground italic" : "font-medium"
      )}>
        {missing ? "Not provided" : (value || "—")}
      </span>
    </div>
  );

  const Section = ({ title, children, missingCount }: { title: string; children: React.ReactNode; missingCount?: number }) => (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          {missingCount !== undefined && missingCount > 0 && (
            <Badge variant="secondary" className="font-normal">
              {missingCount} missing
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        {children}
      </CardContent>
    </Card>
  );

  const FlagItem = ({ checked, label }: { checked: boolean; label: string }) => (
    <div className="flex items-center gap-2 py-1">
      <div className={cn(
        "size-4 rounded border flex items-center justify-center text-xs",
        checked ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30"
      )}>
        {checked && "✓"}
      </div>
      <span className={cn("text-sm", checked ? "text-foreground" : "text-muted-foreground")}>{label}</span>
    </div>
  );

  // Count missing in each section
  const identityMissing = ["provider", "version", "org_name", "provider_country"].filter(k => !hasValue(k)).length;
  const purposeMissing = ["description", "intended_purpose", "use_case", "people_affected", "data_categories"]
    .filter(k => k === "intended_purpose" ? !hasValue(k, "intended_use") : !hasValue(k)).length;
  const ownershipMissing = ["owner_username", "assignee_username", "department"].filter(k => !hasValue(k)).length;

  const hasMissingFields = missingRequired.length > 0 || missingRecommended.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">System Details</h2>
          <p className="text-sm text-muted-foreground">Complete information about this AI system</p>
        </div>
        {!hasMissingFields && (
          <Badge className="bg-green-100 text-green-700 border-green-200">
            <CheckCircle2 className="size-3 mr-1" />
            Complete
          </Badge>
        )}
      </div>

      {/* Completion Summary Card - only show when fields are missing */}
      {hasMissingFields && (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-5">
              {/* Progress circle */}
              <div className="relative flex size-16 shrink-0 items-center justify-center">
                <svg className="size-16 -rotate-90" viewBox="0 0 36 36">
                  <path
                    className="text-muted/30"
                    stroke="currentColor"
                    strokeWidth="3"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    className="text-primary"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={`${completionPct}, 100`}
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
                <span className="absolute text-lg font-semibold">{completionPct}%</span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold">
                    {missingRequired.length > 0 ? "Missing Required Information" : "Almost Complete"}
                  </h3>
                  <span className="text-sm text-muted-foreground">
                    {totalFilled} of {totalFields} fields
                  </span>
                </div>

                {missingRequired.length > 0 && (
                  <div className="mb-2">
                    <span className="text-sm text-muted-foreground">Required: </span>
                    <span className="text-sm">
                      {missingRequired.map(f => f.label).join(", ")}
                    </span>
                  </div>
                )}

                {missingRecommended.length > 0 && (
                  <div className="mb-3">
                    <span className="text-sm text-muted-foreground">Recommended: </span>
                    <span className="text-sm">
                      {missingRecommended.map(f => f.label).join(", ")}
                    </span>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2">
                  <Button onClick={onEdit} variant="outline" size="sm">
                    <Edit className="size-4 mr-1.5" />
                    Edit Manually
                  </Button>
                  <Button onClick={onAIAssist} size="sm">
                    <Sparkles className="size-4 mr-1.5" />
                    Complete with AI
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Identity */}
        <Section title="Identity" missingCount={identityMissing}>
          <DetailRow label="System Name" value={system.name} required missing={!hasValue("name")} />
          <DetailRow label="System ID" value={system.id} />
          <DetailRow label="Version" value={system.version} required missing={!hasValue("version")} />
          <DetailRow label="Provider" value={system.provider} required missing={!hasValue("provider")} />
          <DetailRow label="Organisation" value={system.org_name} missing={!hasValue("org_name")} />
          <DetailRow label="Role" value={system.org_role} />
          <DetailRow label="Country" value={system.provider_country} missing={!hasValue("provider_country")} />
          <DetailRow label="System Type" value={system.system_type} />
          <DetailRow label="Autonomy Level" value={system.autonomy_level?.replace(/_/g, " ")} />
          <DetailRow
            label="Application URL"
            missing={!hasValue("application_url")}
            value={
              system.application_url ? (
                <a href={system.application_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  {system.application_url}
                </a>
              ) : null
            }
          />
        </Section>

        {/* Purpose */}
        <Section title="Purpose" missingCount={purposeMissing}>
          <DetailRow label="Description" value={system.description} required missing={!hasValue("description")} />
          <DetailRow label="Intended Purpose" value={system.intended_purpose || system.intended_use} required missing={!hasValue("intended_purpose", "intended_use")} />
          <DetailRow label="Use Case" value={system.use_case} missing={!hasValue("use_case")} />
          <DetailRow label="People Affected" value={system.people_affected} missing={!hasValue("people_affected")} />
          <DetailRow label="Data Categories" value={system.data_categories} missing={!hasValue("data_categories")} />
        </Section>

        {/* Classification */}
        <Section title="Classification">
          <DetailRow label="Risk Tier" value={
            <Badge variant="secondary">{system.tier}</Badge>
          } />
          <DetailRow label="Classification Basis" value={system.basis} />
          {system.annex_iii_area != null && (
            <DetailRow label="Annex III Area" value={`Area ${system.annex_iii_area}`} />
          )}
          <DetailRow label="Is GPAI" value={system.is_gpai ? "Yes" : "No"} />
          {system.is_gpai && (
            <DetailRow label="Training Compute (FLOPs)" value={system.training_compute_flops?.toExponential()} />
          )}
        </Section>

        {/* Lifecycle */}
        <Section title="Lifecycle">
          <DetailRow label="Current State" value={
            <Badge variant="outline">{LIFECYCLE_LABELS[system.lifecycle] || system.lifecycle}</Badge>
          } />
          <DetailRow label="Workflow Status" value={
            <Badge variant={system.workflow_status === "approved" ? "default" : "secondary"}>
              {system.workflow_status}
            </Badge>
          } />
          <DetailRow label="Compliance Score" value={system.compliance != null ? `${system.compliance}%` : "—"} />
          <DetailRow label="Created" value={new Date(system.created_at).toLocaleString()} />
          <DetailRow label="Last Updated" value={new Date(system.updated_at).toLocaleString()} />
        </Section>
      </div>

      {/* Risk Flags */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Risk Flags</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-3">
            {/* Art. 5 Prohibited */}
            <div>
              <h4 className="mb-3 text-sm font-medium text-muted-foreground">Art. 5 — Prohibited Practices</h4>
              <div className="space-y-1">
                <FlagItem checked={!!system.subliminal_manipulation} label="Subliminal manipulation" />
                <FlagItem checked={!!system.exploits_vulnerability} label="Exploits vulnerability" />
                <FlagItem checked={!!system.social_scoring_public} label="Social scoring (public)" />
                <FlagItem checked={!!system.real_time_biometric_public} label="Real-time biometric ID" />
                <FlagItem checked={!!system.emotion_recognition_workplace} label="Emotion recognition (workplace)" />
                <FlagItem checked={!!system.untargeted_facial_scraping} label="Untargeted facial scraping" />
                <FlagItem checked={!!system.predictive_policing} label="Predictive policing" />
                <FlagItem checked={!!system.biometric_categorisation_sensitive} label="Biometric categorisation" />
              </div>
            </div>

            {/* Annex III High-Risk */}
            <div>
              <h4 className="mb-3 text-sm font-medium text-muted-foreground">Annex III — High-Risk</h4>
              <div className="space-y-1">
                <FlagItem checked={!!system.is_biometric_identification} label="Biometric identification" />
                <FlagItem checked={!!system.is_critical_infrastructure} label="Critical infrastructure" />
                <FlagItem checked={!!system.is_education_related} label="Education & training" />
                <FlagItem checked={!!system.is_employment_related} label="Employment" />
                <FlagItem checked={!!system.is_credit_scoring} label="Credit scoring" />
                <FlagItem checked={!!system.is_public_service} label="Public services" />
                <FlagItem checked={!!system.is_law_enforcement} label="Law enforcement" />
                <FlagItem checked={!!system.is_migration} label="Migration & border" />
                <FlagItem checked={!!system.is_judicial_admin} label="Justice & democracy" />
              </div>
            </div>

            {/* Art. 50 Limited */}
            <div>
              <h4 className="mb-3 text-sm font-medium text-muted-foreground">Art. 50 — Limited Risk</h4>
              <div className="space-y-1">
                <FlagItem checked={!!system.is_chatbot} label="Chatbot / user interaction" />
                <FlagItem checked={!!system.generates_synthetic_content} label="Generates synthetic content" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ownership */}
      <Section title="Ownership & Assignment" missingCount={ownershipMissing}>
        <DetailRow label="Owner" value={system.owner_username} required missing={!hasValue("owner_username")} />
        <DetailRow label="Assignee" value={system.assignee_username} missing={!hasValue("assignee_username")} />
        <DetailRow label="Compliance Officer" value={system.compliance_officer_username} />
        <DetailRow label="Department" value={system.department} missing={!hasValue("department")} />
      </Section>
    </div>
  );
}

// Governance details panel (collapsed by default) - now a Card without border-l
function GovernancePanel({ system }: { system: AISystem }) {
  return (
    <div className="bg-card p-6">
      <Card>
        <CardContent className="flex flex-col items-center p-6 text-center">
          <div className="mb-4 flex size-16 items-center justify-center rounded-xl bg-primary/10">
            <FileText className="size-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold">Governance & compliance details</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Detailed governance information, assessments, obligations, controls and evidence are hidden to keep the overview clean.
          </p>
          <Button variant="link" className="mt-4">
            Show details
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SystemWorkspace() {
  const { systemId } = useParams<{ systemId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const { can, username } = usePermissions();

  const [system, setSystem] = useState<AISystem | null>(null);
  const [models, setModels] = useState<ModelCard[]>([]);
  const [userMap, setUserMap] = useState<UserMap>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showAIAssist, setShowAIAssist] = useState(false);
  const [showEditWizard, setShowEditWizard] = useState(false);

  // Handle tab query parameter
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && ["overview", "tasks", "details", "assessments", "obligations", "controls", "evidence", "activity", "documents", "notes", "models"].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // Navigate to system tasks view with "needs me" filter
  const handleOpenMyTasks = useCallback(() => {
    navigate(`/systems/${systemId}/tasks?assignee=me`);
  }, [navigate, systemId]);

  // Navigate to system tasks view (all tasks)
  const handleViewAllTasks = useCallback(() => {
    navigate(`/systems/${systemId}/tasks`);
  }, [navigate, systemId]);

  const handleStartTask = useCallback((taskType: string) => {
    if (taskType === "registration") {
      setActiveTab("details");
    } else if (taskType === "review") {
      setActiveTab("details");
    } else if (taskType === "compliance") {
      window.location.href = `/compliance/#/systems/${systemId}`;
    }
  }, [systemId]);

  const loadSystem = useCallback(async () => {
    if (!systemId) return;
    setLoading(true);
    try {
      const data = await api.getSystem(systemId);
      setSystem(data);
    } catch (e) {
      showToast(`Failed to load system: ${(e as Error).message}`, true);
    } finally {
      setLoading(false);
    }
  }, [systemId, showToast]);

  const loadModels = useCallback(async () => {
    try {
      const data = await api.getModels();
      setModels(data);
    } catch (e) {
      // Silently fail for models
    }
  }, []);

  const handleDelete = useCallback(async () => {
    if (!systemId) return;
    setDeleting(true);
    try {
      await api.deleteSystem(systemId);
      showToast("System deleted successfully");
      navigate("/systems");
    } catch (e) {
      showToast(`Failed to delete system: ${(e as Error).message}`, true);
    } finally {
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  }, [systemId, showToast, navigate]);

  const handleLinkModel = useCallback(async (modelId: string) => {
    if (!systemId) return;
    try {
      const updated = await api.linkModel(systemId, modelId);
      setSystem(updated);
      showToast("Model linked successfully");
    } catch (e) {
      showToast(`Failed to link model: ${(e as Error).message}`, true);
      throw e;
    }
  }, [systemId, showToast]);

  const handleUnlinkModel = useCallback(async () => {
    if (!systemId) return;
    try {
      const updated = await api.unlinkModel(systemId);
      setSystem(updated);
      showToast("Model unlinked");
    } catch (e) {
      showToast(`Failed to unlink model: ${(e as Error).message}`, true);
    }
  }, [systemId, showToast]);

  useEffect(() => {
    loadSystem();
    loadModels();
  }, [loadSystem, loadModels]);

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

  if (loading || !system) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const owner = userMap[system.owner_username || ""] || {};
  const ownerName = [owner.firstName, owner.lastName].filter(Boolean).join(" ") || system.owner_username || "—";
  const ownerInitials = owner.firstName && owner.lastName
    ? (owner.firstName[0] + owner.lastName[0]).toUpperCase()
    : (system.owner_username || "?").slice(0, 2).toUpperCase();

  const lifecycleIndex = getLifecycleStageIndex(system.lifecycle);
  const lastUpdated = new Date(system.updated_at || system.created_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-6 py-3 text-sm">
        <Link to="/systems" className="text-primary hover:underline">AI Systems</Link>
        <ChevronRight className="size-4 text-muted-foreground" />
        <span className="font-medium">{system.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between border-b border-border bg-card px-6 py-5">
        <div className="flex items-start gap-4">
          <div className="flex size-14 items-center justify-center rounded-xl bg-primary/10 text-2xl">
            👥
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{system.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <FileText className="size-4" />
                <span>System ID</span>
                <span className="font-medium text-foreground">{system.id}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Building2 className="size-4" />
                <span>Business unit</span>
                <span className="font-medium text-foreground">{system.department || "—"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Avatar className="size-6">
                  <AvatarFallback className="bg-primary text-[9px] text-primary-foreground">
                    {ownerInitials}
                  </AvatarFallback>
                </Avatar>
                <span>Owner</span>
                <span className="font-medium text-foreground">{ownerName}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="size-4" />
                <span>Last updated</span>
                <span className="font-medium text-foreground">{lastUpdated}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(() => {
            const primaryAction = getPrimarySystemAction({
              system,
              currentUsername: username,
              canWrite: can("systems:write"),
            });
            return (
              <Button
                variant="default"
                onClick={() => {
                  if (primaryAction.external) {
                    window.location.href = primaryAction.href;
                  } else {
                    navigate(primaryAction.href);
                  }
                }}
                disabled={primaryAction.disabled}
                title={primaryAction.disabledReason}
              >
                {primaryAction.label}
              </Button>
            );
          })()}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Export</DropdownMenuItem>
              <DropdownMenuItem>Archive</DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Lifecycle bar */}
          <LifecycleBar currentIndex={lifecycleIndex} />

          {/* Status banner */}
          <StatusBanner system={system} currentUsername={username} onOpenTasks={handleOpenMyTasks} />

          {/* Tabs */}
          <div className="flex-1 overflow-auto">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
              <div className="border-b border-border px-6">
                <TabsList className="h-auto bg-transparent p-0">
                  <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">
                    <FileText className="mr-2 size-4" />
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="tasks" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">
                    <ClipboardList className="mr-2 size-4" />
                    Tasks
                  </TabsTrigger>
                  <TabsTrigger value="details" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">
                    <Info className="mr-2 size-4" />
                    Details
                  </TabsTrigger>
                  <TabsTrigger value="assessments" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">
                    <ClipboardList className="mr-2 size-4" />
                    Assessments
                  </TabsTrigger>
                  <TabsTrigger value="obligations" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">
                    <ClipboardList className="mr-2 size-4" />
                    Obligations
                  </TabsTrigger>
                  <TabsTrigger value="controls" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">
                    <Shield className="mr-2 size-4" />
                    Controls
                  </TabsTrigger>
                  <TabsTrigger value="evidence" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">
                    <Files className="mr-2 size-4" />
                    Evidence
                  </TabsTrigger>
                  <TabsTrigger value="activity" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">
                    <Activity className="mr-2 size-4" />
                    Activity
                  </TabsTrigger>
                  <TabsTrigger value="documents" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">
                    <FolderOpen className="mr-2 size-4" />
                    Documents
                  </TabsTrigger>
                  <TabsTrigger value="notes" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">
                    <StickyNote className="mr-2 size-4" />
                    Notes
                  </TabsTrigger>
                  <TabsTrigger value="models" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">
                    <Database className="mr-2 size-4" />
                    Models
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="overview" className="m-0 h-full">
                <div className="flex h-full">
                  {/* Main content area */}
                  <div className="flex-1 overflow-auto p-6">
                    {/* System summary + AI Act info row */}
                    <div className="mb-6 grid gap-6 lg:grid-cols-3">
                      <div className="lg:col-span-1">
                        <SystemSummary system={system} />
                      </div>
                      <Card className="lg:col-span-2">
                        <CardContent className="grid gap-6 p-6 md:grid-cols-3">
                          <AIActCategory system={system} />
                          <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Primary use</div>
                            <div className="flex items-center gap-2">
                              <Users className="size-4 text-muted-foreground" />
                              <span className="font-medium">{system.use_case || "HR & Recruitment"}</span>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Affected people</div>
                            <div className="flex items-center gap-2">
                              <Users className="size-4 text-muted-foreground" />
                              <div>
                                <div className="font-medium">{system.people_affected || "Job applicants"}</div>
                                <div className="text-xs text-muted-foreground">(EU)</div>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Key info, tasks, activity row */}
                    <div className="grid gap-6 lg:grid-cols-3">
                      <KeyInformation system={system} onViewDetails={() => setActiveTab("details")} />
                      <CurrentTasks system={system} onStartTask={handleStartTask} onViewAllTasks={handleViewAllTasks} />
                      <RecentActivity system={system} onViewAll={() => setActiveTab("activity")} />
                    </div>
                  </div>

                  {/* Governance panel (right) */}
                  <aside className="hidden w-72 shrink-0 xl:block">
                    <GovernancePanel system={system} />
                  </aside>
                </div>
              </TabsContent>

              <TabsContent value="tasks" className="m-0 p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Tasks</h2>
                    <p className="text-sm text-muted-foreground">Tasks associated with this system</p>
                  </div>
                  <Button variant="outline" onClick={handleViewAllTasks}>
                    View all tasks <ArrowRight className="ml-2 size-4" />
                  </Button>
                </div>
                <CurrentTasks system={system} onStartTask={handleStartTask} onViewAllTasks={handleViewAllTasks} />
              </TabsContent>

              <TabsContent value="details" className="m-0 p-6">
                <DetailsTab
                  system={system}
                  onEdit={() => setShowEditWizard(true)}
                  onAIAssist={() => setShowAIAssist(true)}
                />
              </TabsContent>

              <TabsContent value="assessments" className="m-0 p-6">
                <AssessmentsTab systemId={system.id} systemName={system.name} />
              </TabsContent>

              <TabsContent value="obligations" className="m-0 p-6">
                <ObligationsTab systemId={system.id} systemName={system.name} />
              </TabsContent>

              <TabsContent value="controls" className="m-0 p-6">
                <ControlsTab systemId={system.id} systemName={system.name} />
              </TabsContent>

              <TabsContent value="evidence" className="m-0 p-6">
                <EvidenceTab systemId={system.id} systemName={system.name} />
              </TabsContent>

              <TabsContent value="activity" className="m-0 p-6">
                <ActivityTab systemId={system.id} system={system} />
              </TabsContent>

              <TabsContent value="documents" className="m-0 p-6">
                <Card>
                  <CardContent className="p-8 text-center text-muted-foreground">
                    Documents for this system will be displayed here.
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="notes" className="m-0 p-6">
                <NotesTab systemId={system.id} systemName={system.name} />
              </TabsContent>

              <TabsContent value="models" className="m-0 p-6">
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">Linked Models</h2>
                      <p className="text-sm text-muted-foreground">
                        Models from the catalog associated with this AI system.
                      </p>
                    </div>
                    <Button onClick={() => setShowModelPicker(true)}>
                      <Database className="mr-2 size-4" />
                      {system.model_id ? "Change Model" : "Link Model"}
                    </Button>
                  </div>

                  {system.model_id ? (
                    <Card>
                      <CardContent className="p-4">
                        {(() => {
                          const model = models.find(m => m.id === system.model_id);
                          if (!model) return <p className="text-muted-foreground">Model not found</p>;
                          return (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10">
                                  <Database className="size-6 text-primary" />
                                </div>
                                <div>
                                  <div className="font-medium">{model.name}</div>
                                  <div className="text-sm text-muted-foreground">
                                    {model.provider} · v{model.version}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={() => navigate("/models")}>
                                  <ExternalLink className="mr-2 size-4" />
                                  View in Catalog
                                </Button>
                                <Button variant="ghost" size="sm" className="text-destructive" onClick={handleUnlinkModel}>
                                  Unlink
                                </Button>
                              </div>
                            </div>
                          );
                        })()}
                      </CardContent>
                    </Card>
                  ) : (
                    <Card>
                      <CardContent className="p-8 text-center">
                        <Database className="mx-auto mb-4 size-12 text-muted-foreground/50" />
                        <p className="font-medium">No models linked</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Link a model from the catalog to associate it with this system.
                        </p>
                        <Button className="mt-4" onClick={() => setShowModelPicker(true)}>
                          <Database className="mr-2 size-4" />
                          Browse Model Catalog
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete AI System</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{system?.name}"? This action cannot be undone.
              All associated data including assessments, obligations, and evidence links will be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete System"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Model Picker Modal */}
      <ModelPickerModal
        open={showModelPicker}
        onClose={() => setShowModelPicker(false)}
        onSelect={handleLinkModel}
        currentModelId={system.model_id}
      />

      {/* AI-Assisted Registration Dialog */}
      <EngineerAssistedRegistration
        open={showAIAssist}
        system={system}
        onClose={() => setShowAIAssist(false)}
        onSuccess={() => {
          setShowAIAssist(false);
          loadSystem();
        }}
      />

      {/* Edit Wizard Dialog */}
      <RegisterWizard
        open={showEditWizard}
        onClose={() => setShowEditWizard(false)}
        onSuccess={() => {
          setShowEditWizard(false);
          loadSystem();
        }}
        system={system}
      />
    </div>
  );
}
