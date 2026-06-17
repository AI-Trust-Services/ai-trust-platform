import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import App from "./App";
import LiveSignals from "./views/LiveSignals";
import Analytics from "./views/Analytics";

const root = createRoot(document.getElementById("root"));
root.render(
  <HashRouter>
    <Routes>
      <Route path="/" element={<App />}>
        <Route path="signals" element={<LiveSignals />} />
        <Route path="analytics" element={<Analytics />} />
        <Route index element={<Navigate to="signals" replace />} />
        <Route path="*" element={<Navigate to="signals" replace />} />
      </Route>
    </Routes>
  </HashRouter>
);
