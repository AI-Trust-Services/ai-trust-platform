import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { Outlet } from "react-router";
import { Loader2, Plus, LayoutDashboard } from "lucide-react";
import { useLuigiInit, navigateTo } from "./hooks/useLuigi";
import { usePermissions } from "./hooks/usePermissions";
import { api, HEALTH_URL, REGISTRY_URL } from "./api/client";
import { Button } from "@/components/ui/button";

type ToastFn = (msg: string, isError?: boolean) => void;
const ToastContext = createContext<ToastFn | null>(null);
export const useToast = () => useContext(ToastContext)!;

interface HeaderControls {
  alertCount: number;
  registryUrl: string;
}
export const HeaderContext = createContext<HeaderControls | null>(null);
export const useHeader = () => useContext(HeaderContext)!;

export default function App() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [alertCount, setAlertCount] = useState(0);
  const { can } = usePermissions();
  const mayRegister = can("systems:write");
  const healthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLuigiInit(() => {});

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

  const refreshAlertBadge = useCallback(async () => {
    try {
      const data = await api.getAlertCount();
      setAlertCount(data.count ?? 0);
    } catch { /* alerts backend may be unavailable */ }
  }, []);

  useEffect(() => {
    refreshAlertBadge();
    const id = setInterval(refreshAlertBadge, 30000);
    return () => clearInterval(id);
  }, [refreshAlertBadge]);

  const showToast = useCallback<ToastFn>((msg, isError = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function handleNavigateRegistry() {
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }

  return (
    <ToastContext.Provider value={showToast}>
      <HeaderContext.Provider value={{ alertCount, registryUrl: REGISTRY_URL }}>
        <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6 print:hidden">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1147E9] to-[#6C1AF4] text-white">
              <LayoutDashboard className="size-5" />
            </span>
            <div className="flex flex-col justify-center">
              <h1 className="text-lg font-semibold tracking-[-0.01em]">Compliance Overview</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">Organisation compliance posture at a glance</p>
            </div>
          </div>
          <Button
            onClick={handleNavigateRegistry}
            disabled={!mayRegister}
            title={mayRegister ? undefined : "Requires permission: systems:write"}
          >
            <Plus />
            Register System
          </Button>
        </header>

        {backendOk === false && (
          <div className="flex items-center gap-3 border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-6 py-2.5 text-[13px] text-[var(--danger-fg)] print:hidden">
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
      </HeaderContext.Provider>
    </ToastContext.Provider>
  );
}
