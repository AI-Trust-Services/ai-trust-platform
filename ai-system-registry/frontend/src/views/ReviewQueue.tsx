import { useState, useEffect, useCallback } from "react";
import { Spinner, Input, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, Pagination } from "@heroui/react";
import { TierBadge, FormattedDate, TaskTypeBadge, TaskStatusBadge, PriorityBadge } from "../components/Badges";
import { api, type WorkflowQueueItem, type ActivityEntry } from "../api/client";
import { useToast } from "../App";
import type { AISystem, TierKey, TaskType, TaskStatus, Priority } from "../types";
import ReviewModal from "../components/ReviewModal";

// SVG Icons
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="7" cy="7" r="5" />
    <path d="M11 11l3 3" strokeLinecap="round" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <circle cx="8" cy="3" r="1.5" />
    <circle cx="8" cy="8" r="1.5" />
    <circle cx="8" cy="13" r="1.5" />
  </svg>
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
  </svg>
);

const FilterIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 4h12M4 8h8M6 12h4" strokeLinecap="round" />
  </svg>
);

// Task interface
interface Task {
  system: AISystem;
  taskType: TaskType;
  taskStatus: TaskStatus;
  priority: Priority;
  dueDate: Date | null;
  dueDays: number | null;
  assignedTo: string | null;
  updatedAt: string;
  waitingSince: string | null;
}

// Derive task type from activity history and registration status
function deriveTaskType(system: AISystem, activity: ActivityEntry[]): TaskType {
  // Check if there was a previous "request_changes" action - then it's a clarification
  const hasRequestChanges = activity.some(a => a.action === "reviewed_request_changes");
  if (hasRequestChanges) return "clarification";

  // Check if previously approved/reviewed - then it's a reclassification
  const hasApproval = activity.some(a => a.action === "reviewed_approve" || a.action === "approved");
  if (hasApproval) return "reclassification";

  // Otherwise it's a new request
  return "new_request";
}

// Derive priority from tier
function derivePriority(tier: TierKey): Priority {
  if (tier === "prohibited") return "critical";
  if (tier === "high" || tier === "gpai-systemic") return "high";
  if (tier === "gpai-standard" || tier === "limited") return "medium";
  return "low";
}

// Derive task status from registration_status and waiting_on
function deriveTaskStatus(system: AISystem, currentUser: string): TaskStatus {
  if (system.registration_status === "pending_compliance_review" || system.registration_status === "approved") {
    return "submitted";
  }
  if (system.registration_status === "rejected") {
    return "informational";
  }
  // For pending_technical_review, check if assigned to current user
  if (system.waiting_on === currentUser) {
    return "needs_action";
  }
  return "in_progress";
}

// Calculate due date based on submitted_at and priority
function calculateDueDate(submittedAt: string | null, priority: Priority): { date: Date | null; days: number | null } {
  if (!submittedAt) return { date: null, days: null };

  const slaMap: Record<Priority, number> = {
    critical: 1,
    high: 3,
    medium: 7,
    low: 14,
  };

  const submitted = new Date(submittedAt);
  const dueDate = new Date(submitted);
  dueDate.setDate(dueDate.getDate() + slaMap[priority]);

  const now = new Date();
  const diffMs = dueDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return { date: dueDate, days: diffDays };
}

// KPI Card Component
function KPICard({ label, value, color = "#3b82f6" }: { label: string; value: number; color?: string }) {
  return (
    <div style={kpiCardStyle}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{label}</div>
    </div>
  );
}

