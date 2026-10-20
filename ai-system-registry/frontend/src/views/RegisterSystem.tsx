import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { Loader2, X } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import { usePermissions } from "../hooks/usePermissions";
import { SELECT_CLASS, LIFECYCLE_LABELS } from "../utils";
import type { LifecycleKey } from "../types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// Only AI engineers and business owners may be assigned as contributors.
const CONTRIBUTOR_ROLES = ["ai_engineer", "business_owner"];

interface PlatformUser {
  username: string;
  firstName: string;
  lastName: string;
  role: string;
}

function displayName(u: { username: string; firstName?: string; lastName?: string }) {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return full ? `${full} (${u.username})` : u.username;
}

export default function RegisterSystem() {
  const navigate = useNavigate();
  const showToast = useToast();
  const { username: owner } = usePermissions();

  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [lifecycle, setLifecycle] = useState<LifecycleKey | "">("");
  const [rolloutDate, setRolloutDate] = useState("");
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  const [contributors, setContributors] = useState<string[]>([]);
  const [pendingUser, setPendingUser] = useState("");
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getAllUsers().catch(() => []).then((all) => {
      setUsers(all.filter((u) => CONTRIBUTOR_ROLES.includes(u.role)));
    });
  }, []);

  const userMap = useMemo(() => {
    const m: Record<string, PlatformUser> = {};
    for (const u of users) m[u.username] = u;
    return m;
  }, [users]);

  // Candidates = contributor-eligible users who are neither the owner nor already added.
  const candidates = useMemo(
    () => users.filter((u) => u.username !== owner && !contributors.includes(u.username)),
    [users, owner, contributors],
  );

  const canRegister = name.trim().length > 0 && purpose.trim().length > 0 && !loading;

  function addContributor() {
    if (!pendingUser) return;
    setContributors((c) => (c.includes(pendingUser) ? c : [...c, pendingUser]));
    setPendingUser("");
  }

  async function handleSubmit() {
    if (!canRegister) return;
    setLoading(true);
    try {
      await api.intake({
        name: name.trim(),
        intended_purpose: purpose.trim(),
        lifecycle: lifecycle || undefined,
        planned_rollout_date: rolloutDate || null,
        contributors,
        git_repo_url: gitRepoUrl.trim() || undefined,
      });
      showToast("AI system registered");
      navigate("/systems");
    } catch (e) {
      showToast(`Registration failed: ${(e as Error).message}`, true);
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb + heading */}
      <div className="border-b border-border bg-card px-6 py-4">
        <nav className="mb-2 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <button className="hover:text-foreground" onClick={() => navigate("/systems")}>
            AI Systems Registry
          </button>
          <span>›</span>
          <span className="font-medium text-foreground">Create new AI System</span>
        </nav>
        <h1 className="text-xl font-semibold">Register an AI System</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Provide the core details for this AI System to ensure compliance with the EU AI Act
          registry requirements.
        </p>
      </div>

      {/* Form body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-xl">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg_name">Name of AI system <span className="text-[var(--danger-fg)]">*</span></Label>
              <Input id="reg_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Medical Diagnosis Model v2.4" autoFocus />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg_purpose">Intended purpose <span className="text-[var(--danger-fg)]">*</span></Label>
              <Textarea id="reg_purpose" rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What is the AI system used for?" />
              <p className="text-xs text-muted-foreground">
                Please enter the purpose of use of the AI system — how and for what it is to be used.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg_stage">Development stage</Label>
              <select id="reg_stage" className={SELECT_CLASS} value={lifecycle} onChange={(e) => setLifecycle(e.target.value as LifecycleKey | "")}>
                <option value="">Select a development stage</option>
                {(Object.entries(LIFECYCLE_LABELS) as [LifecycleKey, string][]).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg_rollout">Planned roll-out date (estimation)</Label>
              <Input id="reg_rollout" type="date" value={rolloutDate} onChange={(e) => setRolloutDate(e.target.value)} className="w-auto" />
            </div>

            {/* Contributors */}
            <div className="flex flex-col gap-2">
              <Label>Assign contributors</Label>
              <p className="text-xs text-muted-foreground">
                Designate owners and others to support in the completion of this system's compliance.
              </p>
              <div className="flex gap-2">
                <select className={SELECT_CLASS} value={pendingUser} onChange={(e) => setPendingUser(e.target.value)}>
                  <option value="">Search for user…</option>
                  {candidates.map((u) => (
                    <option key={u.username} value={u.username}>{displayName(u)}</option>
                  ))}
                </select>
                <Button type="button" onClick={addContributor} disabled={!pendingUser}>Add</Button>
              </div>

              <div className="flex flex-col gap-2">
                {/* Owner — the creator, always present, cannot be removed. */}
                <div className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-[11px] font-bold text-white">
                    {owner.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="text-sm font-medium">{owner || "You"} (You)</span>
                </div>
                {contributors.map((username) => (
                  <div key={username} className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-[11px] font-bold text-white">
                      {username.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="text-sm">{userMap[username] ? displayName(userMap[username]) : username}</span>
                    <button
                      type="button"
                      className="ml-auto text-[13px] font-medium text-[var(--brand)] hover:underline"
                      onClick={() => setContributors((c) => c.filter((u) => u !== username))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg_git">Github repository</Label>
              <Input id="reg_git" type="url" value={gitRepoUrl} onChange={(e) => setGitRepoUrl(e.target.value)} placeholder="https://github.com/org/repo" />
            </div>
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between border-t border-border bg-card px-6 py-3">
        <Button variant="ghost" onClick={() => navigate("/systems")}>
          <X className="size-4" /> Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canRegister}>
          {loading && <Loader2 className="animate-spin" />} Register AI System
        </Button>
      </div>
    </div>
  );
}
