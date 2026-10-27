import { useState, useEffect, useCallback, useRef } from "react";
import { Outlet } from "react-router";
import { Loader2 } from "lucide-react";
import { useLuigiInit } from "./hooks/useLuigi";
import { useTheme, useBranding } from "@ai-trust/react-hooks";
import { HEALTH_URL } from "./api/client";

export default function App() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const healthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLuigiInit(() => {});
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

  return (
    <>
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
    </>
  );
}
