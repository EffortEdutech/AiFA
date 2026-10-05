// RETIRED (21-22 September 2026 owner decision, Sprint 70 follow-up).
//
// This function is no longer the browser-facing public site renderer.
// Root cause: Supabase's Edge Functions gateway forces `Content-Type:
// text/plain` (plus a locked-down `sandbox` CSP) on any function response
// that looks like HTML -- confirmed live via `Invoke-WebRequest` against
// this exact function -- to stop a tenant's function serving live,
// browser-renderable HTML from the shared `*.supabase.co` domain. A
// Supabase Edge Function can compute the right page but can never be the
// thing a browser loads directly to see it.
//
// Replaced by web-public/ (a Next.js app on Vercel, no such restriction),
// which ports this function's resolution logic and renderHomepage()
// output 1:1 -- see web-public/README.md and
// web-public/app/site/[slug]/page.tsx. That app is confirmed live.
//
// Kept deployed (not deleted -- no tool available to delete an Edge
// Function from this session) as a deprecation stub so any stale link
// still pointing here gets a clear message instead of a confusing
// raw-text page or a stale render.
Deno.serve(async () => {
  return new Response(
    "This endpoint has been retired. Public Client Business sites are now served from the AiFA web-public app (aifa.com/site/<slug>).",
    { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
});
