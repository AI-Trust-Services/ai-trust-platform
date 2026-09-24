import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { ArrowLeft, Loader2, Trash2, Plus, ChevronDown, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import { SELECT_CLASS } from "../utils";
import type {
  ModelCard, ModelCardPatch, MetricCreate, SourceCreate,
  DatasetCreate, DatasetPatch, Dataset, Preparation, Measurement,
  FeatureStore, FeatureStoreGroup,
} from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// ── Chip input for tags ───────────────────────────────────────────────────────

function ChipInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState("");

  function add() {
    const v = input.trim();
    if (!v || tags.includes(v)) { setInput(""); return; }
    onChange([...tags, v]);
    setInput("");
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 min-h-9">
      {tags.map((t) => (
        <Badge key={t} variant="secondary" className="rounded-full text-xs font-normal gap-1">
          {t}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} className="ml-0.5 hover:text-destructive">×</button>
        </Badge>
      ))}
      <input
        className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        placeholder="Add tag, press Enter…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        onBlur={add}
      />
    </div>
  );
}

// ── Scalar field (PATCH on blur) ──────────────────────────────────────────────

function ScalarField({ label, value, onBlur, type = "text", placeholder }: {
  label: string; value: string; onBlur: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        value={local}
        placeholder={placeholder}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { if (local !== value) onBlur(local); }}
      />
    </div>
  );
}

// ── Metrics section ───────────────────────────────────────────────────────────
// ponytail: add-only rows, no edit (no PATCH endpoint for metrics); change to
// inline edit when a PATCH /metrics/:id endpoint is added.

function MetricsSection({ cardId, metrics, onReload }: { cardId: string; metrics: ModelCard["metrics"]; onReload: () => void }) {
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDataset, setNewDataset] = useState("");
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  async function handleAdd() {
    const val = parseFloat(newValue);
    if (!newName.trim() || isNaN(val)) { showToast("Name and numeric value required", true); return; }
    setSaving(true);
    try {
      const body: MetricCreate = { name: newName.trim(), value: val };
      if (newDataset.trim()) body.dataset = newDataset.trim();
      await api.addMetric(cardId, body);
      setNewName(""); setNewValue(""); setNewDataset("");
      onReload();
    } catch (e) { showToast(`Add failed: ${(e as Error).message}`, true); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    try { await api.deleteMetric(cardId, id); showToast(`Metric "${name}" deleted`); onReload(); }
    catch (e) { showToast(`Delete failed: ${(e as Error).message}`, true); }
  }

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold">Metrics</h3>
      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Value</th>
              <th className="px-4 py-2 text-left font-medium">Dataset</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-medium">{m.name}</td>
                <td className="px-4 py-2 tabular-nums">{m.value}</td>
                <td className="px-4 py-2 text-muted-foreground">{m.dataset || "—"}</td>
                <td className="px-4 py-2 text-right">
                  <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(m.id, m.name)}><Trash2 className="size-3.5" /></Button>
                </td>
              </tr>
            ))}
            {/* Add row */}
            <tr className="bg-muted/30">
              <td className="px-4 py-2"><Input className="h-7 text-xs" placeholder="name" value={newName} onChange={(e) => setNewName(e.target.value)} /></td>
              <td className="px-4 py-2"><Input className="h-7 w-24 text-xs" placeholder="0.0" value={newValue} onChange={(e) => setNewValue(e.target.value)} /></td>
              <td className="px-4 py-2"><Input className="h-7 text-xs" placeholder="dataset (opt)" value={newDataset} onChange={(e) => setNewDataset(e.target.value)} /></td>
              <td className="px-4 py-2 text-right">
                <Button size="icon" variant="ghost" className="size-7" disabled={saving} onClick={handleAdd}>
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </section>
  );
}

// ── Sources section ───────────────────────────────────────────────────────────
// ponytail: same add-only pattern as metrics.

