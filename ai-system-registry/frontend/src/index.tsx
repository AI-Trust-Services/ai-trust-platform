import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import App from "./App";
import { RequirePermission } from "./components/RequirePermission";
import Systems from "./views/Systems";
import Models from "./views/Models";

const SYSTEM_PERMS = ["systems:read", "systems:write"];

const root = createRoot(document.getElementById("root")!);
root.render(
  <HashRouter>
    <Routes>
      <Route path="/" element={<App />}>
        <Route
          path="systems"
          element={<RequirePermission anyOf={SYSTEM_PERMS}><Systems /></RequirePermission>}
        />
        <Route
          path="models"
          element={<RequirePermission anyOf={SYSTEM_PERMS}><Models /></RequirePermission>}
        />
        <Route index element={<Navigate to="systems" replace />} />
        <Route path="*" element={<Navigate to="systems" replace />} />
      </Route>
    </Routes>
  </HashRouter>
);
