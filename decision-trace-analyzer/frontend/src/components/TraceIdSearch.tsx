import "@ui5/webcomponents-icons/dist/search.js";
import { Icon, Input } from "@ui5/webcomponents-react";
import { useEffect, useState } from "react";

interface Props {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  /** Delay (ms) between the user stopping typing and the search firing. */
  debounceMs?: number;
}

/**
 * Trace ID search input.
 *
 * - Debounces typing so we don't refetch on every keystroke.
 * - Pressing Enter flushes immediately (no debounce wait).
 * - Empty string is treated as "no filter" (passes `undefined` upwards).
 */
export function TraceIdSearch({ value, onChange, debounceMs = 300 }: Props) {
  const [local, setLocal] = useState(value ?? "");

  // External resets (e.g. "Reset filters" button) clear the local input too.
  useEffect(() => {
    setLocal(value ?? "");
  }, [value]);

  // Debounce: push the value up after the user pauses typing.
  useEffect(() => {
    const trimmed = local.trim();
    const next = trimmed === "" ? undefined : trimmed;
    if (next === value) return;
    const t = setTimeout(() => onChange(next), debounceMs);
    return () => clearTimeout(t);
  }, [local, debounceMs, onChange, value]);

  return (
    <Input
      value={local}
      placeholder="Search trace ID…"
      icon={<Icon name="search" />}
      style={{ minWidth: 240 }}
      onInput={(e) => setLocal(e.target.value ?? "")}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        const trimmed = local.trim();
        onChange(trimmed === "" ? undefined : trimmed);
      }}
    />
  );
}
