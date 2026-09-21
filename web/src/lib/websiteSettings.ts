/**
 * Public Site content read/publish — Sprint 64 (Architecture §2.3,
 * docs/aifa-platform/Architecture.md).
 *
 * Deliberately NOT part of the local-first encrypted store
 * (sqlJsAdapter.ts / syncService.ts) — public_site_content is a Public
 * Surface table, plaintext by design, so this file talks to Supabase
 * directly, the same way membership.ts and teamMembershipTransport.ts
 * do, rather than going through `db`/`enqueueSyncableWrite`.
 *
 * Reads use a plain `.from(...).select(...)` (RLS: "Anyone can read
 * published site content" — true for anon and authenticated alike, by
 * design). Writes always go through the `publish_site_content` RPC,
 * which re-checks server-side that the caller is an active member with
 * `settings: configure` — the same gate BusinessSettingsPage.tsx already
 * applies client-side for every other Settings write.
 */
import { supabase } from "./supabaseClient";

export interface WebsiteService {
  name: string;
  description: string;
}

export interface PublicSiteContent {
  businessId: string;
  heroHeadline: string | null;
  heroSubtext: string | null;
  services: WebsiteService[];
  contactEmail: string | null;
  contactPhone: string | null;
  accentColor: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

interface PublicSiteContentRow {
  business_id: string;
  hero_headline: string | null;
  hero_subtext: string | null;
  services: WebsiteService[] | null;
  contact_email: string | null;
  contact_phone: string | null;
  accent_color: string | null;
  published_at: string | null;
  updated_at: string;
}

function toPublicSiteContent(row: PublicSiteContentRow): PublicSiteContent {
  return {
    businessId: row.business_id,
    heroHeadline: row.hero_headline,
    heroSubtext: row.hero_subtext,
    services: row.services ?? [],
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    accentColor: row.accent_color,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

/** Current published content for this business, or null if never
 * published yet (a business with no public_site_content row is simply
 * "not published" — not an error). */
export async function getPublicSiteContent(businessId: string): Promise<PublicSiteContent | null> {
  const { data, error } = await supabase
    .from("public_site_content")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw error;
  return data ? toPublicSiteContent(data as PublicSiteContentRow) : null;
}

export interface PublishSiteContentInput {
  heroHeadline: string;
  heroSubtext: string;
  services: WebsiteService[];
  contactEmail: string;
  contactPhone: string;
  accentColor: string;
}

/** Publishes (creates or overwrites) this business's Public Site content.
 * Server-side (publish_site_content RPC) verifies the caller holds an
 * active membership with `settings: configure` for businessId — a
 * rejection surfaces as a thrown error, same as every other RPC call in
 * this codebase. */
export async function publishSiteContent(
  businessId: string,
  input: PublishSiteContentInput,
): Promise<PublicSiteContent> {
  const { data, error } = await supabase.rpc("publish_site_content", {
    p_business_id: businessId,
    p_hero_headline: input.heroHeadline,
    p_hero_subtext: input.heroSubtext,
    p_services: input.services,
    p_contact_email: input.contactEmail,
    p_contact_phone: input.contactPhone,
    p_accent_color: input.accentColor,
  });
  if (error) throw error;
  return toPublicSiteContent(data as PublicSiteContentRow);
}
