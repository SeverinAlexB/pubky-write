import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider } from "react-router";
import { EditorPage } from "./editor/EditorPage.tsx";
import { HomePage } from "./home/HomePage.tsx";
import "./styles.css";

const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },
  { path: "/d/:id", element: <EditorPage /> },
  {
    path: "*",
    element: (
      <div className="page-message">
        <h1>Page not found</h1>
        <Link to="/">Back to Docs</Link>
      </div>
    ),
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
