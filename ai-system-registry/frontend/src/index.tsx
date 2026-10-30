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


