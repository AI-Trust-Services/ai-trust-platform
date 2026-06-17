export function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export const TIER_META = {
  "prohibited":    { label: "Prohibited",    cls: "badge-prohibited" },
  "high":          { label: "High-Risk",     cls: "badge-high" },
  "gpai-systemic": { label: "GPAI Systemic", cls: "badge-gpai-systemic" },
  "gpai-standard": { label: "GPAI Standard", cls: "badge-gpai-standard" },
  "limited":       { label: "Limited",       cls: "badge-limited" },
  "minimal":       { label: "Minimal",       cls: "badge-minimal" },
};

export const LIFECYCLE_LABELS = {
  "development":    "Development",
  "testing":        "Testing",
  "conformity":     "Conformity",
  "market":         "On Market",
  "post-market":    "Post-Market",
  "decommissioned": "Decommissioned",
};
