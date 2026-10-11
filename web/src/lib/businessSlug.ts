/**
 * Business slug — Sprint 70 (Architecture §2.4 rescope, docs/aifa-platform/
 * Architecture.md), owner decision 21 September 2026.
 *
 * Every business gets a default, AiFA-hosted public landing page reachable
 * by slug (e.g. aifa.com/site/<slug>) with zero DNS setup — this replaces
 * the earlier "custom-domain-only" design (Sprint 65/66) as the default
 * path. A bound custom domain (domains.ts) is now an optional, rare add-on
 * the Platform Operator configures on request, not something every
 * business needs.
 *
 * `businesses.slug` is readable via the same "Members can view their own
 * business" RLS policy every other Business Settings field already uses —
 * no new grant needed. Editing goes through update_business_slug() (Sprint
 * 70's own SECURITY DEFINER RPC), settings:configure gated server-side,
 * same pattern as add_domain()/publish_site_content().
 */
import { supabase } from "./supabaseClient";

/** Where the public site (web-public, on Vercel) is served from. Override with
 * VITE_PUBLIC_SITE_URL when aifa.com is attached; no code change needed then.
 * (Sprint 68a: this used to point at the Supabase functions URL, which cannot
 * serve a browsable page -- see web-public/README.md.) */
const PUBLIC_SITE_BASE = (
  (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined) || "https://ai-fa-tawny.vercel.app"
).replace(/\/+$/, "");

export function publicSiteUrlForSlug(slug: string): string {
  return `${PUBLIC_SITE_BASE}/site/${encodeURIComponent(slug)}`;
}

export type QrTarget = "page" | "enquiry" | "rfq";

/** The address a printed QR code opens. `source` is a short label (counter,
 * flyer...) that is stored on each request so the owner can see which QR
 * brought it in. */
export function publicRequestUrl(slug: string, target: QrTarget, source: string): string {
  const base = publicSiteUrlForSlug(slug);
  const src = source.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (target === "page") return src ? `${base}?src=${src}` : base;
  const params = new URLSearchParams({ type: target === "rfq" ? "rfq" : "contact" });
  if (src) params.set("src", src);
  return `${base}/request?${params.toString()}`;
}

/** Reads this business's current slug (always present — auto-generated on
 * creation, see the sprint70 migration's insert trigger). */
export async function getBusinessSlug(businessId: string): Promise<string> {
  const { data, error } = await supabase
    .from("businesses")
    .select("slug")
    .eq("id", businessId)
    .single();
  if (error) throw error;
  return (data as { slug: string }).slug;
}

/** Lets an Owner (settings:configure) pick a custom slug instead of the
 * auto-generated default. Server-side validates format and uniqueness. */
export async function updateBusinessSlug(businessId: string, slug: string): Promise<string> {
  const { data, error } = await supabase.rpc("update_business_slug", {
    p_business_id: businessId,
    p_slug: slug,
  });
  if (error) throw error;
  return (data as { slug: string }).slug;
}
