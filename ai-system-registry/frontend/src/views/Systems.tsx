import { useState, useEffect, useCallback, useMemo } from "react";
import { Spinner, Chip, Pagination } from "@heroui/react";
import { TierBadge, LifecycleBadge, ComplianceBar, FormattedDate } from "../components/Badges";
import SystemDetail from "../components/SystemDetail";
import AppOwnerWizard from "../components/AppOwnerWizard";
import ReviewModal from "../components/ReviewModal";
import ComplianceReviewModal from "../components/ComplianceReviewModal";
import { api, type WorkflowQueueItem, type ActivityEntry } from "../api/client";
import { useToast, useModalControls } from "../App";
import { usePermissions } from "../hooks/usePermissions";
import type { AISystem, ModelCard, TierKey, TaskType, TaskStatus, Priority } from "../types";

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

const RefreshIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 8a6 6 0 0111.5-2.5M14 8a6 6 0 01-11.5 2.5" strokeLinecap="round"/>
    <path d="M14 2v4h-4M2 14v-4h4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#22c55e" strokeWidth="2">
    <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round"/>
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

// Derive priority from tier
function derivePriority(tier: TierKey): Priority {
  if (tier === "prohibited") return "critical";
  if (tier === "high" || tier === "gpai-systemic") return "high";
  if (tier === "gpai-standard" || tier === "limited") return "medium";
  return "low";
}

// Derive task status from registration_status
function deriveTaskStatus(system: AISystem, _currentUser: string): TaskStatus {
  if (system.registration_status === "pending_compliance_review" || system.registration_status === "approved") {
    return "submitted";
  }
  if (system.registration_status === "rejected") {
    return "informational";
  }
  // Items in the review queue (pending_technical_review) need action from the AI Engineer
  if (system.registration_status === "pending_technical_review") {
    return "needs_action";
  }
  return "in_progress";
}

// Calculate due date based on submitted_at and priority
function calculateDueDate(submittedAt: string | null, priority: Priority): { date: Date | null; days: number | null } {
  if (!submittedAt) return { date: null, days: null };
  const slaMap: Record<Priority, number> = { critical: 1, high: 3, medium: 7, low: 14 };
  const submitted = new Date(submittedAt);
  const dueDate = new Date(submitted);
  dueDate.setDate(dueDate.getDate() + slaMap[priority]);
  const now = new Date();
  const diffMs = dueDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return { date: dueDate, days: diffDays };
}

// Custom Badge Components with inline styles
function TaskTypeBadge({ type }: { type: TaskType }) {
  const config: Record<TaskType, { bg: string; color: string; label: string }> = {
    new_request: { bg: "#dbeafe", color: "#1e40af", label: "New request" },
    clarification: { bg: "#fef3c7", color: "#92400e", label: "Clarification" },
    reclassification: { bg: "#ede9fe", color: "#5b21b6", label: "Reclassification" },
  };
  const c = config[type] || { bg: "#f1f5f9", color: "#475569", label: type };
  return <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500, background: c.bg, color: c.color }}>{c.label}</span>;
}

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const config: Record<TaskStatus, { bg: string; color: string; label: string }> = {
    needs_action: { bg: "#fee2e2", color: "#dc2626", label: "Needs action" },
    in_progress: { bg: "#dbeafe", color: "#2563eb", label: "In progress" },
    submitted: { bg: "#dcfce7", color: "#16a34a", label: "Submitted" },
    informational: { bg: "#f1f5f9", color: "#64748b", label: "Completed" },
  };
  const c = config[status] || { bg: "#f1f5f9", color: "#475569", label: status };
  return <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500, background: c.bg, color: c.color }}>{c.label}</span>;
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const config: Record<Priority, { bg: string; color: string; label: string }> = {
    critical: { bg: "#fee2e2", color: "#dc2626", label: "Critical" },
    high: { bg: "#fef3c7", color: "#d97706", label: "High" },
    medium: { bg: "#f1f5f9", color: "#475569", label: "Medium" },
    low: { bg: "#dcfce7", color: "#16a34a", label: "Low" },
  };
  const c = config[priority] || { bg: "#f1f5f9", color: "#475569", label: priority };
  return <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500, background: c.bg, color: c.color }}>{c.label}</span>;
}

