import type { ReactNode } from "react";

/**
 * Shared styling for recharts inside a Card, matching the shadcn "charts" look:
 * muted axis ticks, faint grid lines, a soft tooltip cursor, and no focus
 * outlines on chart surfaces. Apply to the element wrapping <ResponsiveContainer>.
 */
export const chartClass =
  "text-xs " +
  "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground " +
  "[&_.recharts-cartesian-axis_line]:stroke-border " +
  "[&_.recharts-cartesian-grid_line]:stroke-[var(--grid)] " +
  "[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-[color-mix(in_srgb,var(--muted-foreground)_10%,transparent)] " +
  "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-border " +
  "[&_.recharts-layer]:outline-none " +
  "[&_.recharts-sector]:outline-none " +
  "[&_.recharts-surface]:outline-none";

interface TooltipItem {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: Record<string, any>;
}

interface ChartTooltipProps {
  // Injected by recharts when passed via <Tooltip content={...} />
  active?: boolean;
  label?: string | number;
  payload?: TooltipItem[];
  // Our own knobs
  hideLabel?: boolean;
  labelFormatter?: (label: string | number, payload: TooltipItem[]) => ReactNode;
  valueFormatter?: (value: number, item: TooltipItem) => ReactNode;
  nameFormatter?: (item: TooltipItem) => ReactNode;
}

/** shadcn-style tooltip body — rounded card, color swatch per series, muted label. */
export function ChartTooltip({
  active,
  label,
  payload,
  hideLabel,
  labelFormatter,
  valueFormatter,
  nameFormatter,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const showLabel = !hideLabel && label !== undefined && label !== "";

  return (
    <div className="min-w-[8rem] rounded-lg border border-border bg-card px-2.5 py-2 text-xs shadow-[var(--shadow-md)] animate-in fade-in-0 zoom-in-95 duration-150">
      {showLabel && (
        <div className="mb-1.5 font-medium text-foreground">
          {labelFormatter ? labelFormatter(label as string | number, payload) : label}
        </div>
      )}
      <div className="flex flex-col gap-1">
        {payload.map((item, i) => {
          const num = typeof item.value === "number" ? item.value : Number(item.value);
          return (
            <div key={i} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="size-2 shrink-0 rounded-[3px]"
                  style={{ background: item.color ?? "var(--brand)" }}
                />
                {nameFormatter ? nameFormatter(item) : item.name}
              </span>
              <span className="font-semibold tabular-nums text-foreground">
                {valueFormatter ? valueFormatter(num, item) : item.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
