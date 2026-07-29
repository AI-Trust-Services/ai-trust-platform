import type { DateRange } from "../types";

interface Props {
  value: DateRange;
  onChange: (r: DateRange) => void;
}

const PRESETS: { preset: DateRange["preset"]; days: number; label: string }[] = [
  { preset: "7d",  days: 7,  label: "7 days"  },
  { preset: "30d", days: 30, label: "30 days" },
  { preset: "90d", days: 90, label: "90 days" },
];

export default function DateRangeFilter({ value, onChange }: Props): JSX.Element {
  return (
    <div className="date-range-filter">
      {PRESETS.map((p) => (
        <button
          key={p.preset}
          className={`date-range-btn${value.preset === p.preset ? " active" : ""}`}
          onClick={() => onChange({ preset: p.preset, days: p.days })}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}