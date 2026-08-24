import { FileText, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onClose: () => void;
  onManual: () => void;
  onAssisted: () => void;
  title?: string;
  assistedDescription?: string;
  manualDescription?: string;
}

export default function RegisterModeChooser({
  open,
  onClose,
  onManual,
  onAssisted,
  title = "Register AI System",
  assistedDescription,
  manualDescription,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-5 flex flex-col gap-4">
          <p className="text-sm font-medium text-muted-foreground">How would you like to proceed?</p>

          <div className="grid grid-cols-2 gap-4">
            <button
              className="border border-border rounded-lg p-5 text-left flex flex-col gap-4 hover:border-primary hover:shadow-[0_0_0_1px_var(--brand)] transition-all cursor-pointer w-full"
              onClick={onAssisted}
            >
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#e8f0fb] text-[var(--brand)]">
                <Sparkles className="size-5" />
              </div>
              <div>
                <div className="text-[15px] font-semibold">AI-Assisted</div>
                <div className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">
                  {assistedDescription ??
                    "Describe your system in plain language. The assistant asks a few questions, infers the EU AI Act classification, and fills in the details for you."}
                </div>
              </div>
            </button>

            <button
              className="border border-border rounded-lg p-5 text-left flex flex-col gap-4 hover:border-primary hover:shadow-[0_0_0_1px_var(--brand)] transition-all cursor-pointer w-full"
              onClick={onManual}
            >
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#f0f2f4] text-[#5a6e82]">
                <FileText className="size-5" />
              </div>
              <div>
                <div className="text-[15px] font-semibold">Manual</div>
                <div className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">
                  {manualDescription ??
                    "Enter a name and description, then assign an AI Engineer to complete the technical details and risk flags."}
                </div>
              </div>
            </button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