// Action Items Table (urgent tasks)
function ActionItemsCard({
  tasks,
  onRowClick,
}: {
  tasks: Task[];
  onRowClick: (task: Task) => void;
}) {
  const urgent = tasks.filter(t => t.taskStatus === "needs_action" && (t.dueDays !== null && t.dueDays <= 3));

  if (urgent.length === 0) {
    return (
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0f172a", margin: 0 }}>Action Items</h3>
          <span style={{ fontSize: 12, color: "#64748b" }}>Urgent tasks requiring your attention</span>
        </div>
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
          <span style={{ fontSize: 24 }}>✓</span>
          <p style={{ marginTop: 8 }}>No urgent action items</p>
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0f172a", margin: 0 }}>Action Items</h3>
          <span style={urgentBadgeStyle}>{urgent.length} urgent</span>
        </div>
        <span style={{ fontSize: 12, color: "#64748b" }}>Urgent tasks requiring your attention</span>
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>System</th>
            <th style={thStyle}>Task type</th>
            <th style={thStyle}>Priority</th>
            <th style={thStyle}>Due date</th>
            <th style={thStyle}>Status</th>
            <th style={{ ...thStyle, width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {urgent.map((task) => (
            <tr
              key={task.system.id}
              style={{ cursor: "pointer" }}
              onClick={() => onRowClick(task)}
            >
              <td style={tdStyle}>
                <div style={{ fontWeight: 600, color: "#0f172a" }}>{task.system.name}</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{task.system.id}</div>
              </td>
              <td style={tdStyle}>
                <TaskTypeBadge type={task.taskType} />
              </td>
              <td style={tdStyle}>
                <PriorityBadge priority={task.priority} />
              </td>
              <td style={tdStyle}>
                {task.dueDate ? (
                  <div>
                    <div style={{ fontSize: 13, color: task.dueDays !== null && task.dueDays <= 0 ? "#dc2626" : "#0f172a" }}>
                      {task.dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                    <div style={{ fontSize: 12, color: task.dueDays !== null && task.dueDays <= 0 ? "#dc2626" : "#64748b" }}>
                      {task.dueDays !== null && task.dueDays <= 0 ? "Overdue" : `${task.dueDays} days left`}
                    </div>
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td style={tdStyle}>
                <TaskStatusBadge status={task.taskStatus} />
              </td>
              <td style={tdStyle}>
                <span style={{ color: "#94a3b8" }}>
                  <ChevronRightIcon />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// All Tasks Table
function AllTasksCard({
  tasks,
  searchQuery,
  onSearchChange,
  filters,
  onFilterChange,
  currentPage,
  onPageChange,
  onRowClick,
  onRowAction,
}: {
  tasks: Task[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filters: { taskType: TaskType | null; status: TaskStatus | null; priority: Priority | null };
  onFilterChange: (key: string, value: string | null) => void;
  currentPage: number;
  onPageChange: (page: number) => void;
  onRowClick: (task: Task) => void;
  onRowAction: (task: Task, action: string) => void;
}) {
  const PAGE_SIZE = 10;

  // Apply filters
  let filtered = tasks;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(t =>
      t.system.name.toLowerCase().includes(q) ||
      t.system.id.toLowerCase().includes(q) ||
      (t.system.description && t.system.description.toLowerCase().includes(q))
    );
  }
  if (filters.taskType) {
    filtered = filtered.filter(t => t.taskType === filters.taskType);
  }
  if (filters.status) {
    filtered = filtered.filter(t => t.taskStatus === filters.status);
  }
  if (filters.priority) {
    filtered = filtered.filter(t => t.priority === filters.priority);
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div style={cardStyle}>
      <div style={{ ...cardHeaderStyle, flexDirection: "column", alignItems: "stretch", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0f172a", margin: 0 }}>All Tasks</h3>
            <span style={{ fontSize: 12, color: "#64748b", background: "#f1f5f9", padding: "2px 8px", borderRadius: 4 }}>
              {filtered.length} items
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, maxWidth: 300 }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}>
              <SearchIcon />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search systems..."
              style={{
                width: "100%",
                padding: "8px 12px 8px 36px",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                fontSize: 14,
                outline: "none",
              }}
            />
          </div>
          <Dropdown>
            <DropdownTrigger>
              <Button variant="bordered" size="sm" startContent={<FilterIcon />}>
                Task type {filters.taskType && "•"}
              </Button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label="Task type filter"
              onAction={(key) => onFilterChange("taskType", key === "all" ? null : String(key))}
            >
              <DropdownItem key="all">All types</DropdownItem>
              <DropdownItem key="new_request">New request</DropdownItem>
              <DropdownItem key="clarification">Clarification</DropdownItem>
              <DropdownItem key="reclassification">Reclassification</DropdownItem>
            </DropdownMenu>
          </Dropdown>
          <Dropdown>
            <DropdownTrigger>
              <Button variant="bordered" size="sm" startContent={<FilterIcon />}>
                Status {filters.status && "•"}
              </Button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label="Status filter"
              onAction={(key) => onFilterChange("status", key === "all" ? null : String(key))}
            >
              <DropdownItem key="all">All statuses</DropdownItem>
              <DropdownItem key="needs_action">Needs action</DropdownItem>
              <DropdownItem key="in_progress">In progress</DropdownItem>
              <DropdownItem key="submitted">Submitted</DropdownItem>
            </DropdownMenu>
          </Dropdown>
          <Dropdown>
            <DropdownTrigger>
              <Button variant="bordered" size="sm" startContent={<FilterIcon />}>
                Priority {filters.priority && "•"}
              </Button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label="Priority filter"
              onAction={(key) => onFilterChange("priority", key === "all" ? null : String(key))}
            >
              <DropdownItem key="all">All priorities</DropdownItem>
              <DropdownItem key="critical">Critical</DropdownItem>
              <DropdownItem key="high">High</DropdownItem>
              <DropdownItem key="medium">Medium</DropdownItem>
              <DropdownItem key="low">Low</DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </div>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>System</th>
            <th style={thStyle}>Task type</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Priority</th>
            <th style={thStyle}>Assigned to</th>
            <th style={thStyle}>Updated</th>
            <th style={{ ...thStyle, width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {paginated.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ ...tdStyle, textAlign: "center", padding: 40, color: "#94a3b8" }}>
                No tasks found
              </td>
            </tr>
          ) : (
            paginated.map((task) => (
              <tr
                key={task.system.id}
                style={{ cursor: "pointer" }}
                onClick={() => onRowClick(task)}
              >
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600, color: "#0f172a" }}>{task.system.name}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    {task.system.intended_purpose?.slice(0, 50) || task.system.description?.slice(0, 50) || task.system.id}
                  </div>
                </td>
                <td style={tdStyle}>
                  <TaskTypeBadge type={task.taskType} />
                </td>
                <td style={tdStyle}>
                  <TaskStatusBadge status={task.taskStatus} />
                </td>
                <td style={tdStyle}>
                  <PriorityBadge priority={task.priority} />
                </td>
                <td style={tdStyle}>
                  <span style={{ fontSize: 13, color: "#64748b" }}>
                    {task.assignedTo || "Unassigned"}
                  </span>
                </td>
                <td style={tdStyle}>
                  <span style={{ fontSize: 13, color: "#64748b" }}>
                    <FormattedDate iso={task.updatedAt} />
                  </span>
                </td>
                <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                  <Dropdown>
                    <DropdownTrigger>
                      <button style={moreButtonStyle}>
                        <MoreIcon />
                      </button>
                    </DropdownTrigger>
                    <DropdownMenu aria-label="Actions" onAction={(key) => onRowAction(task, String(key))}>
                      <DropdownItem key="review">Review</DropdownItem>
                      <DropdownItem key="reassign">Reassign</DropdownItem>
                      <DropdownItem key="history">View audit history</DropdownItem>
                    </DropdownMenu>
                  </Dropdown>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div style={{ padding: "16px 24px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "center" }}>
          <Pagination
            total={totalPages}
            page={currentPage}
            onChange={onPageChange}
            showControls
          />
        </div>
      )}
    </div>
  );
}

// Task Detail Sidebar
function TaskDetailSidebar({
  task,
  activity,
  activityLoading,
  onClose,
  onReview,
  onRequestChanges,
}: {
  task: Task | null;
  activity: ActivityEntry[];
  activityLoading: boolean;
  onClose: () => void;
  onReview: () => void;
  onRequestChanges: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"details" | "activity">("details");

  if (!task) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.3)",
          zIndex: 50,
        }}
        onClick={onClose}
      />
      {/* Sidebar */}
      <div style={sidebarStyle}>
        {/* Header */}
        <div style={{ padding: 20, borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: "#0f172a", margin: 0, marginBottom: 8 }}>
                {task.system.name}
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TierBadge tier={task.system.tier} />
                <span style={{ fontSize: 12, color: "#64748b" }}>{task.system.id}</span>
              </div>
            </div>
            <button onClick={onClose} style={closeButtonStyle}>
              <CloseIcon />
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, marginTop: 16 }}>
            <button
              onClick={() => setActiveTab("details")}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 500,
                background: activeTab === "details" ? "#eff6ff" : "transparent",
                border: "none",
                borderRadius: 6,
                color: activeTab === "details" ? "#3b82f6" : "#64748b",
                cursor: "pointer",
              }}
            >
              Details
            </button>
            <button
              onClick={() => setActiveTab("activity")}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 500,
                background: activeTab === "activity" ? "#eff6ff" : "transparent",
                border: "none",
                borderRadius: 6,
                color: activeTab === "activity" ? "#3b82f6" : "#64748b",
                cursor: "pointer",
              }}
            >
              Activity
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {activeTab === "details" ? (
            <>
              {/* Overview */}
              <section style={{ marginBottom: 24 }}>
                <h4 style={sectionLabelStyle}>Overview</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {task.system.description && (
                    <div>
                      <div style={fieldLabelStyle}>Description</div>
                      <div style={fieldValueStyle}>{task.system.description}</div>
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={fieldLabelStyle}>Business owner</div>
                      <div style={fieldValueStyle}>{task.system.submitted_by || "—"}</div>
                    </div>
                    <div>
                      <div style={fieldLabelStyle}>System owner</div>
                      <div style={fieldValueStyle}>{task.system.org_name || "—"}</div>
                    </div>
                    <div>
                      <div style={fieldLabelStyle}>Environment</div>
                      <div style={fieldValueStyle}>{task.system.lifecycle}</div>
                    </div>
                    <div>
                      <div style={fieldLabelStyle}>Updated</div>
                      <div style={fieldValueStyle}><FormattedDate iso={task.system.updated_at} /></div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Task Details */}
              <section style={{ marginBottom: 24 }}>
                <h4 style={sectionLabelStyle}>Task details</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={fieldLabelStyle}>Task type</div>
                      <div style={{ marginTop: 4 }}><TaskTypeBadge type={task.taskType} /></div>
                    </div>
                    <div>
                      <div style={fieldLabelStyle}>Status</div>
                      <div style={{ marginTop: 4 }}><TaskStatusBadge status={task.taskStatus} /></div>
                    </div>
                    <div>
                      <div style={fieldLabelStyle}>Priority</div>
                      <div style={{ marginTop: 4 }}><PriorityBadge priority={task.priority} /></div>
                    </div>
                    <div>
                      <div style={fieldLabelStyle}>Due date</div>
                      <div style={fieldValueStyle}>
                        {task.dueDate ? (
                          <>
                            {task.dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            {task.dueDays !== null && (
                              <span style={{ color: task.dueDays <= 0 ? "#dc2626" : "#64748b", marginLeft: 8 }}>
                                ({task.dueDays <= 0 ? "Overdue" : `${task.dueDays} days`})
                              </span>
                            )}
                          </>
                        ) : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Risk Summary */}
              <section style={{ marginBottom: 24 }}>
                <h4 style={sectionLabelStyle}>Risk summary</h4>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <div style={riskBadgeStyle}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>Risk tier</span>
                    <TierBadge tier={task.system.tier} />
                  </div>
                  {task.system.compliance > 0 && (
                    <div style={riskBadgeStyle}>
                      <span style={{ fontSize: 11, color: "#64748b" }}>Compliance</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: task.system.compliance >= 70 ? "#22c55e" : "#f59e0b" }}>
                        {task.system.compliance}%
                      </span>
                    </div>
                  )}
                </div>
              </section>
            </>
          ) : (
            /* Activity Tab */
            <section>
              {activityLoading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                  <Spinner size="sm" />
                </div>
              ) : activity.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
                  No activity recorded
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {activity.map((entry) => (
                    <div key={entry.id} style={activityItemStyle}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: "#0f172a" }}>
                          {entry.actor}
                        </span>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>
                          <FormattedDate iso={entry.created_at} />
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                        {formatAction(entry.action)}
                      </div>
                      {entry.comment && (
                        <p style={{ fontSize: 12, color: "#475569", marginTop: 8, fontStyle: "italic", margin: "8px 0 0" }}>
                          "{entry.comment}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Footer Actions */}
        <div style={{ padding: 20, borderTop: "1px solid #e2e8f0", display: "flex", gap: 12 }}>
          <button onClick={onRequestChanges} style={secondaryButtonStyle}>
            Request changes
          </button>
          <button onClick={onReview} style={primaryButtonStyle}>
            Review system
          </button>
        </div>
      </div>
    </>
  );
}

function formatAction(action: string): string {
  const map: Record<string, string> = {
    created: "registered the system",
    submitted: "submitted for review",
    reviewed_approve: "approved",
    reviewed_reject: "rejected",
    reviewed_request_changes: "requested changes",
    commented: "added a comment",
  };
  return map[action] || action.replace(/_/g, " ");
}

// Main Component
export default function ReviewQueue() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [sidebarActivity, setSidebarActivity] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<{ taskType: TaskType | null; status: TaskStatus | null; priority: Priority | null }>({
    taskType: null,
    status: null,
    priority: null,
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [reviewModalSystem, setReviewModalSystem] = useState<AISystem | null>(null);
  const showToast = useToast();

  const currentUser = "AI Engineer"; // Would come from auth context

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Get review queue items (pending technical review)
      const queueData = await api.getReviewQueue("ai_engineer", "pending_technical_review");

      // Also get systems that have progressed (for "Your AI systems" equivalent)
      const allSystems = await api.getSystems();
      const reviewedStatuses = ["pending_compliance_review", "approved", "rejected"];
      const reviewedSystems = allSystems.filter(s => reviewedStatuses.includes(s.registration_status || ""));

      // Convert queue items to tasks
      const queueTasks: Task[] = queueData.map(item => {
        const priority = derivePriority(item.system.tier);
        const { date, days } = calculateDueDate(item.system.submitted_at, priority);
        return {
          system: item.system,
          taskType: "new_request" as TaskType, // Will be refined with activity data
          taskStatus: deriveTaskStatus(item.system, currentUser),
          priority,
          dueDate: date,
          dueDays: days,
          assignedTo: item.system.waiting_on,
          updatedAt: item.system.updated_at,
          waitingSince: item.waiting_since,
        };
      });

      // Convert reviewed systems to tasks
      const reviewedTasks: Task[] = reviewedSystems.map(sys => {
        const priority = derivePriority(sys.tier);
        const { date, days } = calculateDueDate(sys.submitted_at, priority);
        return {
          system: sys,
          taskType: "new_request" as TaskType, // Placeholder
          taskStatus: deriveTaskStatus(sys, currentUser),
          priority,
          dueDate: date,
          dueDays: days,
          assignedTo: sys.waiting_on,
          updatedAt: sys.updated_at,
          waitingSince: null,
        };
      });

      // Combine and dedupe by system ID
      const allTasks = [...queueTasks];
      reviewedTasks.forEach(rt => {
        if (!allTasks.find(t => t.system.id === rt.system.id)) {
          allTasks.push(rt);
        }
      });

      setTasks(allTasks);
    } catch (e) {
      showToast(`Failed to load data: ${(e as Error).message}`, true);
    } finally {
      setLoading(false);
    }
  }, [showToast, currentUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load activity when sidebar opens
  useEffect(() => {
    if (selectedTask) {
      setActivityLoading(true);
      api.getSystemActivity(selectedTask.system.id)
        .then(data => {
          setSidebarActivity(data);
          // Update task type based on activity
          const taskType = deriveTaskType(selectedTask.system, data);
          setSelectedTask(prev => prev ? { ...prev, taskType } : null);
        })
        .catch(() => setSidebarActivity([]))
        .finally(() => setActivityLoading(false));
    }
  }, [selectedTask?.system.id]);

  // KPI calculations
  const openTasks = tasks.filter(t => t.taskStatus === "needs_action" || t.taskStatus === "in_progress").length;
  const actionItems = tasks.filter(t => t.taskStatus === "needs_action" && (t.dueDays !== null && t.dueDays <= 3)).length;
  const newRequests = tasks.filter(t => t.taskType === "new_request" && t.taskStatus !== "submitted").length;
  const clarifications = tasks.filter(t => t.taskType === "clarification").length;
  const reclassifications = tasks.filter(t => t.taskType === "reclassification").length;
  const inProgress = tasks.filter(t => t.taskStatus === "in_progress").length;

  const handleRowClick = (task: Task) => {
    setSelectedTask(task);
  };

  const handleRowAction = (task: Task, action: string) => {
    if (action === "review") {
      setReviewModalSystem(task.system);
    } else if (action === "reassign") {
      showToast("Reassign functionality coming soon");
    } else if (action === "history") {
      setSelectedTask(task);
    }
  };

  const handleFilterChange = (key: string, value: string | null) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  };

  const handleReviewFromSidebar = () => {
    if (selectedTask) {
      setReviewModalSystem(selectedTask.system);
    }
  };

  const handleRequestChangesFromSidebar = async () => {
    if (!selectedTask) return;
    try {
      await api.completeReview(selectedTask.system.id, { action: "request_changes" });
      showToast("Changes requested");
      setSelectedTask(null);
      loadData();
    } catch (e) {
      showToast(`Failed: ${(e as Error).message}`, true);
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 80 }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, color: "#0f172a", margin: 0 }}>
          AI Systems
        </h1>
        <p style={{ fontSize: 14, color: "#64748b", marginTop: 8 }}>
          Technical review tasks and assigned AI systems
        </p>
      </div>

      {/* KPI Cards Row */}
      <div style={kpiRowStyle}>
        <KPICard label="Open tasks" value={openTasks} />
        <KPICard label="Action items" value={actionItems} color="#dc2626" />
        <KPICard label="New requests" value={newRequests} color="#3b82f6" />
        <KPICard label="Clarifications" value={clarifications} color="#f59e0b" />
        <KPICard label="Reclassification" value={reclassifications} color="#8b5cf6" />
        <KPICard label="In progress" value={inProgress} color="#64748b" />
      </div>

      {/* Action Items Section */}
      <div style={{ marginBottom: 24 }}>
        <ActionItemsCard tasks={tasks} onRowClick={handleRowClick} />
      </div>

      {/* All Tasks Section */}
      <AllTasksCard
        tasks={tasks}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filters={filters}
        onFilterChange={handleFilterChange}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        onRowClick={handleRowClick}
        onRowAction={handleRowAction}
      />

      {/* Detail Sidebar */}
      <TaskDetailSidebar
        task={selectedTask}
        activity={sidebarActivity}
        activityLoading={activityLoading}
        onClose={() => setSelectedTask(null)}
        onReview={handleReviewFromSidebar}
        onRequestChanges={handleRequestChangesFromSidebar}
      />

      {/* Review Modal */}
      <ReviewModal
        system={reviewModalSystem}
        onClose={() => setReviewModalSystem(null)}
        onReviewComplete={() => {
          setReviewModalSystem(null);
          setSelectedTask(null);
          loadData();
        }}
        onDataChange={loadData}
      />
    </div>
  );
}

// Styles
const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  overflow: "hidden",
};

const cardHeaderStyle: React.CSSProperties = {
  padding: "20px 24px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const kpiRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(6, 1fr)",
  gap: 16,
  marginBottom: 24,
};

const kpiCardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  padding: 20,
  textAlign: "center",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 24px",
  fontSize: 12,
  fontWeight: 500,
  color: "#64748b",
  borderBottom: "1px solid #f1f5f9",
  background: "#fafbfc",
};

const tdStyle: React.CSSProperties = {
  padding: "16px 24px",
  fontSize: 14,
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "middle",
};

const moreButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  background: "none",
  border: "none",
  color: "#94a3b8",
  cursor: "pointer",
  borderRadius: 6,
};

const urgentBadgeStyle: React.CSSProperties = {
  background: "#fef2f2",
  color: "#dc2626",
  fontSize: 12,
  fontWeight: 600,
  padding: "2px 10px",
  borderRadius: 12,
};

const sidebarStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  width: 380,
  height: "100vh",
  background: "#fff",
  boxShadow: "-4px 0 20px rgba(0, 0, 0, 0.1)",
  zIndex: 100,
  display: "flex",
  flexDirection: "column",
};

const closeButtonStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "none",
  border: "none",
  color: "#94a3b8",
  cursor: "pointer",
  borderRadius: 6,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 12,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#94a3b8",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

const fieldValueStyle: React.CSSProperties = {
  fontSize: 14,
  color: "#0f172a",
  marginTop: 4,
};

const riskBadgeStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  padding: "12px 16px",
  background: "#f8fafc",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
};

const activityItemStyle: React.CSSProperties = {
  padding: 12,
  background: "#f8fafc",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
};

const secondaryButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "10px 16px",
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  color: "#475569",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const primaryButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "10px 16px",
  background: "#3b82f6",
  border: "none",
  borderRadius: 8,
  color: "#fff",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};
