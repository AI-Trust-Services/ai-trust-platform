import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { useLuigiInit } from "./hooks/useLuigi";
import { HEALTH_URL } from "./api/client";

type ShowToast = (msg: string, isError?: boolean) => void;
const ToastContext = createContext<ShowToast | null>(null);

export function useToast(): ShowToast {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside App");
  return ctx;
}

export default function App(): JSX.Element {
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
        <div className="health-banner">
          Backend is unavailable. Retrying in 5s…{" "}
          <a onClick={checkHealth}>Retry now</a>
        </div>
      )}
      <div className="tab-bar">
        <NavLink to="users" className={({ isActive }) => "tab" + (isActive ? " tab-active" : "")}>Users</NavLink>
        <NavLink to="roles" className={({ isActive }) => "tab" + (isActive ? " tab-active" : "")}>Roles &amp; Permissions</NavLink>
      </div>
      <Outlet />
      {toast && (
        <div className={`toast${toast.isError ? " error" : ""}`}>{toast.msg}</div>
      )}
    </ToastContext.Provider>
  );
}