// Row Action Menu Component (unused - keeping for reference)
function RowActionMenu({ onAction }: { onAction: (action: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }} style={moreButtonStyle}><MoreIcon /></button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", minWidth: 140, zIndex: 20, overflow: "hidden" }}>
            <button onClick={() => { setOpen(false); onAction("review"); }} style={menuItemStyle}>Review</button>
            <button onClick={() => { setOpen(false); onAction("reassign"); }} style={menuItemStyle}>Reassign</button>
            <button onClick={() => { setOpen(false); onAction("history"); }} style={menuItemStyle}>View audit history</button>
          </div>
        </>
      )}
    </div>
  );
}

// Actions Dropdown for Sidebar
function ActionsDropdown({ onRequestChanges, onReassign }: { onRequestChanges: () => void; onReassign: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", flex: 1 }}>
      <button onClick={() => setOpen(!open)} style={{ ...secondaryBtnStyle, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        Request changes
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div style={{ position: "absolute", left: 0, bottom: "100%", marginBottom: 4, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", minWidth: "100%", zIndex: 20, overflow: "hidden" }}>
            <button onClick={() => { setOpen(false); onRequestChanges(); }} style={{ ...menuItemStyle, display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 1l3 3-9 9H1v-3l9-9z" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Request changes
            </button>
            <button onClick={() => { setOpen(false); onReassign(); }} style={{ ...menuItemStyle, display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 11a4 4 0 10-4-4" strokeLinecap="round"/><path d="M5 5v2h2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="9" cy="5" r="2"/></svg>
              Reassign
            </button>
          </div>
        </>
      )}
    </div>
  );
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

// Action Items Table (tasks needing action)
function ActionItemsCard({ tasks, onRowClick }: { tasks: Task[]; onRowClick: (task: Task) => void }) {
  // Show all tasks that need action from the AI Engineer
  const actionItems = tasks.filter(t => t.taskStatus === "needs_action");
  // Count urgent ones (due within 3 days or overdue)
  const urgentCount = actionItems.filter(t => t.dueDays !== null && t.dueDays <= 3).length;

  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0f172a", margin: 0 }}>Action Items</h3>
          {urgentCount > 0 && <span style={urgentBadgeStyle}>{urgentCount} urgent</span>}
        </div>
        <span style={{ fontSize: 12, color: "#64748b" }}>Tasks requiring your attention</span>
      </div>
      {actionItems.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
          <CheckIcon />
          <p style={{ marginTop: 8 }}>No action items</p>
        </div>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>System</th>
              <th style={thStyle}>Task type</th>
              <th style={thStyle}>Priority</th>
              <th style={thStyle}>Due date</th>
              <th style={thStyle}>Status</th>
              <th style={{ ...thStyle, width: 48 }}></th>
            </tr>
          </thead>
          <tbody>
            {actionItems.map((task) => (
              <tr key={task.system.id} style={{ cursor: "pointer" }} onClick={() => onRowClick(task)}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600, color: "#0f172a" }}>{task.system.name}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{task.system.id}</div>
                </td>
                <td style={tdStyle}><TaskTypeBadge type={task.taskType} /></td>
                <td style={tdStyle}><PriorityBadge priority={task.priority} /></td>
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
                  ) : "—"}
                </td>
                <td style={tdStyle}><TaskStatusBadge status={task.taskStatus} /></td>
                <td style={tdStyle}><span style={{ color: "#94a3b8" }}><ChevronRightIcon /></span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// All Tasks Table
function AllTasksCard({
  tasks, searchQuery, onSearchChange, filters, onFilterChange, currentPage, onPageChange, onRowClick, onRowAction,
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

  let filtered = tasks;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(t => t.system.name.toLowerCase().includes(q) || t.system.id.toLowerCase().includes(q) || (t.system.description && t.system.description.toLowerCase().includes(q)));
  }
  if (filters.taskType) filtered = filtered.filter(t => t.taskType === filters.taskType);
  if (filters.status) filtered = filtered.filter(t => t.taskStatus === filters.status);
  if (filters.priority) filtered = filtered.filter(t => t.priority === filters.priority);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div style={cardStyle}>
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0f172a", margin: 0 }}>All Tasks</h3>
            <span style={{ fontSize: 12, color: "#64748b", background: "#f1f5f9", padding: "2px 8px", borderRadius: 4 }}>{filtered.length} items</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 300 }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}><SearchIcon /></span>
            <input type="text" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search systems..." style={{ width: "100%", padding: "8px 12px 8px 36px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none" }} />
          </div>
          <select value={filters.taskType || ""} onChange={(e) => onFilterChange("taskType", e.target.value || null)} style={filterSelectStyle}>
            <option value="">All types</option>
            <option value="new_request">New request</option>
            <option value="clarification">Clarification</option>
            <option value="reclassification">Reclassification</option>
          </select>
          <select value={filters.status || ""} onChange={(e) => onFilterChange("status", e.target.value || null)} style={filterSelectStyle}>
            <option value="">All statuses</option>
            <option value="needs_action">Needs action</option>
            <option value="in_progress">In progress</option>
            <option value="submitted">Submitted</option>
          </select>
          <select value={filters.priority || ""} onChange={(e) => onFilterChange("priority", e.target.value || null)} style={filterSelectStyle}>
            <option value="">All priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
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
            <th style={{ ...thStyle, width: 48 }}></th>
          </tr>
        </thead>
        <tbody>
          {paginated.length === 0 ? (
            <tr><td colSpan={7} style={{ ...tdStyle, textAlign: "center", padding: 40, color: "#94a3b8" }}>No tasks found</td></tr>
          ) : paginated.map((task) => (
            <tr key={task.system.id} style={{ cursor: "pointer" }} onClick={() => onRowClick(task)}>
              <td style={tdStyle}>
                <div style={{ fontWeight: 600, color: "#0f172a" }}>{task.system.name}</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{task.system.intended_purpose?.slice(0, 50) || task.system.description?.slice(0, 50) || task.system.id}</div>
              </td>
              <td style={tdStyle}><TaskTypeBadge type={task.taskType} /></td>
              <td style={tdStyle}><TaskStatusBadge status={task.taskStatus} /></td>
              <td style={tdStyle}><PriorityBadge priority={task.priority} /></td>
              <td style={tdStyle}><span style={{ fontSize: 13, color: "#64748b" }}>{task.assignedTo || "Unassigned"}</span></td>
              <td style={tdStyle}><span style={{ fontSize: 13, color: "#64748b" }}><FormattedDate iso={task.updatedAt} /></span></td>
              <td style={tdStyle}><span style={{ color: "#94a3b8" }}><ChevronRightIcon /></span></td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div style={{ padding: "16px 24px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "center" }}>
          <Pagination total={totalPages} page={currentPage} onChange={onPageChange} showControls />
        </div>
      )}
    </div>
  );
}

// Task Detail Sidebar
function TaskDetailSidebar({
  task, activity, activityLoading, onClose, onReview, onRequestChanges,
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
      <div style={{ position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.3)", zIndex: 50 }} onClick={onClose} />
      <div style={sidebarStyle}>
        <div style={{ padding: 20, borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: "#0f172a", margin: 0, marginBottom: 8 }}>{task.system.name}</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TierBadge tier={task.system.tier} />
                <span style={{ fontSize: 12, color: "#64748b" }}>{task.system.id}</span>
              </div>
            </div>
            <button onClick={onClose} style={closeButtonStyle}><CloseIcon /></button>
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 16 }}>
            <button onClick={() => setActiveTab("details")} style={{ padding: "8px 16px", fontSize: 13, fontWeight: 500, background: activeTab === "details" ? "#eff6ff" : "transparent", border: "none", borderRadius: 6, color: activeTab === "details" ? "#3b82f6" : "#64748b", cursor: "pointer" }}>Details</button>
            <button onClick={() => setActiveTab("activity")} style={{ padding: "8px 16px", fontSize: 13, fontWeight: 500, background: activeTab === "activity" ? "#eff6ff" : "transparent", border: "none", borderRadius: 6, color: activeTab === "activity" ? "#3b82f6" : "#64748b", cursor: "pointer" }}>Activity</button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {activeTab === "details" ? (
            <>
              <section style={{ marginBottom: 24 }}>
                <h4 style={sectionLabelStyle}>Overview</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {task.system.description && <div><div style={fieldLabelStyle}>Description</div><div style={fieldValueStyle}>{task.system.description}</div></div>}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div><div style={fieldLabelStyle}>Business owner</div><div style={fieldValueStyle}>{task.system.submitted_by || "—"}</div></div>
                    <div><div style={fieldLabelStyle}>System owner</div><div style={fieldValueStyle}>{task.system.org_name || "—"}</div></div>
                    <div><div style={fieldLabelStyle}>Environment</div><div style={fieldValueStyle}>{task.system.lifecycle}</div></div>
                    <div><div style={fieldLabelStyle}>Updated</div><div style={fieldValueStyle}><FormattedDate iso={task.system.updated_at} /></div></div>
                  </div>
                </div>
              </section>
              <section style={{ marginBottom: 24 }}>
                <h4 style={sectionLabelStyle}>Task details</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><div style={fieldLabelStyle}>Task type</div><div style={{ marginTop: 4 }}><TaskTypeBadge type={task.taskType} /></div></div>
                  <div><div style={fieldLabelStyle}>Status</div><div style={{ marginTop: 4 }}><TaskStatusBadge status={task.taskStatus} /></div></div>
                  <div><div style={fieldLabelStyle}>Priority</div><div style={{ marginTop: 4 }}><PriorityBadge priority={task.priority} /></div></div>
                  <div><div style={fieldLabelStyle}>Due date</div><div style={fieldValueStyle}>
                    {task.dueDate ? <>{task.dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{task.dueDays !== null && <span style={{ color: task.dueDays <= 0 ? "#dc2626" : "#64748b", marginLeft: 8 }}>({task.dueDays <= 0 ? "Overdue" : `${task.dueDays} days`})</span>}</> : "—"}
                  </div></div>
                </div>
              </section>
              <section style={{ marginBottom: 24 }}>
                <h4 style={sectionLabelStyle}>Risk summary</h4>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <div style={riskBadgeStyle}><span style={{ fontSize: 11, color: "#64748b" }}>Risk tier</span><TierBadge tier={task.system.tier} /></div>
                  {task.system.compliance > 0 && <div style={riskBadgeStyle}><span style={{ fontSize: 11, color: "#64748b" }}>Compliance</span><span style={{ fontSize: 14, fontWeight: 600, color: task.system.compliance >= 70 ? "#22c55e" : "#f59e0b" }}>{task.system.compliance}%</span></div>}
                </div>
              </section>
            </>
          ) : (
            <section>
              {activityLoading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner size="sm" /></div>
              ) : activity.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>No activity recorded</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {activity.map((entry) => (
                    <div key={entry.id} style={activityItemStyle}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: "#0f172a" }}>{entry.actor}</span>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}><FormattedDate iso={entry.created_at} /></span>
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{formatAction(entry.action)}</div>
                      {entry.comment && <p style={{ fontSize: 12, color: "#475569", marginTop: 8, fontStyle: "italic", margin: "8px 0 0" }}>"{entry.comment}"</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <div style={{ padding: 20, borderTop: "1px solid #e2e8f0" }}>
          <div style={{ marginBottom: 12 }}>
            <h4 style={sectionLabelStyle}>Next steps</h4>
            <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>Review the system information and complete your technical assessment.</p>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={onReview} style={primaryBtnStyle}>Review system →</button>
            <ActionsDropdown onRequestChanges={onRequestChanges} onReassign={() => {}} />
          </div>
        </div>
      </div>
    </>
  );
}

function formatAction(action: string): string {
  const map: Record<string, string> = { created: "registered the system", submitted: "submitted for review", reviewed_approve: "approved", reviewed_reject: "rejected", reviewed_request_changes: "requested changes", commented: "added a comment" };
  return map[action] || action.replace(/_/g, " ");
}

// Main Systems Workspace
export default function Systems() {
  const { role, department, businessUnit } = usePermissions();
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [models, setModels] = useState<ModelCard[]>([]);
  const [queue, setQueue] = useState<WorkflowQueueItem[]>([]);
  const [complianceQueue, setComplianceQueue] = useState<WorkflowQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSystem, setSelectedSystem] = useState<AISystem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reviewSystem, setReviewSystem] = useState<AISystem | null>(null);
  const [complianceReviewSystem, setComplianceReviewSystem] = useState<AISystem | null>(null);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("");
  const { wizardOpen, setWizardOpen } = useModalControls();
  const showToast = useToast();

  // State for AI Engineer view
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [sidebarActivity, setSidebarActivity] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<{ taskType: TaskType | null; status: TaskStatus | null; priority: Priority | null }>({ taskType: null, status: null, priority: null });
  const [currentPage, setCurrentPage] = useState(1);

  const isAIEngineer = role === "AI Engineer";
  const isComplianceOfficer = role === "Compliance Officer";
  const currentUser = "AI Engineer";

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      try {
        const [systemsData, modelsData] = await Promise.all([api.getSystems(), api.getModels()]);
        if (cancelled) return;
        setSystems(systemsData);
        setModels(modelsData);
        try { const queueData = await api.getReviewQueue("ai_engineer", "pending_technical_review"); if (!cancelled) setQueue(queueData); } catch { if (!cancelled) setQueue([]); }
        try { const compQueueData = await api.getReviewQueue("ai_compliance_officer", "pending_compliance_review"); if (!cancelled) setComplianceQueue(compQueueData); } catch { if (!cancelled) setComplianceQueue([]); }
      } catch (e) { if (!cancelled) showToast(`Failed to load data: ${(e as Error).message}`, true); } finally { if (!cancelled) setLoading(false); }
    }
    loadData();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Build tasks for AI Engineer view
  useEffect(() => {
    if (!isAIEngineer) return;
    const queueTasks: Task[] = queue.map(item => {
      const priority = derivePriority(item.system.tier);
      const { date, days } = calculateDueDate(item.system.submitted_at, priority);
      return { system: item.system, taskType: "new_request" as TaskType, taskStatus: deriveTaskStatus(item.system, currentUser), priority, dueDate: date, dueDays: days, assignedTo: item.system.waiting_on, updatedAt: item.system.updated_at, waitingSince: item.waiting_since };
    });
    const reviewedStatuses = ["pending_compliance_review", "approved", "rejected"];
    const reviewedSystems = systems.filter(s => reviewedStatuses.includes(s.registration_status || ""));
    const reviewedTasks: Task[] = reviewedSystems.map(sys => {
      const priority = derivePriority(sys.tier);
      const { date, days } = calculateDueDate(sys.submitted_at, priority);
      return { system: sys, taskType: "new_request" as TaskType, taskStatus: deriveTaskStatus(sys, currentUser), priority, dueDate: date, dueDays: days, assignedTo: sys.waiting_on, updatedAt: sys.updated_at, waitingSince: null };
    });
    const allTasks = [...queueTasks];
    reviewedTasks.forEach(rt => { if (!allTasks.find(t => t.system.id === rt.system.id)) allTasks.push(rt); });
    setTasks(allTasks);
  }, [queue, systems, isAIEngineer, currentUser]);

  // Load activity when sidebar opens
  useEffect(() => {
    if (selectedTask) {
      setActivityLoading(true);
      api.getSystemActivity(selectedTask.system.id).then(data => setSidebarActivity(data)).catch(() => setSidebarActivity([])).finally(() => setActivityLoading(false));
    }
  }, [selectedTask?.system.id]);

  const refreshData = useCallback(async () => {
    setLoading(true);
    try {
      const [systemsData, modelsData, queueData, compQueueData] = await Promise.all([api.getSystems(), api.getModels(), api.getReviewQueue("ai_engineer", "pending_technical_review").catch(() => []), api.getReviewQueue("ai_compliance_officer", "pending_compliance_review").catch(() => [])]);
      setSystems(systemsData); setModels(modelsData); setQueue(queueData); setComplianceQueue(compQueueData);
    } catch (e) { showToast(`Failed to load data: ${(e as Error).message}`, true); } finally { setLoading(false); }
  }, [showToast]);

  const openDetail = async (id: string) => { try { const s = await api.getSystem(id); setSelectedSystem(s); setDetailOpen(true); } catch (e) { showToast(`Failed to load system: ${(e as Error).message}`, true); } };

  // KPIs
  const openTasks = tasks.filter(t => t.taskStatus === "needs_action" || t.taskStatus === "in_progress").length;
  const actionItems = tasks.filter(t => t.taskStatus === "needs_action" && (t.dueDays !== null && t.dueDays <= 3)).length;
  const newRequests = tasks.filter(t => t.taskType === "new_request" && t.taskStatus !== "submitted").length;
  const clarifications = tasks.filter(t => t.taskType === "clarification").length;
  const reclassifications = tasks.filter(t => t.taskType === "reclassification").length;
  const inProgressCount = tasks.filter(t => t.taskStatus === "in_progress").length;

  const handleRowClick = (task: Task) => setSelectedTask(task);
  const handleRowAction = (task: Task, action: string) => { if (action === "review") setReviewSystem(task.system); else if (action === "reassign") showToast("Reassign functionality coming soon"); else if (action === "history") setSelectedTask(task); };
  const handleFilterChange = (key: string, value: string | null) => { setFilters(prev => ({ ...prev, [key]: value })); setCurrentPage(1); };
  const handleReviewFromSidebar = () => { if (selectedTask) setReviewSystem(selectedTask.system); };
  const handleRequestChangesFromSidebar = async () => { if (!selectedTask) return; try { await api.completeReview(selectedTask.system.id, { action: "request_changes" }); showToast("Changes requested"); setSelectedTask(null); refreshData(); } catch (e) { showToast(`Failed: ${(e as Error).message}`, true); } };

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return systems.filter((sys) => { const matchSearch = !s || sys.name.toLowerCase().includes(s) || sys.id.toLowerCase().includes(s); const matchTier = !tierFilter || sys.tier === tierFilter; const matchLc = !lifecycleFilter || sys.lifecycle === lifecycleFilter; return matchSearch && matchTier && matchLc; });
  }, [systems, search, tierFilter, lifecycleFilter]);

  // AI Engineer View
  if (isAIEngineer) {
    if (loading) return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 80 }}><Spinner size="lg" /></div>;
    return (
      <div style={{ position: "relative" }}>
        <div style={{ marginBottom: 24 }}><h1 style={{ fontSize: 28, fontWeight: 600, color: "#0f172a", margin: 0 }}>AI Systems</h1><p style={{ fontSize: 14, color: "#64748b", marginTop: 8 }}>Technical review tasks and assigned AI systems</p></div>
        <div style={kpiRowStyle}><KPICard label="Open tasks" value={openTasks} /><KPICard label="Action items" value={actionItems} color="#dc2626" /><KPICard label="New requests" value={newRequests} color="#3b82f6" /><KPICard label="Clarifications" value={clarifications} color="#f59e0b" /><KPICard label="Reclassification" value={reclassifications} color="#8b5cf6" /><KPICard label="In progress" value={inProgressCount} color="#64748b" /></div>
        <div style={{ marginBottom: 24 }}><ActionItemsCard tasks={tasks} onRowClick={handleRowClick} /></div>
        <AllTasksCard tasks={tasks} searchQuery={searchQuery} onSearchChange={setSearchQuery} filters={filters} onFilterChange={handleFilterChange} currentPage={currentPage} onPageChange={setCurrentPage} onRowClick={handleRowClick} onRowAction={handleRowAction} />
        <TaskDetailSidebar task={selectedTask} activity={sidebarActivity} activityLoading={activityLoading} onClose={() => setSelectedTask(null)} onReview={handleReviewFromSidebar} onRequestChanges={handleRequestChangesFromSidebar} />
        <ReviewModal system={reviewSystem} onClose={() => setReviewSystem(null)} onReviewComplete={() => { setReviewSystem(null); setSelectedTask(null); refreshData(); }} onDataChange={refreshData} />
        <SystemDetail open={detailOpen} system={selectedSystem} models={models} onClose={() => setDetailOpen(false)} onDelete={() => { setDetailOpen(false); refreshData(); }} onUpdate={(u) => { setSelectedSystem(u); refreshData(); }} />
      </div>
    );
  }

  // Compliance Officer View
  if (isComplianceOfficer) {
    return (
      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 24 }}><h1 style={{ fontSize: 24, fontWeight: 600, color: "#0f172a", margin: 0 }}>Compliance Review</h1><p style={{ fontSize: 14, color: "#64748b", marginTop: 4 }}>Review and approve AI systems for regulatory compliance</p></div>
          <div style={cardStyle}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}><h3 style={{ fontSize: 15, fontWeight: 600, color: "#0f172a", margin: 0 }}>Pending Compliance Review ({complianceQueue.length})</h3><button onClick={refreshData} disabled={loading} style={refreshButtonStyle}><RefreshIcon /> Refresh</button></div>
            {loading ? <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spinner /></div> : complianceQueue.length === 0 ? <div style={{ textAlign: "center", padding: 48, color: "#64748b" }}>No systems pending compliance review</div> : (
              <table style={tableStyle}><thead><tr><th style={thStyle}>System</th><th style={thStyle}>Submitted</th><th style={thStyle}>Risk</th><th style={thStyle}>Action</th></tr></thead><tbody>
                {complianceQueue.map((item) => (<tr key={item.system.id}><td style={tdStyle}><div style={{ fontWeight: 500, color: "#0f172a" }}>{item.system.name}</div><div style={{ fontSize: 12, color: "#64748b" }}>{item.system.id}</div></td><td style={tdStyle}>{item.waiting_since ? new Date(item.waiting_since).toLocaleDateString() : "—"}</td><td style={tdStyle}><TierBadge tier={item.system.tier} /></td><td style={tdStyle}><button onClick={() => setComplianceReviewSystem(item.system)} style={startReviewButtonStyle}>Review</button></td></tr>))}
              </tbody></table>
            )}
          </div>
        </div>
        <ComplianceReviewModal system={complianceReviewSystem} onClose={() => setComplianceReviewSystem(null)} onReviewComplete={refreshData} />
      </div>
    );
  }

  // Default View (App Owner)
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <input type="text" placeholder="Search systems…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, maxWidth: 300, padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none" }} />
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} style={selectStyle}><option value="">All Risk Tiers</option><option value="high">High-Risk</option><option value="limited">Limited</option><option value="minimal">Minimal</option></select>
        <select value={lifecycleFilter} onChange={(e) => setLifecycleFilter(e.target.value)} style={selectStyle}><option value="">All Lifecycles</option><option value="development">Development</option><option value="market">On Market</option></select>
        <div style={{ flex: 1 }} />
        <button onClick={refreshData} disabled={loading} style={refreshButtonStyle}><RefreshIcon /> Refresh</button>
      </div>
      <div style={cardStyle}>
        {loading ? <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spinner /></div> : filtered.length === 0 ? <div style={{ textAlign: "center", padding: 48, color: "#64748b" }}>{systems.length === 0 ? 'No systems registered yet.' : 'No systems match filters.'}</div> : (
          <table style={tableStyle}><thead><tr><th style={thStyle}>System</th><th style={thStyle}>Risk Tier</th><th style={thStyle}>Lifecycle</th><th style={thStyle}>Compliance</th><th style={thStyle}>Registered</th></tr></thead><tbody>
            {filtered.map((s) => (<tr key={s.id} onClick={() => openDetail(s.id)} style={{ cursor: "pointer" }}><td style={tdStyle}><div style={{ fontWeight: 600, color: "#0f172a" }}>{s.name}</div><div style={{ fontSize: 12, color: "#64748b" }}>{s.id} · v{s.version || "1.0.0"}</div></td><td style={tdStyle}><TierBadge tier={s.tier} /></td><td style={tdStyle}><LifecycleBadge lc={s.lifecycle} /></td><td style={tdStyle}><ComplianceBar pct={s.compliance} /></td><td style={tdStyle}><FormattedDate iso={s.created_at} /></td></tr>))}
          </tbody></table>
        )}
      </div>
      <AppOwnerWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onSuccess={refreshData} userDepartment={department} userBusinessUnit={businessUnit} />
      <SystemDetail open={detailOpen} system={selectedSystem} models={models} onClose={() => setDetailOpen(false)} onDelete={() => { setDetailOpen(false); refreshData(); }} onUpdate={(u) => { setSelectedSystem(u); refreshData(); }} />
    </>
  );
}

