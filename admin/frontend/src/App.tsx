import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { Outlet } from "react-router";
import { useLuigiThemeSync } from "./hooks/useLuigi";
import { HEALTH_URL } from "./api/client";
import { cn } from "@/lib/utils";
// [REVIEW_MODE] -- POC feedback collection, remove before merging to main
import { ReviewModeProvider } from "@/hooks/useReviewMode";
import { ReviewPanel } from "@/components/ReviewPanel";
// [/REVIEW_MODE]
import { CommandMenu } from "@/components/CommandMenu";

type ShowToast = (msg: string, isError?: boolean) => void;
const ToastContext = createContext<ShowToast | null>(null);

export function useToast(): ShowToast {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside App");
  return ctx;
}

export default function App() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const healthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLuigiThemeSync();

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
    return () => {
      if (healthTimer.current) clearTimeout(healthTimer.current);
    };
  }, [checkHealth]);

  const showToast = useCallback<ShowToast>((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {/* [REVIEW_MODE] -- POC feedback collection, remove before merging to main */}
      <ReviewModeProvider>
      {/* [/REVIEW_MODE] */}
        <div className="min-h-screen bg-background">
          {/* Backend health banner */}
          {backendOk === false && (
            <div className="flex items-center gap-2 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              Backend is unavailable. Retrying in 5s…{" "}
              <button
                className="cursor-pointer p-0 text-primary underline"
                onClick={checkHealth}
              >
                Retry now
              </button>
            </div>
          )}

          {/* Content area - Luigi handles the shell navigation */}
          <Outlet />

          {/* Toast notifications */}
          {toast && (
            <div
              className={cn(
                "fixed bottom-6 right-6 z-[500] rounded-md px-[18px] py-2.5 text-sm text-white shadow-lg",
                toast.isError ? "bg-destructive" : "bg-foreground"
              )}
            >
              {toast.msg}
            </div>
          )}

          {/* [REVIEW_MODE] -- POC feedback collection, remove before merging to main */}
          <ReviewPanel />
          {/* [/REVIEW_MODE] */}

          {/* Command Menu (Ctrl+K) */}
          <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
        </div>
      {/* [REVIEW_MODE] -- POC feedback collection, remove before merging to main */}
      </ReviewModeProvider>
      {/* [/REVIEW_MODE] */}
    </ToastContext.Provider>
  );
}
