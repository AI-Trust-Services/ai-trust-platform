import { useState, useEffect } from "react";
import { useLuigi } from "./hooks/useLuigi";
import { useTheme } from "./hooks/useTheme";
import SystemsListPage from "./pages/SystemsListPage";
import AssessmentWizardPage from "./pages/AssessmentWizardPage";
import type { DraftRisk } from "./pages/AssessmentWizardPage";

const API_BASE = import.meta.env.VITE_RISK_MANAGEMENT_API_BASE ?? "/api/risk-management/v1";

type View =
  | { type: "list" }
  | { type: "wizard"; systemId: string; systemName: string; prefillRisk?: Partial<DraftRisk> };

export default function App() {
  useLuigi();
  useTheme();

  const [view, setView] = useState<View>({ type: "list" });
  const [backendOk, setBackendOk] = useState<boolean | null>(null);

  useEffect(() => {
    const check = () =>
      fetch(`${API_BASE.replace(/\/v1$/, "")}/health`)
        .then(r => setBackendOk(r.ok))
        .catch(() => setBackendOk(false));
    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      {backendOk === false && (
        <div style={{
          background: "#dc2626", color: "#fff",
          padding: "8px 20px", fontSize: 13, textAlign: "center",
          position: "sticky", top: 0, zIndex: 100,
        }}>
          Backend unavailable — retrying…
        </div>
      )}

      {view.type === "list" && (
        <SystemsListPage
          onSelectSystem={(id, name, prefill) => setView({ type: "wizard", systemId: id, systemName: name, prefillRisk: prefill })}
        />
      )}

      {view.type === "wizard" && (
        <AssessmentWizardPage
          systemId={view.systemId}
          systemName={view.systemName}
          prefillRisk={view.prefillRisk}
          onBack={() => setView({ type: "list" })}
        />
      )}
    </div>
  );
}
