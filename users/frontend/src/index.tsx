import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import App from "./App";
import UsersPage from "./pages/UsersPage";
import RolesPage from "./pages/RolesPage";
import { RequirePermission } from "./components/RequirePermission";

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <HashRouter>
    <Routes>
      <Route path="/" element={<App />}>
        <Route path="users" element={<RequirePermission anyOf={["iam:manage"]}><UsersPage /></RequirePermission>} />
        <Route path="roles" element={<RequirePermission anyOf={["iam:manage"]}><RolesPage /></RequirePermission>} />
        <Route index element={<Navigate to="users" replace />} />
        <Route path="*" element={<Navigate to="users" replace />} />
      </Route>
    </Routes>
  </HashRouter>
);
