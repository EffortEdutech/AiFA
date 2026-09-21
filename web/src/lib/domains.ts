/**
 * Domain binding — Sprint 65 (Architecture §2.4, docs/aifa-platform/Architecture.md).
 *
 * Same pattern as websiteSettings.ts: talks to Supabase directly rather than
 * through `db`/`enqueueSyncableWrite`, because `domains` is a Public Surface
 * table (Architecture §2), not local-first-encrypted data.
 *
 * - addDomain() / getDomains() go through the RLS-gated table and the
 *   add_domain() RPC (settings:configure-checked server-side, same as
 *   publish_site_content()).
 * - checkDomainNow() invokes the verify-domain edge function, which performs
 *   the actual live DNS-over-HTTPS TXT lookup and flips verification_status
 *   to "verified" when the challenge value matches — this file never talks
 *   to DNS itself.
 */
import { supabase } from "./supabaseClient";

export interface DomainBinding {
  id: string;
  businessId: string;
  domain: string;
  verificationToken: string;
  verificationStatus: "pending" | "verified";
  sslStatus: "pending" | "active" | "failed";
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

interface DomainRow {
  id: string;
  business_id: string;
  domain: string;
  verification_token: string;
  verification_status: "pending" | "verified";
  ssl_status: "pending" | "active" | "failed";
  verified_at: string | null;
  last_checked_at: string | null;
  created_at: string;
}

function toDomainBinding(row: DomainRow): DomainBinding {
  return {
    id: row.id,
    businessId: row.business_id,
    domain: row.domain,
    verificationToken: row.verification_token,
    verificationStatus: row.verification_status,
    sslStatus: row.ssl_status,
    verifiedAt: row.verified_at,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
  };
}

/** This business's bound domain(s) — usually zero or one for v1. */
export async function getDomains(businessId: string): Promise<DomainBinding[]> {
  const { data, error } = await supabase
    .from("domains")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as DomainRow[]).map(toDomainBinding);
}

/** Claims a domain for this business and generates its DNS TXT challenge
 * value. Server-side (add_domain RPC) verifies active membership + the same
 * settings:configure gate every other Settings write in this codebase uses,
 * and rejects a domain another business has already claimed. */
export async function addDomain(businessId: string, domain: string): Promise<DomainBinding> {
  const { data, error } = await supabase.rpc("add_domain", {
    p_business_id: businessId,
    p_domain: domain,
  });
  if (error) throw error;
  return toDomainBinding(data as DomainRow);
}

/** "Check now" — asks the verify-domain edge function to look up this
 * domain's real DNS TXT records right now, instead of waiting for the
 * scheduled re-check. Returns whether it verified on this call. */
export async function checkDomainNow(domainId: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("verify-domain", {
    body: { domainId },
  });
  if (error) throw error;
  return Boolean((data as { verified?: boolean } | null)?.verified);
}
