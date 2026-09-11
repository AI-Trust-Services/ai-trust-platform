import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import type { AISystem, Control } from "../types";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
}

const NONE = "__none__";

export default function ControlPicker({ value, onChange }: Props) {
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [systemId, setSystemId] = useState("");
  const [controlCatalog, setControlCatalog] = useState<Control[]>([]);
  const [search, setSearch] = useState("");
  const showToast = useToast();

  useEffect(() => {
    (async () => {
      try {
        const sys = await api.getSystems();
        setSystems(sys.filter((s) => s.lifecycle !== "decommissioned"));
      } catch (e) {
        showToast(`Failed to load systems: ${(e as Error).message}`, true);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setControlCatalog([]);
    if (!systemId) return;
    (async () => {
      try {
        setControlCatalog(await api.getControls({ ai_system_id: systemId }));
      } catch (e) {
        showToast(`Failed to load controls: ${(e as Error).message}`, true);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId]);

  const filtered = controlCatalog
    .filter((c) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return c.title.toLowerCase().includes(q) || (c.control_ref ?? "").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const ra = a.control_ref ?? "￿";
      const rb = b.control_ref ?? "￿";
      if (ra !== rb) return ra.localeCompare(rb);
      return a.title.localeCompare(b.title);
    });

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={systemId || NONE}
        onValueChange={(v) => { setSystemId(v === NONE ? "" : v); setSearch(""); }}
      >
        <SelectTrigger><SelectValue placeholder="Select a system to browse controls…" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— select a system —</SelectItem>
          {systems.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {systemId && (
        <>
          <Input
            placeholder="Search controls…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-[13px]"
          />
          <div className="max-h-48 overflow-y-auto rounded-md border border-border">
            {filtered.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">
                {search ? "No controls match" : "No controls for this system"}
              </div>
            ) : filtered.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 last:border-0 hover:bg-muted/50">
                <Checkbox checked={value.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
                <span className="flex-1 truncate text-[13px] text-foreground">{c.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{c.control_ref || c.id}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
