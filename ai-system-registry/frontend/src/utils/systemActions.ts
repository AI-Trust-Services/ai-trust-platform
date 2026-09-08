/**
 * Context-aware system action resolver.
 * Determines the primary action based on lifecycle stage, workflow status, and user role.
 */

import type { AISystem, SystemAction } from "../types";

// Lifecycle stage mapping from backend values
const LIFECYCLE_STAGE: Record<string, string> = {
  development: "register",
  testing: "review",
  conformity: "classify",
  market: "comply",
  "post-market": "operate",
  decommissioned: "operate",
};

interface ActionContext {
  system: AISystem;
  currentUsername: string;
  canWrite: boolean;
}

/**
 * Determines the primary contextual action for a system based on:
 * - lifecycle stage
 * - workflow_status
 * - current user's relationship to the system (owner, assignee, compliance officer)
 * - write permissions
 */
export function getPrimarySystemAction(ctx: ActionContext): SystemAction {
  const { system, currentUsername, canWrite } = ctx;
  const stage = LIFECYCLE_STAGE[system.lifecycle] || "register";

  const isOwner = system.owner_username === currentUsername;
  const isAssignee = system.assignee_username === currentUsername;
  const isComplianceOfficer = system.compliance_officer_username === currentUsername;
  const isResponsible = isOwner || isAssignee || isComplianceOfficer;

  // Registration stage - draft systems
  if (system.workflow_status === "draft") {
    const hasStarted = system.updated_at !== system.created_at;
    const label = hasStarted ? "Continue registration" : "Start registration";

    if (!canWrite) {
      return {
        label,
        href: `/systems/${system.id}`,
        disabled: true,
        disabledReason: "Requires systems:write permission",
      };
    }

    if (!isOwner && system.owner_username) {
      return {
        label,
        href: `/systems/${system.id}`,
        disabled: true,
        disabledReason: `Assigned to ${system.owner_username}`,
      };
    }

    return {
      label,
      href: `/systems/${system.id}?tab=details`,
    };
  }

  // Review stage - pending review systems
  if (system.workflow_status === "pending_review") {
    const label = "Continue technical review";

    if (!canWrite) {
      return {
        label,
        href: `/systems/${system.id}`,
        disabled: true,
        disabledReason: "Requires systems:write permission",
      };
    }

    if (!isAssignee && system.assignee_username) {
      return {
        label,
        href: `/systems/${system.id}`,
        disabled: true,
        disabledReason: `Assigned to ${system.assignee_username}`,
      };
    }

    return {
      label,
      href: `/systems/${system.id}/review`,
    };
  }

  // Approved systems in market/post-market - change flow
  if (system.workflow_status === "approved" && (stage === "comply" || stage === "operate")) {
    // High-risk systems need compliance assessment
    if (system.tier === "high" || system.tier === "gpai-systemic") {
      if (stage === "comply") {
        return {
          label: "Continue assessment",
          href: `/compliance/#/systems/${system.id}`,
          external: true,
          disabled: !canWrite,
          disabledReason: !canWrite ? "Requires systems:write permission" : undefined,
        };
      }
    }

    // Operating systems - monitoring or change
    if (stage === "operate") {
      return {
        label: "Open monitoring",
        href: `/monitoring/#/systems/${system.id}`,
        external: true,
      };
    }

    // Locked/approved systems - start change flow
    if (isResponsible) {
      return {
        label: "Start change",
        href: `/systems/${system.id}/change`,
        disabled: !canWrite,
        disabledReason: !canWrite ? "Requires systems:write permission" : undefined,
      };
    }

    return {
      label: "Propose change",
      href: `/systems/${system.id}/change`,
      disabled: !canWrite,
      disabledReason: !canWrite ? "Requires systems:write permission" : undefined,
    };
  }

  // Classification stage
  if (stage === "classify") {
    return {
      label: "Review classification",
      href: `/systems/${system.id}/classify`,
      disabled: !canWrite,
      disabledReason: !canWrite ? "Requires systems:write permission" : undefined,
    };
  }

  // Default - view details
  return {
    label: "View details",
    href: `/systems/${system.id}`,
  };
}

/**
 * Get the lifecycle stage label from backend lifecycle value.
 */
export function getLifecycleStageLabel(lifecycle: string): string {
  const labels: Record<string, string> = {
    development: "Register",
    testing: "Review",
    conformity: "Classify",
    market: "Comply",
    "post-market": "Operate",
    decommissioned: "Operate",
  };
  return labels[lifecycle] || "Register";
}
