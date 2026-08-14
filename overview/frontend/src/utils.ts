import type { TierKey } from "./types";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
}

/** Single source for value-based chart/bar/progress coloring (governed status ramp). */
export function statusColor(pct: number): string {
  return pct >= 80 ? "var(--success)" : pct >= 50 ? "var(--warning)" : "var(--destructive)";
}

export const TIER_COLORS: Record<TierKey, string> = {
  prohibited:       "#8b0000",
  high:             "#e05c00",
  "gpai-systemic":  "#5a0080",
  "gpai-standard":  "#9b59b6",
  limited:          "#e9a922",
  minimal:          "#1a7a3c",
};

export const LIFECYCLE_COLORS: Record<string, string> = {
  development:    "#0a6ed1",
  testing:        "#e9a922",
  conformity:     "#e05c00",
  market:         "#1a7a3c",
  "post-market":  "#0d7a3c",
  decommissioned: "#999999",
};

export const PALETTE = [
  "#0a6ed1", "#1a7a3c", "#e05c00", "#5a0080",
  "#e9a922", "#8b0000", "#00758f", "#3d6b99",
  "#2e8b57", "#c0392b",
];

export const HIST_COLORS = ["#bb0000", "#e05c00", "#e9a922", "#3d9e6b", "#1a7a3c"];

export const TIER_LABELS: Record<TierKey, string> = {
  prohibited:       "Prohibited",
  high:             "High-Risk",
  "gpai-systemic":  "GPAI Systemic",
  "gpai-standard":  "GPAI Standard",
  limited:          "Limited",
  minimal:          "Minimal",
};
