import { useState, useEffect } from "react";
import { Loader2, ClipboardList } from "lucide-react";
import { api } from "../api/client";
import { registryClient } from "../api/registryClient";
import { useToast } from "../App";
import { usePermissions } from "../hooks/usePermissions";
import type { AISystem, Framework } from "../types";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialSystemId?: string;
  initialFrameworkId?: string;
}

type Step = "system" | "framework" | "details";

type User = { username: string; firstName: string; lastName: string; role: string };

const EU_AI_ACT_ID = "FRM-EU-AI-ACT";

// Non-EU-AI-Act frameworks shown on the right ("Other frameworks"). Dummies for now.
const OTHER_FRAMEWORKS: Array<{ frameworkId: string; title: string; description: string }> = [
  { frameworkId: "FRM-ISO-42001", title: "ISO/IEC 42001", description: "Coming soon." },
  { frameworkId: "FRM-NIST-AI-RMF", title: "NIST AI RMF", description: "Coming soon." },
];

// Framework recommendation from the two EU-presence answers captured at registration.
// EU AI Act is recommended unless the system is neither used in nor placed on the EU
// market (both explicitly No). Mirrors the registry RegisterWizard success panel.
function euActRecommended(euOutput: boolean | null, euMarket: boolean | null): boolean {
  return !(euOutput === false && euMarket === false);
}

