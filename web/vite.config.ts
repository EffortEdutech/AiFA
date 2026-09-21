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
      // @aifa/core/src/sync/dek.ts imports @noble/* deep subpaths. Vite's
      // Node resolution walks up from the IMPORTING file's own directory
      // (packages/core/src/sync), which never reaches web/node_modules
      // since there's no root-level node_modules in this non-workspaces
      // monorepo. Mirrors app/package.json's jest moduleNameMapper fix
      // for the identical problem in the mobile test runner.
      "@noble/ciphers/aes.js": path.resolve(__dirname, "node_modules/@noble/ciphers/aes.js"),
      "@noble/ciphers/utils.js": path.resolve(__dirname, "node_modules/@noble/ciphers/utils.js"),
      "@noble/hashes/hkdf.js": path.resolve(__dirname, "node_modules/@noble/hashes/hkdf.js"),
      "@noble/hashes/sha2.js": path.resolve(__dirname, "node_modules/@noble/hashes/sha2.js"),
      "@noble/hashes/utils.js": path.resolve(__dirname, "node_modules/@noble/hashes/utils.js"),
    },
  },
  // sql.js's dist build (sql-wasm-browser.js) is a CommonJS/UMD file
  // (`module.exports = initSqlJs`), not a real ES module. Vite's dev
  // server only rewrites CJS deps into a proper `export default` when
  // they go through its esbuild dependency pre-bundling step
  // (optimizeDeps) — a prior `exclude: ["sql.js"]` here skipped that,
  // so the browser tried to load the raw CJS file as native ESM and
  // failed with "does not provide an export named 'default'". `vite
  // build` (Rollup + @rollup/plugin-commonjs) never hit this, which is
  // why it went unnoticed until the dev server was actually run.
  optimizeDeps: {
    include: ["sql.js"],
  },
  build: {
    target: "es2022",
  },
  server: {
    port: 3070,
  },
});
