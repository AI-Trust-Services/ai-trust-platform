import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { Outlet } from "react-router";
import { Plus, LayoutDashboard } from "lucide-react";
import { navigateTo } from "../hooks/useLuigi";
import { usePermissions } from "../hooks/usePermissions";
import { api, REGISTRY_URL } from "../api/client";
import { Button } from "@/components/ui/button";

type ToastFn = (msg: string, isError?: boolean) => void;
const ToastContext = createContext<ToastFn | null>(null);
export const useToast = () => useContext(ToastContext)!;

interface HeaderControls {
  alertCount: number;
  registryUrl: string;
}
const HeaderContext = createContext<HeaderControls | null>(null);
export const useHeader = () => useContext(HeaderContext)!;

/**
 * Layout for the Compliance Overview dashboard route (#/dashboard).
 * Provides the dashboard header chrome plus the toast + header contexts that
 * `views/Overview.tsx` consumes. Scoped to this route so the Landing Zone
 * (#/overview) and Task View (#/tasks) stay chrome-free. The backend-health
 * banner lives in the shared App shell, not here.
 */
export default function DashboardLayout() {
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [alertCount, setAlertCount] = useState(0);
  const { can } = usePermissions();
  const mayRegister = can("systems:write");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
