import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router";
import "./index.css";
import App from "./App";
import { RequirePermission } from "./components/RequirePermission";
import DashboardPage from "./pages/DashboardPage";
import UsersPage from "./pages/UsersPage";
import AIProvidersPage from "./pages/AIProvidersPage";
import MailServicePage from "./pages/MailServicePage";
import SettingsPage from "./pages/SettingsPage";

// All admin pages require iam:manage permission
const ADMIN_PERMS = ["iam:manage"];

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: (
          <RequirePermission anyOf={ADMIN_PERMS}>
            <DashboardPage />
          </RequirePermission>
        ),
      },
      {
        path: "users",
        element: (
          <RequirePermission anyOf={ADMIN_PERMS}>
            <UsersPage />
          </RequirePermission>
        ),
      },
      {
        path: "ai-providers",
        element: (
          <RequirePermission anyOf={ADMIN_PERMS}>
            <AIProvidersPage />
          </RequirePermission>
        ),
      },
      {
        path: "mail-service",
        element: (
          <RequirePermission anyOf={ADMIN_PERMS}>
            <MailServicePage />
          </RequirePermission>
        ),
      },
      {
        path: "settings",
        element: (
          <RequirePermission anyOf={ADMIN_PERMS}>
            <SettingsPage />
          </RequirePermission>
        ),
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
);