// Styles
const cardStyle: React.CSSProperties = { background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" };
const cardHeaderStyle: React.CSSProperties = { padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" };
const kpiRowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16, marginBottom: 24 };
const kpiCardStyle: React.CSSProperties = { background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 20, textAlign: "center" };
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse" };
const thStyle: React.CSSProperties = { textAlign: "left", padding: "12px 24px", fontSize: 12, fontWeight: 500, color: "#64748b", borderBottom: "1px solid #f1f5f9", background: "#fafbfc" };
const tdStyle: React.CSSProperties = { padding: "16px 24px", fontSize: 14, borderBottom: "1px solid #f1f5f9", verticalAlign: "middle" };
const moreButtonStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, background: "none", border: "none", color: "#94a3b8", cursor: "pointer", borderRadius: 6 };
const menuItemStyle: React.CSSProperties = { display: "block", width: "100%", padding: "10px 16px", background: "transparent", border: "none", color: "#475569", fontSize: 14, cursor: "pointer", textAlign: "left" };
const urgentBadgeStyle: React.CSSProperties = { background: "#fef2f2", color: "#dc2626", fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 12 };
const sidebarStyle: React.CSSProperties = { position: "fixed", top: 0, right: 0, width: 380, height: "100vh", background: "#fff", boxShadow: "-4px 0 20px rgba(0, 0, 0, 0.1)", zIndex: 100, display: "flex", flexDirection: "column" };
const closeButtonStyle: React.CSSProperties = { width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", borderRadius: 6 };
const sectionLabelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 };
const fieldLabelStyle: React.CSSProperties = { fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.03em" };
const fieldValueStyle: React.CSSProperties = { fontSize: 14, color: "#0f172a", marginTop: 4 };
const riskBadgeStyle: React.CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 16px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" };
const activityItemStyle: React.CSSProperties = { padding: 12, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" };
const secondaryBtnStyle: React.CSSProperties = { flex: 1, padding: "10px 16px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, color: "#475569", fontSize: 14, fontWeight: 500, cursor: "pointer" };
const primaryBtnStyle: React.CSSProperties = { flex: 1, padding: "10px 16px", background: "#3b82f6", border: "none", borderRadius: 8, color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" };
const startReviewButtonStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "6px 14px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, color: "#2563eb", fontSize: 13, fontWeight: 500, cursor: "pointer" };
const selectStyle: React.CSSProperties = { padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none", background: "#fff" };
const filterSelectStyle: React.CSSProperties = { padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, outline: "none", background: "#fff", minWidth: 120 };
const refreshButtonStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: "pointer", color: "#475569" };
