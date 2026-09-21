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

/** The base path a business's default AiFA-hosted landing page lives under.
 * Until aifa.com itself is live, this resolves against the Supabase
 * project's own functions URL with the slug as an explicit query param
 * (see public-homepage/index.ts's own resolution order) — the link still
 * works today, and moves to a clean aifa.com/site/<slug> path with no
 * change needed on this side once that domain exists. */
const SUPABASE_FUNCTIONS_URL = "https://yotapuotkbyyocraraza.supabase.co/functions/v1/public-homepage";

export function publicSiteUrlForSlug(slug: string): string {
  return `${SUPABASE_FUNCTIONS_URL}?slug=${encodeURIComponent(slug)}`;
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
