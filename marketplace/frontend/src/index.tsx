import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router";
import "./index.css";
import MarketplacePage from "./MarketplacePage";
import EmbedPage from "./EmbedPage";

const router = createHashRouter([
  { path: "/", element: <MarketplacePage /> },
  { path: "/embed/:name", element: <EmbedPage /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);

createRoot(document.getElementById("root") as HTMLElement).render(
  <RouterProvider router={router} />
);
