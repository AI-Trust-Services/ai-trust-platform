/**
 * NotesTab — Displays and manages notes attached to an AI system.
 */

import { useState, useEffect, useCallback } from "react";
import { StickyNote, RotateCw, Plus, Trash2, User, Edit2, Check, X } from "lucide-react";
import { api } from "../api/client";
import type { SystemNote } from "../types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface NotesTabProps {
  systemId: string;
  systemName: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotesTab({ systemId, systemName }: NotesTabProps) {
  const [notes, setNotes] = useState<SystemNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.systemNotes.list(systemId);
      setNotes(data);
    } catch (e) {
      console.error("Failed to load notes:", e);
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!newNote.trim()) return;
    setCreating(true);
    try {
      const note = await api.systemNotes.create(systemId, { content: newNote.trim() });
      setNotes((prev) => [note, ...prev]);
      setNewNote("");
    } catch (e) {
      console.error("Failed to create note:", e);
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdate(noteId: string) {
    if (!editContent.trim()) return;
    try {
      const updated = await api.systemNotes.update(systemId, noteId, { content: editContent.trim() });
      setNotes((prev) => prev.map((n) => n.id === noteId ? updated : n));
      setEditingId(null);
      setEditContent("");
    } catch (e) {
      console.error("Failed to update note:", e);
    }
  }

  async function handleDelete(noteId: string) {
    if (!confirm("Delete this note?")) return;
    try {
      await api.systemNotes.delete(systemId, noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (e) {
      console.error("Failed to delete note:", e);
    }
  }

  function startEdit(note: SystemNote) {
    setEditingId(note.id);
    setEditContent(note.content);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditContent("");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RotateCw className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Notes</h2>
          <p className="text-sm text-muted-foreground">Notes and comments for {systemName}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RotateCw className="mr-2 size-4" /> Refresh
        </Button>
      </div>

      {/* New note input */}
      <Card className="p-4">
        <Textarea
          placeholder="Add a note..."
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          className="min-h-[80px] resize-none"
        />
        <div className="mt-3 flex justify-end">
          <Button onClick={handleCreate} disabled={!newNote.trim() || creating}>
            <Plus className="mr-2 size-4" />
            {creating ? "Adding..." : "Add Note"}
          </Button>
        </div>
      </Card>

      {/* Notes list */}
      {notes.length === 0 ? (
        <Card className="p-8 text-center">
          <StickyNote className="mx-auto mb-4 size-12 text-muted-foreground/50" />
          <p className="font-medium">No notes yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add notes to keep track of important information about this system.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <Card key={note.id} className="p-4">
              {editingId === note.id ? (
                // Edit mode
                <div>
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="min-h-[80px] resize-none"
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={cancelEdit}>
                      <X className="mr-1 size-4" /> Cancel
                    </Button>
                    <Button size="sm" onClick={() => handleUpdate(note.id)} disabled={!editContent.trim()}>
                      <Check className="mr-1 size-4" /> Save
                    </Button>
                  </div>
                </div>
              ) : (
                // View mode
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <p className="whitespace-pre-wrap text-sm">{note.content}</p>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" className="size-8 p-0" onClick={() => startEdit(note)}>
                        <Edit2 className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(note.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <User className="size-3" />
                      <span>{note.author_username}</span>
                    </div>
                    <span>•</span>
                    <span title={`${formatDate(note.created_at)} ${formatTime(note.created_at)}`}>
                      {formatDate(note.created_at)}
                    </span>
                    {note.updated_at !== note.created_at && (
                      <>
                        <span>•</span>
                        <span className="italic">edited</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
