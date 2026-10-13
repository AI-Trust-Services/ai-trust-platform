import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Scale,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
import { api } from "../api/client";
import type {
  DocumentStatus,
  IndexingStatus,
  RetrievalKnobs,
  RetrieveMode,
  TestBedEnabledSources,
  TestBedRole,
  TestBedRunResult,
  TestBedRunSummary,
  TestBedSample,
  TestBedSampleDetail,
} from "../types";
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
import { Switch } from "../components/ui/switch";
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

const TIER_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  prohibited: "destructive",
  "gpai-systemic": "destructive",
  "gpai-standard": "secondary",
  high: "destructive",
  limited: "secondary",
  minimal: "default",
  pending: "outline",
};

const TIER_LABEL: Record<string, string> = {
  prohibited: "Prohibited",
  "gpai-systemic": "GPAI Systemic",
  "gpai-standard": "GPAI Standard",
  high: "High Risk",
  limited: "Limited Risk",
  minimal: "Minimal Risk",
  pending: "Pending",
};

const RECOMMENDED_KNOBS: RetrievalKnobs = { k: 5, mode: "hybrid", rrf_k: 60 };

const MODE_LABEL: Record<RetrieveMode, string> = {
  hybrid: "Hybrid (dense + FTS)",
  dense: "Dense only",
  fts: "Full-text only",
};

const SOURCE_LABEL: Record<string, string> = {
  system_docs: "System documents",
  eu_ai_act: "EU AI Act",
  cognee: "Expert knowledge",
};

const BUSINESS_LABELS: Record<string, string> = {
  intended_purpose: "Intended purpose",
  department: "Department",
  use_case: "Use case",
  people_affected: "People affected",
  decision_context: "Decision context",
  data_sources: "Data sources",
  oversight_mechanism: "Oversight mechanism",
  deployment_context: "Deployment context",
};

const TECHNICAL_LABELS: Record<string, string> = {
  data_and_inputs: "Data & inputs",
  decision_domain: "Decision domain",
  automation_and_oversight: "Automation & oversight",
  affected_people: "Affected people",
  model_nature: "Model nature",
  user_interaction: "User interaction",
  prohibited_practices: "Prohibited practices",
};

const STATUS_VARIANT: Record<IndexingStatus, "default" | "secondary" | "outline" | "destructive"> =
  { indexed: "default", processing: "secondary", pending: "outline", failed: "destructive" };

const ACTIVE_STATUSES: IndexingStatus[] = ["pending", "processing"];

const STAGE_STEP: Record<string, string> = { parsing: "2/5", embedding: "3/5", storing: "4/5" };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function TierBadge({ tier }: { tier: string }) {
  return (
    <Badge variant={TIER_VARIANT[tier] ?? "outline"}>
      {TIER_LABEL[tier] ?? tier}
    </Badge>
  );
}

