import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { useLocation, useNavigate, Outlet } from "react-router";
import { Loader2 } from "lucide-react";
import LuigiClient from "@luigi-project/client";
import { useLuigiInit } from "./hooks/useLuigi";
import { useTheme, useBranding } from "@ai-trust/react-hooks";
import { usePermissions } from "./hooks/usePermissions";
import { HEALTH_URL } from "./api/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ToastFn = (msg: string, isError?: boolean) => void;

interface ModalControls {
  modelCreateOpen: boolean;
  setModelCreateOpen: (open: boolean) => void;
  mayWrite: boolean;
  mayApprove: boolean;
  mayWriteAssessments: boolean;
  username: string;
}

const ToastContext = createContext<ToastFn | null>(null);
export const useToast = () => useContext(ToastContext)!;

/**
 * True only when the shell's top window was reloaded (browser refresh), as
 * opposed to a Luigi side-nav click that merely swaps the iframe src. The
 * registry runs same-origin with the shell, so the top window's navigation
 * timing is readable; a cross-origin/unsupported read falls back to "not a
 * reload" → land on the systems list.
 */
function isShellReload(): boolean {
  try {
    const nav = window.top?.performance?.getEntriesByType?.(
      "navigation",
    )?.[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === "reload";
  } catch {
    return false;
  }
}

export const ModalContext = createContext<ModalControls | null>(null);
export const useModalControls = () => useContext(ModalContext)!;

export default function App() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [modelCreateOpen, setModelCreateOpen] = useState(false);
  const healthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { can, username } = usePermissions();
  const mayWrite = can("systems:write");
  const mayApprove = can("systems:approve");
  const mayWriteAssessments = can("assessments:write");
  const noWriteTitle = "Requires permission: systems:write";

  // Consume a cross-MFE/in-session handoff: restore a saved path, redirect into
  // the single-page assessment app when another MFE (e.g. compliance) asks us to
  // open an assessment, or — on a genuine browser refresh — restore the last-open
  // system detail. Idempotent: the flags are removed once read.
  const consumeHandoff = useCallback(() => {
    const savedPath = sessionStorage.getItem("lastSystemPath");
    if (savedPath) {
      sessionStorage.removeItem("lastSystemPath");
      navigate(savedPath, { replace: true });
      return;
    }
    // Cross-MFE handoff: compliance redirects an owner/CO into the single-page
    // assessment app via this localStorage flag (replaces the old questionnaire modal).
    const handoff = localStorage.getItem("registry.openAssessment");
    if (handoff) {
      localStorage.removeItem("registry.openAssessment");
      try {
        const { systemId } = JSON.parse(handoff);
        if (systemId) navigate(`/systems/${systemId}/assessment`, { replace: true });
      } catch {
        /* ignore malformed handoff */
      }
      return;
    }
    // Browser-refresh restore. Luigi reloads the iframe to /registry/ on BOTH a
    // real page refresh and a side-nav click, and both fire this init — but only
    // a refresh reloads the shell top window. Restore the last-open detail page
    // only on a genuine refresh, so a nav-menu click lands on the list, not the
    // old detail.
    const restorePath = sessionStorage.getItem("registryRestorePath");
    if (restorePath && isShellReload()) {
      navigate(restorePath, { replace: true });
    }
  }, [navigate]);

  // Fires on a FRESH registry iframe load.
  useLuigiInit(consumeHandoff);

  // Luigi caches MFE iframes: when it re-reveals an already-loaded registry
  // iframe (the compliance→registry CO handoff is the common case), addInitListener
  // does NOT re-fire, so the handoff flag would sit unconsumed and the user would
  // land on the systems list. Also consume it on every context update — mirrors
  // what compliance's AssessmentsPage already does for its own handoffs.
  useEffect(() => {
    const id = LuigiClient.addContextUpdateListener(() => consumeHandoff());
    return () => { LuigiClient.removeContextUpdateListener(id); };
  }, [consumeHandoff]);
  useTheme();
  useBranding();

  const checkHealth = useCallback(async () => {
    if (healthTimer.current) clearTimeout(healthTimer.current);
    try {
      const res = await fetch(HEALTH_URL, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setBackendOk(true);
    } catch {
      setBackendOk(false);
      healthTimer.current = setTimeout(checkHealth, 5000);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    return () => { if (healthTimer.current) clearTimeout(healthTimer.current); };
  }, [checkHealth]);

  const showToast = useCallback<ToastFn>((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const activeView = location.pathname.startsWith("/models") ? "models" : "systems";
  // Don't show the shell header when viewing a single system or the full-height
  // assessment app — those render their own header.
  const isSystemDetail = /^\/systems\/(?!new$)[^/]+$/.test(location.pathname);
  const isAssessment = /^\/systems\/[^/]+\/assessment(\/|$)/.test(location.pathname);
  const hideHeader = isSystemDetail || isAssessment;

  return (
    <ToastContext.Provider value={showToast}>
      <ModalContext.Provider value={{ modelCreateOpen, setModelCreateOpen, mayWrite, mayApprove, mayWriteAssessments, username }}>
        <div className="flex h-screen flex-col overflow-hidden">
        {!hideHeader && (
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6 shadow-[var(--shadow-xs)]">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">AI System Registry</h1>
          </div>
          <div>
            {activeView === "systems" ? (
              <Button disabled={!mayWrite}
                className="border-transparent bg-[#1147E9] text-white hover:bg-[#0d39c4]"
                title={mayWrite ? undefined : "Requires permission: systems:write"}
                onClick={() => navigate("/systems/new")}>
                + Register new AI System
              </Button>
            ) : (
              <Button disabled={!mayWrite} title={mayWrite ? undefined : noWriteTitle}
                onClick={() => setModelCreateOpen(true)}>
                + Add Model
              </Button>
            )}
          </div>
        </div>
        )}

        {backendOk === false && (
          <div className="flex items-center gap-3 border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-6 py-2.5 text-[13px] text-[var(--danger-fg)]">
            <Loader2 className="size-3.5 animate-spin" />
            <span>Backend is unavailable. Retrying in 5 s…</span>
            <a className="cursor-pointer font-semibold underline" onClick={checkHealth}>Retry now</a>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </div>

        {toast && (
          <div className={cn(
            "fixed bottom-6 right-6 z-[2000] rounded-md px-5 py-3 text-sm text-white shadow-[var(--shadow-md)]",
            toast.isError ? "bg-[var(--danger)]" : "bg-[var(--success)]",
          )}>
            {toast.msg}
          </div>
        )}
        </div>
      </ModalContext.Provider>
    </ToastContext.Provider>
  );
}
