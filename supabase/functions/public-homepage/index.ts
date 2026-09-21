// Sprint 66 -- Public Homepage Renderer (Architecture §2.3, §2.4).
// Rescoped by Sprint 70 (21 September 2026 owner decision) -- see below.
//
// Server-renders the Public Site homepage for a business resolved primarily
// by SLUG now, not by a bound custom domain. This corrects a premise
// mismatch: the original Sprint 65/66 design ("Custom-domain-only for v1
// ... no aifa.my fallback subdomain", Architecture §2.4) made a bound
// custom domain the ONLY way to reach a Client Business's public site. The
// actual product intent is the opposite -- every Client Business gets a
// working, AiFA-hosted landing page immediately (aifa.com/site/<slug>, or
// a link/QR shared from inside the AiFA app), zero DNS setup required. A
// bound custom domain (Sprint 65's `domains` table + resolve_domain()) is
// now an optional, rare add-on the Platform Operator configures on
// request -- kept as a fallback resolution path below, not the default.
// verify_jwt is OFF because a website visitor has no account at all --
// this function does its own, narrower checks instead (a real, resolvable
// business only).
//
// Resolution order (first match wins):
//   1. ?business_id=<uuid>   -- explicit override, testing/internal only.
//   2. ?slug=<slug>          -- explicit override, testing/internal only.
//   3. ?domain=<domain>      -- explicit override, testing/internal only.
//   4. A trailing URL path segment after the function's own route (the
//      shape aifa.com/site/<slug> will forward once that domain is live)
//      -> resolve_business_slug() -- THE DEFAULT PATH for every business.
//   5. Incoming Host header -> resolve_domain() -- only reached when a
//      Client Business has an Operator-bound custom domain and the
//      request truly arrived on it.
//
// GET  -> renders the homepage HTML (nav, hero, services grid, about,
//         contact form, footer -- matches the existing mockup's layout).
// POST -> the contact form's target: calls submit_public_request() so a
//         real submission lands as a real `requests` row (Sprint 68 wires
//         this into the Approval Task pipeline) -- not a dead end.
//
// DEBUG PATCH (kept permanently, v2): this function was the first code in
// the codebase to query tables directly via a service-role admin client
// (`.from(...).select()`) instead of going through a SECURITY DEFINER RPC
// -- every other domain in this project uses the RPC-only pattern, which
// never needed service_role to hold table grants directly. That gap meant
// service_role had never been granted SELECT on `public_site_content` or
// `businesses`, so every request silently fell through to "not published"
// on a swallowed 42501 permission-denied error. Fixed via the
// sprint66_grant_service_role_public_homepage_reads migration. The
// `?debug=1` branch below (added while diagnosing that bug) is kept
// intentionally: it surfaces `resolveDebug` plus the raw {data, error} from
// both queries instead of the rendered HTML, which is the fastest way to
// diagnose a future "not published"-looking issue without guessing.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface SiteContent {
  business_id: string;
  hero_headline: string | null;
  hero_subtext: string | null;
  services: { name: string; description: string }[] | null;
  contact_email: string | null;
  contact_phone: string | null;
  accent_color: string | null;
}

function renderHomepage(content: SiteContent, businessName: string): string {
  const accent = content.accent_color || "#1a2b3c";
  const headline = escapeHtml(content.hero_headline || businessName);
  const subtext = escapeHtml(content.hero_subtext || "");
  const services = content.services || [];
  const email = content.contact_email ? escapeHtml(content.contact_email) : "";
  const phone = content.contact_phone ? escapeHtml(content.contact_phone) : "";
  const servicesHtml = services.map((s) => `
      <div class="service-card"><h3>${escapeHtml(s.name)}</h3><p>${escapeHtml(s.description)}</p></div>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(businessName)}</title><style>
  :root { --accent: ${accent}; } * { box-sizing: border-box; } body { margin: 0; font-family: system-ui, -apple-system, sans-serif; color: #1a1a1a; }
  nav { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid #eee; }
  nav .brand { font-weight: 700; font-size: 18px; }
  .hero { padding: 64px 24px; background: var(--accent); color: #fff; text-align: center; } .hero h1 { margin: 0 0 12px; font-size: 32px; } .hero p { margin: 0; font-size: 18px; opacity: 0.9; }
  section { padding: 48px 24px; max-width: 960px; margin: 0 auto; }
  .services-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  .service-card { border: 1px solid #eee; border-radius: 8px; padding: 20px; } .service-card h3 { margin-top: 0; color: var(--accent); }
  #contact form { display: flex; flex-direction: column; gap: 12px; max-width: 480px; } #contact input, #contact textarea { padding: 10px; border: 1px solid #ccc; border-radius: 6px; font: inherit; }
  #contact button { padding: 10px 20px; background: var(--accent); color: #fff; border: none; border-radius: 6px; cursor: pointer; }
  footer { padding: 24px; text-align: center; color: #777; font-size: 13px; border-top: 1px solid #eee; } #form-status { font-size: 14px; }
</style></head><body>
  <nav><span class="brand">${escapeHtml(businessName)}</span></nav>
  <div class="hero"><h1>${headline}</h1>${subtext ? `<p>${subtext}</p>` : ""}</div>
  <section id="services"><h2>Services</h2><div class="services-grid">${servicesHtml || "<p>Services coming soon.</p>"}</div></section>
  <section id="about"><h2>About</h2><p>${subtext || escapeHtml(businessName + " is on AiFA.")}</p></section>
  <section id="contact"><h2>Contact</h2>${email ? `<p>Email: ${email}</p>` : ""}${phone ? `<p>Phone: ${phone}</p>` : ""}
    <form id="contact-form"><input name="name" placeholder="Your name" required><input name="email" type="email" placeholder="Your email" required><textarea name="message" placeholder="Message" rows="4" required></textarea><button type="submit">Send</button></form>
    <p id="form-status"></p></section>
  <footer>Powered by AiFA</footer>
  <script>document.getElementById('contact-form').addEventListener('submit', async (e) => { e.preventDefault(); const status = document.getElementById('form-status'); status.textContent = 'Sending…'; const fd = new FormData(e.target); try { const res = await fetch(window.location.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fd.get('name'), email: fd.get('email'), message: fd.get('message') }) }); if (!res.ok) throw new Error('failed'); status.textContent = 'Thanks — we\'ll be in touch.'; e.target.reset(); } catch { status.textContent = 'Could not send — please try again.'; } });</script>
</body></html>`;
}

// Pulls a trailing slug segment off the request path, e.g.
// "/functions/v1/public-homepage/nhl-global-solution" -> "nhl-global-solution".
// Ignores the function's own route segments (case-insensitive) so this
// works whether the caller hits the raw Supabase URL directly or a future
// aifa.com/site/<slug> rewrite that forwards the slug as the final segment.
function slugFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const routeWords = new Set(["functions", "v1", "public-homepage", "site"]);
  const trailing = segments.filter((s) => !routeWords.has(s.toLowerCase()));
  const last = trailing[trailing.length - 1];
  return last || null;
}

