// Sprint 18 (Vol 12_0 §3 "PWA... service worker for app-shell caching") —
// deliberately minimal, hand-rolled app-shell cache (no Workbox/build-time
// PWA plugin, to avoid a new build-tool dependency for what this sprint's
// own "Safe to Carry Over" note calls cosmetic polish). Caches the app
// shell on install so a repeat visit loads without network; does NOT
// cache API/Supabase calls or attempt any background sync — the DoD item
// this satisfies is "loads without network once first visited," not
// full offline data sync (that's IndexedDB + Sprint 19's concern).
const CACHE_NAME = "aifa-shell-v1";
const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

// Cache-first for the app shell's own static assets (same-origin GET
// only); everything else (Supabase API calls, sql.js's wasm fetch) goes
// straight to the network — never intercepted, never cached stale.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok && SHELL_URLS.includes(url.pathname)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match("/index.html"));
    }),
  );
});
