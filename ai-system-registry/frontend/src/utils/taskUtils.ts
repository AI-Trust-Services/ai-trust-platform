/**
 * Shared task derivation utilities.
 * Used by SystemWorkspace, SystemTasks, and other components that need task counts.
 */

import type { AISystem, SystemTask } from "../types";

// Lifecycle stage label mapping
const LIFECYCLE_LABELS: Record<string, string> = {
  development: "Register",
  testing: "Review",
  conformity: "Classify",
  market: "Comply",
  "post-market": "Operate",
  decommissioned: "Operate",
};

export function getLifecycleStageLabel(lifecycle: string): string {
  return LIFECYCLE_LABELS[lifecycle] || "Register";
}

/**
 * Derive tasks from system state.
 * Returns all tasks for the system with assignee information.
 */
export function deriveTasksFromSystem(system: AISystem, currentUsername: string): SystemTask[] {
  const tasks: SystemTask[] = [];
  const stage = getLifecycleStageLabel(system.lifecycle);

  // Draft systems need registration completion
  if (system.workflow_status === "draft") {
    const isMyTask = system.owner_username === currentUsername;
    tasks.push({
      id: `${system.id}-registration`,
      title: "Complete system registration",
      description: "Fill in required system information",
      type: "registration",
      status: isMyTask ? "in_progress" : "waiting",
      priority: "medium",
      assignee: system.owner_username,
      assigneeRole: "Owner",
      stage,
      actionHref: `/systems/${system.id}/edit`,
    });
  }

  // Pending review systems need technical review
  if (system.workflow_status === "pending_review") {
    const isMyTask = system.assignee_username === currentUsername;
    tasks.push({
      id: `${system.id}-review`,
      title: "Review technical information",
      description: "Verify and complete technical details",
      type: "review",
      status: isMyTask ? "in_progress" : "waiting",
      priority: "high",
      assignee: system.assignee_username || system.owner_username,
      assigneeRole: "Engineer",
      stage,
      actionHref: `/systems/${system.id}/review`,
    });
  }

  // High-risk systems need compliance assessment
  if (system.tier === "high" || system.tier === "gpai-systemic") {
    const isMyTask = system.compliance_officer_username === currentUsername;
    tasks.push({
      id: `${system.id}-compliance`,
      title: "Complete compliance assessment",
      description: `${stage} stage compliance review`,
      type: "compliance",
      status: isMyTask ? "in_progress" : "open",
      priority: "high",
      assignee: system.compliance_officer_username || system.assignee_username,
      assigneeRole: "Compliance Officer",
      stage,
      actionHref: `/compliance/#/systems/${system.id}`,
      external: true,
    });
  }

  return tasks;
}

/**
 * Filter tasks to only those assigned to the current user.
 */
export function getMyTasks(tasks: SystemTask[], currentUsername: string): SystemTask[] {
  return tasks.filter(t => t.assignee === currentUsername && t.status !== "completed");
}

/**
 * Get count of tasks assigned to the current user.
 */
export function getMyTaskCount(system: AISystem, currentUsername: string): number {
  const tasks = deriveTasksFromSystem(system, currentUsername);
  return getMyTasks(tasks, currentUsername).length;
}

/**
 * Get total task count for the system.
 */
export function getTotalTaskCount(system: AISystem, currentUsername: string): number {
  return deriveTasksFromSystem(system, currentUsername).length;
}
