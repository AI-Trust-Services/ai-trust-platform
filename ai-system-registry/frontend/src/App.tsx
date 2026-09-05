import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { Outlet } from "react-router";
import { Loader2 } from "lucide-react";
import { useLuigiInit, useLuigiThemeSync } from "./hooks/useLuigi";
import { usePermissions } from "./hooks/usePermissions";
import { ReviewModeProvider } from "./hooks/useReviewMode";
import { ReviewPanel } from "./components/ReviewPanel";
import { CommandMenu } from "./components/CommandMenu";
import { HEALTH_URL } from "./api/client";
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
  const [commandOpen, setCommandOpen] = useState(false);
  const healthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { can, username } = usePermissions();
  const mayWrite = can("systems:write");
  const mayRegister = can("systems:write"); // systems:write allows registration

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

  const showToast = useCallback<ToastFn>((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      <ModalContext.Provider value={{ wizardOpen, setWizardOpen, modelCreateOpen, setModelCreateOpen, mayWrite, mayRegister, username }}>
        <ReviewModeProvider>
          <div className="flex h-full flex-col">
            {/* Backend health banner */}
            {backendOk === false && (
              <div className="flex shrink-0 items-center gap-3 border-b border-destructive bg-destructive/10 px-6 py-2.5 text-[13px] text-destructive">
                <Loader2 className="size-3.5 animate-spin" />
                <span>Backend is unavailable. Retrying in 5 s…</span>
                <a className="cursor-pointer font-semibold underline" onClick={checkHealth}>Retry now</a>
              </div>
            )}

            {/* Main content rendered by router */}
            <div className="flex-1 overflow-hidden">
              <Outlet />
            </div>

            {/* Toast notifications */}
            {toast && (
              <div className={cn(
                "fixed bottom-6 right-6 z-[2000] rounded-md px-5 py-3 text-sm text-white shadow-lg",
                toast.isError ? "bg-destructive" : "bg-green-600",
              )}>
                {toast.msg}
              </div>
            )}

            <ReviewPanel />

            {/* Command menu (Ctrl+K) */}
            <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
          </div>
        </ReviewModeProvider>
      </ModalContext.Provider>
    </ToastContext.Provider>
  );
}
