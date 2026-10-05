import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { DocumentStatus, IndexingStatus, RetrievedPassage } from "../types";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
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

export function DocumentIndexing({ mayWrite }: { mayWrite: boolean }) {
  const [systemId, setSystemId] = useState("");
  const [loadedSystem, setLoadedSystem] = useState("");
  const [documents, setDocuments] = useState<DocumentStatus[]>([]);
  const [docError, setDocError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [k, setK] = useState(10);
  const [results, setResults] = useState<RetrievedPassage[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const loadDocuments = useCallback(async (id: string) => {
    if (!id) return;
    try {
      setDocuments(await api.listDocuments(id));
      setDocError(null);
    } catch (e) {
      setDocError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  function onLoadSystem() {
    const id = systemId.trim();
    setLoadedSystem(id);
    setResults(null);
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
      setResults(await api.retrieve(loadedSystem, query.trim(), k));
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-5">
      {/* AI system selector */}
      <Card>
        <CardHeader>
          <CardTitle>AI system</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="flex-1">
            <Label htmlFor="system-id">AI system ID</Label>
            <Input
              id="system-id"
              placeholder="SYS-XXXXXXXX"
              value={systemId}
              onChange={(e) => setSystemId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onLoadSystem()}
            />
          </div>
          <Button onClick={onLoadSystem} disabled={!systemId.trim()}>
            Load
          </Button>
        </CardContent>
      </Card>

      {loadedSystem && (
        <>
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
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Chunks</TableHead>
                    {mayWrite && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={mayWrite ? 4 : 3} className="text-center text-muted-foreground">
                        No documents yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    documents.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.filename}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[d.status]}>{d.status}</Badge>
                          {d.status === "failed" && d.error && (
                            <span className="ml-2 text-xs text-destructive">{d.error}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{d.chunk_count}</TableCell>
                        {mayWrite && (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => void onDelete(d.id)}
                              title="Delete"
                            >
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </TableCell>
                        )}
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
              {searchError && <p className="text-[13px] text-destructive">{searchError}</p>}

              {results !== null && (
                <div className="flex flex-col gap-3">
                  {results.length === 0 ? (
                    <p className="text-muted-foreground">No passages found.</p>
                  ) : (
                    results.map((r) => (
                      <div key={r.chunk_id} className="rounded-lg border border-border p-3">
                        <p className="whitespace-pre-wrap text-sm">{r.passage}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{r.source.filename}</span>
                          {r.source.page != null && <span>p. {r.source.page}</span>}
                          {r.source.heading_path && r.source.heading_path.length > 0 && (
                            <span>{r.source.heading_path.join(" › ")}</span>
                          )}
                          <span className="ml-auto tabular-nums">score {r.score.toFixed(3)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
