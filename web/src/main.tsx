import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";

// Sprint 18 — register the hand-rolled app-shell service worker
// (public/sw.js) so a repeat visit loads without network (this sprint's
// PWA DoD item). Not gated on production-only — Vite serves /sw.js as a
// static asset in dev too, and registration failing is caught and
// swallowed rather than blocking app startup either way.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal — offline-shell caching is "safe to carry over" per
      // this sprint's own risk register, never load-bearing for the app
      // to function online.
    });
  });
}

// UI polish Phase 1: dev-only component gallery at `/?ui-preview`. The
// `import.meta.env.DEV` guard is a compile-time constant, so production
// builds drop the preview module entirely.
const UiPreview = import.meta.env.DEV ? React.lazy(() => import("./ui/UiPreview")) : null;
const showUiPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).has("ui-preview");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {showUiPreview && UiPreview ? (
      <Suspense fallback={null}>
        <UiPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
