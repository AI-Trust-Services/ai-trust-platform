import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router";
import "./index.css";
import App from "./App";
import Overview from "./views/Overview";

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { path: "overview", element: <Overview /> },
      { index: true, element: <Navigate to="overview" replace /> },
      { path: "*", element: <Navigate to="overview" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
);
