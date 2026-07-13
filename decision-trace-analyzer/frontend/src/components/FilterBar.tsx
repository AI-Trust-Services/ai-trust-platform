import "@ui5/webcomponents/dist/Select.js";
import "@ui5/webcomponents/dist/Option.js";
import "@ui5/webcomponents/dist/Button.js";
import "@ui5/webcomponents/dist/ToggleButton.js";
import "@ui5/webcomponents-icons/dist/filter.js";
import "@ui5/webcomponents-icons/dist/reset.js";
import "@ui5/webcomponents-icons/dist/error.js";
import { useEffect, useRef } from "react";
import { type TraceFilters } from "../api/traces";
import { TimeframePicker } from "./TimeframePicker";
import { TraceIdSearch } from "./TraceIdSearch";

interface Props {
  filters: TraceFilters;
  services: string[];
  models: string[];
  onChange: (filters: TraceFilters) => void;
}

function Ui5Select({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string | undefined;
  options: string[];
  placeholder: string;
  onChange: (val: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { selectedOption: { value: string } };
      onChange(detail.selectedOption.value);
    };
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, [onChange]);

  return (
    // @ts-ignore
    <ui5-select ref={ref} style={{ minWidth: 140 }}>
      {/* @ts-ignore */}
      <ui5-option value="">{placeholder}</ui5-option>
      {options.map((o) => (
        // @ts-ignore
        <ui5-option key={o} value={o} selected={value === o || undefined}>{o}</ui5-option>
      ))}
    {/* @ts-ignore */}
    </ui5-select>
  );
}

export function FilterBar({ filters, services, models, onChange }: Props) {
  const hasFilters = !!(
    filters.from ||
    filters.to ||
    filters.service_name ||
    filters.model ||
    filters.trace_id ||
    filters.errors_only
  );

  return (
    <div style={styles.bar}>
      {/* @ts-ignore */}
      <ui5-icon name="filter" style={styles.icon} />

      <TraceIdSearch
        value={filters.trace_id}
        onChange={(val) => onChange({ ...filters, trace_id: val })}
      />

      <div style={styles.divider} />

      <TimeframePicker
        value={{ from: filters.from, to: filters.to }}
        onChange={(tf) => onChange({ ...filters, from: tf.from, to: tf.to })}
      />

      <div style={styles.divider} />

      <Ui5Select
        value={filters.service_name}
        options={services}
        placeholder="All services"
        onChange={(val) => onChange({ ...filters, service_name: val || undefined })}
      />

      <Ui5Select
        value={filters.model}
        options={models}
        placeholder="All models"
        onChange={(val) => onChange({ ...filters, model: val || undefined })}
      />

      {/* @ts-ignore */}
      <ui5-toggle-button
        icon="error"
        design={filters.errors_only ? "Negative" : "Default"}
        pressed={filters.errors_only || undefined}
        onClick={() =>
          onChange({ ...filters, errors_only: filters.errors_only ? undefined : true })
        }
        title="Show only traces with at least one errored span"
      >
        Errors only
      {/* @ts-ignore */}
      </ui5-toggle-button>

      {hasFilters && (
        // @ts-ignore
        <ui5-button design="Transparent" icon="reset" onClick={() => onChange({})}>
          Reset
        {/* @ts-ignore */}
        </ui5-button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    padding: "8px 16px",
    marginBottom: 16,
    flexWrap: "wrap" as const,
  },
  icon: { color: "var(--color-text-secondary)", width: 16, height: 16 } as React.CSSProperties,
  divider: { width: 1, height: 20, background: "var(--color-border)" },
};
