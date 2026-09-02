import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Consistent "bold dashboard" card header: a tinted icon chip + title, with an
 * optional subtitle and a right-aligned slot (badges, actions). The chip and
 * icon are tinted from a single `color` via color-mix, so any hex or CSS var
 * (e.g. var(--brand)) works without a separate tint value.
 */
export function CardTitleBar({
  icon: Icon,
  title,
  color = "var(--brand)",
  sub,
  right,
}: {
  icon: LucideIcon;
  title: string;
  color?: string;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2 border-b border-border pb-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" style={{ color }} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-tight tracking-[-0.005em]">{title}</div>
          {sub && <div className="text-[11px] font-normal text-muted-foreground">{sub}</div>}
        </div>
      </div>
      {right}
    </div>
  );
}
