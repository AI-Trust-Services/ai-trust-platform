import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

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
    <div className="relative" style={{ minWidth: 240 }}>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        style={{ width: 14, height: 14 }}
      />
      <Input
        value={local}
        placeholder="Search trace ID…"
        className="pl-8"
        onChange={(e) => setLocal(e.target.value ?? "")}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const trimmed = local.trim();
          onChange(trimmed === "" ? undefined : trimmed);
        }}
      />
    </div>
  );
}
