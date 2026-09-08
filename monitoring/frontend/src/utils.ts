export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export const TIER_META = {
  "prohibited":    { label: "Prohibited Practice",          cls: "badge-prohibited" },
  "high":          { label: "High Risk AI System",          cls: "badge-high" },
  "gpai-systemic": { label: "GPAI with Systemic Risk",      cls: "badge-gpai-systemic" },
  "gpai-standard": { label: "GPAI Standard",                cls: "badge-gpai-standard" },
  "limited":       { label: "Minimal or No Risk AI System", cls: "badge-limited" },
  "minimal":       { label: "Minimal or No Risk AI System", cls: "badge-minimal" },
};

export const LIFECYCLE_LABELS = {
  "development":    "Development",
  "testing":        "Testing",
  "prod_ready":     "Production Ready",
  "market":         "On Market",
  "service":        "In Service",
  "updated":        "Updated",
  "decommissioned": "Decommissioned",
};
