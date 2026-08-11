import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router";
import "./index.css";
import App from "./App";
import { RequirePermission } from "./components/RequirePermission";
import AssessmentsPage from "./pages/AssessmentsPage";
import ObligationsPage from "./pages/ObligationsPage";
import ControlsPage from "./pages/ControlsPage";
import EvidencePage from "./pages/EvidencePage";

const ASSESSMENT_PERMS = ["assessments:read", "assessments:write", "assessments:approve"];
const EVIDENCE_PERMS = ["evidence:read", "evidence:write", "evidence:approve"];

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        path: "assessments",
        element: <RequirePermission anyOf={ASSESSMENT_PERMS}><AssessmentsPage /></RequirePermission>,
      },
      {
        path: "obligations",
        element: <RequirePermission anyOf={ASSESSMENT_PERMS}><ObligationsPage /></RequirePermission>,
      },
      {
        path: "controls",
        element: <RequirePermission anyOf={ASSESSMENT_PERMS}><ControlsPage /></RequirePermission>,
      },
      {
        path: "evidence",
        element: <RequirePermission anyOf={EVIDENCE_PERMS}><EvidencePage /></RequirePermission>,
      },
      { index: true, element: <Navigate to="assessments" replace /> },
      { path: "*", element: <Navigate to="assessments" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root") as HTMLElement).render(
  <RouterProvider router={router} />
);
