import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface TimeframeValue {
  /** Backend format: "YYYY-MM-DD HH:mm:ss", interpreted as UTC by the API. */
  from?: string;
  /** Backend format: "YYYY-MM-DD HH:mm:ss", interpreted as UTC by the API. */
  to?: string;
}

interface Props {
  value: TimeframeValue;
  onChange: (next: TimeframeValue) => void;
}

const QUICK = [
  { label: "24H", hours: 24 },
  { label: "7D", hours: 24 * 7 },
  { label: "1M", hours: 24 * 30 },
];

/** Format a Date as the backend's UTC "YYYY-MM-DD HH:mm:ss". */
function toBackendUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Convert a backend UTC string ("YYYY-MM-DD HH:mm:ss") to the LOCAL "yyyy-MM-dd HH:mm"
 * the picker displays. Without this the user would see UTC times, which is
 * confusing — they pick "today 00:00" and find out it meant 02:00 in their timezone.
 */
function backendUtcToLocalPicker(backendUtc: string | undefined): string {
  if (!backendUtc) return "";
  const d = new Date(backendUtc.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  // Local components, zero-padded.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Convert the picker's LOCAL "yyyy-MM-dd HH:mm" back to backend UTC.
 * This is the missing piece: previously we sent the local string verbatim, and
 * the backend treated it as UTC, shifting the window by the user's offset.
 */
function localPickerToBackendUtc(localStr: string, fallbackSeconds = "00"): string | undefined {
  if (!localStr) return undefined;
  // The string is "yyyy-MM-dd HH:mm" in the user's local timezone.
  const [date, time] = localStr.split(" ");
  if (!date || !time) return undefined;
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return undefined;
  const local = new Date(y, mo - 1, d, h, mi, Number(fallbackSeconds));
  return toBackendUtc(local);
}

function quickFrom(hours: number): string {
  return toBackendUtc(new Date(Date.now() - hours * 3600_000));
}

/** Returns the active quick-button label, or null if none matches. */
function activeQuick(value: TimeframeValue): string | null {
  if (!value.from || value.to) return null;
  for (const tf of QUICK) {
    const expected = new Date(quickFrom(tf.hours).replace(" ", "T") + "Z").getTime();
    const got = new Date(value.from.replace(" ", "T") + "Z").getTime();
    if (Math.abs(expected - got) < 60_000) return tf.label;
  }
  return null;
}

/**
 * Combined timeframe filter: three quick buttons (24H / 7D / 1M) plus a Custom
 * range with two `<DateTimePicker>` instances (date + 24h time).
 *
 * Picker UI is in the user's LOCAL timezone (intuitive: "I want traces from
 * today 14:00") but the API receives UTC, matching how the backend stores
 * `started_at`.
 */
export function TimeframePicker({ value, onChange }: Props) {
  const active = activeQuick(value);
  const isCustomActive = !!(value.from && value.to);
  const [customOpen, setCustomOpen] = useState(isCustomActive);
  const [draft, setDraft] = useState<{ from: string; to: string }>({
    from: backendUtcToLocalPicker(value.from),
    to: backendUtcToLocalPicker(value.to),
  });

  // Resync the draft when the value changes from the outside (e.g. reset).
  useEffect(() => {
    setDraft({
      from: backendUtcToLocalPicker(value.from),
      to: backendUtcToLocalPicker(value.to),
    });
    if (!value.from && !value.to) setCustomOpen(false);
  }, [value.from, value.to]);

  function setQuick(label: string, hours: number) {
    if (active === label) {
      onChange({});
      return;
    }
    setCustomOpen(false);
    onChange({ from: quickFrom(hours), to: undefined });
  }

  function applyCustom() {
    const fromUtc = localPickerToBackendUtc(draft.from, "00");
    const toUtc = localPickerToBackendUtc(draft.to, "59");
    if (!fromUtc || !toUtc) return;
    onChange({ from: fromUtc, to: toUtc });
  }

  /** Pre-fill the picker with "today 00:00 — now" when the user opens Custom. */
  function openCustom() {
    if (!draft.from || !draft.to) {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const pad = (n: number) => String(n).padStart(2, "0");
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      setDraft({ from: fmt(startOfDay), to: fmt(now) });
    }
    setCustomOpen(true);
  }

  const canApply =
    !!draft.from &&
    !!draft.to &&
    !!localPickerToBackendUtc(draft.from) &&
    !!localPickerToBackendUtc(draft.to) &&
    new Date(draft.from.replace(" ", "T")).getTime() <=
      new Date(draft.to.replace(" ", "T")).getTime();

  return (
    <div style={styles.root}>
      <div style={styles.quickGroup}>
        {QUICK.map((tf) => (
          <button
            key={tf.label}
            type="button"
            style={{ ...styles.quickBtn, ...(active === tf.label ? styles.quickBtnActive : {}) }}
            onClick={() => setQuick(tf.label, tf.hours)}
          >
            {tf.label}
          </button>
        ))}
        <button
          type="button"
          style={{ ...styles.quickBtn, ...((customOpen || isCustomActive) ? styles.quickBtnActive : {}) }}
          onClick={() => (customOpen ? setCustomOpen(false) : openCustom())}
          aria-expanded={customOpen}
        >
          Custom {customOpen ? "▴" : "▾"}
        </button>
      </div>

      {customOpen && (
        <div style={styles.customRow}>
          <DateTimePickerField
            value={draft.from}
            placeholder="From"
            onChange={(v) => setDraft((d) => ({ ...d, from: v }))}
          />
          <span style={styles.dash}>–</span>
          <DateTimePickerField
            value={draft.to}
            placeholder="To"
            onChange={(v) => setDraft((d) => ({ ...d, to: v }))}
          />
          <Button size="sm" disabled={!canApply} onClick={applyCustom}>
            Apply
          </Button>
          {isCustomActive && (
            <Button variant="ghost" size="sm" onClick={() => onChange({})}>
              Clear
            </Button>
          )}
          <span style={styles.tzHint}>
            Times in your local timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Native `<input type="datetime-local">` styled as the kit Input. The picker
 * works in "yyyy-MM-dd HH:mm" (space-separated) everywhere else in this file,
 * but datetime-local uses a "T" separator — so we swap the separator on the way
 * in and out, preserving the exact from/to change contract the parent expects.
 */
function DateTimePickerField({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (val: string) => void;
}) {
  const inputValue = value ? value.replace(" ", "T") : "";
  return (
    <Input
      type="datetime-local"
      value={inputValue}
      placeholder={placeholder}
      style={{ minWidth: 200 }}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v ? v.replace("T", " ") : "");
      }}
    />
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column" as const, gap: 8 },
  quickGroup: { display: "flex", gap: 4 },
  quickBtn: {
    background: "none",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "3px 10px",
    fontSize: "0.75rem",
    fontFamily: "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    color: "var(--foreground)",
    cursor: "pointer",
  },
  quickBtnActive: {
    background: "var(--brand)",
    borderColor: "var(--brand)",
    color: "#fff",
  },
  customRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap" as const,
  },
  dash: { color: "var(--text-secondary)", fontSize: "0.875rem" },
  tzHint: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
    marginLeft: 4,
  },
};
