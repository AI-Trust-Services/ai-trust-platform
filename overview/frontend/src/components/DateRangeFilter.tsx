import type { DateRange } from "../types";
import { Button } from "@/components/ui/button";

interface Props {
  value: DateRange;
  onChange: (r: DateRange) => void;
}

const PRESETS: { preset: DateRange["preset"]; days: number; label: string }[] = [
  { preset: "7d",  days: 7,  label: "7 days"  },
  { preset: "30d", days: 30, label: "30 days" },
  { preset: "90d", days: 90, label: "90 days" },
];

export default function DateRangeFilter({ value, onChange }: Props) {
  return (
    <div className="flex gap-1">
      {PRESETS.map((p) => (
        <Button
          key={p.preset}
          size="sm"
          variant={value.preset === p.preset ? "default" : "outline"}
          onClick={() => onChange({ preset: p.preset, days: p.days })}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}
