/**
 * Backend timestamps come from ClickHouse `DateTime` columns, ISO-formatted but
 * WITHOUT a timezone suffix (e.g. "2026-06-15T15:46:02"). They represent UTC.
 *
 * Plain `new Date("2026-06-15T15:46:02")` treats that as local time, which
 * silently shifts displayed times by the user's offset and makes the timeframe
 * filter look broken (picker is local, table showed raw UTC). Always go through
 * this helper instead.
 */
export function parseBackendDate(iso: string): Date {
  if (!iso) return new Date(NaN);
  // Already has a TZ marker — let the browser handle it.
  if (iso.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(iso)) return new Date(iso);
  return new Date(iso + "Z");
}
