/**
 * Cross-Domain Routing & Chaining — Sprint 61 (Phase 5, "Cross-Domain
 * Approval Chaining & Confidence Trust," 16 September 2026).
 *
 * Two genuinely new, Path B-native concerns this sprint introduces —
 * see the Sprint 61 migration's own header for the two premise
 * mismatches this file's shape resolves:
 *
 *   - channel_domain_trust: mirrors packages/core/src/db/
 *     businessKnowledgeRepository.ts's Path A-only trust shape
 *     (3-in-a-row confirmation threshold, reset to 0 on a wrong
 *     classification), rebuilt as a Path B Postgres table because the
 *     original mechanism is architecturally unreachable from here
 *     (local SQLite, end-to-end encrypted before it ever reaches
 *     Supabase).
 *   - chained_intakes: the real automatic router re-entry Sprint 58
 *     disclosed it never built (explicit owner-triggered buttons were
 *     shipped instead) — a chained intake surfaces the next real step
 *     (e.g. "PO approved — confirm stock receipt") for the owner to
 *     act on; it does not itself post anything.
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

export type ChainedIntakeStatus = "pending" | "resolved" | "dismissed";

/** Row shape record_channel_domain_confirmation returns — the raw table row, no is_trusted column (that computation lives only in get_channel_domain_trust_status). */
export interface ChannelDomainTrustRecordResultRow {
  confirmation_count: number;
  auto_record_threshold: number;
}

export interface ChannelDomainTrustRecordResult {
  confirmationCount: number;
  autoRecordThreshold: number;
}

/** Row shape get_channel_domain_trust_status returns. */
export interface ChannelDomainTrustStatusRow {
  confirmation_count: number;
  auto_record_threshold: number;
  is_trusted: boolean;
}

export interface ChannelDomainTrustStatus {
  confirmationCount: number;
  autoRecordThreshold: number;
  /**
   * False for the five permanent-approval domains (attendance_correction,
   * stock_adjustment, e_invoice_flag, contract_alert, e_signature_request)
   * NO MATTER the confirmationCount — enforced inside
   * get_channel_domain_trust_status itself, not just here, so this is a
   * real database guarantee, not a client-side convention that could be
   * bypassed by a different caller.
   */
  isTrusted: boolean;
}

/** Row shape of public.chained_intakes. */
export interface ChainedIntakeRow {
  id: string;
  business_id: string;
  domain: string;
  subject_type: string;
  subject_id: string;
  summary: string | null;
  status: ChainedIntakeStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface ChainedIntake {
  id: string;
  businessId: string;
  /** The NEXT-STAGE domain this intake represents (e.g. 'stock_receipt_pending', 'payment_due', 'payment_expected') — not the domain that produced it. */
  domain: string;
  subjectType: string;
  subjectId: string;
  summary: string | null;
  status: ChainedIntakeStatus;
  createdAt: string;
  resolvedAt: string | null;
}

function toChainedIntake(row: ChainedIntakeRow): ChainedIntake {
  return {
    id: row.id,
    businessId: row.business_id,
    domain: row.domain,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    summary: row.summary,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export interface SupabaseRoutingAndChainingTransport {
  /**
   * Gated on active business membership alone (mirrors capture_triage's
   * own precedent — this spans every domain, so there is no single
   * capability domain to gate it on). Call after every capture the
   * owner actually confirms/corrects: `wasCorrect: true` when the owner
   * kept the AI-detected domain as-is, `false` when they overrode it to
   * a different domain (the reset-on-mismatch case, mirroring
   * businessKnowledgeRepository.ts's own vendor-category behaviour).
   * Returns the raw updated counters only — call
   * getChannelDomainTrustStatus separately for the is_trusted verdict
   * (kept as two calls rather than one, so the five-domain permanent
   * exception has exactly one place it's computed).
   */
  recordChannelDomainConfirmation(params: {
    businessId: string;
    channel: string;
    domain: string;
    wasCorrect: boolean;
  }): Promise<ChannelDomainTrustRecordResult>;

  /**
   * Read-only trust check — call before deciding whether a capture can
   * skip the "is this classified right?" review step (Sprint 61's own
   * "reduced-friction handling," never a skip of the underlying
   * approval gate itself).
   */
  getChannelDomainTrustStatus(params: {
    businessId: string;
    channel: string;
    domain: string;
  }): Promise<ChannelDomainTrustStatus>;

  /** Every pending chained intake for this business — the "next step" surfaces the owner should act on. */
  listChainedIntakes(businessId: string): Promise<ChainedIntake[]>;

  /** Owner decided a pending chained intake needs no action (e.g. a PO's stock receipt is now moot). Does not touch the underlying record. */
  dismissChainedIntake(id: string): Promise<ChainedIntake>;
}

export function createSupabaseRoutingAndChainingTransport(
  client: SupabaseClientLike,
): SupabaseRoutingAndChainingTransport {
  return {
    async recordChannelDomainConfirmation(params) {
      const { data, error } = await client.rpc("record_channel_domain_confirmation", {
        p_business_id: params.businessId,
        p_channel: params.channel,
        p_domain: params.domain,
        p_was_correct: params.wasCorrect,
      });
      if (error) throw error;
      const row = data as ChannelDomainTrustRecordResultRow;
      return { confirmationCount: row.confirmation_count, autoRecordThreshold: row.auto_record_threshold };
    },

    async getChannelDomainTrustStatus(params) {
      const { data, error } = await client.rpc("get_channel_domain_trust_status", {
        p_business_id: params.businessId,
        p_channel: params.channel,
        p_domain: params.domain,
      });
      if (error) throw error;
      const rows = data as ChannelDomainTrustStatusRow[];
      const row = rows[0];
      return {
        confirmationCount: row.confirmation_count,
        autoRecordThreshold: row.auto_record_threshold,
        isTrusted: row.is_trusted,
      };
    },

    async listChainedIntakes(businessId) {
      const { data, error } = await client.rpc("list_chained_intakes", { p_business_id: businessId });
      if (error) throw error;
      return (data as ChainedIntakeRow[]).map(toChainedIntake);
    },

    async dismissChainedIntake(id) {
      const { data, error } = await client.rpc("dismiss_chained_intake", { p_id: id });
      if (error) throw error;
      return toChainedIntake(data as ChainedIntakeRow);
    },
  };
}
