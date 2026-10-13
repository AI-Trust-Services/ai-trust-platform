import { useState, useRef } from "react";
import { Loader2, X } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../App";
import type { AISystemImportResult } from "../types";
import { SELECT_CLASS } from "../utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  canApprove: boolean;
}

export default function BatchImportModal({ open, onClose, onSuccess, canApprove }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [targetStatus, setTargetStatus] = useState("draft");
  const [result, setResult] = useState<AISystemImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const showToast = useToast();

  function reset() {
    setFile(null);
    setTargetStatus("draft");
    setResult(null);
    submitting.current = false;
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!file) { showToast("Please select a JSON file", true); return; }
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      const r = await api.importSystems(file, targetStatus);
      setResult(r);
      onSuccess();
    } catch (e) {
      showToast(`Import failed: ${(e as Error).message}`, true);
      submitting.current = false;
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent showCloseButton={false} className="flex max-h-[90vh] max-w-xl flex-col gap-0 p-0">
        <DialogHeader className="flex-row items-center justify-between space-y-0">
          <DialogTitle>Batch Import AI Systems</DialogTitle>
          <button onClick={handleClose} className="text-muted-foreground transition-opacity hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
          {!result ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bi_file">JSON file <span className="text-[var(--danger-fg)]">*</span></Label>
                <input ref={fileRef} id="bi_file" type="file" accept=".json" className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <div className="flex items-center gap-2">
                  <Button variant="outline" type="button" onClick={() => fileRef.current?.click()}>
                    {file ? "Change file" : "Choose file"}
                  </Button>
                  {file && <span className="text-sm text-muted-foreground truncate max-w-[220px]">{file.name}</span>}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bi_status">Target status</Label>
                <select id="bi_status" className={SELECT_CLASS} value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value)}>
                  <option value="draft">Draft</option>
                  {canApprove && <option value="approved">Approved</option>}
                </select>
                <p className="text-xs text-muted-foreground">
                  Records without a tier always land as <em>draft</em> regardless of this setting.
                </p>
              </div>
            </>
          ) : (
            <ImportReport result={result} />
          )}
        </div>

        <DialogFooter className="sm:justify-start">
          {!result ? (
            <>
              <Button onClick={handleSubmit} disabled={loading}>
                {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                Import
              </Button>
              <Button variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
            </>
          ) : (
            <Button onClick={handleClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportReport({ result }: { result: AISystemImportResult }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">
        {result.imported} system{result.imported !== 1 ? "s" : ""} imported
        {result.failed.length > 0 && `, ${result.failed.length} failed`}
      </p>
      {result.failed.length > 0 && (
        <div className="flex flex-col gap-1">
          {result.failed.map((f) => (
            <div key={f.index} className="rounded border border-[var(--danger-fg)]/30 bg-[var(--danger-fg)]/5 px-3 py-2 text-sm">
              <span className="font-medium text-[var(--danger-fg)]">
                #{f.index}{f.name ? ` · ${f.name}` : ""} (invalid)
              </span>
              <p className="mt-0.5 text-muted-foreground">{f.error}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