async function resolveBusinessId(admin: ReturnType<typeof createClient>, hostHeader: string | null, url: URL): Promise<{ id: string | null; debug: string }> {
  const overrideBusinessId = url.searchParams.get("business_id");
  if (overrideBusinessId) return { id: overrideBusinessId, debug: "override:business_id" };

  const overrideSlug = url.searchParams.get("slug");
  if (overrideSlug) {
    const { data, error } = await admin.rpc("resolve_business_slug", { p_slug: overrideSlug });
    if (error) return { id: null, debug: `resolve_business_slug_error:${error.message}` };
    if (!data) return { id: null, debug: `resolve_business_slug_no_match:${overrideSlug}` };
    return { id: data as string, debug: "resolved_via_slug_override" };
  }

  const overrideDomain = url.searchParams.get("domain");
  if (overrideDomain) {
    const { data, error } = await admin.rpc("resolve_domain", { p_domain: overrideDomain });
    if (error) return { id: null, debug: `resolve_domain_error:${error.message}` };
    if (!data) return { id: null, debug: `resolve_domain_no_match:${overrideDomain}` };
    return { id: data as string, debug: "resolved_via_domain_override" };
  }

  // Default path: every Client Business is reachable this way, no DNS
  // setup required (Sprint 70).
  const pathSlug = slugFromPath(url.pathname);
  if (pathSlug) {
    const { data, error } = await admin.rpc("resolve_business_slug", { p_slug: pathSlug });
    if (error) return { id: null, debug: `resolve_business_slug_error:${error.message}` };
    if (data) return { id: data as string, debug: "resolved_via_slug_path" };
    // Fall through to Host-header/domain resolution below rather than
    // 404ing immediately -- a path segment that isn't a known slug might
    // still be meaningful once a real reverse proxy is in front of this.
  }

  // Fallback: an Operator-bound custom domain (Sprint 65, now optional).
  const host = hostHeader?.split(":")[0] || null;
  if (!host) return { id: null, debug: "no_slug_domain_or_override" };
  const { data, error } = await admin.rpc("resolve_domain", { p_domain: host });
  if (error) return { id: null, debug: `resolve_domain_error:${error.message}` };
  if (!data) return { id: null, debug: `no_match_for_slug_or_host:${pathSlug ?? ""}/${host}` };
  return { id: data as string, debug: "resolved_via_host_domain" };
}

Deno.serve(async (req: Request) => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const url = new URL(req.url);
  const debugMode = url.searchParams.get("debug") === "1";

  const { id: businessId, debug: resolveDebug } = await resolveBusinessId(admin, req.headers.get("host"), url);
  if (!businessId) {
    return new Response(debugMode ? JSON.stringify({ error: "no_business_id", resolveDebug }) : "Domain not found or not verified.", { status: 404 });
  }

  if (req.method === "POST") {
    let body: { name?: string; email?: string; message?: string } = {};
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 }); }
    const { error } = await admin.rpc("submit_public_request", { p_business_id: businessId, p_request_type: "contact", p_payload: body });
    if (error) return new Response(JSON.stringify({ error: String(error.message ?? error) }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  const contentRes = await admin.from("public_site_content").select("*").eq("business_id", businessId).maybeSingle();
  const businessRes = await admin.from("businesses").select("legal_name").eq("id", businessId).maybeSingle();

  if (debugMode) {
    return new Response(JSON.stringify({ businessId, resolveDebug, contentRes, businessRes }, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const businessName = (businessRes.data as { legal_name?: string } | null)?.legal_name || "This business";

  if (contentRes.error || !contentRes.data) {
    return new Response(
      `<!doctype html><html><body><h1>${escapeHtml(businessName)}</h1><p>This site has not published any content yet.</p></body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  return new Response(renderHomepage(contentRes.data as SiteContent, businessName), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