const fullName = (u: User) => [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username;

// Searchable dropdown of users: focus opens the full list, typing filters it,
// clicking selects. The input shows the chosen user's name when not focused.
function UserCombobox({
  label, users, selected, onSelect, placeholder, hint, required, optionalHint,
}: {
  label: string;
  users: User[];
  selected: string;
  onSelect: (username: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  optionalHint?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = (q
    ? users.filter((u) => u.username.toLowerCase().includes(q) || u.firstName.toLowerCase().includes(q) || u.lastName.toLowerCase().includes(q))
    : users
  ).slice(0, 8);

  const selectedUser = users.find((u) => u.username === selected);
  const inputValue = open ? query : (selectedUser ? fullName(selectedUser) : query);

  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {label}{" "}
        {required
          ? <span className="text-destructive">*</span>
          : optionalHint && <span className="text-muted-foreground text-xs font-normal">({optionalHint})</span>}
      </Label>
      <div className="relative">
        <Input
          value={inputValue}
          onChange={(e) => { setQuery(e.target.value); onSelect(""); setOpen(true); }}
          onFocus={() => { setQuery(""); setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="text-sm"
        />
        {open && filtered.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-background shadow-md">
            {filtered.map((u) => (
              <button
                key={u.username}
                type="button"
                className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted"
                onMouseDown={(e) => { e.preventDefault(); onSelect(u.username); setQuery(""); setOpen(false); }}
              >
                <span className="font-medium">{fullName(u)}</span>
                <span className="text-xs text-muted-foreground">{u.username} · {u.role.replace(/_/g, " ")}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function CreateAssessmentModal({ open, onClose, onSuccess, initialSystemId, initialFrameworkId }: Props) {
  const [step, setStep] = useState<Step>("system");
  const [systemId, setSystemId] = useState("");
  const [frameworkId, setFrameworkId] = useState("");
  const [intendedPurpose, setIntendedPurpose] = useState("");
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [bizSelected, setBizSelected] = useState<string>("");
  const [techSelected, setTechSelected] = useState<string>("");
  const [coSelected, setCoSelected] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const showToast = useToast();
  const { username } = usePermissions();

  const selectedSystem = systems.find((s) => s.id === systemId);
  const selectedFramework = frameworks.find((f) => f.id === frameworkId);

  useEffect(() => {
    if (!open) return;
    // Reset, then seed from handoff props to decide the entry step.
    setSystemId(initialSystemId ?? "");
    setFrameworkId(initialFrameworkId ?? "");
    setIntendedPurpose("");
    setBizSelected("");
    setTechSelected("");
    setCoSelected("");
    if (initialSystemId && initialFrameworkId) setStep("details");
    else if (initialSystemId) setStep("framework");
    else setStep("system");
    (async () => {
      try {
        const [sys, fw] = await Promise.all([api.getSystems(), api.getFrameworks()]);
        setSystems(sys.filter((s) => s.lifecycle !== "decommissioned"));
        setFrameworks(fw.filter((f) => f.enabled));
      } catch (e) {
        showToast(`Failed to load options: ${(e as Error).message}`, true);
      }
    })();
    registryClient.getAllUsers().then(setAllUsers).catch(() => {});
  }, [open, initialSystemId, initialFrameworkId, showToast]);

  // Pre-fill intended purpose once the selected system's details are available.
  useEffect(() => {
    if (step === "details" && selectedSystem) {
      setIntendedPurpose((p) => p || selectedSystem.intended_purpose || "");
    }
  }, [step, selectedSystem]);

  if (!open) return null;

  function pickFramework(fwId: string) {
    setFrameworkId(fwId);
    setStep("details");
  }

  async function handleSubmit() {
    if (!systemId) { showToast("Select an AI system", true); return; }
    if (!frameworkId) { showToast("Select a framework", true); return; }
    if (!intendedPurpose.trim()) { showToast("Intended purpose is required", true); return; }
    if (!coSelected) { showToast("Select a compliance officer", true); return; }
    setLoading(true);
    try {
      const systemName = selectedSystem?.name ?? systemId;
      const frameworkName = selectedFramework?.name ?? frameworkId;
      await api.createAssessment({
        ai_system_id: systemId,
        framework_id: frameworkId,
        title: `${systemName} ${frameworkName} Assessment`,
        type: "compliance",
        notes: "",
      });
      // Assignees + intended purpose are recorded on the system via the workflow assign
      // call (no assignee guard) — assigned while the system is still a draft.
      if (username && selectedSystem?.workflow_status === "draft") {
        await registryClient.assignWorkflow(systemId, {
          business_assignee_username: bizSelected || username,
          technical_assignee_username: techSelected || undefined,
          compliance_officer_username: coSelected,
          intended_purpose: intendedPurpose.trim(),
        });
      }
      onClose();
      showToast("Assessment created");
      onSuccess();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("already in progress")) {
        showToast("A questionnaire is already in progress for this system. Open the existing assessment.", true);
      } else {
        showToast(`Failed: ${msg}`, true);
      }
    } finally {
      setLoading(false);
    }
  }

  const title = step === "framework" ? "Select Framework" : "New Assessment";

  return (
    <Dialog open onOpenChange={(o: boolean) => { if (!o) onClose(); }}>
      <DialogContent className={cn("gap-0 p-0", step === "framework" ? "sm:max-w-[760px]" : "sm:max-w-[520px]")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {step === "system" && (
          <div className="flex flex-col gap-4 p-6">
            <div className="flex flex-col gap-1.5">
              <Label>AI System <span className="text-destructive">*</span></Label>
              <Select value={systemId} onValueChange={setSystemId}>
                <SelectTrigger><SelectValue placeholder="Select a system…" /></SelectTrigger>
                <SelectContent>
                  {systems.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.id}) — {s.tier === "pending" ? "Pending classification" : s.tier}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === "framework" && (
          <div className="flex flex-col gap-4 px-6 py-5">
            <p className="text-sm font-medium text-muted-foreground">Which framework would you like to assess against?</p>
            <div className="grid grid-cols-[1.2fr_1fr] gap-4">
              {/* LEFT — recommended framework (EU AI Act) */}
              <div className="flex flex-col gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {euActRecommended(selectedSystem?.eu_output_usage ?? null, selectedSystem?.eu_market_placement ?? null) ? "Recommended for you" : "Not applicable"}
                </div>
                {(() => {
                  const recommended = euActRecommended(selectedSystem?.eu_output_usage ?? null, selectedSystem?.eu_market_placement ?? null);
                  return (
                    <button
                      className={cn(
                        "flex flex-1 w-full flex-col gap-4 rounded-lg border-2 p-5 text-left transition-all cursor-pointer",
                        recommended
                          ? "border-[var(--brand)] bg-[var(--brand)]/5 hover:shadow-[0_0_0_1px_var(--brand)]"
                          : "border-border bg-muted/20 opacity-80 hover:opacity-100",
                      )}
                      onClick={() => pickFramework(EU_AI_ACT_ID)}
                    >
                      <div className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-xl",
                        recommended ? "bg-[var(--brand)]/10 text-[var(--brand)]" : "bg-[#f0f2f4] text-[#5a6e82]",
                      )}>
                        <ClipboardList className="size-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-semibold">EU AI Act Risk Classification</span>
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            recommended ? "bg-[var(--brand)]/15 text-[var(--brand)]" : "bg-muted text-muted-foreground",
                          )}>
                            {recommended ? "Recommended" : "Not applicable"}
                          </span>
                        </div>
                        <div className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">
                          {recommended
                            ? "Run the risk classification questionnaire, determine the tier, and generate obligations."
                            : "This system's answers indicate it is neither used in nor placed on the EU market, so EU AI Act classification is likely not required. You can still start it if needed."}
                        </div>
                      </div>
                    </button>
                  );
                })()}
              </div>

              {/* RIGHT — other frameworks (dummies for now) */}
              <div className="flex flex-col gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Other frameworks</div>
                {OTHER_FRAMEWORKS.map((c) => (
                  <button
                    key={c.frameworkId}
                    disabled
                    className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg border border-border p-4 text-left opacity-50"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#f0f2f4] text-[#5a6e82]">
                      <ClipboardList className="size-4" />
                    </div>
                    <div>
                      <div className="text-[14px] font-semibold">{c.title}</div>
                      <div className="text-[12px] text-muted-foreground">{c.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === "details" && (
          <div className="flex flex-col gap-4 p-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ca-purpose">Intended Purpose <span className="text-destructive">*</span></Label>
              <Textarea id="ca-purpose" value={intendedPurpose} onChange={(e) => setIntendedPurpose(e.target.value)} placeholder="Describe the intended purpose of this AI system…" />
            </div>
            <UserCombobox
              label="Business Owner of the AI System"
              optionalHint="optional — defaults to you"
              users={allUsers}
              selected={bizSelected}
              onSelect={setBizSelected}
              placeholder={`${username} (you) — search to reassign`}
              hint="Will be assigned the business questionnaire section. Leave blank to assign to yourself."
            />
            <UserCombobox
              label="Technical Owner of the AI System"
              optionalHint="optional"
              users={allUsers}
              selected={techSelected}
              onSelect={setTechSelected}
              placeholder="Search by name or username…"
              hint="Will be assigned the technical questionnaire section. Leave blank to assign later."
            />
            <UserCombobox
              label="Compliance Officer"
              required
              users={allUsers.filter((u) => u.role === "ai_compliance_officer")}
              selected={coSelected}
              onSelect={setCoSelected}
              placeholder="Search compliance officers…"
              hint="Will review and approve the system after both questionnaire sections are complete."
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {step === "system" && (
            <Button onClick={() => { if (!systemId) { showToast("Select an AI system", true); return; } setStep("framework"); }}>
              Next
            </Button>
          )}
          {step === "framework" && !initialSystemId && (
            <Button variant="ghost" onClick={() => setStep("system")}>← Back</Button>
          )}
          {step === "details" && (
            <Button onClick={handleSubmit} disabled={loading}>
              {loading && <Loader2 className="animate-spin" />} Create
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
