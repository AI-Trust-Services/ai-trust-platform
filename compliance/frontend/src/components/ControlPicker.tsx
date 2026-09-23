import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import type { AISystem, Assessment, Requirement } from "../types";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Props {
  /** Currently selected requirement IDs. */
  value: string[];
  /** Called when the user checks/unchecks a requirement. */
  onChange: (ids: string[]) => void;
}

const NONE = "__none__";

export default function ControlPicker({ value, onChange }: Props) {
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [systemId, setSystemId] = useState("");
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [assessmentId, setAssessmentId] = useState("");
  const [requirementCatalog, setRequirementCatalog] = useState<Requirement[]>([]);
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
    setAssessments([]);
    setAssessmentId("");
    setRequirementCatalog([]);
    if (!systemId) return;
    (async () => {
      try {
        const [allAssessments, allRequirements] = await Promise.all([
          api.getAssessments(systemId),
          api.getRequirements({ ai_system_id: systemId }),
        ]);
        setAssessments(allAssessments.filter((a) => a.status !== "archived"));
        setRequirementCatalog(allRequirements);
      } catch (e) {
        showToast(`Failed to load data: ${(e as Error).message}`, true);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId]);

  function handleAssessmentChange(v: string) {
    setAssessmentId(v === NONE ? "" : v);
    setSearch("");
  }

  const filtered = requirementCatalog
    .filter((r) => {
      if (r.assessment_id !== assessmentId) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return r.title.toLowerCase().includes(q) || (r.requirement_ref ?? "").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const ra = a.requirement_ref ?? "￿";
      const rb = b.requirement_ref ?? "￿";
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
        <SelectTrigger><SelectValue placeholder="Select a system to browse requirements…" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— select a system —</SelectItem>
          {systems.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {systemId && (
        <Select
          value={assessmentId || NONE}
          onValueChange={handleAssessmentChange}
          disabled={assessments.length === 0}
        >
          <SelectTrigger>
            <SelectValue placeholder={assessments.length === 0 ? "No assessments for this system" : "Select an assessment…"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>— select an assessment —</SelectItem>
            {assessments.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.title} ({a.status})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {assessmentId && (
        <>
          <Input
            placeholder="Search requirements…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-[13px]"
          />
          <div className="max-h-48 overflow-y-auto rounded-md border border-border">
            {filtered.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">
                {search ? "No requirements match" : "No requirements for this assessment"}
              </div>
            ) : filtered.map((r) => (
              <label key={r.id} className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 last:border-0 hover:bg-muted/50">
                <Checkbox checked={value.includes(r.id)} onCheckedChange={() => toggle(r.id)} />
                <span className="flex-1 truncate text-[13px] text-foreground">{r.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{r.requirement_ref || r.id}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