function SourcesSection({ cardId, sources, onReload }: { cardId: string; sources: ModelCard["sources"]; onReload: () => void }) {
  const [newUrl, setNewUrl] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  async function handleAdd() {
    if (!newUrl.trim()) { showToast("URL required", true); return; }
    setSaving(true);
    try {
      const body: SourceCreate = { url: newUrl.trim() };
      if (newName.trim()) body.name = newName.trim();
      await api.addSource(cardId, body);
      setNewUrl(""); setNewName(""); onReload();
    } catch (e) { showToast(`Add failed: ${(e as Error).message}`, true); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    try { await api.deleteSource(cardId, id); onReload(); }
    catch (e) { showToast(`Delete failed: ${(e as Error).message}`, true); }
  }

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold">Sources</h3>
      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">URL</th>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 max-w-xs truncate"><a href={s.url} target="_blank" rel="noreferrer" className="text-[var(--brand)] underline">{s.url}</a></td>
                <td className="px-4 py-2 text-muted-foreground">{s.name || "—"}</td>
                <td className="px-4 py-2 text-right">
                  <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(s.id)}><Trash2 className="size-3.5" /></Button>
                </td>
              </tr>
            ))}
            <tr className="bg-muted/30">
              <td className="px-4 py-2"><Input className="h-7 text-xs" placeholder="https://…" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} /></td>
              <td className="px-4 py-2"><Input className="h-7 text-xs" placeholder="name (opt)" value={newName} onChange={(e) => setNewName(e.target.value)} /></td>
              <td className="px-4 py-2 text-right">
                <Button size="icon" variant="ghost" className="size-7" disabled={saving} onClick={handleAdd}>
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </section>
  );
}

// ── Dataset card ──────────────────────────────────────────────────────────────

type EditableDataset = Omit<Dataset, "preparations" | "measurements" | "feature_stores"> & {
  preparations: (Omit<Preparation, "id" | "order"> & { id: string })[];
  measurements: (Omit<Measurement, "id"> & { id: string })[];
  feature_stores: (Omit<FeatureStore, "groups"> & { groups: (Omit<FeatureStoreGroup, "id"> & { id: string })[] })[];
};

function toDatasetCreate(ds: Dataset): DatasetCreate {
  return {
    name: ds.name,
    type: ds.type,
    revision: ds.revision,
    origin: ds.origin,
    is_personal_data: ds.is_personal_data,
    assumptions: ds.assumptions,
    assessment_availability: ds.assessment_availability,
    assessment_quantity: ds.assessment_quantity,
    assessment_suitability: ds.assessment_suitability,
    potential_biases: ds.potential_biases,
    preparations: ds.preparations.map((p) => ({ operation: p.operation, description: p.description })),
    measurements: ds.measurements.map((m) => ({ measure: m.measure, value: m.value })),
    feature_stores: ds.feature_stores.map((fs) => ({
      store_name: fs.store_name,
      groups: fs.groups.map((g) => ({ name: g.name, version: g.version, origin: g.origin })),
    })),
  };
}

