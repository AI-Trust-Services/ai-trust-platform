import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router";
import "./index.css";
import App from "./App";
import { RequirePermission } from "./components/RequirePermission";
import Systems from "./views/Systems";
import Models from "./views/Models";

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
        path: "models",
        element: <RequirePermission anyOf={SYSTEM_PERMS}><Models /></RequirePermission>,
      },
      { index: true, element: <Navigate to="systems" replace /> },
      { path: "*", element: <Navigate to="systems" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
);
