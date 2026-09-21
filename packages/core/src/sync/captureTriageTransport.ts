/**
 * Capture Triage — Sprint 53 (Phase 5, Vol 5_5 §7's mandatory
 * "unclassified" fallback for the Quick Capture router).
 *
 * A genuine Path B (plaintext Supabase) table — see Vol_5_5 §3's
 * correction note and Sprint 53's own correction note for why this is
 * deliberately NOT a `business_events` row: Path A (the local,
 * end-to-end-encrypted `business_events`/`business_data` tables
 * `capturePipeline.ts` writes to) is excluded from the Quick Capture
 * router entirely. This is a small, standalone table + two RPCs
 * (`create_capture_triage_item`, `resolve_capture_triage_item`) — no
 * domain-specific capability gate, since the whole point of an
 * unclassified item is that its domain (and therefore which of the
 * eleven Vol 13_1 §3 permission domains would even apply) is not yet
 * known; gated on active business membership alone, mirroring
 * Approvals' own generic-queue precedent.
 *
 * Mirrors this directory's other transport files' own shape (see
 * attendanceLeaveCommissionTransport.ts's header for why
 * `SupabaseClientLike` exists instead of importing the real
 * `SupabaseClient` type).
 */

export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type CaptureTriageStatus = "pending" | "dismissed" | "resolved";

/** Row shape of public.capture_triage. */
export interface CaptureTriageRow {
  id: string;
  business_id: string;
  raw_text: string;
  detected_domain: string | null;
  status: CaptureTriageStatus;
  created_by_membership_id: string | null;
  created_at: string;
}

export interface CaptureTriageItem {
  id: string;
  businessId: string;
  rawText: string;
  detectedDomain: string | null;
  status: CaptureTriageStatus;
  createdByMembershipId: string | null;
  createdAt: string;
}

function toCaptureTriageItem(row: CaptureTriageRow): CaptureTriageItem {
  return {
    id: row.id,
    businessId: row.business_id,
    rawText: row.raw_text,
    detectedDomain: row.detected_domain,
    status: row.status,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

export interface SupabaseCaptureTriageTransport {
  /** No domain-specific capability gate — any active member of the business may file an item the router couldn't confidently place. */
  createCaptureTriageItem(params: {
    businessId: string;
    rawText: string;
    detectedDomain?: string | null;
  }): Promise<CaptureTriageItem>;

  /** Marks a pending item 'dismissed' (owner decided it needs no action) or 'resolved' (owner manually re-entered it through the correct per-domain screen). */
  resolveCaptureTriageItem(
    id: string,
    status: "dismissed" | "resolved",
  ): Promise<CaptureTriageItem>;
}

export function createSupabaseCaptureTriageTransport(
  client: SupabaseClientLike,
): SupabaseCaptureTriageTransport {
  return {
    async createCaptureTriageItem(params) {
      const { data, error } = await client.rpc("create_capture_triage_item", {
        p_business_id: params.businessId,
        p_raw_text: params.rawText,
        p_detected_domain: params.detectedDomain ?? null,
      });
      if (error) throw error;
      return toCaptureTriageItem(data as CaptureTriageRow);
    },

    async resolveCaptureTriageItem(id, status) {
      const { data, error } = await client.rpc("resolve_capture_triage_item", {
        p_id: id,
        p_status: status,
      });
      if (error) throw error;
      return toCaptureTriageItem(data as CaptureTriageRow);
    },
  };
}
