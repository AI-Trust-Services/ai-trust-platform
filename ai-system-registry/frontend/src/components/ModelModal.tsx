import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import { SELECT_CLASS } from "../utils";
import type { ModelCard, ModelCardFormData } from "../types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

const EMPTY: ModelCardFormData = { name: "", provider: "", version: "", model_type: "llm", description: "", inference_url: "", open_weights: false };

interface Props {
  open: boolean;
  editingModel: ModelCard | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ModelModal({ open, editingModel, onClose, onSuccess }: Props) {
  const [form, setForm] = useState<ModelCardFormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    if (open) setForm(editingModel ? { ...EMPTY, ...editingModel } : EMPTY);
  }, [open, editingModel]);

  const set = (k: keyof ModelCardFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: (e.target as HTMLInputElement).type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function handleSave() {
    if (!form.name.trim() || !form.provider.trim()) {
      showToast("Name and provider are required", true); return;
    }
    setSaving(true);
    try {
      if (editingModel) {
        await api.updateModel(editingModel.id, form);
        showToast("Model updated");
      } else {
        await api.createModel(form);
        showToast("Model card added");
      }
      onClose();
      onSuccess();
    } catch (e) {
      showToast(`Save failed: ${(e as Error).message}`, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[560px] gap-0 p-0">
        <DialogHeader>
          <DialogTitle>{editingModel ? "Edit Model Card" : "Add Model Card"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 p-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mc_name">Model Name <span className="text-[var(--danger-fg)]">*</span></Label>
            <Input type="text" id="mc_name" value={form.name} onChange={set("name")} placeholder="e.g. GPT-4o" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mc_provider">Provider <span className="text-[var(--danger-fg)]">*</span></Label>
            <Input type="text" id="mc_provider" value={form.provider} onChange={set("provider")} placeholder="e.g. openai" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mc_version">Version</Label>
            <Input type="text" id="mc_version" value={form.version} onChange={set("version")} placeholder="e.g. 2024-08" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mc_model_type">Type</Label>
            <select className={SELECT_CLASS} id="mc_model_type" value={form.model_type} onChange={set("model_type")}>
              <option value="llm">LLM</option>
              <option value="embedding">Embedding</option>
              <option value="multimodal">Multimodal</option>
              <option value="classifier">Classifier</option>
            </select>
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="mc_description">Description</Label>
            <Textarea id="mc_description" rows={2} value={form.description} onChange={set("description")} placeholder="Brief description…" />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="mc_inference_url">Inference URL (optional)</Label>
            <Input type="url" id="mc_inference_url" value={form.inference_url} onChange={set("inference_url")} placeholder="https://api.example.com/v1" />
          </div>
          <div className="col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox id="mc_open_weights" checked={form.open_weights}
                onCheckedChange={(c) => setForm((f) => ({ ...f, open_weights: c === true }))} />
              <span>Open weights (publicly available model weights)</span>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {editingModel ? "Save Changes" : "Add Model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
