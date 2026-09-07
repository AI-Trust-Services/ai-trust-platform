import { useState } from "react";
import type { DashboardCard, ChartType, DataKey } from "../types";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Props {
  card: DashboardCard;
  onSave: (updated: DashboardCard) => void;
  onClose: () => void;
}

const DATA_KEYS: { value: DataKey; label: string }[] = [
  { value: "by_tier",              label: "Systems by Risk Tier" },
  { value: "by_lifecycle",         label: "Systems by Lifecycle State" },
  { value: "by_type",              label: "Systems by Type" },
  { value: "compliance_by_tier",   label: "Avg Compliance by Tier" },
  { value: "compliance_histogram", label: "Compliance Distribution" },
  { value: "by_model_type",        label: "Models by Type" },
  { value: "by_model_provider",    label: "Models by Provider" },
];

export default function EditCardModal({ card, onSave, onClose }: Props) {
  const [title, setTitle] = useState(card.title);
  const [type, setType] = useState<ChartType>(card.type as ChartType);
  const [dataKey, setDataKey] = useState<DataKey>(card.dataKey ?? "by_tier");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Edit Graph</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-title">Title</Label>
            <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Chart Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as ChartType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bar">Bar Chart</SelectItem>
                <SelectItem value="pie">Pie Chart</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Data Source</Label>
            <Select value={dataKey} onValueChange={(v) => setDataKey(v as DataKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATA_KEYS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave({ ...card, title: title.trim() || card.title, type, dataKey })}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
