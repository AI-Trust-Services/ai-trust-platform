import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router";
import "./index.css";
import App from "./App";
import MailServicePage from "./pages/MailServicePage";
import SettingsPage from "./pages/SettingsPage";
import { RequirePermission } from "./components/RequirePermission";

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        path: "mail-service",
        element: (
          <RequirePermission anyOf={["iam:manage"]}>
            <MailServicePage />
          </RequirePermission>
        ),
      },
      {
        path: "admin-settings",
        element: (
          <RequirePermission anyOf={["iam:manage"]}>
            <SettingsPage />
          </RequirePermission>
        ),
      },
      { index: true, element: <Navigate to="admin-settings" replace /> },
      { path: "*", element: <Navigate to="admin-settings" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root") as HTMLElement).render(
  <RouterProvider router={router} />
);
