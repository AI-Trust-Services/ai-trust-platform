import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router";
import "./index.css";
import App from "./App";
import LiveSignals from "./views/LiveSignals";

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { path: "signals", element: <LiveSignals /> },
      { index: true, element: <Navigate to="signals" replace /> },
      { path: "*", element: <Navigate to="signals" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
);
