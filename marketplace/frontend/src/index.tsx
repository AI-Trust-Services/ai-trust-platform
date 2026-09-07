import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router";
import LuigiClient from "@luigi-project/client";
import "./index.css";
import MarketplacePage from "./MarketplacePage";
import EmbedPage from "./EmbedPage";

const router = createHashRouter([
  { path: "/", element: <MarketplacePage /> },
  { path: "/embed/:name", element: <EmbedPage /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);

// Every MFE mounted by the Luigi shell MUST complete the client handshake, or
// Luigi times out waiting for init and blanks the iframe (the app paints once
// then goes white — see the other MFEs' useLuigi hook). Fire it once at the
// root so it covers all routes (marketplace catalog + embedded services).
function App() {
  useEffect(() => {
    const id = LuigiClient.addInitListener(() => {});
    return () => { LuigiClient.removeInitListener(id); };
  }, []);
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
