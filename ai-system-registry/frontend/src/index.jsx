import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import App from "./App";
import Systems from "./views/Systems";
import Models from "./views/Models";

const root = createRoot(document.getElementById("root"));
root.render(
  <HashRouter>
    <Routes>
      <Route path="/" element={<App />}>
        <Route path="systems" element={<Systems />} />
        <Route path="models" element={<Models />} />
        <Route index element={<Navigate to="systems" replace />} />
        <Route path="*" element={<Navigate to="systems" replace />} />
      </Route>
    </Routes>
  </HashRouter>
);
