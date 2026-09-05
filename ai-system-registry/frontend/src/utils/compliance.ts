/**
 * Compliance utilities — status metadata and formatting helpers.
 * Ported from compliance MFE for use in embedded compliance tabs.
 */

import type { BadgeMeta } from "../types";

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

export function humanize(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Score bar for assessments (0-100%) */
export function getScoreColor(score: number | null): string {
  if (score === null) return "bg-muted";
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-yellow-500";
  if (score >= 40) return "bg-orange-500";
  return "bg-red-500";
}

/** Status class to Tailwind color mapping */
export function getStatusColor(cls: string): string {
  switch (cls) {
    case "st-draft": return "bg-gray-100 text-gray-700";
    case "st-applicable": return "bg-blue-100 text-blue-700";
    case "st-progress": return "bg-indigo-100 text-indigo-700";
    case "st-submitted": return "bg-purple-100 text-purple-700";
    case "st-review": return "bg-yellow-100 text-yellow-700";
    case "st-fulfilled":
    case "st-approved": return "bg-green-100 text-green-700";
    case "st-overdue": return "bg-red-100 text-red-700";
    case "st-na": return "bg-gray-100 text-gray-500";
    default: return "bg-gray-100 text-gray-700";
  }
}
