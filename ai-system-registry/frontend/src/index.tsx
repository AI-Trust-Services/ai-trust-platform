import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router";
import "./index.css";
import App from "./App";
import { RequirePermission } from "./components/RequirePermission";
import Systems from "./views/Systems";
import RegisterSystem from "./views/RegisterSystem";
import ModelListPage from "./views/ModelListPage";
import ModelPage from "./views/ModelPage";
import SystemDetailPage from "./views/SystemDetailPage";
import AssessmentApp from "./views/assessment/AssessmentApp";
import AssessmentMethodPage from "./views/assessment/AssessmentMethodPage";
import AssessmentStartPage from "./views/assessment/AssessmentStartPage";
import QuestionView from "./views/assessment/QuestionView";
import AssessmentSubmitPage from "./views/assessment/AssessmentSubmitPage";
import CoIssueView from "./views/assessment/CoIssueView";
import HierarchySolverTester from "./views/HierarchySolverTester";

const SYSTEM_PERMS = ["systems:read", "systems:write"];

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        path: "systems",
        element: <RequirePermission anyOf={SYSTEM_PERMS}><Systems /></RequirePermission>,
      },
      {
        path: "systems/new",
        element: <RequirePermission anyOf={["systems:write"]}><RegisterSystem /></RequirePermission>,
      },
      {
        path: "systems/:id",
        element: <RequirePermission anyOf={SYSTEM_PERMS}><SystemDetailPage /></RequirePermission>,
      },
      {
        // Method selection — shown before opening a new assessment cycle.
        // Writers only; read/approve roles enter via /assessment directly.
        path: "systems/:id/assessment/method",
        element: <RequirePermission anyOf={["systems:write"]}><AssessmentMethodPage /></RequirePermission>,
      },
      {
        path: "systems/:id/assessment",
        element: <RequirePermission anyOf={SYSTEM_PERMS}><AssessmentApp /></RequirePermission>,
        children: [
          { index: true, element: <AssessmentStartPage /> },
          { path: "q/:questionKey", element: <QuestionView /> },
          { path: "submit", element: <AssessmentSubmitPage /> },
          { path: "issue", element: <CoIssueView /> },
        ],
      },
      {
        // Read-only view of a SPECIFIC (historical) assessment cycle by id —
        // "View results". Same components; AssessmentApp renders it read-only and
        // nested links carry the :assessmentId so in-app nav stays on this cycle.
        path: "systems/:id/assessment/view/:assessmentId",
        element: <RequirePermission anyOf={SYSTEM_PERMS}><AssessmentApp /></RequirePermission>,
        children: [
          { index: true, element: <AssessmentStartPage /> },
          { path: "q/:questionKey", element: <QuestionView /> },
        ],
      },
      {
        path: "systems/:id/hierarchy-test",
        element: <RequirePermission anyOf={SYSTEM_PERMS}><HierarchySolverTester /></RequirePermission>,
      },
      {
        path: "models",
        element: <RequirePermission anyOf={SYSTEM_PERMS}><ModelListPage /></RequirePermission>,
      },
      {
        path: "models/:id",
        element: <RequirePermission anyOf={SYSTEM_PERMS}><ModelPage /></RequirePermission>,
      },
      { index: true, element: <Navigate to="systems" replace /> },
      { path: "*", element: <Navigate to="systems" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
);