function DatasetCard({ cardId, dataset, onReload, onDelete }: {
  cardId: string; dataset: Dataset;
  onReload: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<Dataset>(dataset);
  const showToast = useToast();

  useEffect(() => setLocal(dataset), [dataset]);

  // PATCH scalar on blur
  async function patchScalar(patch: DatasetPatch) {
    try {
      await api.patchDataset(cardId, dataset.id, patch);
    } catch (e) { showToast(`Save failed: ${(e as Error).message}`, true); }
  }

  // PUT full dataset (collections changed)
  async function putDataset(updated: Dataset) {
    try {
      await api.replaceDataset(cardId, dataset.id, toDatasetCreate(updated));
      onReload();
    } catch (e) { showToast(`Save failed: ${(e as Error).message}`, true); }
  }

  // Preparations
  function movePrepUp(idx: number) {
    if (idx === 0) return;
    const preps = [...local.preparations];
    [preps[idx - 1], preps[idx]] = [preps[idx], preps[idx - 1]];
    const updated = { ...local, preparations: preps };
    setLocal(updated);
    putDataset(updated);
  }
  function movePrepDown(idx: number) {
    if (idx >= local.preparations.length - 1) return;
    const preps = [...local.preparations];
    [preps[idx], preps[idx + 1]] = [preps[idx + 1], preps[idx]];
    const updated = { ...local, preparations: preps };
    setLocal(updated);
    putDataset(updated);
  }
  function addPrep() {
    const updated = { ...local, preparations: [...local.preparations, { id: `_new_${Date.now()}`, order: local.preparations.length, operation: "", description: null }] };
    setLocal(updated);
  }
  function deletePrep(idx: number) {
    const updated = { ...local, preparations: local.preparations.filter((_, i) => i !== idx) };
    setLocal(updated);
    putDataset(updated);
  }
  function blurPrep(idx: number, field: "operation" | "description", val: string) {
    const updated = { ...local, preparations: local.preparations.map((p, i) => i === idx ? { ...p, [field]: val || null } : p) };
    setLocal(updated);
    putDataset(updated);
  }

  // Measurements
  function addMeasurement() {
    const updated = { ...local, measurements: [...local.measurements, { id: `_new_${Date.now()}`, measure: "", value: "" }] };
    setLocal(updated);
  }
  function deleteMeasurement(idx: number) {
    const updated = { ...local, measurements: local.measurements.filter((_, i) => i !== idx) };
    setLocal(updated);
    putDataset(updated);
  }
  function blurMeasurement(idx: number, field: "measure" | "value", val: string) {
    const updated = { ...local, measurements: local.measurements.map((m, i) => i === idx ? { ...m, [field]: val } : m) };
    setLocal(updated);
    putDataset(updated);
  }

  // Feature stores
  function addFeatureStore() {
    const updated = { ...local, feature_stores: [...local.feature_stores, { id: `_new_${Date.now()}`, store_name: "", groups: [] }] };
    setLocal(updated);
  }
  function deleteFeatureStore(fsIdx: number) {
    const updated = { ...local, feature_stores: local.feature_stores.filter((_, i) => i !== fsIdx) };
    setLocal(updated);
    putDataset(updated);
  }
  function blurFeatureStore(fsIdx: number, val: string) {
    const updated = { ...local, feature_stores: local.feature_stores.map((fs, i) => i === fsIdx ? { ...fs, store_name: val } : fs) };
    setLocal(updated);
    putDataset(updated);
  }
  function addGroup(fsIdx: number) {
    const updated = { ...local, feature_stores: local.feature_stores.map((fs, i) => i === fsIdx
      ? { ...fs, groups: [...fs.groups, { id: `_new_${Date.now()}`, name: "", version: null, origin: null }] }
      : fs) };
    setLocal(updated);
  }
  function deleteGroup(fsIdx: number, gIdx: number) {
    const updated = { ...local, feature_stores: local.feature_stores.map((fs, i) => i === fsIdx
      ? { ...fs, groups: fs.groups.filter((_, j) => j !== gIdx) }
      : fs) };
    setLocal(updated);
    putDataset(updated);
  }
  function blurGroup(fsIdx: number, gIdx: number, field: keyof Omit<FeatureStoreGroup, "id">, val: string) {
    const updated = { ...local, feature_stores: local.feature_stores.map((fs, i) => i === fsIdx
      ? { ...fs, groups: fs.groups.map((g, j) => j === gIdx ? { ...g, [field]: val || null } : g) }
      : fs) };
    setLocal(updated);
    putDataset(updated);
  }

  return (
    <Card className="overflow-hidden p-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none hover:bg-muted/30"
        onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
        <span className="font-medium text-sm">{local.name}</span>
        <Badge variant="secondary" className="rounded-full text-xs font-normal">{local.type}</Badge>
        {local.revision && <span className="text-xs text-muted-foreground">@ {local.revision}</span>}
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {open && (
        <div className="border-t border-border px-4 py-4 flex flex-col gap-5">
          {/* Scalars */}
          <div className="grid grid-cols-2 gap-3">
            <ScalarField label="Name" value={local.name}
              onBlur={(v) => { setLocal({ ...local, name: v }); patchScalar({ name: v }); }} />
            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <select className={SELECT_CLASS} value={local.type}
                onChange={(e) => { const v = e.target.value as Dataset["type"]; setLocal({ ...local, type: v }); patchScalar({ type: v }); }}>
                <option value="train">train</option>
                <option value="val">val</option>
                <option value="test">test</option>
                <option value="train_cv">train_cv</option>
              </select>
            </div>
            <ScalarField label="Revision" value={local.revision || ""}
              onBlur={(v) => { setLocal({ ...local, revision: v || null }); patchScalar({ revision: v || null }); }} />
            <ScalarField label="Origin" value={local.origin || ""}
              onBlur={(v) => { setLocal({ ...local, origin: v || null }); patchScalar({ origin: v || null }); }} />
          </div>

          <div className="grid grid-cols-1 gap-3">
            {(["assumptions", "assessment_availability", "assessment_quantity", "assessment_suitability", "potential_biases"] as const).map((field) => {
              const labels: Record<string, string> = {
                assumptions: "Assumptions", assessment_availability: "Assessment: Availability",
                assessment_quantity: "Assessment: Quantity", assessment_suitability: "Assessment: Suitability",
                potential_biases: "Potential Biases",
              };
              return (
                <div key={field} className="flex flex-col gap-1.5">
                  <Label>{labels[field]}</Label>
                  <TextareaBlur value={local[field] || ""} placeholder={labels[field] + "…"}
                    onBlur={(v) => { setLocal({ ...local, [field]: v || null }); patchScalar({ [field]: v || null }); }} />
                </div>
              );
            })}
          </div>

          <Separator />

          {/* Preparations */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preparations</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={addPrep}><Plus className="size-3" />Add</Button>
            </div>
            <div className="flex flex-col gap-1.5">
              {local.preparations.map((p, idx) => (
                <div key={p.id} className="flex items-start gap-1.5">
                  <div className="flex flex-col gap-0.5 mt-1">
                    <Button variant="ghost" size="icon" className="size-5" onClick={() => movePrepUp(idx)} disabled={idx === 0}><ArrowUp className="size-3" /></Button>
                    <Button variant="ghost" size="icon" className="size-5" onClick={() => movePrepDown(idx)} disabled={idx >= local.preparations.length - 1}><ArrowDown className="size-3" /></Button>
                  </div>
                  <Input className="h-7 text-xs flex-1" placeholder="operation" defaultValue={p.operation}
                    onBlur={(e) => blurPrep(idx, "operation", e.target.value)} />
                  <Input className="h-7 text-xs flex-1" placeholder="description (opt)" defaultValue={p.description || ""}
                    onBlur={(e) => blurPrep(idx, "description", e.target.value)} />
                  <Button variant="ghost" size="icon" className="size-7 mt-0 text-muted-foreground hover:text-destructive" onClick={() => deletePrep(idx)}><Trash2 className="size-3.5" /></Button>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Measurements */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Measurements</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={addMeasurement}><Plus className="size-3" />Add</Button>
            </div>
            <div className="flex flex-col gap-1.5">
              {local.measurements.map((m, idx) => (
                <div key={m.id} className="flex items-center gap-1.5">
                  <Input className="h-7 text-xs flex-1" placeholder="measure" defaultValue={m.measure}
                    onBlur={(e) => blurMeasurement(idx, "measure", e.target.value)} />
                  <Input className="h-7 text-xs flex-1" placeholder="value" defaultValue={m.value}
                    onBlur={(e) => blurMeasurement(idx, "value", e.target.value)} />
                  <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => deleteMeasurement(idx)}><Trash2 className="size-3.5" /></Button>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Feature stores */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Feature Stores</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={addFeatureStore}><Plus className="size-3" />Add store</Button>
            </div>
            <div className="flex flex-col gap-3">
              {local.feature_stores.map((fs, fsIdx) => (
                <div key={fs.id} className="rounded-md border border-border p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <Input className="h-7 text-xs flex-1" placeholder="store_name" defaultValue={fs.store_name}
                      onBlur={(e) => blurFeatureStore(fsIdx, e.target.value)} />
                    <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => deleteFeatureStore(fsIdx)}><Trash2 className="size-3.5" /></Button>
                  </div>
                  <div className="pl-2 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Groups</span>
                      <Button variant="ghost" size="sm" className="h-5 text-xs gap-1 px-1" onClick={() => addGroup(fsIdx)}><Plus className="size-3" />Add</Button>
                    </div>
                    {fs.groups.map((g, gIdx) => (
                      <div key={g.id} className="flex items-center gap-1.5">
                        <Input className="h-7 text-xs flex-1" placeholder="name" defaultValue={g.name}
                          onBlur={(e) => blurGroup(fsIdx, gIdx, "name", e.target.value)} />
                        <Input className="h-7 text-xs w-24" placeholder="version" defaultValue={g.version || ""}
                          onBlur={(e) => blurGroup(fsIdx, gIdx, "version", e.target.value)} />
                        <Input className="h-7 text-xs flex-1" placeholder="origin" defaultValue={g.origin || ""}
                          onBlur={(e) => blurGroup(fsIdx, gIdx, "origin", e.target.value)} />
                        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => deleteGroup(fsIdx, gIdx)}><Trash2 className="size-3.5" /></Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Textarea with blur ─────────────────────────────────────────────────────────

function TextareaBlur({ value, onBlur, placeholder }: { value: string; onBlur: (v: string) => void; placeholder?: string }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <Textarea rows={2} value={local} placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onBlur(local); }} />
  );
}

// ── Datasets section ──────────────────────────────────────────────────────────

function DatasetsSection({ cardId, datasets, onReload }: { cardId: string; datasets: Dataset[]; onReload: () => void }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<DatasetCreate["type"]>("train");
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  async function handleCreate() {
    if (!newName.trim()) { showToast("Name required", true); return; }
    setSaving(true);
    try {
      await api.addDataset(cardId, { name: newName.trim(), type: newType });
      setDialogOpen(false); setNewName(""); setNewType("train");
      onReload();
    } catch (e) { showToast(`Create failed: ${(e as Error).message}`, true); }
    finally { setSaving(false); }
  }

  async function handleDelete(dsId: string, name: string) {
    if (!confirm(`Delete dataset "${name}"?\n\nAll preparations, measurements and feature stores will be removed.`)) return;
    try { await api.deleteDataset(cardId, dsId); onReload(); }
    catch (e) { showToast(`Delete failed: ${(e as Error).message}`, true); }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Datasets</h3>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setDialogOpen(true)}><Plus className="size-3.5" />Add dataset</Button>
      </div>
      <div className="flex flex-col gap-3">
        {datasets.length === 0 && <p className="text-sm text-muted-foreground">No datasets yet.</p>}
        {datasets.map((ds) => (
          <DatasetCard key={ds.id} cardId={cardId} dataset={ds} onReload={onReload}
            onDelete={() => handleDelete(ds.id, ds.name)} />
        ))}
      </div>

      {/* Create dialog */}
      <dialog open={dialogOpen} className="fixed inset-0 z-50 bg-transparent p-0" onClick={() => setDialogOpen(false)}>
        <div className="fixed left-1/2 top-1/2 w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-lg flex flex-col gap-4"
          onClick={(e) => e.stopPropagation()}>
          <h3 className="font-semibold">New Dataset</h3>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ds_name">Name <span className="text-[var(--danger-fg)]">*</span></Label>
            <Input id="ds_name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. MMLU" autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ds_type">Type</Label>
            <select id="ds_type" className={SELECT_CLASS} value={newType} onChange={(e) => setNewType(e.target.value as DatasetCreate["type"])}>
              <option value="train">train</option>
              <option value="val">val</option>
              <option value="test">test</option>
              <option value="train_cv">train_cv</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />} Create
            </Button>
          </div>
        </div>
      </dialog>
    </section>
  );
}

// ── ModelPage ─────────────────────────────────────────────────────────────────

export default function ModelPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const showToast = useToast();
  const { mayWrite } = useModalControls();
  const [card, setCard] = useState<ModelCard | null>(null);
  const [systems, setSystems] = useState<Array<{ id: string; name: string; tier: string; lifecycle: string }>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [c, s] = await Promise.all([api.getModelCard(id), api.getModelSystems(id)]);
      setCard(c);
      setSystems(s);
    } catch {
      showToast("Model card not found", true);
      navigate("/models");
    } finally {
      setLoading(false);
    }
  }, [id, navigate, showToast]);

  useEffect(() => { load(); }, [load]);

  // PATCH scalar on blur — only send non-empty diffs
  async function patch(data: ModelCardPatch) {
    if (!id) return;
    try { await api.patchModelCard(id, data); }
    catch (e) { showToast(`Save failed: ${(e as Error).message}`, true); }
  }

  async function handleDelete() {
    if (!id) return;
    if (!confirm(`Delete model card "${card?.name}"?\n\nThis cannot be undone.`)) return;
    try {
      await api.deleteModelCard(id);
      showToast("Model card deleted");
      navigate("/models");
    } catch (e) { showToast(`Delete failed: ${(e as Error).message}`, true); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  if (!card) return null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 flex flex-col gap-6">
      {/* Back + delete */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => navigate("/models")}>
          <ArrowLeft className="size-4" />Back
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-destructive" disabled={!mayWrite} onClick={handleDelete}>
          <Trash2 className="size-4" />Delete card
        </Button>
      </div>

      {/* Header scalars */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">{card.name}</h2>
        <div className="mb-3">
          <Label>Tags</Label>
          <div className="mt-1.5">
            <ChipInput
              tags={card.tags}
              onChange={(tags) => { setCard({ ...card, tags }); patch({ tags }); }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(["name", "version", "base_model", "library_name", "license", "license_name", "license_link", "training_commit", "validation_status", "task_type", "task_name"] as const).map((field) => {
            const labels: Record<string, string> = {
              name: "Name", version: "Version", base_model: "Base model", library_name: "Library",
              license: "License (SPDX)", license_name: "License name", license_link: "License link",
              training_commit: "Training commit", validation_status: "Validation status",
              task_type: "Task type", task_name: "Task name",
            };
            return (
              <ScalarField key={field} label={labels[field]} value={card[field] || ""}
                onBlur={(v) => { setCard({ ...card, [field]: v || null }); patch({ [field]: v || null }); }} />
            );
          })}
        </div>
      </section>

      <Separator />

      <MetricsSection cardId={card.id} metrics={card.metrics} onReload={load} />
      <SourcesSection cardId={card.id} sources={card.sources} onReload={load} />
      <DatasetsSection cardId={card.id} datasets={card.datasets} onReload={load} />

      {/* Used by systems — read only */}
      {systems.length > 0 && (
        <>
          <Separator />
          <section>
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Used by systems</h3>
            <div className="flex flex-col gap-1.5">
              {systems.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{s.id}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
