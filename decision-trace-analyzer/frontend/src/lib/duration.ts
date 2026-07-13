import { type Span } from "../api/traces";
import { parseBackendDate } from "./dates";

/** Format a duration in ms as either "123ms" (sub-second) or "12.34s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Wall-clock span across a list of spans — earliest start to latest end. Treats
 * overlapping spans correctly (a parent's duration plus a child's duration is
 * NOT the wall-clock total — the parent already contains the child).
 */
export function totalDuration(spans: Span[]): number {
  if (spans.length === 0) return 0;
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const s of spans) {
    const start = parseBackendDate(s.started_at).getTime();
    const end = start + (s.duration_ms || 0);
    if (start < minStart) minStart = start;
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd - minStart;
}
