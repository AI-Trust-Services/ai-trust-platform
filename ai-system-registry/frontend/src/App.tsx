import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { useNavigate, useLocation, Outlet } from "react-router";
import { Loader2, Database } from "lucide-react";
import { useLuigiInit } from "./hooks/useLuigi";
import { usePermissions } from "./hooks/usePermissions";
import { HEALTH_URL } from "./api/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ToastFn = (msg: string, isError?: boolean) => void;

interface ModalControls {
  wizardOpen: boolean;
  setWizardOpen: (open: boolean) => void;
  modelCreateOpen: boolean;
  setModelCreateOpen: (open: boolean) => void;
  mayWrite: boolean;
  mayRegister: boolean;
  username: string;
}

const ToastContext = createContext<ToastFn | null>(null);
export const useToast = () => useContext(ToastContext)!;

export const ModalContext = createContext<ModalControls | null>(null);
export const useModalControls = () => useContext(ModalContext)!;

export default function App() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [modelCreateOpen, setModelCreateOpen] = useState(false);
  const healthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { can, username } = usePermissions();
  const mayWrite = can("systems:write");
  const mayRegister = can("systems:approve");
  const noWriteTitle = "Requires permission: systems:write";

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

  const showToast = useCallback<ToastFn>((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const activeView = location.pathname.startsWith("/models") ? "models" : "systems";

  return (
    <ToastContext.Provider value={showToast}>
      <ModalContext.Provider value={{ wizardOpen, setWizardOpen, modelCreateOpen, setModelCreateOpen, mayWrite, mayRegister, username }}>
        <div className="flex h-screen flex-col overflow-hidden">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6 shadow-[var(--shadow-xs)]">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1147E9] to-[#6C1AF4] text-white">
              <Database className="size-5" />
            </span>
            <h1 className="text-lg font-semibold">AI System Registry</h1>
          </div>
          <div>
            {activeView === "systems" ? (
              <Button disabled={!mayRegister}
                title={mayRegister ? undefined : "Requires role: business owner or administrator"}
                onClick={() => setWizardOpen(true)}>
                + Register System
              </Button>
            ) : (
              <Button disabled={!mayWrite} title={mayWrite ? undefined : noWriteTitle}
                onClick={() => setModelCreateOpen(true)}>
                + Add Model
              </Button>
            )}
          </div>
        </div>

        <div className="flex border-b border-border bg-card px-6">
          {([["systems", "AI Systems"], ["models", "Model Catalog"]] as const).map(([key, label]) => (
            <div
              key={key}
              className={cn(
                "-mb-px cursor-pointer border-b-[3px] border-transparent px-5 py-3.5 text-sm font-medium",
                activeView === key
                  ? "border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => navigate(`/${key}`)}
            >
              {label}
            </div>
          ))}
        </div>

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
