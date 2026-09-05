/**
 * ReviewPanel — Floating panel for POC feedback collection.
 *
 * Shows a floating button when review mode is active. Clicking it opens a
 * slide-in panel where users can add/manage notes for the current page.
 */

import { useState } from "react";
import { MessageSquarePlus, X, Check, XCircle, CheckCircle, Trash2, Download, LogOut } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useReviewMode } from "@/hooks/useReviewMode";
import { api } from "@/api/client";
import type { ReviewNote, ReviewNoteStatus } from "@/types";

const STATUS_CONFIG: Record<ReviewNoteStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "Pending", color: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: null },
  confirmed: { label: "Confirmed", color: "bg-green-100 text-green-800 border-green-200", icon: <Check className="size-3" /> },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-800 border-red-200", icon: <X className="size-3" /> },
  done: { label: "Done", color: "bg-blue-100 text-blue-800 border-blue-200", icon: <CheckCircle className="size-3" /> },
};

function NoteCard({ note, onUpdate, onDelete }: {
  note: ReviewNote;
  onUpdate: (id: string, data: { status: ReviewNoteStatus }) => void;
  onDelete: (id: string) => void;
}) {
  const config = STATUS_CONFIG[note.status];
  const date = new Date(note.created_at).toLocaleString();

  return (
    <div className="rounded-lg border bg-card p-3 text-card-foreground shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <Badge variant="outline" className={cn("text-xs", config.color)}>
          {config.icon}
          <span className="ml-1">{config.label}</span>
        </Badge>
        <span className="text-xs text-muted-foreground">{date}</span>
      </div>

      <p className="mb-3 whitespace-pre-wrap text-sm">{note.content}</p>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">by {note.author_username}</span>
        <div className="flex gap-1">
          {note.status === "pending" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-green-600 hover:bg-green-50 hover:text-green-700"
                onClick={() => onUpdate(note.id, { status: "confirmed" })}
                title="Confirm"
              >
                <Check className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={() => onUpdate(note.id, { status: "rejected" })}
                title="Reject"
              >
                <XCircle className="size-4" />
              </Button>
            </>
          )}
          {(note.status === "confirmed" || note.status === "pending") && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
              onClick={() => onUpdate(note.id, { status: "done" })}
              title="Mark as done"
            >
              <CheckCircle className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onDelete(note.id)}
            title="Delete"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ReviewPanel() {
  const {
    enabled,
    setEnabled,
    currentPagePath,
    notes,
    currentPageNotes,
    loading,
    addNote,
    updateNote,
    deleteNote,
  } = useReviewMode();

  const [open, setOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!enabled) return null;

  const handleSubmit = async () => {
    if (!newNote.trim()) return;
    setSubmitting(true);
    const result = await addNote(newNote.trim());
    if (result) {
      setNewNote("");
    }
    setSubmitting(false);
  };

  const handleUpdate = async (id: string, data: { status: ReviewNoteStatus }) => {
    await updateNote(id, data);
  };

  const handleDelete = async (id: string) => {
    await deleteNote(id);
  };

  const handleExport = () => {
    window.open(api.reviewNotes.exportUrl(), "_blank");
  };

  const handleExit = () => {
    setEnabled(false);
    setOpen(false);
    // Reload to fully clear review mode UI
    window.location.reload();
  };

  // Count notes by status
  const pendingCount = notes.filter((n) => n.status === "pending").length;
  const totalCount = notes.length;

  return (
    <>
      {/* Floating button - moves left when panel is open to avoid overlap */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 z-[1999] flex items-center gap-2 rounded-full px-4 py-3 font-medium shadow-lg transition-all hover:scale-105",
          open ? "right-[420px]" : "right-6",
          pendingCount > 0
            ? "bg-yellow-500 text-white hover:bg-yellow-600"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
      >
        <MessageSquarePlus className="size-5" />
        <span>Review</span>
        {totalCount > 0 && (
          <Badge variant="secondary" className="ml-1 bg-white/20 text-inherit">
            {pendingCount > 0 ? `${pendingCount} pending` : totalCount}
          </Badge>
        )}
      </button>

      {/* Slide-in panel */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-[400px] flex-col p-6 sm:max-w-[400px]">
          <SheetHeader className="border-b pb-4 -mx-6 px-6">
            <SheetTitle className="flex items-center gap-2">
              <MessageSquarePlus className="size-5" />
              Review Notes
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-auto -mx-6 px-6 py-4">
            {/* Current page info */}
            <div className="mb-4 rounded-lg bg-muted/50 p-3">
              <div className="mb-1 text-xs font-medium text-muted-foreground">Current page</div>
              <div className="break-all text-sm font-mono">{currentPagePath}</div>
            </div>

            {/* Add new note */}
            <div className="mb-4">
              <Textarea
                placeholder="Add a note about this page..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="mb-2 min-h-[80px] resize-none"
              />
              <Button
                onClick={handleSubmit}
                disabled={!newNote.trim() || submitting}
                className="w-full"
              >
                {submitting ? "Adding..." : "Add Note"}
              </Button>
            </div>

            {/* Notes for current page */}
            <div className="mb-4">
              <h4 className="mb-2 text-sm font-medium">
                Notes on this page ({currentPageNotes.length})
              </h4>
              {loading ? (
                <div className="py-4 text-center text-sm text-muted-foreground">Loading...</div>
              ) : currentPageNotes.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  No notes for this page yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {currentPageNotes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      onUpdate={handleUpdate}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* All notes summary */}
            {notes.length > currentPageNotes.length && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs font-medium text-muted-foreground">All notes summary</div>
                <div className="mt-1 text-sm">
                  {notes.length} total • {pendingCount} pending
                </div>
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="border-t pt-4">
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handleExport}>
                <Download className="mr-2 size-4" />
                Export CSV
              </Button>
              <Button variant="ghost" className="text-muted-foreground" onClick={handleExit}>
                <LogOut className="mr-2 size-4" />
                Exit Review
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
