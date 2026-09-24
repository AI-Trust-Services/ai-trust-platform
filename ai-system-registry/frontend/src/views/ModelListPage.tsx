import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { RefreshCw, Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import type { ModelCard, ModelCardCreate } from "../types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

// ── Create dialog ────────────────────────────────────────────────────────────

function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  useEffect(() => { if (open) setName(""); }, [open]);

  async function handleCreateModelCard() {
    if (!name.trim()) { showToast("Name is required", true); return; }
    setSaving(true);
    try {
      const card = await api.createModelCard({ name: name.trim() } satisfies ModelCardCreate);
      showToast(`Model card "${card.name}" created`);
      onCreated(card.id);
    } catch (e) {
      showToast(`Create failed: ${(e as Error).message}`, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[400px] gap-0 p-0">
        <DialogHeader><DialogTitle>New Model Card</DialogTitle></DialogHeader>
        <div className="p-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mc_name">Name <span className="text-[var(--danger-fg)]">*</span></Label>
            <Input
              id="mc_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateModelCard(); }}
              placeholder="e.g. GPT-4o"
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreateModelCard} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── List page ────────────────────────────────────────────────────────────────

export default function ModelListPage() {
  const [models, setModels] = useState<ModelCard[]>([]);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { modelCreateOpen, setModelCreateOpen } = useModalControls();
  const showToast = useToast();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try { setModels(await api.getModels()); }
    catch (e) { showToast(`Failed to load models: ${(e as Error).message}`, true); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  // Header "+ Add Model" button wired through ModalContext (same pattern as Systems).
  useEffect(() => {
    if (modelCreateOpen) { setDialogOpen(true); setModelCreateOpen(false); }
  }, [modelCreateOpen, setModelCreateOpen]);

  const filtered = search
    ? models.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()) || m.id.toLowerCase().includes(search.toLowerCase()))
    : models;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-6 py-3">
        <Input className="w-56" placeholder="Search models…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex-1" />
        <Button variant="ghost" onClick={load}><RefreshCw className="size-4" /></Button>
      </div>

      <div className="px-6 py-5">
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                    No model cards found.
                  </TableCell>
                </TableRow>
              ) : filtered.map((m) => (
                <TableRow
                  key={m.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/models/${m.id}`)}
                >
                  <TableCell>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.id}</div>
                  </TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{m.version || "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {m.tags.map((t) => (
                        <Badge key={t} variant="secondary" className="rounded-full text-xs font-normal">{t}</Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <CreateDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(id) => { setDialogOpen(false); navigate(`/models/${id}`); }}
      />
    </>
  );
}
