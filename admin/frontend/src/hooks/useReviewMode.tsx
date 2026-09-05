/**
 * [REVIEW_MODE] -- POC feedback collection feature.
 * DELETE THIS ENTIRE FILE before merging to main.
 *
 * Review Mode Context — hidden POC feedback feature for admin frontend.
 *
 * Persists to localStorage so mode survives navigation within the app.
 * Uses the registry backend API for review notes storage.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useLocation } from "react-router";

// Review notes are stored in the registry backend
const REGISTRY_API_BASE = import.meta.env.VITE_REGISTRY_API_BASE || "/api/registry/v1";

// --- Types ---

export type ReviewNoteStatus = "pending" | "confirmed" | "rejected" | "done";

export interface ReviewNote {
  id: string;
  page_path: string;
  content: string;
  status: ReviewNoteStatus;
  author_username: string;
  created_at: string;
  updated_at: string;
}

export interface ReviewNoteCreate {
  page_path: string;
  content: string;
}

export interface ReviewNoteUpdate {
  content?: string;
  status?: ReviewNoteStatus;
}

// --- API Methods ---

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${REGISTRY_API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (null as T) : res.json();
}

const reviewNotesApi = {
  list: (pagePath?: string) => {
    const params = pagePath ? `?page_path=${encodeURIComponent(pagePath)}` : "";
    return request<ReviewNote[]>(`/review-notes${params}`);
  },
  create: (data: ReviewNoteCreate) =>
    request<ReviewNote>("/review-notes", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: ReviewNoteUpdate) =>
    request<ReviewNote>(`/review-notes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<{ status: string; id: string }>(`/review-notes/${id}`, { method: "DELETE" }),
  exportUrl: () => `${REGISTRY_API_BASE}/review-notes/export`,
};

// --- Context ---

interface ReviewModeContextValue {
  /** Whether review mode is currently active */
  enabled: boolean;
  /** Enable or disable review mode */
  setEnabled: (enabled: boolean) => void;
  /** Current page path (from React Router location) */
  currentPagePath: string;
  /** All review notes (fetched from backend) */
  notes: ReviewNote[];
  /** Notes for the current page only */
  currentPageNotes: ReviewNote[];
  /** Loading state */
  loading: boolean;
  /** Refresh notes from backend */
  refresh: () => Promise<void>;
  /** Add a new note for the current page */
  addNote: (content: string) => Promise<ReviewNote | null>;
  /** Update a note's content or status */
  updateNote: (id: string, data: { content?: string; status?: ReviewNoteStatus }) => Promise<ReviewNote | null>;
  /** Delete a note */
  deleteNote: (id: string) => Promise<boolean>;
  /** Get export URL */
  exportUrl: () => string;
}

const ReviewModeContext = createContext<ReviewModeContextValue | null>(null);

const STORAGE_KEY = "ai_trust_review_mode";

export function ReviewModeProvider({ children }: { children: ReactNode }) {
  const location = useLocation();

  // Initialize from localStorage
  const [enabled, setEnabledState] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY) === "true";
    }
    return false;
  });

  const [notes, setNotes] = useState<ReviewNote[]>([]);
  const [loading, setLoading] = useState(false);

  // Current page path from router (prefix with /admin to distinguish from registry pages)
  const currentPagePath = "/admin" + location.pathname + location.hash;

  // Persist enabled state to localStorage
  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    if (value) {
      localStorage.setItem(STORAGE_KEY, "true");
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Fetch all notes from backend
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const data = await reviewNotesApi.list();
      setNotes(data);
    } catch (err) {
      console.error("Failed to fetch review notes:", err);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  // Fetch notes when review mode is enabled
  useEffect(() => {
    if (enabled) {
      refresh();
    } else {
      setNotes([]);
    }
  }, [enabled, refresh]);

  // Filter notes for current page
  const currentPageNotes = notes.filter((n) => n.page_path === currentPagePath);

  // Add a new note
  const addNote = useCallback(async (content: string): Promise<ReviewNote | null> => {
    try {
      const note = await reviewNotesApi.create({ page_path: currentPagePath, content });
      setNotes((prev) => [note, ...prev]);
      return note;
    } catch (err) {
      console.error("Failed to create review note:", err);
      return null;
    }
  }, [currentPagePath]);

  // Update a note
  const updateNote = useCallback(async (
    id: string,
    data: { content?: string; status?: ReviewNoteStatus }
  ): Promise<ReviewNote | null> => {
    try {
      const updated = await reviewNotesApi.update(id, data);
      setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
      return updated;
    } catch (err) {
      console.error("Failed to update review note:", err);
      return null;
    }
  }, []);

  // Delete a note
  const deleteNote = useCallback(async (id: string): Promise<boolean> => {
    try {
      await reviewNotesApi.delete(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      return true;
    } catch (err) {
      console.error("Failed to delete review note:", err);
      return false;
    }
  }, []);

  // Get export URL
  const exportUrl = useCallback(() => reviewNotesApi.exportUrl(), []);

  return (
    <ReviewModeContext.Provider
      value={{
        enabled,
        setEnabled,
        currentPagePath,
        notes,
        currentPageNotes,
        loading,
        refresh,
        addNote,
        updateNote,
        deleteNote,
        exportUrl,
      }}
    >
      {children}
    </ReviewModeContext.Provider>
  );
}

export function useReviewMode() {
  const ctx = useContext(ReviewModeContext);
  if (!ctx) {
    throw new Error("useReviewMode must be used within ReviewModeProvider");
  }
  return ctx;
}
