import type { BadgeMeta } from "./types";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export const ASSESSMENT_STATUS_META: Record<string, BadgeMeta> = {
  draft:        { label: "Draft",        cls: "st-draft" },
  submitted:    { label: "Submitted",    cls: "st-submitted" },
  under_review: { label: "Under Review", cls: "st-review" },
  approved:     { label: "Approved",     cls: "st-approved" },
};

export const OBLIGATION_STATUS_META: Record<string, BadgeMeta> = {
  applicable:     { label: "Applicable",     cls: "st-applicable" },
  in_progress:    { label: "In Progress",    cls: "st-progress" },
  fulfilled:      { label: "Fulfilled",      cls: "st-fulfilled" },
  not_applicable: { label: "Not Applicable", cls: "st-na" },
  overdue:        { label: "Overdue",        cls: "st-overdue" },
};

export const CONTROL_STATUS_META: Record<string, BadgeMeta> = {
  not_started:       { label: "Not Started",       cls: "st-draft" },
  planned:           { label: "Planned",           cls: "st-applicable" },
  in_implementation: { label: "In Implementation", cls: "st-progress" },
  implemented:       { label: "Implemented",       cls: "st-submitted" },
  under_review:      { label: "Under Review",      cls: "st-review" },
  effective:         { label: "Effective",         cls: "st-fulfilled" },
  ineffective:       { label: "Ineffective",       cls: "st-overdue" },
  deactivated:       { label: "Deactivated",       cls: "st-na" },
};

export const EVIDENCE_STATUS_META: Record<string, BadgeMeta> = {
  pending:      { label: "Pending",      cls: "st-applicable" },
  under_review: { label: "Under Review", cls: "st-review" },
  approved:     { label: "Approved",     cls: "st-fulfilled" },
  rejected:     { label: "Rejected",     cls: "st-overdue" },
  expired:      { label: "Expired",      cls: "st-na" },
};

export const ASSESSMENT_TYPES: string[] = [
  "compliance", "risk", "privacy", "security", "fairness",
  "transparency", "human_oversight", "operational_readiness", "third_party",
];

export const CONTROL_CATEGORIES: string[] = [
  "human_oversight", "documentation", "monitoring", "security", "fairness",
  "data_governance", "logging", "testing", "change_management",
  "incident_response", "general",
];

export const EVIDENCE_TYPES: string[] = [
  "document", "policy_document", "technical_doc", "test_report",
  "monitoring_data", "approval_record", "audit_log", "training_record",
  "certificate", "screenshot", "api_log",
];

export function humanize(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
