import "@ui5/webcomponents/dist/Input.js";
import "@ui5/webcomponents-icons/dist/search.js";
import { useEffect, useRef, useState } from "react";

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
 *
 * UI5 quirks worked around here:
 *   - We set `value` via the element's property (not JSX attribute), since
 *     attribute reflection isn't reliable for re-renders.
 *   - We listen via addEventListener for `input` and `keydown`; the `target`
 *     of `input` is the <ui5-input> itself, whose `.value` is the current text.
 */
export function TraceIdSearch({ value, onChange, debounceMs = 300 }: Props) {
  const ref = useRef<HTMLElement & { value: string }>(null);
  const [local, setLocal] = useState(value ?? "");

  // Keep the underlying UI5 element's value in sync with React state.
  useEffect(() => {
    const el = ref.current;
    if (el && el.value !== local) {
      el.value = local;
    }
  }, [local]);

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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onInput = (e: Event) => {
      const v = (e.target as HTMLInputElement).value ?? "";
      setLocal(v);
    };

    // Enter → flush immediately, skipping the debounce.
    const onKeyDown = (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key !== "Enter") return;
      const v = (e.target as HTMLInputElement).value ?? "";
      const trimmed = v.trim();
      onChange(trimmed === "" ? undefined : trimmed);
    };

    el.addEventListener("input", onInput);
    el.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKeyDown);
    };
  }, [onChange]);

  return (
    // @ts-ignore — UI5 web component
    <ui5-input
      ref={ref}
      placeholder="Search trace ID…"
      icon="search"
      style={{ minWidth: 240 }}
    />
  );
}
