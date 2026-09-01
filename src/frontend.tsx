/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 *
 * The store must load before React renders: `useDataset` calls `store.get()`,
 * which throws if the snapshot has not loaded yet, so the UI can never render
 * a blank budget as though the user had no data.
 */

import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./ui/App.tsx";
import { store } from "./store/index.ts";

const container = document.getElementById("root") ?? document.body;

store.load().then(
  () => createRoot(container).render(<App />),
  (error: unknown) => {
    container.textContent = `Could not open your budget data: ${
      error instanceof Error ? error.message : String(error)
    }`;
  },
);
