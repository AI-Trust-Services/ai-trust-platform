import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ message, confirmLabel = "Delete", onConfirm, onCancel }: Props) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-[360px]" showCloseButton={false}>
        <DialogHeader className="border-b-0 px-6 pb-2 pt-6">
          <DialogTitle className="sr-only">Confirm</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-5 pt-1">
          <p className="text-sm leading-relaxed text-foreground">{message}</p>
        </div>
        <DialogFooter className="px-6 py-3.5">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
