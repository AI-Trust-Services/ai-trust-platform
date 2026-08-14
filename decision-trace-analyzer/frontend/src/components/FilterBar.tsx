import { Filter, CircleAlert, RotateCcw } from "lucide-react";
import { type TraceFilters } from "../api/traces";
import { TimeframePicker } from "./TimeframePicker";
import { TraceIdSearch } from "./TraceIdSearch";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  filters: TraceFilters;
  services: string[];
  models: string[];
  onChange: (filters: TraceFilters) => void;
}

// Radix Select disallows an empty-string item value, so the "all" option uses
// a sentinel that maps back to "" (cleared) in the change handler — preserving
// the original contract where selecting the placeholder clears the filter.
const ALL = "__all__";

function KitSelect({
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
  return (
    <Select
      value={value || ALL}
      onValueChange={(v) => onChange(v === ALL ? "" : v)}
    >
      <SelectTrigger className="h-8" style={{ minWidth: 140 }}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
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
      <Filter style={styles.icon} />

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

      <KitSelect
        value={filters.service_name}
        options={services}
        placeholder="All services"
        onChange={(val) => onChange({ ...filters, service_name: val || undefined })}
      />

      <KitSelect
        value={filters.model}
        options={models}
        placeholder="All models"
        onChange={(val) => onChange({ ...filters, model: val || undefined })}
      />

      <Toggle
        variant="outline"
        size="sm"
        pressed={!!filters.errors_only}
        onPressedChange={() =>
          onChange({ ...filters, errors_only: filters.errors_only ? undefined : true })
        }
        className="data-[state=on]:bg-[var(--danger-bg)] data-[state=on]:text-[var(--danger-fg)] data-[state=on]:border-[var(--danger-border)]"
        title="Show only traces with at least one errored span"
      >
        <CircleAlert />
        Errors only
      </Toggle>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={() => onChange({})}>
          <RotateCcw />
          Reset
        </Button>
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
