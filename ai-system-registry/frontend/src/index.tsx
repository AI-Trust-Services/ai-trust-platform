import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router";
import "./index.css";
import App from "./App";
import { RequirePermission } from "./components/RequirePermission";
import Today from "./views/Today";
import MyWork from "./views/MyWork";
import Systems from "./views/Systems";
import SystemWorkspace from "./views/SystemWorkspace";
import SystemTasks from "./views/SystemTasks";
import Models from "./views/Models";

const SYSTEM_PERMS = ["systems:read", "systems:write"];

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        path: "today",
        element: <RequirePermission anyOf={SYSTEM_PERMS}><Today /></RequirePermission>,
      },
      {
        path: "work",
        element: <RequirePermission anyOf={SYSTEM_PERMS}><MyWork /></RequirePermission>,
      },
      {
        path: "systems",
        element: <RequirePermission anyOf={SYSTEM_PERMS}><Systems /></RequirePermission>,
      },
      {
        path: "systems/:systemId",
        element: <RequirePermission anyOf={SYSTEM_PERMS}><SystemWorkspace /></RequirePermission>,
      },
      {
        path: "systems/:systemId/tasks",
        element: <RequirePermission anyOf={SYSTEM_PERMS}><SystemTasks /></RequirePermission>,
      },
      {
        path: "models",
        element: <RequirePermission anyOf={SYSTEM_PERMS}><Models /></RequirePermission>,
      },
      { index: true, element: <Navigate to="today" replace /> },
      { path: "*", element: <Navigate to="today" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
);
