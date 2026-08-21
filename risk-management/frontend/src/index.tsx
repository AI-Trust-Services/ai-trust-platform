import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router";
import "./index.css";
import App from "./App";
import AssessmentPage from "./pages/AssessmentPage";

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { path: "assess", element: <AssessmentPage /> },
      { index: true, element: <Navigate to="assess" replace /> },
      { path: "*", element: <Navigate to="assess" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root") as HTMLElement).render(
  <RouterProvider router={router} />
);
