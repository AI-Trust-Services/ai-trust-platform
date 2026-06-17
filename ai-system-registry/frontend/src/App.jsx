import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import { useLuigiInit } from "./hooks/useLuigi";
import { HEALTH_URL } from "./api/client";

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

// Allows App's header buttons to open modals that live in child route components
export const ModalContext = createContext(null);
export const useModalControls = () => useContext(ModalContext);

export default function App() {
  const [backendOk, setBackendOk] = useState(null);
  const [toast, setToast] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [modelCreateOpen, setModelCreateOpen] = useState(false);
  const healthTimer = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  useLuigiInit(() => {});

  const checkHealth = useCallback(async () => {
    clearTimeout(healthTimer.current);
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
    return () => clearTimeout(healthTimer.current);
  }, [checkHealth]);

  const showToast = useCallback((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const activeView = location.pathname.startsWith("/models") ? "models" : "systems";

  return (
    <ToastContext.Provider value={showToast}>
      <ModalContext.Provider value={{ wizardOpen, setWizardOpen, modelCreateOpen, setModelCreateOpen }}>
        <div className="page-header">
          <h1>AI System Registry <span className="mfe-badge">EU AI Act</span></h1>
          <div>
            {activeView === "systems" ? (
              <button className="btn-primary" onClick={() => setWizardOpen(true)}>
                + Register System
              </button>
            ) : (
              <button className="btn-primary" onClick={() => setModelCreateOpen(true)}>
                + Add Model
              </button>
            )}
          </div>
        </div>

        <div className="nav-tabs">
          <div
            className={`nav-tab${activeView === "systems" ? " active" : ""}`}
            onClick={() => navigate("/systems")}
          >
            AI Systems
          </div>
          <div
            className={`nav-tab${activeView === "models" ? " active" : ""}`}
            onClick={() => navigate("/models")}
          >
            Model Catalog
          </div>
        </div>

        {backendOk === false && (
          <div className="health-banner show">
            <span className="spinner" style={{ borderTopColor: "#8b0000", borderColor: "#f5b8b8", width: 14, height: 14 }} />
            <span>Backend is unavailable. Retrying in 5 s…</span>
            <a onClick={checkHealth}>Retry now</a>
          </div>
        )}

        <Outlet />

        {toast && (
          <div className={`toast show${toast.isError ? " error" : ""}`}>{toast.msg}</div>
        )}
      </ModalContext.Provider>
    </ToastContext.Provider>
  );
}
