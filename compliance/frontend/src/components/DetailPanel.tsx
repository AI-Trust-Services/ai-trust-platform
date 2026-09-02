import type { ReactNode } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

interface DetailPanelProps {
  open?: boolean;
  title: string;
  subtitle?: string;
  badge?: string;
  onClose: () => void;
  children: ReactNode;
}

export default function DetailPanel({ open = true, title, subtitle, badge, onClose, children }: DetailPanelProps) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="pr-12">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <SheetTitle className="break-words">{title}</SheetTitle>
              {subtitle && <SheetDescription className="mt-1 font-medium text-primary">{subtitle}</SheetDescription>}
            </div>
            {badge && <Badge variant="secondary" className="rounded-full font-medium">{badge}</Badge>}
          </div>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto pb-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

interface DetailFieldProps { label: string; children: ReactNode; }
export function DetailField({ label, children }: DetailFieldProps) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="w-[120px] shrink-0 pt-px text-xs text-muted-foreground">{label}</span>
      <span className="break-words text-[13px] text-foreground">{children}</span>
    </div>
  );
}

interface DetailSectionProps { title: string; children: ReactNode; }
export function DetailSection({ title, children }: DetailSectionProps) {
  return (
    <div className="px-5 pt-4">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}
