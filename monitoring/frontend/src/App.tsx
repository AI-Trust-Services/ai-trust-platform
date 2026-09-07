import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { Outlet } from "react-router";
import { Activity, Loader2 } from "lucide-react";
import { useLuigiInit } from "./hooks/useLuigi";
import { useTheme } from './hooks/useTheme';
import { HEALTH_URL } from "./api/client";

type ToastFn = (msg: string, isError?: boolean) => void;

const ToastContext = createContext<ToastFn | null>(null);
export const useToast = () => useContext(ToastContext)!;

export default function App() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const healthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLuigiInit(() => {});
  useTheme();

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

  return (
    <ToastContext.Provider value={showToast}>
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1147E9] to-[#6C1AF4] text-white">
            <Activity className="size-5" />
          </span>
          <div className="flex flex-col justify-center">
            <h1 className="flex items-center gap-2.5 text-lg font-semibold tracking-[-0.01em]">
              Monitoring
              <span className="rounded-full bg-[var(--brand)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
                Live
              </span>
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">Live observability signals</p>
          </div>
        </div>
      </header>

      {backendOk === false && (
        <div className="flex items-center gap-3 border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-6 py-2.5 text-[13px] text-[var(--danger-fg)]">
          <Loader2 className="size-3.5 animate-spin" />
          <span>Backend is unavailable. Retrying in 5&nbsp;s…</span>
          <button
            className="cursor-pointer border-none bg-transparent p-0 font-semibold text-[var(--danger-fg)] underline"
            onClick={checkHealth}
          >
            Retry now
          </button>
        </div>
      )}

      <Outlet />

      {toast && (
        <div className="fixed bottom-6 right-6 z-[2000] flex items-center gap-2.5 rounded-xl bg-foreground px-5 py-3 text-sm text-background shadow-[var(--shadow-md)]">
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: toast.isError ? "var(--destructive)" : "var(--success)" }}
          />
          {toast.msg}
        </div>
      )}
    </ToastContext.Provider>
  );
}
