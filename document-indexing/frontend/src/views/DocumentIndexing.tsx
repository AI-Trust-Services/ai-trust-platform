import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileUp,
  History,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "../api/client";
import { registryApi } from "../api/registryClient";
import type {
  AISystem,
  DocumentStatus,
  IndexingStatus,
  RetrieveMode,
  RetrievedPassage,
  VersionInfo,
} from "../types";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

const STATUS_VARIANT: Record<IndexingStatus, "default" | "secondary" | "outline" | "destructive"> = {
  indexed: "default",
  processing: "secondary",
  pending: "outline",
  failed: "destructive",
};

const ACTIVE: IndexingStatus[] = ["pending", "processing"];

// Validated defaults (Phase-1 harness): hybrid fusion, RRF k=60, top 10. The advanced
// panel starts here and offers a one-click reset so a tweaked config can't quietly
// become someone's "the retrieval is bad" baseline.
const RECOMMENDED = { mode: "hybrid" as RetrieveMode, rrfK: 60, k: 10 };

const MODE_LABEL: Record<RetrieveMode, string> = {
  hybrid: "Hybrid (dense + FTS)",
  dense: "Dense only",
  fts: "Keyword (FTS) only",
};

// Fine-grained phase → step position for the progress hint (5 phases total).
const STAGE_STEP: Record<string, string> = {
  parsing: "2/5",
  embedding: "3/5",
  storing: "4/5",
};

function progressHint(d: DocumentStatus): string | null {
  if (d.status === "pending") return "queued (1/5)";
  if (d.status === "processing" && d.stage) return `${d.stage} (${STAGE_STEP[d.stage] ?? ""})`;
  if (d.status === "processing") return "processing…";
  return null;
}

