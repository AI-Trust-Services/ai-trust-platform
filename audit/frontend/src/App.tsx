import { useState, useEffect } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import { api, HEALTH_URL } from "./api/client";
import { useLuigiInit } from "./hooks/useLuigi";
import { useTheme } from "./hooks/useTheme";
import { usePermissions } from "./hooks/usePermissions";
import { NoAccess } from "./components/NoAccess";
import { AuditLogs } from "./views/AuditLogs";

export default function App() {
  useLuigiInit(() => {});
  useTheme();

  const { can, loading: permsLoading } = usePermissions();
  const mayView = can("audit:read");

  const [backendOk, setBackendOk] = useState<boolean | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const res = await fetch(HEALTH_URL);
        setBackendOk(res.ok);
      } catch {
        setBackendOk(false);
      }
      timer = setTimeout(check, 10000);
    }
    check();
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1147E9] to-[#6C1AF4] text-white">
            <ClipboardList className="size-5" />
          </span>
          <h1 className="text-lg font-semibold tracking-[-0.01em]">Audit Trail</h1>
        </div>
      </header>

      {permsLoading ? null : !mayView ? (
        <NoAccess />
      ) : (
        <>
          {backendOk === false && (
            <div className="flex shrink-0 items-center gap-3 border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-6 py-2.5 text-[13px] text-[var(--danger-fg)]">
              <Loader2 className="size-3.5 animate-spin" />
              <span>Backend is unavailable. Retrying…</span>
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <AuditLogs />
          </div>
        </>
      )}
    </div>
  );
}
