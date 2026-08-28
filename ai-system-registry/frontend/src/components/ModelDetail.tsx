import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../api/client";
import type { ModelCard, ModelCardFormData, ModelSystemResponse } from "../types";
import { TierBadge, LifecycleBadge, ModelTypeBadge } from "./Badges";
import { useToast, useModalControls } from "../App";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SELECT_CLASS } from "../utils";

const EMPTY: ModelCardFormData = { name: "", provider: "", version: "", model_type: "llm", description: "", inference_url: "", open_weights: false };

export default function ModelDetail({ modelId, open, onClose, onUpdate }: {
  modelId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}) {
  const [model, setModel] = useState<ModelCard | null>(null);
  const [systems, setSystems] = useState<ModelSystemResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<ModelCardFormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const showToast = useToast();
  const { mayWrite } = useModalControls();

  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([api.getModelCard(modelId), api.getModelSystems(modelId)])
      .then(([m, s]) => { if (!cancelled) { setModel(m); setSystems(s); setForm({ ...EMPTY, ...m }); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [modelId]);

  const set = (k: keyof ModelCardFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: (e.target as HTMLInputElement).type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function handleSave() {
    if (!form.name.trim() || !form.provider.trim()) {
      showToast("Name and provider are required", true); return;
    }
    setSaving(true);
    try {
      const updated = await api.updateModel(model!.id, form);
      setModel(updated);
      setForm({ ...EMPTY, ...updated });
      showToast("Model updated");
      onUpdate?.();
    } catch (e) {
      showToast(`Save failed: ${(e as Error).message}`, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-[480px] overflow-y-auto sm:max-w-[480px]">
        {loading || !model ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            {loading ? <><Loader2 className="mr-2 size-4 animate-spin" />Loading…</> : null}
          </div>
        ) : (
          <>
            <SheetHeader className="mb-4">
              <SheetTitle>{model.name}</SheetTitle>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{model.id}</span>
                <ModelTypeBadge type={model.model_type} />
                {model.open_weights && (
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">Open weights</span>
                )}
              </div>
            </SheetHeader>

            <Tabs defaultValue="overview">
              <TabsList className="mb-4 w-full">
                <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
                {mayWrite && <TabsTrigger value="edit" className="flex-1">Edit</TabsTrigger>}
              </TabsList>

              <TabsContent value="overview" className="space-y-6">
                <section>
                  <h3 className="mb-3 text-sm font-semibold">Model Details</h3>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Provider</dt><dd>{model.provider || "—"}</dd>
                    <dt className="text-muted-foreground">Version</dt><dd>{model.version || "—"}</dd>
                    <dt className="text-muted-foreground">Type</dt><dd><ModelTypeBadge type={model.model_type} /></dd>
                    <dt className="text-muted-foreground">Weights</dt>
                    <dd>
                      {model.open_weights
                        ? <span className="font-medium text-[#1a5c35]">Open</span>
                        : <span className="text-muted-foreground">Proprietary</span>}
                    </dd>
                    {model.inference_url && <>
                      <dt className="text-muted-foreground">Inference URL</dt>
                      <dd>
                        <a href={model.inference_url} target="_blank" rel="noreferrer"
                          className="text-primary underline-offset-4 hover:underline">
                          {model.inference_url}
                        </a>
                      </dd>
                    </>}
                    {model.description && <>
                      <dt className="text-muted-foreground">Description</dt>
                      <dd>{model.description}</dd>
                    </>}
                  </dl>
                </section>

                <section>
                  <h3 className="mb-3 text-sm font-semibold">Linked AI Systems</h3>
                  {systems.length === 0 ? (
                    <p className="rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                      No systems linked to this model.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {systems.map((s) => (
                        <div key={s.id} className="rounded-md border border-border bg-card px-4 py-3 text-sm">
                          <div className="font-medium">{s.name}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{s.id}</span>
                            <TierBadge tier={s.tier as any} />
                            <LifecycleBadge lc={s.lifecycle as any} />
                            {s.role && <span className="text-primary">{s.role}</span>}
                            <span>{Math.round(s.compliance)}% compliance</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </TabsContent>

              {mayWrite && (
                <TabsContent value="edit" className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="md_name">Model Name <span className="text-[var(--danger-fg)]">*</span></Label>
                      <Input id="md_name" value={form.name} onChange={set("name")} placeholder="e.g. GPT-4o" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="md_provider">Provider <span className="text-[var(--danger-fg)]">*</span></Label>
                      <Input id="md_provider" value={form.provider} onChange={set("provider")} placeholder="e.g. openai" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="md_version">Version</Label>
                      <Input id="md_version" value={form.version} onChange={set("version")} placeholder="e.g. 2024-08" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="md_model_type">Type</Label>
                      <select className={SELECT_CLASS} id="md_model_type" value={form.model_type} onChange={set("model_type")}>
                        <option value="llm">LLM</option>
                        <option value="embedding">Embedding</option>
                        <option value="multimodal">Multimodal</option>
                        <option value="classifier">Classifier</option>
                      </select>
                    </div>
                    <div className="col-span-2 flex flex-col gap-1.5">
                      <Label htmlFor="md_description">Description</Label>
                      <Textarea id="md_description" rows={2} value={form.description} onChange={set("description")} placeholder="Brief description…" />
                    </div>
                    <div className="col-span-2 flex flex-col gap-1.5">
                      <Label htmlFor="md_inference_url">Inference URL (optional)</Label>
                      <Input type="url" id="md_inference_url" value={form.inference_url} onChange={set("inference_url")} placeholder="https://api.example.com/v1" />
                    </div>
                    <div className="col-span-2">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox id="md_open_weights" checked={form.open_weights}
                          onCheckedChange={(c) => setForm((f) => ({ ...f, open_weights: c === true }))} />
                        <span>Open weights (publicly available model weights)</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={handleSave} disabled={saving}>
                      {saving && <Loader2 className="animate-spin" />} Save Changes
                    </Button>
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