export function DocumentIndexing({ mayWrite }: { mayWrite: boolean }) {
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [systemsError, setSystemsError] = useState<string | null>(null);
  const [loadedSystem, setLoadedSystem] = useState("");
  const [documents, setDocuments] = useState<DocumentStatus[]>([]);
  const [docError, setDocError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Per-row "upload new version" via one hidden input retargeted on click.
  const versionInput = useRef<HTMLInputElement>(null);
  const [versionDocId, setVersionDocId] = useState<string | null>(null);

  const [historyDoc, setHistoryDoc] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);

  const [query, setQuery] = useState("");
  const [k, setK] = useState(RECOMMENDED.k);
  const [mode, setMode] = useState<RetrieveMode>(RECOMMENDED.mode);
  const [rrfK, setRrfK] = useState(RECOMMENDED.rrfK);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [results, setResults] = useState<RetrievedPassage[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const atRecommended = mode === RECOMMENDED.mode && rrfK === RECOMMENDED.rrfK && k === RECOMMENDED.k;
  function resetRetrieval() {
    setMode(RECOMMENDED.mode);
    setRrfK(RECOMMENDED.rrfK);
    setK(RECOMMENDED.k);
  }

  // Load the AI-system list for the selector (registry backend).
  useEffect(() => {
    registryApi
      .getSystems()
      .then((s) => setSystems(s.filter((x) => x.lifecycle !== "decommissioned")))
      .catch((e) => setSystemsError(e instanceof Error ? e.message : String(e)));
  }, []);

  const loadDocuments = useCallback(async (id: string) => {
    if (!id) return;
    try {
      setDocuments(await api.listDocuments(id));
      setDocError(null);
    } catch (e) {
      setDocError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  function onSelectSystem(id: string) {
    setLoadedSystem(id);
    setResults(null);
    setDocuments([]);
    void loadDocuments(id);
  }

  // Poll while any document is still pending/processing (indexing runs async).
  useEffect(() => {
    if (!loadedSystem) return;
    const hasActive = documents.some((d) => ACTIVE.includes(d.status));
    if (!hasActive) return;
    const t = setInterval(() => void loadDocuments(loadedSystem), 3000);
    return () => clearInterval(t);
  }, [loadedSystem, documents, loadDocuments]);

  async function onUpload() {
    if (!file || !loadedSystem) return;
    setUploading(true);
    setUploadError(null);
    try {
      await api.uploadDocument(loadedSystem, file);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await loadDocuments(loadedSystem);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  function triggerVersionUpload(docId: string) {
    setVersionDocId(docId);
    versionInput.current?.click();
  }

  async function onVersionSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (versionInput.current) versionInput.current.value = "";
    if (!f || !versionDocId) return;
    setUploadError(null);
    try {
      await api.uploadVersion(versionDocId, f);
      await loadDocuments(loadedSystem);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setVersionDocId(null);
    }
  }

  async function openHistory(docId: string) {
    setHistoryDoc(docId);
    setVersions(null);
    try {
      setVersions(await api.listVersions(docId));
    } catch (e) {
      setDocError(e instanceof Error ? e.message : String(e));
      setHistoryDoc(null);
    }
  }

  async function onDelete(id: string) {
    try {
      await api.deleteDocument(id);
      await loadDocuments(loadedSystem);
    } catch (e) {
      setDocError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onSearch() {
    if (!query.trim() || !loadedSystem) return;
    setSearching(true);
    setSearchError(null);
    try {
      setResults(await api.retrieve(loadedSystem, query.trim(), k, { mode, rrfK }));
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  // Trace a passage back to its source: open the original, jumping to the page for PDFs.
  async function openSource(r: RetrievedPassage) {
    // Open the tab *synchronously*, inside the click's user-activation window. The
    // await below consumes that activation, so a window.open() after the fetch is
    // silently blocked by popup blockers — which is why the link appeared to do
    // nothing. We open a blank tab now and navigate it once the URL resolves.
    const win = window.open("", "_blank");
    if (win) win.opener = null; // sever opener (we dropped noopener to keep the handle)
    try {
      // Open the exact version the passage came from, not whatever is current now —
      // a new version uploaded between search and click would otherwise reopen the
      // wrong original (acceptance criterion: trace back to source).
      const { url } = await api.getDownloadUrl(r.source.document_id, r.source.version_id);
      const isPdf = r.source.filename.toLowerCase().endsWith(".pdf");
      const target = isPdf && r.source.page != null ? `${url}#page=${r.source.page}` : url;
      if (win) {
        win.location.replace(target);
      } else {
        // Popup blocked outright — fall back to navigating the current tab.
        window.location.assign(target);
      }
    } catch (e) {
      win?.close();
      setSearchError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-5">
      {/* AI system selector */}
      <Card>
        <CardHeader>
          <CardTitle>AI system</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="system-select">Select an AI system</Label>
          <Select value={loadedSystem} onValueChange={onSelectSystem}>
            <SelectTrigger id="system-select" className="max-w-md">
              <SelectValue placeholder="Select an AI system…" />
            </SelectTrigger>
            <SelectContent>
              {systems.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({s.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {systemsError && <p className="text-[13px] text-destructive">{systemsError}</p>}
        </CardContent>
      </Card>

      {loadedSystem && (
        <>
          {/* hidden input reused for all per-row "new version" uploads */}
          <input
            ref={versionInput}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.pptx,.md,.markdown,.html,.htm,.txt"
            onChange={onVersionSelected}
          />

          {/* Documents + upload */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Documents</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void loadDocuments(loadedSystem)}
                title="Refresh"
              >
                <RefreshCw className="size-4" />
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {mayWrite && (
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <Label htmlFor="file">Upload a document (PDF, DOCX, PPTX, MD, HTML, TXT)</Label>
                    <Input
                      id="file"
                      type="file"
                      ref={fileInput}
                      accept=".pdf,.docx,.pptx,.md,.markdown,.html,.htm,.txt"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                  <Button onClick={onUpload} disabled={!file || uploading}>
                    {uploading ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
                    <span className="ml-2">Upload</span>
                  </Button>
                </div>
              )}
              {uploadError && <p className="text-[13px] text-destructive">{uploadError}</p>}
              {docError && <p className="text-[13px] text-destructive">{docError}</p>}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead className="w-20">Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Chunks</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No documents yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    documents.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.filename}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {d.version_label}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[d.status]}>{d.status}</Badge>
                          {progressHint(d) && (
                            <span className="ml-2 text-xs text-muted-foreground">{progressHint(d)}</span>
                          )}
                          {d.status === "failed" && d.error && (
                            <span className="ml-2 text-xs text-destructive">{d.error}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{d.chunk_count}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => void openHistory(d.id)}
                              title="Version history"
                            >
                              <History className="size-4" />
                            </Button>
                            {mayWrite && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => triggerVersionUpload(d.id)}
                                  title="Upload new version"
                                >
                                  <Upload className="size-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => void onDelete(d.id)}
                                  title="Delete"
                                >
                                  <Trash2 className="size-4 text-destructive" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Retrieval */}
          <Card>
            <CardHeader>
              <CardTitle>Retrieve passages</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Label htmlFor="query">Query</Label>
                  <Input
                    id="query"
                    placeholder="Ask something about the indexed documents…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && onSearch()}
                  />
                </div>
                <div className="w-20">
                  <Label htmlFor="k">Top k</Label>
                  <Input
                    id="k"
                    type="number"
                    min={1}
                    max={50}
                    value={k}
                    onChange={(e) => setK(Math.min(50, Math.max(1, Number(e.target.value) || 10)))}
                  />
                </div>
                <Button onClick={onSearch} disabled={!query.trim() || searching}>
                  {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  <span className="ml-2">Search</span>
                </Button>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {showAdvanced ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  Advanced
                  {!atRecommended && (
                    <Badge variant="secondary" className="ml-1">custom</Badge>
                  )}
                </button>

                {showAdvanced && (
                  <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="w-56">
                        <Label htmlFor="mode">Retrieval mode</Label>
                        <Select value={mode} onValueChange={(v) => setMode(v as RetrieveMode)}>
                          <SelectTrigger id="mode">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(["hybrid", "dense", "fts"] as RetrieveMode[]).map((m) => (
                              <SelectItem key={m} value={m}>{MODE_LABEL[m]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-28">
                        <Label htmlFor="rrfK">RRF k</Label>
                        <Input
                          id="rrfK"
                          type="number"
                          min={1}
                          max={200}
                          value={rrfK}
                          disabled={mode !== "hybrid"}
                          onChange={(e) =>
                            setRrfK(Math.min(200, Math.max(1, Number(e.target.value) || RECOMMENDED.rrfK)))
                          }
                        />
                      </div>
                      {atRecommended ? (
                        <span className="pb-2 text-xs text-muted-foreground">Recommended settings</span>
                      ) : (
                        <button
                          type="button"
                          onClick={resetRetrieval}
                          className="pb-2 text-xs font-medium text-foreground hover:underline"
                        >
                          Reset to recommended
                        </button>
                      )}
                    </div>
                    {mode !== "hybrid" && (
                      <p className="text-xs text-muted-foreground">
                        Single-channel mode — Hybrid usually returns the best matches. Use this
                        only to inspect one channel in isolation.
                      </p>
                    )}
                  </div>
                )}
              </div>
              {searchError && <p className="text-[13px] text-destructive">{searchError}</p>}

              {results !== null && (
                <div className="flex flex-col gap-3">
                  {results.length === 0 ? (
                    <p className="text-muted-foreground">No passages found.</p>
                  ) : (
                    results.map((r) => (
                      <div key={r.chunk_id} className="rounded-lg border border-border p-3">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
                            #{r.rank}
                          </span>
                          <p className="whitespace-pre-wrap text-sm">{r.passage}</p>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{r.source.filename}</span>
                          <span>v{r.source.version_label}</span>
                          {r.source.page != null && <span>p. {r.source.page}</span>}
                          {r.source.heading_path && r.source.heading_path.length > 0 && (
                            <span>{r.source.heading_path.join(" › ")}</span>
                          )}
                          <button
                            type="button"
                            onClick={() => void openSource(r)}
                            className="ml-auto inline-flex items-center gap-1 text-foreground hover:underline"
                            title="Open source document"
                          >
                            Open source <ExternalLink className="size-3" />
                          </button>
                        </div>
                        {showAdvanced && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {r.dense_rank != null && (
                              <Badge variant="outline" className="font-normal tabular-nums">
                                dense #{r.dense_rank} · {r.dense_score?.toFixed(2)}
                              </Badge>
                            )}
                            {r.fts_rank != null && (
                              <Badge variant="outline" className="font-normal tabular-nums">
                                FTS #{r.fts_rank} · {r.fts_score?.toFixed(3)}
                              </Badge>
                            )}
                            {r.rrf_score != null && (
                              <Badge variant="outline" className="font-normal tabular-nums">
                                RRF {r.rrf_score.toFixed(4)}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Version history */}
      <Dialog open={historyDoc !== null} onOpenChange={(o) => !o && setHistoryDoc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
          </DialogHeader>
          {versions === null ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                  <TableHead>Current</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="tabular-nums">{v.version_label}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[v.status]}>{v.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{v.chunk_count}</TableCell>
                    <TableCell>{v.is_current ? "✓" : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
