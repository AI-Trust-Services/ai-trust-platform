import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import App from "./App";
import { RequirePermission } from "./components/RequirePermission";
import AssessmentsPage from "./pages/AssessmentsPage";
import ObligationsPage from "./pages/ObligationsPage";
import ControlsPage from "./pages/ControlsPage";
import EvidencePage from "./pages/EvidencePage";

const ASSESSMENT_PERMS = ["assessments:read", "assessments:write", "assessments:approve"];
const EVIDENCE_PERMS = ["evidence:read", "evidence:write", "evidence:approve"];

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <HashRouter>
    <Routes>
      <Route path="/" element={<App />}>
        <Route
          path="assessments"
          element={<RequirePermission anyOf={ASSESSMENT_PERMS}><AssessmentsPage /></RequirePermission>}
        />
        <Route
          path="obligations"
          element={<RequirePermission anyOf={ASSESSMENT_PERMS}><ObligationsPage /></RequirePermission>}
        />
        <Route
          path="controls"
          element={<RequirePermission anyOf={ASSESSMENT_PERMS}><ControlsPage /></RequirePermission>}
        />
        <Route
          path="evidence"
          element={<RequirePermission anyOf={EVIDENCE_PERMS}><EvidencePage /></RequirePermission>}
        />
        <Route index element={<Navigate to="assessments" replace />} />
        <Route path="*" element={<Navigate to="assessments" replace />} />
      </Route>
    </Routes>
  </HashRouter>
);
