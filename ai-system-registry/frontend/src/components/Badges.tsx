import { Chip } from "@heroui/react";
import type { TierKey, LifecycleKey, ModelType, RegistrationStatus, TaskType, TaskStatus, Priority } from "../types";
import { TIER_META, LIFECYCLE_LABELS, fmtDate } from "../utils";

// Map tiers to HeroUI Chip colors (restrained per PDF §6 - not rainbow)
const TIER_COLORS: Record<TierKey, "danger" | "warning" | "secondary" | "primary" | "success" | "default"> = {
  "prohibited": "danger",
  "high": "warning",
  "gpai-systemic": "secondary",
  "gpai-standard": "secondary",
  "limited": "default",
  "minimal": "success",
};

// Map lifecycle to Chip colors
const LIFECYCLE_COLORS: Record<LifecycleKey, "primary" | "warning" | "secondary" | "success" | "default"> = {
  "development": "primary",
  "testing": "warning",
  "conformity": "secondary",
  "market": "success",
  "post-market": "success",
  "decommissioned": "default",
};

// Map registration status to Chip colors
const REGISTRATION_STATUS_COLORS: Record<RegistrationStatus, "default" | "warning" | "secondary" | "success" | "danger"> = {
  "draft": "default",
  "pending_technical_review": "warning",
  "pending_compliance_review": "secondary",
  "approved": "success",
  "rejected": "danger",
};

const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  "draft": "Draft",
  "pending_technical_review": "Technical Review",
  "pending_compliance_review": "Compliance Review",
  "approved": "Approved",
  "rejected": "Rejected",
};

export function TierBadge({ tier }: { tier: TierKey }) {
  const meta = TIER_META[tier] || { label: tier };
  const color = TIER_COLORS[tier] || "default";
  return (
    <Chip size="sm" variant="flat" color={color}>
      {meta.label}
    </Chip>
  );
}

export function LifecycleBadge({ lc }: { lc: LifecycleKey }) {
  const color = LIFECYCLE_COLORS[lc] || "default";
  return (
    <Chip size="sm" variant="flat" color={color}>
      {LIFECYCLE_LABELS[lc] || lc}
    </Chip>
  );
}

export function ModelTypeBadge({ type }: { type: ModelType }) {
  const colorMap: Record<ModelType, "primary" | "success" | "secondary" | "warning"> = {
    "llm": "primary",
    "embedding": "success",
    "multimodal": "secondary",
    "classifier": "warning",
  };
  return (
    <Chip size="sm" variant="flat" color={colorMap[type] || "default"}>
      {type}
    </Chip>
  );
}

export function ComplianceBar({ pct = 0 }: { pct?: number }) {
  const color = pct >= 100 ? "#1a7a3c" : pct >= 60 ? "#e9a922" : "#bb0000";
  return (
    <div className="progress-wrap">
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="progress-text">{pct.toFixed(0)}%</span>
    </div>
  );
}

export function FormattedDate({ iso }: { iso: string | null | undefined }) {
  return <span>{fmtDate(iso)}</span>;
}

export function RegistrationBadge({ status }: { status: RegistrationStatus }) {
  const color = REGISTRATION_STATUS_COLORS[status] || "default";
  const label = REGISTRATION_STATUS_LABELS[status] || status;
  return (
    <Chip size="sm" variant="flat" color={color}>
      {label}
    </Chip>
  );
}

// Task Type Badge - "New request" (blue), "Clarification" (amber), "Reclassification" (purple)
const TASK_TYPE_COLORS: Record<TaskType, "primary" | "warning" | "secondary"> = {
  "new_request": "primary",
  "clarification": "warning",
  "reclassification": "secondary",
};

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  "new_request": "New request",
  "clarification": "Clarification",
  "reclassification": "Reclassification",
};

export function TaskTypeBadge({ type }: { type: TaskType }) {
  const color = TASK_TYPE_COLORS[type] || "default";
  const label = TASK_TYPE_LABELS[type] || type;
  return (
    <Chip size="sm" variant="flat" color={color}>
      {label}
    </Chip>
  );
}

// Task Status Badge - "Needs action" (red), "In progress" (blue), "Submitted" (green)
const TASK_STATUS_COLORS: Record<TaskStatus, "danger" | "primary" | "success" | "default"> = {
  "needs_action": "danger",
  "in_progress": "primary",
  "submitted": "success",
  "informational": "default",
};

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  "needs_action": "Needs action",
  "in_progress": "In progress",
  "submitted": "Submitted",
  "informational": "Completed",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const color = TASK_STATUS_COLORS[status] || "default";
  const label = TASK_STATUS_LABELS[status] || status;
  return (
    <Chip size="sm" variant="flat" color={color}>
      {label}
    </Chip>
  );
}

// Priority Badge - "Critical" (red), "High" (amber), "Medium" (gray), "Low" (green)
const PRIORITY_COLORS: Record<Priority, "danger" | "warning" | "default" | "success"> = {
  "critical": "danger",
  "high": "warning",
  "medium": "default",
  "low": "success",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  "critical": "Critical",
  "high": "High",
  "medium": "Medium",
  "low": "Low",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const color = PRIORITY_COLORS[priority] || "default";
  const label = PRIORITY_LABELS[priority] || priority;
  return (
    <Chip size="sm" variant="flat" color={color}>
      {label}
    </Chip>
  );
}
