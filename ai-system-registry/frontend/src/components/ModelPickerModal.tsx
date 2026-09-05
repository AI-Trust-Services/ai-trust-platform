/**
 * ModelPickerModal — Dialog for selecting and linking a model to an AI system.
 */

import { useState, useEffect, useMemo } from "react";
import { Database, Search, Check } from "lucide-react";
import { api } from "../api/client";
import type { ModelCard } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ModelPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (modelId: string) => Promise<void>;
  currentModelId?: string | null;
}

export default function ModelPickerModal({
  open,
  onClose,
  onSelect,
  currentModelId,
}: ModelPickerModalProps) {
  const [models, setModels] = useState<ModelCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (open) {
      setLoading(true);
      setSelected(currentModelId ?? null);
      api.getModels()
        .then(setModels)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [open, currentModelId]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(s) ||
        m.provider.toLowerCase().includes(s) ||
        m.description?.toLowerCase().includes(s)
    );
  }, [models, search]);

  async function handleLink() {
    if (!selected) return;
    setLinking(true);
    try {
      await onSelect(selected);
      onClose();
    } catch (e) {
      console.error("Failed to link model:", e);
    } finally {
      setLinking(false);
    }
  }

  const modelTypeLabels: Record<string, string> = {
    llm: "LLM",
    embedding: "Embedding",
    multimodal: "Multimodal",
    classifier: "Classifier",
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link Model from Catalog</DialogTitle>
          <DialogDescription>
            Select a model to associate with this AI system.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search models by name, provider..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="h-[300px] overflow-y-auto rounded-md border">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">Loading models...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">
                {models.length === 0 ? "No models in catalog" : "No models match your search"}
              </p>
            </div>
          ) : (
            <div className="p-2">
              {filtered.map((model) => (
                <div
                  key={model.id}
                  onClick={() => setSelected(model.id)}
                  className={cn(
                    "flex cursor-pointer items-center gap-4 rounded-lg p-3 transition-colors",
                    selected === model.id
                      ? "bg-primary/10 ring-1 ring-primary"
                      : "hover:bg-muted"
                  )}
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Database className="size-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{model.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {modelTypeLabels[model.model_type] ?? model.model_type}
                      </Badge>
                      {model.open_weights && (
                        <Badge variant="outline" className="text-xs">
                          Open Weights
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {model.provider} · v{model.version}
                    </div>
                    {model.description && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {model.description}
                      </p>
                    )}
                  </div>
                  {selected === model.id && (
                    <Check className="size-5 shrink-0 text-primary" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={linking}>
            Cancel
          </Button>
          <Button onClick={handleLink} disabled={!selected || linking}>
            {linking ? "Linking..." : "Link Model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
