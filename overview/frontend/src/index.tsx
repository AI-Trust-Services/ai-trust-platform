import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router";
import "./index.css";
import App from "./App";
import Landing from "./views/Landing";

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { path: "overview", element: <Landing /> },
      { index: true, element: <Navigate to="overview" replace /> },
      { path: "*", element: <Navigate to="overview" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
);
