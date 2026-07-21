import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import App from "./App";
import Overview from "./views/Overview";

const root = createRoot(document.getElementById("root")!);
root.render(
  <HashRouter>
    <Routes>
      <Route path="/" element={<App />}>
        <Route path="overview" element={<Overview />} />
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Route>
    </Routes>
  </HashRouter>
);
