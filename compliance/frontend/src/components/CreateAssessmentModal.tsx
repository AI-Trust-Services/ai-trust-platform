import { useState, useEffect } from "react";
import { ClipboardList } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import type { AISystem } from "../types";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialSystemId?: string;
  initialFrameworkId?: string;
  onOpenInRegistry: (systemId: string) => void | Promise<void>;
}

type Step = "system" | "framework";

const EU_AI_ACT_ID = "FRM-EU-AI-ACT";

export default function CreateAssessmentModal({ open, onClose, initialSystemId, onOpenInRegistry }: Props) {
  const [step, setStep] = useState<Step>("system");
  const [systemId, setSystemId] = useState("");
  const [systems, setSystems] = useState<AISystem[]>([]);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;
    setSystemId(initialSystemId ?? "");
    if (initialSystemId) setStep("framework");
    else setStep("system");
    (async () => {
      try {
        const sys = await api.getSystems();
        setSystems(sys.filter((s) => s.lifecycle !== "decommissioned"));
      } catch (e) {
        showToast(`Failed to load options: ${(e as Error).message}`, true);
      }
    })();
  }, [open, initialSystemId, showToast]);

  if (!open) return null;

  async function pickFramework(_fwId: string) {
    if (!systemId) { showToast("Select an AI system first", true); return; }
    await onOpenInRegistry(systemId);
  }

  const title = step === "framework" ? "Select Framework" : "New Assessment";

  return (
    <Dialog open onOpenChange={(o: boolean) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {step === "system" && (
          <div className="flex flex-col gap-4 p-6">
            <div className="flex flex-col gap-1.5">
              <Label>AI System <span className="text-destructive">*</span></Label>
              <Select value={systemId} onValueChange={setSystemId}>
                <SelectTrigger><SelectValue placeholder="Select a system…" /></SelectTrigger>
                <SelectContent>
                  {systems.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.id}) — {s.tier === "pending" ? "Pending classification" : s.tier}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === "framework" && (
          <div className="flex flex-col gap-4 px-6 py-5">
            <p className="text-sm font-medium text-muted-foreground">Which framework would you like to assess against?</p>
            <div className="flex flex-col gap-2">
              <button
                className="flex flex-1 w-full flex-col gap-4 rounded-lg border-2 border-[var(--brand)] bg-[var(--brand)]/5 p-5 text-left transition-all cursor-pointer hover:shadow-[0_0_0_1px_var(--brand)]"
                onClick={() => pickFramework(EU_AI_ACT_ID)}
              >
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)]/10 text-[var(--brand)]">
                  <ClipboardList className="size-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold">EU AI Act Risk Classification</span>
                    <span className="rounded-full bg-[var(--brand)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--brand)]">Strongly Recommended</span>
                  </div>
                  <div className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">
                    Run the risk classification questionnaire, determine the category, and generate obligations.
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {step === "system" && (
            <Button onClick={() => { if (!systemId) { showToast("Select an AI system", true); return; } setStep("framework"); }}>
              Next
            </Button>
          )}
          {step === "framework" && !initialSystemId && (
            <Button variant="ghost" onClick={() => setStep("system")}>← Back</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
