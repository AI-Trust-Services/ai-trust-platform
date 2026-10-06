import { useState, useEffect } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
  RefreshCw,
} from "lucide-react";
import { api } from "../api/client";
import type {
  TestBedEnabledSources,
  TestBedRole,
  TestBedRunResult,
  TestBedRunSummary,
  TestBedSample,
} from "../types";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
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
  const color =
    value >= 0.8 ? "bg-green-500" : value >= 0.6 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

function ResultPanel({ result }: { result: TestBedRunResult }) {
  const [showObligs, setShowObligs] = useState(false);
  const [showPassages, setShowPassages] = useState(false);
  const [showFlags, setShowFlags] = useState(false);
  const rationale = result.rationale;

  return (
    <div className="flex flex-col gap-4">
      {/* Tier + confidence */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Risk tier</span>
          <TierBadge tier={result.tier} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Confidence</span>
          <ConfidenceBar value={result.confidence} />
        </div>
      </div>

      {/* Basis */}
      <div>
        <p className="text-sm font-medium">Basis</p>
        <p className="text-sm text-muted-foreground">{result.basis}</p>
      </div>

      {/* Reasoning */}
      {rationale?.reasoning && (
        <div>
          <p className="text-sm font-medium">Reasoning</p>
          <p className="text-sm text-muted-foreground">{rationale.reasoning}</p>
        </div>
      )}

      {/* Missing info */}
      {rationale?.missing_info && rationale.missing_info.length > 0 && (
        <div>
          <p className="text-sm font-medium text-yellow-600">Information gaps</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {rationale.missing_info.map((item, i) => (
              <li key={i} className="text-sm text-muted-foreground">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Obligations toggle */}
      {result.obligations.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowObligs((v) => !v)}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            {showObligs ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            Obligations ({result.obligations.length})
          </button>
          {showObligs && (
            <ul className="mt-2 list-inside list-disc space-y-1">
              {result.obligations.map((o, i) => (
                <li key={i} className="text-sm text-muted-foreground">
                  {o}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Inferred flags toggle */}
      {rationale?.flags && rationale.flags.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowFlags((v) => !v)}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            {showFlags ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            Inferred flags ({rationale.flags.length})
          </button>
          {showFlags && (
            <div className="mt-2 flex flex-col gap-1.5">
              {rationale.flags.map((f, i) => (
                <div key={i} className="rounded border border-border p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{f.flag}</span>
                    <Badge variant="outline" className="tabular-nums">
                      {String(f.value)}
                    </Badge>
                    {f.confidence != null && (
                      <span className="text-xs text-muted-foreground">
                        {Math.round(f.confidence * 100)}% conf.
                      </span>
                    )}
                  </div>
                  {f.rationale && (
                    <p className="mt-1 text-muted-foreground">{f.rationale}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Source passages toggle */}
      {result.source_passages.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowPassages((v) => !v)}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            {showPassages ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            Source passages ({result.source_passages.length})
          </button>
          {showPassages && (
            <div className="mt-2 flex flex-col gap-2">
              {result.source_passages.map((p, i) => (
                <div key={i} className="rounded-lg border border-border p-3 text-sm">
                  <p className="whitespace-pre-wrap">{p.passage}</p>
                  <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{p.source.filename}</span>
                    <span>v{p.source.version_label}</span>
                    {p.source.page != null && <span>p. {p.source.page}</span>}
                    {p._source_label && (
                      <Badge variant="outline" className="font-normal">
                        {p._source_label}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ComparePanel({
  runA,
  runB,
}: {
  runA: TestBedRunResult;
  runB: TestBedRunResult;
}) {
  const fields: Array<{ label: string; a: string; b: string }> = [
    { label: "Tier", a: runA.tier, b: runB.tier },
    {
      label: "Confidence",
      a: runA.confidence != null ? `${Math.round(runA.confidence * 100)}%` : "—",
      b: runB.confidence != null ? `${Math.round(runB.confidence * 100)}%` : "—",
    },
    {
      label: "Sources",
      a: Object.entries(runA.enabled_sources)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(", ") || "none",
      b: Object.entries(runB.enabled_sources)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(", ") || "none",
    },
    { label: "Role", a: runA.role, b: runB.role },
    {
      label: "Flags",
      a: String(runA.rationale?.flags?.length ?? 0),
      b: String(runB.rationale?.flags?.length ?? 0),
    },
    { label: "Run ID", a: runA.run_id, b: runB.run_id },
    { label: "Created", a: new Date(runA.created_at).toLocaleString(), b: new Date(runB.created_at).toLocaleString() },
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

export function TestBed({ mayWrite }: { mayWrite: boolean }) {
  const [samples, setSamples] = useState<TestBedSample[]>([]);
  const [samplesError, setSamplesError] = useState<string | null>(null);
  const [selectedSample, setSelectedSample] = useState("");
  const [role, setRole] = useState<TestBedRole>("engineer");
  const [sources, setSources] = useState<TestBedEnabledSources>({
    system_docs: false,
    eu_ai_act: false,
    cognee: false,
  });
  const [promptOverride, setPromptOverride] = useState("");
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<TestBedRunResult | null>(null);

  const [runs, setRuns] = useState<TestBedRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  // Comparison
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [runADetail, setRunADetail] = useState<TestBedRunResult | null>(null);
  const [runBDetail, setRunBDetail] = useState<TestBedRunResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listTestBedSamples()
      .then(setSamples)
      .catch((e) => setSamplesError(e instanceof Error ? e.message : String(e)));
  }, []);

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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-5">
      {/* Sample + run configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Configure run</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {samplesError && (
            <div className="flex items-center gap-2 text-[13px] text-destructive">
              <AlertCircle className="size-4" />
              {samplesError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="sample-select">Sample</Label>
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
                          (expected: {s.expected_tier})
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="role-select">Role perspective</Label>
              <Select value={role} onValueChange={(v) => setRole(v as TestBedRole)}>
                <SelectTrigger id="role-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="engineer">AI Engineer</SelectItem>
                  <SelectItem value="compliance_officer">Compliance Officer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Source toggles */}
          <div className="flex flex-col gap-2">
            <Label>Knowledge sources</Label>
            <div className="flex flex-wrap gap-6">
              {(["system_docs", "eu_ai_act", "cognee"] as const).map((key) => {
                const labels: Record<string, string> = {
                  system_docs: "System documents",
                  eu_ai_act: "EU AI Act",
                  cognee: "Cognee (stub)",
                };
                return (
                  <div key={key} className="flex items-center gap-2">
                    <Switch
                      id={`src-${key}`}
                      checked={sources[key]}
                      onCheckedChange={(v) => setSources((s) => ({ ...s, [key]: v }))}
                    />
                    <Label htmlFor={`src-${key}`} className="cursor-pointer">
                      {labels[key]}
                    </Label>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Prompt override editor */}
          <div>
            <button
              type="button"
              onClick={() => setShowPromptEditor((v) => !v)}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              {showPromptEditor ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              Prompt override
              {promptOverride && (
                <Badge variant="secondary" className="ml-1">
                  active
                </Badge>
              )}
            </button>
            {showPromptEditor && (
              <div className="mt-2">
                <Textarea
                  className="min-h-[120px] font-mono text-xs"
                  placeholder="Leave blank to use the default classify_questionnaire prompt. Enter a custom system prompt to override it entirely."
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
              disabled={!selectedSample || running || !mayWrite}
              className="w-32"
            >
              {running ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              <span className="ml-2">{running ? "Running…" : "Run"}</span>
            </Button>
            {!mayWrite && (
              <span className="text-xs text-muted-foreground">
                systems:write required to run
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Latest result */}
      {lastResult && (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent>
            <ResultPanel result={lastResult} />
          </CardContent>
        </Card>
      )}

      {/* Run history */}
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
                      <TableCell className="capitalize">{r.role.replace("_", " ")}</TableCell>
                      <TableCell>
                        {r.tier ? <TierBadge tier={r.tier} /> : "—"}
                      </TableCell>
                      <TableCell>
                        {r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {Object.entries(r.enabled_sources)
                          .filter(([, v]) => v)
                          .map(([k]) => k)
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

      {/* Two-run comparison */}
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
              {compareLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Compare"
              )}
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
