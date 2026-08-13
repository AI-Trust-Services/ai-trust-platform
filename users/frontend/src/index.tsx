import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router";
import "./index.css";
import App from "./App";
import UsersPage from "./pages/UsersPage";
import RolesPage from "./pages/RolesPage";
import { RequirePermission } from "./components/RequirePermission";

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { path: "users", element: <RequirePermission anyOf={["iam:manage"]}><UsersPage /></RequirePermission> },
      { path: "roles", element: <RequirePermission anyOf={["iam:manage"]}><RolesPage /></RequirePermission> },
      { index: true, element: <Navigate to="users" replace /> },
      { path: "*", element: <Navigate to="users" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root") as HTMLElement).render(
  <RouterProvider router={router} />
);
