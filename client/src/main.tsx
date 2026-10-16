import "@fontsource/roboto/400.css";
import "@fontsource/roboto/400-italic.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/roboto/700-italic.css";
import "@fontsource/roboto-mono/400.css";
import "@fontsource/roboto-mono/700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider } from "react-router";
import { Tooltips } from "./components/Tooltips.tsx";
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
        <Link to="/">Back to Pubky Write</Link>
      </div>
    ),
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
    <Tooltips />
  </StrictMode>,
);
