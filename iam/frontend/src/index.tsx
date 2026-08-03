import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import App from "./App";
import Users from "./views/Users";
import Roles from "./views/Roles";

const root = createRoot(document.getElementById("root")!);
root.render(
  <HashRouter>
    <Routes>
      <Route path="/" element={<App />}>
        <Route path="users" element={<Users />} />
        <Route path="roles" element={<Roles />} />
        <Route index element={<Navigate to="users" replace />} />
        <Route path="*" element={<Navigate to="users" replace />} />
      </Route>
    </Routes>
  </HashRouter>
);
