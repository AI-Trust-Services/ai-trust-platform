import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ChooserOption {
  key: string;
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  /** Tailwind classes for the icon chip background/text. */
  iconClass?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  options: ChooserOption[];
  title?: string;
}

export default function RegisterModeChooser({ open, onClose, options, title = "Register AI System" }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={cn(options.length > 2 ? "sm:max-w-[760px]" : "sm:max-w-[560px]")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-5 flex flex-col gap-4">
          <p className="text-sm font-medium text-muted-foreground">How would you like to proceed?</p>

          <div className={cn("grid gap-4", options.length > 2 ? "grid-cols-3" : "grid-cols-2")}>
            {options.map((opt) => (
              <button
                key={opt.key}
                className="border border-border rounded-lg p-5 text-left flex flex-col gap-4 hover:border-primary hover:shadow-[0_0_0_1px_var(--brand)] transition-all cursor-pointer w-full"
                onClick={opt.onClick}
              >
                <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", opt.iconClass ?? "bg-[#f0f2f4] text-[#5a6e82]")}>
                  {opt.icon}
                </div>
                <div>
                  <div className="text-[15px] font-semibold">{opt.title}</div>
                  <div className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">
                    {opt.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
