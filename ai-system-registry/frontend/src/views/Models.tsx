import { useState, useEffect, useCallback, useMemo } from "react";
import { Pencil, Trash2, RefreshCw } from "lucide-react";
import { ModelTypeBadge } from "../components/Badges";
import ModelModal from "../components/ModelModal";
import ModelDetail from "../components/ModelDetail";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import { SELECT_CLASS } from "../utils";
import type { ModelCard } from "../types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export default function Models() {
  const [models, setModels] = useState<ModelCard[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelCard | null>(null);
  const [detailModelId, setDetailModelId] = useState<string | null>(null);
  const { modelCreateOpen, setModelCreateOpen, mayWrite } = useModalControls();
  const showToast = useToast();
  const noWriteTitle = "Requires permission: systems:write";

  const loadModels = useCallback(async () => {
    try {
      const data = await api.getModels();
      setModels(data);
    } catch (e) {
      showToast(`Failed to load models: ${(e as Error).message}`, true);
    }
  }, [showToast]);

  useEffect(() => { loadModels(); }, [loadModels]);

  // Open "Add Model" modal when triggered from App header button
  useEffect(() => {
    if (modelCreateOpen) {
      setModalOpen(true);
      setModelCreateOpen(false);
    }
  }, [modelCreateOpen, setModelCreateOpen]);

  const providers = useMemo(
    () => [...new Set(models.map((m) => m.provider))].sort(),
    [models]
  );

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return models.filter((m) => {
      const matchSearch = !s || m.name.toLowerCase().includes(s) ||
        m.id.toLowerCase().includes(s) || m.provider.toLowerCase().includes(s);
      const matchType = !typeFilter || m.model_type === typeFilter;
      const matchProvider = !providerFilter || m.provider === providerFilter;
      return matchSearch && matchType && matchProvider;
    });
  }, [models, search, typeFilter, providerFilter]);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete model "${name}"?\n\nSystems linked to this model will have their link removed.`)) return;
    try {
      await api.deleteModel(id);
      showToast(`Model "${name}" deleted`);
      loadModels();
    } catch (e) {
      showToast(`Delete failed: ${(e as Error).message}`, true);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-6 py-3">
        <Input type="text" className="w-56" placeholder="Search models…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={cn(SELECT_CLASS, "w-auto")} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          <option value="llm">LLM</option>
          <option value="embedding">Embedding</option>
          <option value="multimodal">Multimodal</option>
          <option value="classifier">Classifier</option>
        </select>
        <select className={cn(SELECT_CLASS, "w-auto")} value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
          <option value="">All Providers</option>
          {providers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="flex-1" />
        <Button variant="ghost" onClick={loadModels}><RefreshCw /> Refresh</Button>
        <Button disabled={!mayWrite} title={mayWrite ? undefined : noWriteTitle}
          onClick={() => { setEditingModel(null); setModalOpen(true); }}>+ Add Model</Button>
      </div>

      <div className="px-6 py-5">
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Model</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Weights</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No model cards found.</TableCell>
                </TableRow>
              ) : filtered.map((m) => (
                <TableRow key={m.id} className="hover:bg-transparent">
                  <TableCell>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.id}{m.description ? ` · ${m.description.slice(0, 60)}` : ""}</div>
                  </TableCell>
                  <TableCell className="text-[13px]">{m.provider}</TableCell>
                  <TableCell><ModelTypeBadge type={m.model_type} /></TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{m.version || "—"}</TableCell>
                  <TableCell className="text-[13px]">
                    {m.open_weights
                      ? <span className="font-medium text-[#1a5c35]">Open</span>
                      : <span className="text-muted-foreground">Proprietary</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="size-8" title={mayWrite ? "Edit" : noWriteTitle} disabled={!mayWrite}
                        onClick={() => { setEditingModel(m); setModalOpen(true); }}><Pencil /></Button>
                      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-[var(--danger-fg)]"
                        title={mayWrite ? "Delete" : noWriteTitle} disabled={!mayWrite}
                        onClick={() => handleDelete(m.id, m.name)}><Trash2 /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <ModelModal
        open={modalOpen}
        editingModel={editingModel}
        onClose={() => { setModalOpen(false); setEditingModel(null); }}
        onSuccess={loadModels}
      />
      <ModelDetail
        modelId={detailModelId}
        open={detailModelId !== null}
        onClose={() => setDetailModelId(null)}
        onUpdate={loadModels}
      />
    </>
  );
}
