import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { Outlet } from "react-router";
import { Loader2 } from "lucide-react";
import { useLuigiInit, useLuigiThemeSync } from "./hooks/useLuigi";
import { HEALTH_URL } from "./api/client";
import { cn } from "@/lib/utils";

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
  const healthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLuigiInit(() => {});
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
    return () => { if (healthTimer.current) clearTimeout(healthTimer.current); };
  }, [checkHealth]);

  const showToast = useCallback<ShowToast>((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {backendOk === false && (
        <div className="flex items-center gap-2 border-b border-[var(--danger-border,var(--destructive))] bg-[var(--danger-bg,#fef2f2)] px-4 py-2 text-[13px] text-[var(--danger-fg,var(--destructive))]">
          <Loader2 className="size-3.5 animate-spin" />
          <span>Backend is unavailable. Retrying in 5 s…</span>
          <a className="cursor-pointer font-medium underline" onClick={checkHealth}>Retry now</a>
        </div>
      )}
      <Outlet />
      {toast && (
        <div
          className={cn(
            "fixed bottom-5 right-5 z-50 rounded-md px-4 py-2.5 text-[13px] font-medium text-white shadow-lg",
            toast.isError ? "bg-[var(--destructive)]" : "bg-foreground",
          )}
        >
          {toast.msg}
        </div>
      )}
    </ToastContext.Provider>
  );
}
