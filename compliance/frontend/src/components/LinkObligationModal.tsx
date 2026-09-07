import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import type { AISystem, Assessment, Control, Obligation } from "../types";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface Props {
  open: boolean;
  control: Control | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function LinkObligationModal({ open, control, onClose, onSuccess }: Props) {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [systemsById, setSystemsById] = useState<Record<string, AISystem>>({});
  const [assessmentId, setAssessmentId] = useState("");
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const showToast = useToast();

  // On open: load the assessment list (scoped to the control's system, or all
  // assessments for an org-wide control) plus systems for labelling, and the
  // control's currently-linked obligation IDs.
  const load = useCallback(async () => {
    if (!control) return;
    try {
      const [assess, sys, detail] = await Promise.all([
        api.getAssessments(control.ai_system_id ?? undefined),
        api.getSystems(),
        api.getControl(control.id),
      ]);
      setAssessments(assess);
      setSystemsById(Object.fromEntries(sys.map((s) => [s.id, s])));
      setLinked(new Set(detail.obligation_ids));
    } catch (e) {
      showToast(`Failed to load: ${(e as Error).message}`, true);
    }
  }, [control, showToast]);

  useEffect(() => {
    if (open) {
      setAssessmentId("");
      setObligations([]);
      load();
    }
  }, [open, load]);

  // When an assessment is picked, load only that assessment's obligations.
  useEffect(() => {
    if (!assessmentId) { setObligations([]); return; }
    (async () => {
      try {
        setObligations(await api.getObligations({ assessment_id: assessmentId }));
      } catch (e) {
        showToast(`Failed to load obligations: ${(e as Error).message}`, true);
      }
    })();
  }, [assessmentId, showToast]);

  if (!open || !control) return null;

  async function toggle(obligationId: string, isLinked: boolean) {
    if (!control) return;
    setBusy(obligationId);
    try {
      if (isLinked) {
        await api.unlinkObligation(control.id, obligationId);
        setLinked((s) => { const n = new Set(s); n.delete(obligationId); return n; });
      } else {
        await api.linkObligation(control.id, obligationId);
        setLinked((s) => new Set(s).add(obligationId));
      }
      onSuccess();
    } catch (e) {
      showToast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  const orgWide = !control.ai_system_id;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Link Obligations — {control.title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto">
          <div className="px-6 pt-4">
            <div className="rounded-md border border-[var(--info-border,var(--border))] bg-[var(--info-bg,var(--muted))] px-3 py-2 text-[13px] text-foreground">
              Linking a control marks its obligations "In Progress". When the control becomes Effective (via approved evidence), they become "Fulfilled".
            </div>
          </div>
          <div className="px-6 pt-4">
            <Label className="mb-1.5 block">Assessment</Label>
            <Select value={assessmentId} onValueChange={setAssessmentId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select an assessment…" /></SelectTrigger>
              <SelectContent>
                {assessments.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {orgWide ? `${systemsById[a.ai_system_id]?.name ?? a.ai_system_id} — ${a.title}` : a.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!assessmentId ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Select an assessment to see its obligations.</div>
          ) : obligations.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">This assessment has no obligations.</div>
          ) : (
            <div className="mt-3 px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Obligation</TableHead>
                    <TableHead>Ref</TableHead>
                    <TableHead className="text-right">Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {obligations.map((o) => {
                    const isLinked = linked.has(o.id);
                    return (
                      <TableRow key={o.id}>
                        <TableCell>
                          <div className="text-[13px] font-medium text-foreground">{o.title}</div>
                          <div className="text-[11px] text-muted-foreground">{o.id}</div>
                        </TableCell>
                        <TableCell className="text-xs">{o.article_ref || "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={isLinked ? "outline" : "default"}
                            disabled={busy === o.id}
                            onClick={() => toggle(o.id, isLinked)}
                          >
                            {busy === o.id && <Loader2 className="animate-spin" />}
                            {isLinked ? "Unlink" : "Link"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
