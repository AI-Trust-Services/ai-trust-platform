import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import type { AISystem, Control, EvidenceDetail } from "../types";
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
  evidence: EvidenceDetail | null;
  onClose: () => void;
  onSuccess: (updated: EvidenceDetail) => void;
}

const ALL = "__all__";

export default function LinkControlModal({ open, evidence, onClose, onSuccess }: Props) {
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [systemId, setSystemId] = useState("");
  const [controls, setControls] = useState<Control[]>([]);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const showToast = useToast();

  const load = useCallback(async () => {
    if (!evidence) return;
    try {
      const sys = await api.getSystems();
      setSystems(sys);
      setLinked(new Set(evidence.controls.map((c) => c.id)));
    } catch (e) {
      showToast(`Failed to load: ${(e as Error).message}`, true);
    }
  }, [evidence, showToast]);

  useEffect(() => {
    if (open) {
      setSystemId("");
      setControls([]);
      load();
    }
  }, [open, load]);

  useEffect(() => {
    if (!systemId) { setControls([]); return; }
    (async () => {
      try {
        setControls(await api.getControls({ ai_system_id: systemId }));
      } catch (e) {
        showToast(`Failed to load controls: ${(e as Error).message}`, true);
      }
    })();
  }, [systemId, showToast]);

  if (!open || !evidence) return null;

  async function toggle(controlId: string, isLinked: boolean) {
    if (!evidence) return;
    setBusy(controlId);
    try {
      const updated = isLinked
        ? await api.unlinkControl(evidence.id, controlId)
        : await api.linkControl(evidence.id, controlId);
      setLinked(new Set(updated.controls.map((c) => c.id)));
      onSuccess(updated);
    } catch (e) {
      showToast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Link Controls — {evidence.title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto">
          <div className="px-6 pt-4">
            <Label className="mb-1.5 block">AI System</Label>
            <Select value={systemId || ALL} onValueChange={(v) => setSystemId(v === ALL ? "" : v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select a system…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Select a system…</SelectItem>
                {systems.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!systemId ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Select a system to see its controls.</div>
          ) : controls.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">This system has no controls.</div>
          ) : (
            <div className="mt-3 px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Control</TableHead>
                    <TableHead>Ref</TableHead>
                    <TableHead className="text-right">Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {controls.map((c) => {
                    const isLinked = linked.has(c.id);
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="text-[13px] font-medium text-foreground">{c.title}</div>
                          <div className="text-[11px] text-muted-foreground">{c.id}</div>
                        </TableCell>
                        <TableCell className="text-xs">{c.control_ref || "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={isLinked ? "outline" : "default"}
                            disabled={busy === c.id}
                            onClick={() => toggle(c.id, isLinked)}
                          >
                            {busy === c.id && <Loader2 className="animate-spin" />}
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
