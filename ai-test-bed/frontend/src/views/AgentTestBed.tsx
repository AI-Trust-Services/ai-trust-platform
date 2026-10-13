import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Upload,
} from "lucide-react";
import { api } from "../api/client";
import { registryApi } from "../api/registryClient";
import type {
  AgentRetrievedPassage,
  AgentResult,
  AgentRunResult,
  AgentRunSummary,
  AgentSourceBackends,
  AISystem,
  Backend,
  RetrievalKnobs,
  RetrieveMode,
  SourceReference,
} from "../types";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECOMMENDED_KNOBS: RetrievalKnobs = { k: 5, mode: "hybrid", rrf_k: 60 };

const MODE_LABEL: Record<RetrieveMode, string> = {
  hybrid: "Hybrid (dense + FTS)",
  dense: "Dense only",
  fts: "Full-text only",
};

const BACKEND_LABEL: Record<Backend, string> = {
  classic: "Classic RAG",
  graph: "Graph",
  hierarchical: "Hierarchical",
};

const DEFAULT_TASK = "Risk Classification";

const TASK_OPTIONS = [DEFAULT_TASK, "Custom"];

const SOURCE_LABELS: Record<keyof AgentSourceBackends, string> = {
  legal: "Legal",
  reviewed_judgments: "Reviewed Judgments",
  system_evidence: "System Evidence",
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function ToggleSection({
  label,
  count,
  children,
  defaultOpen = false,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        {label}
        {count != null && (
          <span className="ml-0.5 text-xs text-muted-foreground">({count})</span>
        )}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retrieval knobs panel (reused from TestBed pattern)
// ---------------------------------------------------------------------------

function RetrievalKnobsPanel({
  knobs,
  onChange,
}: {
  knobs: RetrievalKnobs;
  onChange: (k: RetrievalKnobs) => void;
}) {
  const atRecommended =
    knobs.k === RECOMMENDED_KNOBS.k &&
    knobs.mode === RECOMMENDED_KNOBS.mode &&
    knobs.rrf_k === RECOMMENDED_KNOBS.rrf_k;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Retrieval settings</span>
        {!atRecommended && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...RECOMMENDED_KNOBS })}
            className="h-6 gap-1 px-2 text-xs"
          >
            <RotateCcw className="size-3" />
            Reset to recommended
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label className="text-xs">Mode</Label>
          <Select
            value={knobs.mode}
            onValueChange={(v) => onChange({ ...knobs, mode: v as RetrieveMode })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODE_LABEL) as RetrieveMode[]).map((m) => (
                <SelectItem key={m} value={m}>{MODE_LABEL[m]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Passages per source (k)</Label>
          <Input
            type="number"
            min={1}
            max={20}
            className="h-8 text-xs"
            value={knobs.k}
            onChange={(e) => {
              const v = Math.max(1, Math.min(20, parseInt(e.target.value) || 1));
              onChange({ ...knobs, k: v });
            }}
          />
        </div>

        <div>
          <Label className="text-xs">RRF k (fusion constant)</Label>
          <Input
            type="number"
            min={1}
            max={200}
            disabled={knobs.mode !== "hybrid"}
            className="h-8 text-xs disabled:opacity-50"
            value={knobs.rrf_k}
            onChange={(e) => {
              const v = Math.max(1, Math.min(200, parseInt(e.target.value) || 60));
              onChange({ ...knobs, rrf_k: v });
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocPanel (local copy — same as TestBed's DocPanel)
// Compact document list with upload/delete and status polling.
// ---------------------------------------------------------------------------

import type { DocumentStatus, IndexingStatus } from "../types";

const STATUS_VARIANT: Record<IndexingStatus, "default" | "secondary" | "outline" | "destructive"> =
  { indexed: "default", processing: "secondary", pending: "outline", failed: "destructive" };

const ACTIVE_STATUSES: IndexingStatus[] = ["pending", "processing"];

const STAGE_STEP: Record<string, string> = { parsing: "2/5", embedding: "3/5", storing: "4/5" };

function progressHint(d: DocumentStatus): string | null {
  if (d.status === "pending") return "queued (1/5)";
  if (d.status === "processing" && d.stage) return `${d.stage} (${STAGE_STEP[d.stage] ?? ""})`;
  if (d.status === "processing") return "processing…";
  return null;
}

function DocPanel({
  systemId,
  mayWrite,
  emptyHint,
}: {
  systemId: string;
  mayWrite: boolean;
  emptyHint?: string;
}) {
  const [docs, setDocs] = useState<DocumentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadDocs() {
    try {
      setDocs(await api.listDocuments(systemId));
    } catch {
      // silently fail — system may not exist yet
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId]);

  useEffect(() => {
    const hasActive = docs.some((d) => ACTIVE_STATUSES.includes(d.status));
    if (!hasActive) return;
    const id = setInterval(() => void loadDocs(), 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  async function onUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      await api.uploadDocument(systemId, file);
      await loadDocs();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function onDelete(docId: string) {
    setDeleteError(null);
    try {
      await api.deleteDocument(docId);
      await loadDocs();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {loading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {emptyHint ?? "No documents uploaded yet."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Chunks</TableHead>
              {mayWrite && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="text-xs">{d.filename}</TableCell>
                <TableCell className="text-xs text-muted-foreground">v{d.version_label}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={STATUS_VARIANT[d.status]}>{d.status}</Badge>
                    {progressHint(d) && (
                      <span className="text-[11px] text-muted-foreground">{progressHint(d)}</span>
                    )}
                    {d.error && (
                      <span className="text-[11px] text-destructive" title={d.error}>error</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {d.chunk_count > 0 ? d.chunk_count : "—"}
                </TableCell>
                {mayWrite && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void onDelete(d.id)}
                      title="Delete document"
                    >
                      <span className="text-[11px] text-muted-foreground hover:text-destructive">
                        Delete
                      </span>
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
      {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}

      {mayWrite && (
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.pptx,.md,.markdown,.html,.htm,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
            className="gap-1.5"
          >
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            Upload document
          </Button>
          <span className="text-[11px] text-muted-foreground">
            PDF, DOCX, PPTX, MD, HTML, TXT · max 50 MB
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent result panel
// ---------------------------------------------------------------------------

function SourceRefBadge({ ref: r }: { ref: SourceReference }) {
  return (
    <div className="flex flex-col gap-0.5 rounded border border-border p-2">
      <div className="flex items-center gap-2">
        <Badge
          variant={r.resolved ? "default" : "destructive"}
          className="text-[10px]"
        >
          {r.resolved ? "✓" : "✗"} {r.ref_id}
        </Badge>
      </div>
      {r.quote && (
        <p className="mt-0.5 text-xs italic text-muted-foreground">"{r.quote}"</p>
      )}
    </div>
  );
}

function AgentPassageGroup({
  label,
  passages,
  defaultOpen,
}: {
  label: string;
  passages: AgentRetrievedPassage[];
  defaultOpen: boolean;
}) {
  return (
    <ToggleSection label={label} count={passages.length} defaultOpen={defaultOpen}>
      <div className="flex flex-col gap-2">
        {passages.map((p, i) => (
          <div key={i} className="rounded-lg border border-border p-3 text-sm">
            <p className="whitespace-pre-wrap">{p.text}</p>
            <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{p.ref_id}</span>
              <Badge variant="outline" className="text-[10px]">{p.backend}</Badge>
            </div>
          </div>
        ))}
      </div>
    </ToggleSection>
  );
}

function AgentResultPanel({
  result,
  passages,
}: {
  result: AgentResult;
  passages: AgentRetrievedPassage[];
}) {
  const passageGroups: Record<string, AgentRetrievedPassage[]> = {};
  for (const p of passages) {
    const lbl = p.source_label || "other";
    (passageGroups[lbl] ??= []).push(p);
  }

  return (
    <div className="flex flex-col gap-4">
      {result.review_required && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Review Required</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {result.review_questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div>
        <p className="text-sm font-medium">Proposed Answer</p>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{result.proposed_answer}</p>
      </div>

      <div>
        <p className="text-sm font-medium">Rationale</p>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{result.rationale}</p>
      </div>

      {result.source_references.length > 0 && (
        <ToggleSection
          label="Source references"
          count={result.source_references.length}
          defaultOpen
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {result.source_references.map((r) => (
              <SourceRefBadge key={r.ref_id} ref={r} />
            ))}
          </div>
        </ToggleSection>
      )}

      {result.applicable_judgments.length > 0 && (
        <ToggleSection
          label="Applicable judgments"
          count={result.applicable_judgments.length}
          defaultOpen
        >
          <div className="flex flex-col gap-2">
            {result.applicable_judgments.map((j, i) => (
              <div key={i} className="rounded border border-border p-2">
                <span className="font-mono text-xs font-medium">{j.ref_id}</span>
                <p className="mt-0.5 text-sm text-muted-foreground">{j.statement}</p>
              </div>
            ))}
          </div>
        </ToggleSection>
      )}

      {result.missing_facts.length > 0 && (
        <div>
          <p className="text-sm font-medium text-yellow-600">Missing facts</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {result.missing_facts.map((f, i) => (
              <li key={i} className="text-sm text-muted-foreground">{f}</li>
            ))}
          </ul>
        </div>
      )}

      {Object.keys(passageGroups).length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Retrieved passages</p>
          {Object.entries(passageGroups).map(([lbl, ps]) => (
            <AgentPassageGroup
              key={lbl}
              label={lbl}
              passages={ps}
              defaultOpen={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main AgentTestBed component
// ---------------------------------------------------------------------------

export function AgentTestBed({ mayWrite }: { mayWrite: boolean }) {
  // ---- System selector ----
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [systemsError, setSystemsError] = useState<string | null>(null);
  const [selectedSystem, setSelectedSystem] = useState("");

  // ---- Task ----
  const [taskOption, setTaskOption] = useState(DEFAULT_TASK);
  const [customTask, setCustomTask] = useState("");

  // ---- Source backends ----
  const [sourceBackends, setSourceBackends] = useState<AgentSourceBackends>({
    legal: "classic",
    reviewed_judgments: "classic",
    system_evidence: "classic",
  });

  // ---- Retrieval knobs ----
  const [knobs, setKnobs] = useState<RetrievalKnobs>({ ...RECOMMENDED_KNOBS });

  // ---- Run state ----
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<AgentRunResult | null>(null);

  // ---- Recent runs ----
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);

  // ---- Feedback ----
  const [fbConclusion, setFbConclusion] = useState("");
  const [fbReasoning, setFbReasoning] = useState("");
  const [fbQuestion, setFbQuestion] = useState("");
  const [fbSubmitting, setFbSubmitting] = useState(false);
  const [fbStatus, setFbStatus] = useState<string | null>(null);
  const [fbError, setFbError] = useState<string | null>(null);

  // ---- Cognee ingest ----
  const cogneeInput = useRef<HTMLInputElement>(null);
  const [cogneeUploading, setCogneeUploading] = useState(false);
  const [cogneeStatus, setCogneeStatus] = useState<string | null>(null);
  const [cogneeError, setCogneeError] = useState<string | null>(null);

  // Load systems on mount
  useEffect(() => {
    registryApi
      .getSystems()
      .then((s) =>
        setSystems(s.filter((x) => x.lifecycle !== "decommissioned" && !x.id.startsWith("__"))),
      )
      .catch((e) => setSystemsError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function loadRuns() {
    setRunsLoading(true);
    setRunsError(null);
    try {
      setRuns(await api.listAgentRuns());
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunsLoading(false);
    }
  }

  useEffect(() => {
    void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onRun() {
    if (!selectedSystem) return;
    setRunning(true);
    setRunError(null);
    setLastRun(null);
    setFbStatus(null);
    setFbError(null);
    try {
      const task = taskOption === "Custom" ? customTask || DEFAULT_TASK : taskOption;
      const result = await api.runAgent({
        system_id: selectedSystem,
        task,
        source_backends: sourceBackends,
        retrieval_k: knobs.k,
        retrieval_mode: knobs.mode,
        retrieval_rrf_k: knobs.rrf_k,
      });
      setLastRun(result);
      await loadRuns();
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function onOpenRun(runId: string) {
    try {
      const run = await api.getAgentRun(runId);
      setLastRun(run);
      setFbStatus(null);
      setFbError(null);
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onSubmitFeedback() {
    if (!lastRun || !fbConclusion || !fbReasoning) return;
    setFbSubmitting(true);
    setFbError(null);
    setFbStatus(null);
    try {
      const res = await api.submitAgentFeedback({
        run_id: lastRun.run_id,
        conclusion: fbConclusion,
        reasoning: fbReasoning,
        question: fbQuestion || undefined,
      });
      setFbStatus(res.status);
      setFbConclusion("");
      setFbReasoning("");
      setFbQuestion("");
    } catch (e) {
      setFbError(e instanceof Error ? e.message : String(e));
    } finally {
      setFbSubmitting(false);
    }
  }

  async function onCogneeIngest(file: File) {
    setCogneeUploading(true);
    setCogneeError(null);
    setCogneeStatus(null);
    try {
      const res = await api.cogneeIngest(file);
      setCogneeStatus(res.status);
    } catch (e) {
      setCogneeError(e instanceof Error ? e.message : String(e));
    } finally {
      setCogneeUploading(false);
      if (cogneeInput.current) cogneeInput.current.value = "";
    }
  }

  const knobsCustomised =
    knobs.k !== RECOMMENDED_KNOBS.k ||
    knobs.mode !== RECOMMENDED_KNOBS.mode ||
    knobs.rrf_k !== RECOMMENDED_KNOBS.rrf_k;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-5">

      {/* ------------------------------------------------------------------ */}
      {/* 1. System selector                                                   */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4" />
            System
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {systemsError && (
            <div className="flex items-center gap-2 text-[13px] text-destructive">
              <AlertCircle className="size-4" />
              {systemsError}
            </div>
          )}

          <div>
            <Label htmlFor="agent-system-select">Registered AI system</Label>
            <Select value={selectedSystem} onValueChange={setSelectedSystem}>
              <SelectTrigger id="agent-system-select">
                <SelectValue placeholder="Select a system…" />
              </SelectTrigger>
              <SelectContent>
                {systems.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    <span className="ml-1.5 text-xs text-muted-foreground">({s.id})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* 2. Task                                                              */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Task</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Label htmlFor="agent-task-select">Task type</Label>
            <Select value={taskOption} onValueChange={setTaskOption}>
              <SelectTrigger id="agent-task-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {taskOption === "Custom" && (
            <div>
              <Label htmlFor="agent-custom-task">Custom task description</Label>
              <Textarea
                id="agent-custom-task"
                className="min-h-[80px] text-sm"
                placeholder="Describe the task for the agent…"
                value={customTask}
                onChange={(e) => setCustomTask(e.target.value)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* 3. Configure retrieval (per-source RAG backend + knobs)             */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Configure retrieval</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ToggleSection
            label="Per-source RAG backend"
            defaultOpen={false}
          >
            <div className="flex flex-col gap-3 mt-2">
              {(Object.keys(SOURCE_LABELS) as Array<keyof AgentSourceBackends>).map((source) => (
                <div key={source} className="flex items-center gap-3">
                  <Label className="w-40 shrink-0 text-sm">{SOURCE_LABELS[source]}</Label>
                  <Select
                    value={sourceBackends[source]}
                    onValueChange={(v) =>
                      setSourceBackends((prev) => ({ ...prev, [source]: v as Backend }))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="classic">{BACKEND_LABEL.classic}</SelectItem>
                      <SelectItem value="graph">{BACKEND_LABEL.graph}</SelectItem>
                      <SelectItem value="hierarchical" disabled>
                        {BACKEND_LABEL.hierarchical}
                        <span className="ml-1.5 text-[10px] text-muted-foreground">
                          — coming soon
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </ToggleSection>

          <div>
            <button
              type="button"
              onClick={() => {}}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="size-4" />
              Retrieval settings
              {knobsCustomised && (
                <Badge variant="secondary" className="ml-1 text-[10px]">custom</Badge>
              )}
            </button>
          </div>

          <RetrievalKnobsPanel knobs={knobs} onChange={setKnobs} />
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* 4. Run button                                                        */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardContent className="pt-5">
          {runError && (
            <p className="mb-3 text-[13px] text-destructive">{runError}</p>
          )}
          <Button
            onClick={onRun}
            disabled={!selectedSystem || running}
            className="w-40"
          >
            {running ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            <span className="ml-2">{running ? "Running…" : "Run agent"}</span>
          </Button>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* 5. Result panel                                                      */}
      {/* ------------------------------------------------------------------ */}
      {lastRun && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Agent Result
              <Badge variant="outline" className="ml-1 text-[11px]">
                {lastRun.run_id}
              </Badge>
              {lastRun.result.review_required && (
                <Badge variant="destructive" className="ml-1 text-[11px]">
                  Review required
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AgentResultPanel
              result={lastRun.result}
              passages={lastRun.retrieved_passages}
            />
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 6. Reviewed-judgments corpus                                         */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-4" />
            Reviewed-judgments corpus
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            Upload reviewed judgment documents here. These are shared across all agent runs and used
            for the <strong>Reviewed Judgments</strong> retrieval source.
          </p>
          <DocPanel
            systemId="__reviewed_judgments__"
            mayWrite={mayWrite}
            emptyHint="No reviewed-judgment documents uploaded yet."
          />

          {mayWrite && (
            <div className="mt-2 flex flex-col gap-2 border-t border-border pt-4">
              <p className="text-xs font-medium">Add to Knowledge Graph (Cognee)</p>
              <p className="text-xs text-muted-foreground">
                Ingest a document directly into the Cognee graph backend for graph-based retrieval.
              </p>
              <div className="flex items-center gap-2">
                <input
                  ref={cogneeInput}
                  type="file"
                  accept=".pdf,.docx,.md,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onCogneeIngest(f);
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cogneeUploading}
                  onClick={() => cogneeInput.current?.click()}
                  className="gap-1.5"
                >
                  {cogneeUploading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Upload className="size-3.5" />
                  )}
                  Ingest to Cognee
                </Button>
                <span className="text-[11px] text-muted-foreground">PDF, DOCX, MD, TXT</span>
              </div>
              {cogneeStatus && (
                <p className="text-xs text-green-600">Cognee ingest status: {cogneeStatus}</p>
              )}
              {cogneeError && (
                <p className="text-xs text-destructive">{cogneeError}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* 7. Recent runs                                                        */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent agent runs</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadRuns()}
            title="Refresh"
          >
            <RefreshCw className="size-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {runsLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : runsError ? (
            <p className="text-sm text-destructive">{runsError}</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agent runs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run ID</TableHead>
                  <TableHead>System</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.run_id}>
                    <TableCell className="font-mono text-xs">{r.run_id}</TableCell>
                    <TableCell className="text-xs">{r.system_id}</TableCell>
                    <TableCell className="text-xs">{r.task}</TableCell>
                    <TableCell>
                      {r.review_required ? (
                        <Badge variant="destructive" className="text-[10px]">required</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">ok</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => void onOpenRun(r.run_id)}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* 8. Feedback form                                                     */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Feedback</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!lastRun && (
            <p className="text-sm text-muted-foreground">
              Run the agent first to submit feedback on the result.
            </p>
          )}

          {lastRun && (
            <>
              <p className="text-xs text-muted-foreground">
                Submitting feedback for run{" "}
                <span className="font-mono">{lastRun.run_id}</span>. Corrections are written back
                into Cognee to improve future runs.
              </p>

              <div>
                <Label htmlFor="fb-conclusion">Corrected assessment (conclusion)</Label>
                <Textarea
                  id="fb-conclusion"
                  className="mt-1 min-h-[80px] text-sm"
                  placeholder="Enter the correct conclusion or assessment…"
                  value={fbConclusion}
                  onChange={(e) => setFbConclusion(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="fb-reasoning">Reasoning</Label>
                <Textarea
                  id="fb-reasoning"
                  className="mt-1 min-h-[80px] text-sm"
                  placeholder="Explain why this is the correct assessment…"
                  value={fbReasoning}
                  onChange={(e) => setFbReasoning(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="fb-question">Question (optional)</Label>
                <Input
                  id="fb-question"
                  className="mt-1 text-sm"
                  placeholder="Any question or note for the reviewer…"
                  value={fbQuestion}
                  onChange={(e) => setFbQuestion(e.target.value)}
                />
              </div>

              {fbError && <p className="text-[13px] text-destructive">{fbError}</p>}
              {fbStatus && (
                <p className="text-[13px] text-green-600">
                  Feedback submitted — status: <strong>{fbStatus}</strong>
                </p>
              )}

              <div>
                <Button
                  onClick={onSubmitFeedback}
                  disabled={!fbConclusion || !fbReasoning || fbSubmitting}
                  className="w-40"
                >
                  {fbSubmitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  <span className={fbSubmitting ? "ml-2" : ""}>
                    {fbSubmitting ? "Submitting…" : "Submit feedback"}
                  </span>
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
