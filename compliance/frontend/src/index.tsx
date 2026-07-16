import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import App from "./App";
import AssessmentsPage from "./pages/AssessmentsPage";
import ObligationsPage from "./pages/ObligationsPage";
import ControlsPage from "./pages/ControlsPage";
import EvidencePage from "./pages/EvidencePage";

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <HashRouter>
    <Routes>
      <Route path="/" element={<App />}>
        <Route path="assessments" element={<AssessmentsPage />} />
        <Route path="obligations" element={<ObligationsPage />} />
        <Route path="controls" element={<ControlsPage />} />
        <Route path="evidence" element={<EvidencePage />} />
        <Route index element={<Navigate to="assessments" replace />} />
        <Route path="*" element={<Navigate to="assessments" replace />} />
      </Route>
    </Routes>
  </HashRouter>
);
