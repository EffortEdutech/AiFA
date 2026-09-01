import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Sprint 18 (Vol 12_0 §6) — Vite+React over Next.js: AIFA is an
// authenticated app, not a marketing site, so there's no SSR/SEO
// requirement to justify Next.js's extra complexity (see that volume's
// "Revisit If" column for the framework decision).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Mirrors app/babel.config.js's module-resolver alias — @aifa/core
      // is consumed as TS source directly, no build step, same as mobile.
      "@aifa/core": path.resolve(__dirname, "../packages/core/src"),
    },
  },
  optimizeDeps: {
    exclude: ["sql.js"],
  },
  build: {
    target: "es2022",
  },
  server: {
    port: 4280,
  },
});
