import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { Loader2, X, UploadCloud, FileText, Trash2, Sparkles } from "lucide-react";
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

// Mirrors the document-indexing service limits (document-indexing/backend). The
// form restricts to the three formats named in the ticket; the service also
// accepts pptx/html/txt but we don't surface those here.
const MAX_FILES = 10;
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_EXT = ["pdf", "docx", "md"];
const ACCEPT = ".pdf,.docx,.md";

interface PlatformUser {
  username: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface UploadItem {
  localId: string;
  name: string;
  size: number;
  status: "uploading" | "done" | "error" | "canceled";
  progress: number;
  documentId?: string;
  error?: string;
}

function displayName(u: { username: string; firstName?: string; lastName?: string }) {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return full ? `${full} (${u.username})` : u.username;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Draft lifecycle: the first dropped file creates the system so uploads have a
  // real id to target. Register updates the draft; abandoning the form deletes it.
  const draftIdRef = useRef<string | null>(null);
  const draftPromiseRef = useRef<Promise<string> | null>(null);
  const registeredRef = useRef(false);
  const abortRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    api.getAllUsers().catch(() => []).then((all) => {
      setUsers(all.filter((u) => CONTRIBUTOR_ROLES.includes(u.role)));
    });
  }, []);

  // On unmount: if the user left without registering, abort in-flight uploads, purge any
  // documents already indexed for the draft (the indexing service has no FK to the
  // registry, so deleting the system row alone would orphan them), then delete the draft
  // system. When registered, do nothing so uploads keep running (indexing continues
  // server-side) — registration is never blocked by uploads.
  // ponytail: a hard tab-close can't run this cleanup; a periodic draft sweep is
  // the upgrade path.
  useEffect(() => {
    return () => {
      if (registeredRef.current) return;
      for (const c of abortRef.current.values()) c.abort();
      const draftId = draftIdRef.current;
      if (draftId) {
        void api
          .deleteIndexedDocumentsForSystem(draftId)
          .catch(() => {})
          .finally(() => void api.deleteSystem(draftId).catch(() => {}));
      }
    };
  }, []);

  const userMap = useMemo(() => {
    const m: Record<string, PlatformUser> = {};
    for (const u of users) m[u.username] = u;
    return m;
  }, [users]);

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

  async function ensureDraft(): Promise<string> {
    if (draftIdRef.current) return draftIdRef.current;
    if (!draftPromiseRef.current) {
      draftPromiseRef.current = api
        .intake({ name: name.trim() || "Untitled system", intended_purpose: purpose.trim() || "" })
        .then((sys) => {
          draftIdRef.current = sys.id;
          return sys.id;
        })
        .catch((err) => {
          draftPromiseRef.current = null; // allow a retry on the next drop
          throw err;
        });
    }
    return draftPromiseRef.current;
  }

  async function startUpload(file: File) {
    const localId = crypto.randomUUID();
    setUploads((prev) => [
      ...prev,
      { localId, name: file.name, size: file.size, status: "uploading", progress: 0 },
    ]);
    const controller = new AbortController();
    abortRef.current.set(localId, controller);
    try {
      const systemId = await ensureDraft();
      const res = await api.uploadDocumentIndexed(systemId, file, {
        signal: controller.signal,
        onProgress: (pct) =>
          setUploads((prev) => prev.map((u) => (u.localId === localId ? { ...u, progress: pct } : u))),
      });
      setUploads((prev) =>
        prev.map((u) =>
          u.localId === localId ? { ...u, status: "done", progress: 100, documentId: res.document_id } : u,
        ),
      );
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      setUploads((prev) =>
        prev.map((u) =>
          u.localId === localId
            ? { ...u, status: aborted ? "canceled" : "error", error: aborted ? undefined : (e as Error).message }
            : u,
        ),
      );
    } finally {
      abortRef.current.delete(localId);
    }
  }

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const active = uploads.filter((u) => u.status === "uploading" || u.status === "done").length;
    const errors: string[] = [];
    const accepted: File[] = [];
    let slot = active;
    for (const f of incoming) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED_EXT.includes(ext)) {
        errors.push(`${f.name}: unsupported format (allowed: PDF, DOCX, MD)`);
        continue;
      }
      if (f.size > MAX_SIZE) {
        errors.push(`${f.name}: exceeds the 50 MB limit`);
        continue;
      }
      if (slot >= MAX_FILES) {
        errors.push(`You can upload at most ${MAX_FILES} documents.`);
        break;
      }
      accepted.push(f);
      slot++;
    }
    setFileError(errors.length ? errors.join(" · ") : null);
    accepted.forEach(startUpload);
  }

  function removeUpload(item: UploadItem) {
    if (item.status === "uploading") {
      abortRef.current.get(item.localId)?.abort();
      setUploads((prev) => prev.filter((u) => u.localId !== item.localId));
      return;
    }
    if (item.status === "done" && item.documentId) {
      const docId = item.documentId;
      api.deleteIndexedDocument(docId).catch((e) => showToast(`Delete failed: ${(e as Error).message}`, true));
    }
    setUploads((prev) => prev.filter((u) => u.localId !== item.localId));
  }

  async function handleSubmit() {
    if (!canRegister) return;
    setLoading(true);
    const fields = {
      name: name.trim(),
      intended_purpose: purpose.trim(),
      lifecycle: lifecycle || undefined,
      planned_rollout_date: rolloutDate || null,
      contributors,
      git_repo_url: gitRepoUrl.trim() || undefined,
    };
    try {
      // Reuse the draft created on first file drop; otherwise create the system now.
      let systemId = draftIdRef.current;
      if (!systemId && draftPromiseRef.current) {
        systemId = await draftPromiseRef.current.catch(() => null);
      }
      if (systemId) {
        await api.updateSystem(systemId, fields);
      } else {
        await api.intake(fields);
      }
      registeredRef.current = true;
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
          Provide the core details and supporting documentation for this AI System to ensure
          compliance with the EU AI Act registry requirements.
        </p>
      </div>

      {/* Two-column body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* LEFT — core details */}
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
                    {(owner || "YOU").slice(0, 2).toUpperCase()}
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

          {/* RIGHT — documentation upload */}
          <div className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Upload documentation</h2>
            <div className="flex items-start gap-2 rounded-md border border-[var(--success-border,var(--border))] bg-[var(--success-bg,var(--accent))] px-3.5 py-2.5 text-[13px]">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-[var(--brand)]" />
              <span>Uploading your complete documentation will allow the AI to pre-fill the assessment later. Ensure your documentation is up-to-date.</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Upload a maximum of {MAX_FILES} documents related to your AI system. Maximum file size: 50 MB.
              Supported formats: pdf, docx, md.
            </p>

            <input ref={fileInputRef} type="file" multiple accept={ACCEPT} className="hidden"
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />

            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
                dragging ? "border-[var(--brand)] bg-[var(--brand)]/5" : "border-border hover:border-foreground/30"
              }`}
            >
              <UploadCloud className="size-8 text-muted-foreground" />
              <div className="text-sm font-semibold">Drag and drop files here</div>
              <div className="text-xs text-muted-foreground">or click to browse from your computer</div>
            </div>

            {fileError && (
              <p className="text-[13px] text-[var(--danger-fg)]">{fileError}</p>
            )}

            {uploads.length > 0 && (
              <div className="flex flex-col gap-2">
                {uploads.map((item) => (
                  <div key={item.localId} className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{item.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatSize(item.size)}
                        {item.status === "uploading" && " · Uploading…"}
                        {item.status === "done" && " · Uploaded"}
                        {item.status === "canceled" && " · Canceled"}
                        {item.status === "error" && ` · ${item.error || "Upload failed"}`}
                      </div>
                      {item.status === "uploading" && (
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${item.progress}%` }} />
                        </div>
                      )}
                    </div>
                    {item.status === "uploading" && (
                      <span className="shrink-0 text-[11px] font-semibold text-[var(--brand)]">{item.progress}%</span>
                    )}
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground hover:text-[var(--danger-fg)]"
                      title={item.status === "uploading" ? "Cancel" : "Remove"}
                      onClick={() => removeUpload(item)}
                    >
                      {item.status === "uploading" ? <X className="size-4" /> : <Trash2 className="size-4" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
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
