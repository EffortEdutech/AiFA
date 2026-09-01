import React from "react";
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
