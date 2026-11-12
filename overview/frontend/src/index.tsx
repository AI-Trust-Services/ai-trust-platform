import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router";
import "./index.css";
import App from "./App";
import Landing from "./views/Landing";
import TaskView from "./views/TaskView";
import DashboardLayout from "./views/DashboardLayout";
import Overview from "./views/Overview";

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { path: "overview", element: <Landing /> },
      { path: "tasks", element: <TaskView /> },
      {
        path: "dashboard",
        element: <DashboardLayout />,
        children: [{ index: true, element: <Overview /> }],
      },
      { index: true, element: <Navigate to="overview" replace /> },
      { path: "*", element: <Navigate to="overview" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
);