function ConfidenceBar({ value }: { value: number | null }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? "bg-green-500" : value >= 0.6 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

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
// DocPanel — compact document list with upload/delete and status polling
// Used for both the sample-system corpus and the EU AI Act corpus.
// ---------------------------------------------------------------------------

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

  const loadDocs = useCallback(async () => {
    try {
      setDocs(await api.listDocuments(systemId));
    } catch {
      // silently fail — system may not exist yet (seed pending)
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  // Poll while any document is still active
  useEffect(() => {
    const hasActive = docs.some((d) => ACTIVE_STATUSES.includes(d.status));
    if (!hasActive) return;
    const id = setInterval(() => void loadDocs(), 3000);
    return () => clearInterval(id);
  }, [docs, loadDocs]);

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
                      <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
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
// Scenario panel — shows what the sample AI system does and expected outcome
// ---------------------------------------------------------------------------

function ScenarioPanel({ detail }: { detail: TestBedSampleDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{detail.description}</p>

      {detail.expected_tier && (
        <div className="flex flex-wrap items-start gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Expected tier</span>
            <TierBadge tier={detail.expected_tier} />
          </div>
          {detail.expected_rationale && (
            <p className="flex-1 text-xs text-muted-foreground leading-relaxed">
              {detail.expected_rationale}
            </p>
          )}
        </div>
      )}

      <ToggleSection label="Business owner answers" count={Object.keys(detail.business_answers).length}>
        <dl className="grid grid-cols-1 gap-y-2 sm:grid-cols-[max-content_1fr] sm:gap-x-4">
          {Object.entries(detail.business_answers).map(([k, v]) => (
            <>
              <dt key={`dt-${k}`} className="text-xs font-medium text-muted-foreground sm:pt-0.5 sm:text-right">
                {BUSINESS_LABELS[k] ?? k}
              </dt>
              <dd key={`dd-${k}`} className="text-xs">{v}</dd>
            </>
          ))}
        </dl>
      </ToggleSection>

      <ToggleSection label="Technical owner answers" count={Object.keys(detail.technical_answers).length}>
        <dl className="grid grid-cols-1 gap-y-2 sm:grid-cols-[max-content_1fr] sm:gap-x-4">
          {Object.entries(detail.technical_answers).map(([k, v]) => (
            <>
              <dt key={`dt-${k}`} className="text-xs font-medium text-muted-foreground sm:pt-0.5 sm:text-right">
                {TECHNICAL_LABELS[k] ?? k}
              </dt>
              <dd key={`dd-${k}`} className="text-xs">{v}</dd>
            </>
          ))}
        </dl>
      </ToggleSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result panel — role-focused layout
// ---------------------------------------------------------------------------

function PassageGroup({
  label,
  passages,
  defaultOpen,
}: {
  label: string;
  passages: Array<{ passage: string; source: { filename: string; version_label: string; page: number | null } }>;
  defaultOpen: boolean;
}) {
  return (
    <ToggleSection label={label} count={passages.length} defaultOpen={defaultOpen}>
      <div className="flex flex-col gap-2">
        {passages.map((p, i) => (
          <div key={i} className="rounded-lg border border-border p-3 text-sm">
            <p className="whitespace-pre-wrap">{p.passage}</p>
            <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{p.source.filename}</span>
              <span>v{p.source.version_label}</span>
              {p.source.page != null && <span>p. {p.source.page}</span>}
            </div>
          </div>
        ))}
      </div>
    </ToggleSection>
  );
}

function ResultPanel({ result }: { result: TestBedRunResult }) {
  const rationale = result.rationale;
  const isEngineer = result.role !== "compliance_officer";

  const passageGroups: Record<string, typeof result.source_passages> = {};
  for (const p of result.source_passages) {
    const lbl = p._source_label ?? "other";
    (passageGroups[lbl] ??= []).push(p);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Risk tier</span>
          <TierBadge tier={result.tier} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Confidence</span>
          <ConfidenceBar value={result.confidence} />
        </div>
        {rationale?.org_role && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Organisation role</span>
            <Badge variant="outline" className="capitalize">{rationale.org_role}</Badge>
          </div>
        )}
      </div>

      {isEngineer ? (
        <>
          {rationale?.flags && rationale.flags.length > 0 && (
            <ToggleSection label="Inferred flags" count={rationale.flags.length} defaultOpen>
              <div className="flex flex-col gap-1.5">
                {rationale.flags.map((f, i) => (
                  <div key={i} className="rounded border border-border p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">{f.flag}</span>
                      <Badge variant="outline" className="tabular-nums">{String(f.value)}</Badge>
                      {f.confidence != null && (
                        <span className="text-xs text-muted-foreground">
                          {Math.round(f.confidence * 100)}% conf.
                        </span>
                      )}
                    </div>
                    {f.rationale && <p className="mt-1 text-muted-foreground">{f.rationale}</p>}
                  </div>
                ))}
              </div>
            </ToggleSection>
          )}

          {rationale?.reasoning && (
            <div>
              <p className="text-sm font-medium">Reasoning</p>
              <p className="text-sm text-muted-foreground">{rationale.reasoning}</p>
            </div>
          )}

          {result.obligations.length > 0 && (
            <ToggleSection label="Resulting obligations" count={result.obligations.length}>
              <ul className="list-inside list-disc space-y-1">
                {result.obligations.map((o, i) => (
                  <li key={i} className="text-sm text-muted-foreground">{o}</li>
                ))}
              </ul>
            </ToggleSection>
          )}
        </>
      ) : (
        <>
          <div>
            <p className="text-sm font-medium">Legal basis</p>
            <p className="text-sm text-muted-foreground">{result.basis}</p>
          </div>

          {rationale?.reasoning && (
            <div>
              <p className="text-sm font-medium">Regulatory reasoning</p>
              <p className="text-sm text-muted-foreground">{rationale.reasoning}</p>
            </div>
          )}

          {rationale?.org_role_rationale && (
            <div>
              <p className="text-sm font-medium">Role rationale</p>
              <p className="text-sm text-muted-foreground">{rationale.org_role_rationale}</p>
            </div>
          )}

          {result.obligations.length > 0 && (
            <ToggleSection label="Applicable obligations" count={result.obligations.length} defaultOpen>
              <ul className="list-inside list-disc space-y-1">
                {result.obligations.map((o, i) => (
                  <li key={i} className="text-sm text-muted-foreground">{o}</li>
                ))}
              </ul>
            </ToggleSection>
          )}

          {rationale?.flags && rationale.flags.length > 0 && (
            <ToggleSection label="Inferred classifier flags" count={rationale.flags.length}>
              <div className="flex flex-col gap-1.5">
                {rationale.flags.map((f, i) => (
                  <div key={i} className="rounded border border-border p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">{f.flag}</span>
                      <Badge variant="outline" className="tabular-nums">{String(f.value)}</Badge>
                    </div>
                    {f.rationale && <p className="mt-1 text-muted-foreground">{f.rationale}</p>}
                  </div>
                ))}
              </div>
            </ToggleSection>
          )}
        </>
      )}

      {rationale?.missing_info && rationale.missing_info.length > 0 && (
        <div>
          <p className="text-sm font-medium text-yellow-600">Information gaps</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {rationale.missing_info.map((item, i) => (
              <li key={i} className="text-sm text-muted-foreground">{item}</li>
            ))}
          </ul>
        </div>
      )}

      {Object.keys(passageGroups).length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Supporting source passages</p>
          {Object.entries(passageGroups).map(([lbl, ps]) => (
            <PassageGroup
              key={lbl}
              label={SOURCE_LABEL[lbl] ?? lbl}
              passages={ps}
              defaultOpen={isEngineer && lbl === "system_docs"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retrieval knobs advanced panel
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
// Compare panel
// ---------------------------------------------------------------------------

function ComparePanel({ runA, runB }: { runA: TestBedRunResult; runB: TestBedRunResult }) {
  const fields: Array<{ label: string; a: string; b: string }> = [
    { label: "Tier", a: runA.tier, b: runB.tier },
    {
      label: "Confidence",
      a: runA.confidence != null ? `${Math.round(runA.confidence * 100)}%` : "—",
      b: runB.confidence != null ? `${Math.round(runB.confidence * 100)}%` : "—",
    },
    { label: "Role", a: runA.role, b: runB.role },
    {
      label: "Sources",
      a: Object.entries(runA.enabled_sources).filter(([, v]) => v).map(([k]) => SOURCE_LABEL[k] ?? k).join(", ") || "none",
      b: Object.entries(runB.enabled_sources).filter(([, v]) => v).map(([k]) => SOURCE_LABEL[k] ?? k).join(", ") || "none",
    },
    {
      label: "Retrieval mode",
      a: runA.retrieval_knobs?.mode ?? "—",
      b: runB.retrieval_knobs?.mode ?? "—",
    },
    {
      label: "Passages (k)",
      a: runA.retrieval_knobs?.k != null ? String(runA.retrieval_knobs.k) : "—",
      b: runB.retrieval_knobs?.k != null ? String(runB.retrieval_knobs.k) : "—",
    },
    {
      label: "Flags",
      a: String(runA.rationale?.flags?.length ?? 0),
      b: String(runB.rationale?.flags?.length ?? 0),
    },
    {
      label: "Obligations",
      a: String(runA.obligations.length),
      b: String(runB.obligations.length),
    },
    { label: "Run ID", a: runA.run_id, b: runB.run_id },
    {
      label: "Created",
      a: new Date(runA.created_at).toLocaleString(),
      b: new Date(runB.created_at).toLocaleString(),
    },
  ];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Field</TableHead>
          <TableHead>Run A</TableHead>
          <TableHead>Run B</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {fields.map(({ label, a, b }) => (
          <TableRow key={label}>
            <TableCell className="font-medium">{label}</TableCell>
            <TableCell className={a !== b ? "font-semibold" : ""}>
              {label === "Tier" ? <TierBadge tier={a} /> : a}
            </TableCell>
            <TableCell className={a !== b ? "font-semibold" : ""}>
              {label === "Tier" ? <TierBadge tier={b} /> : b}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Main TestBed component
// ---------------------------------------------------------------------------

export function TestBed({ mayWrite }: { mayWrite: boolean }) {
  const [samples, setSamples] = useState<TestBedSample[]>([]);
  const [samplesError, setSamplesError] = useState<string | null>(null);
  const [selectedSample, setSelectedSample] = useState("");
  const [sampleDetail, setSampleDetail] = useState<TestBedSampleDetail | null>(null);
  const [sampleDetailLoading, setSampleDetailLoading] = useState(false);

  const [role, setRole] = useState<TestBedRole>("engineer");
  const [sources, setSources] = useState<TestBedEnabledSources>({
    system_docs: false,
    eu_ai_act: false,
    cognee: false,
  });
  const [knobs, setKnobs] = useState<RetrievalKnobs>({ ...RECOMMENDED_KNOBS });
  const [showKnobs, setShowKnobs] = useState(false);
  const [promptOverride, setPromptOverride] = useState("");
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<TestBedRunResult | null>(null);

  const [runs, setRuns] = useState<TestBedRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [runADetail, setRunADetail] = useState<TestBedRunResult | null>(null);
  const [runBDetail, setRunBDetail] = useState<TestBedRunResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  // Load sample list once
  useEffect(() => {
    api
      .listTestBedSamples()
      .then(setSamples)
      .catch((e) => setSamplesError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Load full sample detail when selection changes
  useEffect(() => {
    if (!selectedSample) {
      setSampleDetail(null);
      return;
    }
    setSampleDetailLoading(true);
    setSampleDetail(null);
    api
      .getTestBedSample(selectedSample)
      .then(setSampleDetail)
      .catch(() => setSampleDetail(null))
      .finally(() => setSampleDetailLoading(false));
  }, [selectedSample]);

  const loadRuns = async (sampleId?: string) => {
    setRunsLoading(true);
    try {
      setRuns(await api.listTestBedRuns(sampleId || undefined));
    } finally {
      setRunsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedSample) void loadRuns(selectedSample);
  }, [selectedSample]);

  async function onRun() {
    if (!selectedSample) return;
    setRunning(true);
    setRunError(null);
    setLastResult(null);
    try {
      const result = await api.runTestBed({
        sample_id: selectedSample,
        role,
        enabled_sources: sources,
        prompt_override: promptOverride || null,
        retrieval_k: knobs.k,
        retrieval_mode: knobs.mode,
        retrieval_rrf_k: knobs.rrf_k,
      });
      setLastResult(result);
      await loadRuns(selectedSample);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function onCompare() {
    if (!compareA || !compareB) return;
    setCompareLoading(true);
    setCompareError(null);
    setRunADetail(null);
    setRunBDetail(null);
    try {
      const [a, b] = await Promise.all([
        api.getTestBedRun(compareA),
        api.getTestBedRun(compareB),
      ]);
      setRunADetail(a);
      setRunBDetail(b);
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompareLoading(false);
    }
  }

  const knobsCustomised =
    knobs.k !== RECOMMENDED_KNOBS.k ||
    knobs.mode !== RECOMMENDED_KNOBS.mode ||
    knobs.rrf_k !== RECOMMENDED_KNOBS.rrf_k;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-5">

      {/* ------------------------------------------------------------------ */}
      {/* 1. Sample selector + scenario details                               */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-4" />
            Scenario
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {samplesError && (
            <div className="flex items-center gap-2 text-[13px] text-destructive">
              <AlertCircle className="size-4" />
              {samplesError}
            </div>
          )}

          <div>
            <Label htmlFor="sample-select">Sample system</Label>
            <Select value={selectedSample} onValueChange={setSelectedSample}>
              <SelectTrigger id="sample-select">
                <SelectValue placeholder="Select a sample…" />
              </SelectTrigger>
              <SelectContent>
                {samples.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    {s.expected_tier && (
                      <span className="ml-1.5 text-muted-foreground">
                        (expected: {TIER_LABEL[s.expected_tier] ?? s.expected_tier})
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {sampleDetailLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading scenario details…
            </div>
          )}

          {sampleDetail && !sampleDetailLoading && (
            <ScenarioPanel detail={sampleDetail} />
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* 2. System documents corpus (linked to the sample's AI system)       */}
      {/* ------------------------------------------------------------------ */}
      {sampleDetail?.ai_system_id && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4" />
              System documents
              <span className="text-xs font-normal text-muted-foreground">
                ({sampleDetail.ai_system_id})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Documents indexed for this sample system. Enable the{" "}
              <strong>System documents</strong> source toggle below to inject retrieved
              passages into the classification prompt. Upload your own documents to
              replace or extend the seeded sample card.
            </p>
            <DocPanel
              systemId={sampleDetail.ai_system_id}
              mayWrite={mayWrite}
              emptyHint="No documents seeded yet — the testbed-seed job may still be running, or the document-indexing-worker is indexing the sample card."
            />
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 3. EU AI Act corpus (sentinel __eu_ai_act__)                        */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-4" />
            EU AI Act corpus
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Upload EU AI Act PDFs (or other regulatory text) here. Enable the{" "}
            <strong>EU AI Act</strong> source toggle to inject relevant article passages
            into the classification prompt. The corpus is shared across all samples.
          </p>
          <DocPanel
            systemId="__eu_ai_act__"
            mayWrite={mayWrite}
            emptyHint="No EU AI Act documents uploaded yet. Upload the EU AI Act PDF to enable article-level retrieval context."
          />
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* 4. Run configuration                                               */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="size-4" />
            Configure run
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">

          {/* Role selector */}
          <div>
            <Label htmlFor="role-select">Role perspective</Label>
            <Select value={role} onValueChange={(v) => setRole(v as TestBedRole)}>
              <SelectTrigger id="role-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="engineer">
                  <div className="flex items-center gap-2">
                    <Wrench className="size-3.5" />
                    AI Engineer — focus on technical flags &amp; risk drivers
                  </div>
                </SelectItem>
                <SelectItem value="compliance_officer">
                  <div className="flex items-center gap-2">
                    <Scale className="size-3.5" />
                    Compliance Officer — focus on obligations &amp; legal reasoning
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              {role === "engineer"
                ? "Prompt framing emphasises technical flag evidence, confidence, and data/model characteristics."
                : "Prompt framing emphasises applicable obligations, org_role determination, and legal exposure gaps."}
            </p>
          </div>

          {/* Knowledge source toggles */}
          <div className="flex flex-col gap-2">
            <Label>Knowledge sources</Label>
            <div className="flex flex-wrap gap-6">
              {(["system_docs", "eu_ai_act", "cognee"] as const).map((key) => {
                const disabled = key === "cognee";
                return (
                  <div key={key} className="flex items-center gap-2">
                    <Switch
                      id={`src-${key}`}
                      checked={sources[key]}
                      disabled={disabled}
                      onCheckedChange={(v) => setSources((s) => ({ ...s, [key]: v }))}
                    />
                    <Label
                      htmlFor={`src-${key}`}
                      className={`cursor-pointer${disabled ? " opacity-50" : ""}`}
                    >
                      {SOURCE_LABEL[key]}
                      {disabled && (
                        <Badge variant="outline" className="ml-1.5 text-[10px]">stub</Badge>
                      )}
                    </Label>
                  </div>
                );
              })}
            </div>
            {sources.system_docs && !sampleDetail?.ai_system_id && (
              <p className="text-[12px] text-yellow-600">
                This sample has no linked AI system — system-document retrieval will return no passages.
              </p>
            )}
          </div>

          {/* Retrieval knobs */}
          <div>
            <button
              type="button"
              onClick={() => setShowKnobs((v) => !v)}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              {showKnobs ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              Retrieval settings
              {knobsCustomised && (
                <Badge variant="secondary" className="ml-1 text-[10px]">custom</Badge>
              )}
            </button>
            {showKnobs && (
              <div className="mt-2">
                <RetrievalKnobsPanel knobs={knobs} onChange={setKnobs} />
              </div>
            )}
          </div>

          {/* Prompt override */}
          <div>
            <button
              type="button"
              onClick={() => setShowPromptEditor((v) => !v)}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              {showPromptEditor ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              Prompt override
              {promptOverride && (
                <Badge variant="secondary" className="ml-1 text-[10px]">active</Badge>
              )}
            </button>
            {showPromptEditor && (
              <div className="mt-2">
                <Textarea
                  className="min-h-[120px] font-mono text-xs"
                  placeholder="Leave blank to use the default classify_questionnaire prompt (with role framing). Enter a custom system prompt to override it entirely — role framing will not apply."
                  value={promptOverride}
                  onChange={(e) => setPromptOverride(e.target.value)}
                />
              </div>
            )}
          </div>

          {runError && <p className="text-[13px] text-destructive">{runError}</p>}

          <div className="flex items-center gap-3">
            <Button
              onClick={onRun}
              disabled={!selectedSample || running}
              className="w-32"
            >
              {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              <span className="ml-2">{running ? "Running…" : "Run"}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* 5. Latest result                                                    */}
      {/* ------------------------------------------------------------------ */}
      {lastResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Result
              <Badge variant="outline" className="ml-1 text-[11px]">
                {lastResult.role === "compliance_officer" ? "Compliance Officer view" : "AI Engineer view"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResultPanel result={lastResult} />
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 6. Run history                                                      */}
      {/* ------------------------------------------------------------------ */}
      {selectedSample && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Run history</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadRuns(selectedSample)}
              title="Refresh"
            >
              <RefreshCw className="size-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {runsLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet for this sample.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run ID</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Sources</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.run_id}>
                      <TableCell className="font-mono text-xs">{r.run_id}</TableCell>
                      <TableCell className="text-xs capitalize">{r.role.replace("_", " ")}</TableCell>
                      <TableCell>
                        {r.tier ? <TierBadge tier={r.tier} /> : "—"}
                      </TableCell>
                      <TableCell>
                        {r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {Object.entries(r.enabled_sources)
                          .filter(([, v]) => v)
                          .map(([k]) => SOURCE_LABEL[k] ?? k)
                          .join(", ") || "none"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 7. Two-run comparison                                               */}
      {/* ------------------------------------------------------------------ */}
      {runs.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Compare two runs</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="compareA">Run A</Label>
                <Select value={compareA} onValueChange={setCompareA}>
                  <SelectTrigger id="compareA">
                    <SelectValue placeholder="Select run A…" />
                  </SelectTrigger>
                  <SelectContent>
                    {runs.map((r) => (
                      <SelectItem key={r.run_id} value={r.run_id}>
                        {r.run_id} — {r.tier ?? "?"}{" "}
                        {new Date(r.created_at).toLocaleTimeString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="compareB">Run B</Label>
                <Select value={compareB} onValueChange={setCompareB}>
                  <SelectTrigger id="compareB">
                    <SelectValue placeholder="Select run B…" />
                  </SelectTrigger>
                  <SelectContent>
                    {runs.map((r) => (
                      <SelectItem key={r.run_id} value={r.run_id}>
                        {r.run_id} — {r.tier ?? "?"}{" "}
                        {new Date(r.created_at).toLocaleTimeString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              onClick={onCompare}
              disabled={!compareA || !compareB || compareA === compareB || compareLoading}
              className="w-32"
            >
              {compareLoading ? <Loader2 className="size-4 animate-spin" /> : "Compare"}
            </Button>
            {compareError && (
              <p className="text-[13px] text-destructive">{compareError}</p>
            )}
            {runADetail && runBDetail && (
              <ComparePanel runA={runADetail} runB={runBDetail} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
