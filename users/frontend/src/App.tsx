import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { Outlet, NavLink } from "react-router";
import { Users } from "lucide-react";
import { useLuigiInit } from "./hooks/useLuigi";
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
        <div className="flex items-center gap-2 bg-[var(--danger-bg)] px-4 py-2 text-sm text-[var(--danger-fg)]">
          Backend is unavailable. Retrying in 5s…{" "}
          <button
            className="cursor-pointer p-0 text-[var(--brand)] underline"
            onClick={checkHealth}
          >
            Retry now
          </button>
        </div>
      )}
      <header className="flex h-14 items-center border-b border-border bg-card px-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1147E9] to-[#6C1AF4] text-white">
            <Users className="size-5" />
          </span>
          <h1 className="text-lg font-semibold tracking-[-0.01em]">Users &amp; Roles</h1>
        </div>
      </header>
      <div className="flex gap-0 border-b border-border bg-card px-6">
        <NavLink
          to="users"
          className={({ isActive }) =>
            cn(
              "-mb-px border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground no-underline hover:text-[var(--brand)]",
              isActive && "border-[var(--brand)] text-[var(--brand)]"
            )
          }
        >
          Users
        </NavLink>
        <NavLink
          to="roles"
          className={({ isActive }) =>
            cn(
              "-mb-px border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground no-underline hover:text-[var(--brand)]",
              isActive && "border-[var(--brand)] text-[var(--brand)]"
            )
          }
        >
          Roles &amp; Permissions
        </NavLink>
      </div>
      <Outlet />
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-[500] rounded-md px-[18px] py-2.5 text-sm text-white shadow-[var(--shadow-md)]",
            toast.isError ? "bg-destructive" : "bg-foreground"
          )}
        >
          {toast.msg}
        </div>
      )}
    </ToastContext.Provider>
  );
}

