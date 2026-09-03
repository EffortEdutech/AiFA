/**
 * e-Invoice & SST Compliance — Sprint 33 (Vol 13_0 §9 Module F:
 * e-Invois & SST / LHDN & Kastam Compliance). Opens (and, per this
 * sprint's own stubbed scope, does not close) Sub-phase 3d.
 *
 * Mirrors fullAccountingReportsTransport.ts / inventoryDeliveryTransport.ts's
 * own shape in this same directory.
 *
 * ============================================================
 * IMPORTANT — READ BEFORE WIRING THIS UP AS "DONE":
 * This sprint's own Definition of Done items 1 and 4 require a REAL
 * submission against LHDN's live MyInvois sandbox (a real UUID/QR
 * code back, and a real IRB rejection reason for a malformed one).
 * This session had no LHDN MyInvois sandbox API credentials and could
 * not fabricate a live connection to a government sandbox. The owner
 * was asked directly (via AskUserQuestion) how to proceed and chose
 * to have the full state machine, SST computation, and this
 * MyInvoisClient interface built now, against a STUBBED/simulated
 * response — NOT the live sandbox.
 *
 * `StubMyInvoisClient` below is that stub. It is wired to
 * `createEInvoiceSstTransport` by default so the app is runnable
 * end-to-end today, but it does NOT talk to LHDN. Replace it with a
 * real `MyInvoisClient` implementation (using real sandbox, then
 * production, credentials) before DoD items 1 and 4 can be claimed —
 * see the Sprint 33 doc's Outcomes section for what stays open.
 * ============================================================
 */

/** See supabaseTransport.ts's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Vol 6_9 §5's advice boundary, surfaced here concretely per this
 * sprint's own "Boundary" Task Breakdown item ("surfaced here
 * concretely, not just architecturally"). Render this literally in
 * the UI anywhere e-Invoice or SST figures are shown — do not
 * paraphrase it away.
 */
export const TAX_ADVICE_BOUNDARY_STATEMENT =
  "AiFA computes and organises tax-relevant figures and flags obligations; it does not replace a licensed tax professional's formal advice or filing responsibility.";

export type EInvoiceSubmissionStatus = "draft" | "submitted" | "validated" | "rejected" | "cancelled";
export type EInvoiceSubmissionType = "normal" | "consolidated";

/** Row shape of public.e_invoice_submissions. */
export interface EInvoiceSubmissionRow {
  id: string;
  business_id: string;
  invoice_id: string | null;
  lhdn_uuid: string | null;
  qr_code_ref: string | null;
  submission_type: EInvoiceSubmissionType;
  consolidated_period: string | null;
  status: EInvoiceSubmissionStatus;
  irb_response_ref: string | null;
  submitted_at: string | null;
  created_by_membership_id: string | null;
  created_at: string;
}

export interface EInvoiceSubmission {
  id: string;
  businessId: string;
  invoiceId: string | null;
  lhdnUuid: string | null;
  qrCodeRef: string | null;
  submissionType: EInvoiceSubmissionType;
  consolidatedPeriod: string | null;
  status: EInvoiceSubmissionStatus;
  /**
   * Whatever MyInvoisClient reported back — a success payload's
   * response code, or (per DoD item 4) the rejection reason,
   * surfaced verbatim, never swallowed into a generic error.
   */
  irbResponseRef: string | null;
  submittedAt: string | null;
  createdByMembershipId: string | null;
  createdAt: string;
}

function toEInvoiceSubmission(row: EInvoiceSubmissionRow): EInvoiceSubmission {
  return {
    id: row.id,
    businessId: row.business_id,
    invoiceId: row.invoice_id,
    lhdnUuid: row.lhdn_uuid,
    qrCodeRef: row.qr_code_ref,
    submissionType: row.submission_type,
    consolidatedPeriod: row.consolidated_period,
    status: row.status,
    irbResponseRef: row.irb_response_ref,
    submittedAt: row.submitted_at,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

/** Row shape of public.sst_rates. */
export interface SstRateRow {
  sst_code: string;
  tax_type: string;
  rate: number;
  description: string | null;
  rule_version: string | null;
}

export interface SstRate {
  sstCode: string;
  taxType: string;
  rate: number;
  description: string | null;
  ruleVersion: string | null;
}

function toSstRate(row: SstRateRow): SstRate {
  return {
    sstCode: row.sst_code,
    taxType: row.tax_type,
    rate: row.rate,
    description: row.description,
    ruleVersion: row.rule_version,
  };
}

/** Row shape of public.sst_transactions. */
export interface SstTransactionRow {
  id: string;
  business_id: string;
  invoice_id: string | null;
  payment_voucher_id: string | null;
  sst_code: string;
  rate: number;
  taxable_amount: number;
  sst_amount: number;
  created_at: string;
}

export interface SstTransaction {
  id: string;
  businessId: string;
  invoiceId: string | null;
  paymentVoucherId: string | null;
  sstCode: string;
  rate: number;
  taxableAmount: number;
  sstAmount: number;
  createdAt: string;
}

function toSstTransaction(row: SstTransactionRow): SstTransaction {
  return {
    id: row.id,
    businessId: row.business_id,
    invoiceId: row.invoice_id,
    paymentVoucherId: row.payment_voucher_id,
    sstCode: row.sst_code,
    rate: row.rate,
    taxableAmount: row.taxable_amount,
    sstAmount: row.sst_amount,
    createdAt: row.created_at,
  };
}

export type SstReturnStatus = "draft" | "submitted";

/** Row shape of public.sst_returns. */
export interface SstReturnRow {
  id: string;
  business_id: string;
  period: string;
  status: SstReturnStatus;
  total_output_tax: number;
  submitted_at: string | null;
  created_by_membership_id: string | null;
  created_at: string;
}

export interface SstReturn {
  id: string;
  businessId: string;
  period: string;
  status: SstReturnStatus;
  totalOutputTax: number;
  submittedAt: string | null;
  createdByMembershipId: string | null;
  createdAt: string;
}

function toSstReturn(row: SstReturnRow): SstReturn {
  return {
    id: row.id,
    businessId: row.business_id,
    period: row.period,
    status: row.status,
    totalOutputTax: row.total_output_tax,
    submittedAt: row.submitted_at,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

// ================================================================
// MyInvoisClient — the actual outbound HTTP call to LHDN, kept
// client-side per the migration's own header note 6 (Postgres never
// makes outbound HTTP calls in this schema). The Postgres side only
// owns state (draft -> submitted -> validated/rejected); this
// interface is what a caller uses to actually talk to MyInvois and
// then reports the outcome back via
// SupabaseEInvoiceSstTransport.recordSubmissionResult.
// ================================================================

export interface MyInvoisValidationRequest {
  submissionId: string;
  /** The invoice's LHDN-shaped payload — left as unknown here; the
   * real client is responsible for building this against MyInvois's
   * actual schema, using MY-EINVOICE-RULES-1.0.0.json's
   * required_invoice_fields as a starting point. */
  payload: unknown;
}

export interface MyInvoisValidationResult {
  status: "validated" | "rejected";
  lhdnUuid: string | null;
  qrCodeRef: string | null;
  /** The raw IRB response, success or rejection — surfaced verbatim,
   * never paraphrased, per this sprint's own DoD wording. */
  irbResponseRef: string;
}

/**
 * Real client-side interface to LHDN's MyInvois API. A real
 * implementation (sandbox, then production) is NOT built this
 * sprint — see this file's own header. Implementations are expected
 * to hold real client ID/secret or certificate credentials and make
 * a real outbound HTTP call; this session never handles those
 * credentials directly (see this project's own standing rule: never
 * expose secrets/API keys/tokens).
 */
export interface MyInvoisClient {
  submitForValidation(request: MyInvoisValidationRequest): Promise<MyInvoisValidationResult>;
}

/**
 * A stub MyInvoisClient — simulates MyInvois's response shape without
 * making any real network call. This is what this sprint actually
 * ships wired up. It always "succeeds" (returns 'validated' with a
 * fabricated UUID/QR) UNLESS the caller opts into simulating a
 * rejection via `simulateRejection`, matching the shape
 * sprint33_einvoice_sst_test.py itself exercises server-side.
 *
 * DO NOT treat a 'validated' result from this stub as proof of a real
 * LHDN sandbox submission — it is not one.
 */
export class StubMyInvoisClient implements MyInvoisClient {
  async submitForValidation(
    request: MyInvoisValidationRequest,
    simulateRejection?: { irbResponseCode: string; irbResponseMessage: string },
  ): Promise<MyInvoisValidationResult> {
    if (simulateRejection) {
      return {
        status: "rejected",
        lhdnUuid: null,
        qrCodeRef: null,
        irbResponseRef: JSON.stringify({
          simulated: true,
          irbResponseCode: simulateRejection.irbResponseCode,
          irbResponseMessage: simulateRejection.irbResponseMessage,
        }),
      };
    }
    const fakeUuid = `SIMULATED-UUID-${request.submissionId.slice(0, 8)}`;
    return {
      status: "validated",
      lhdnUuid: fakeUuid,
      qrCodeRef: `qr/simulated-${request.submissionId.slice(0, 8)}.png`,
      irbResponseRef: JSON.stringify({ simulated: true, irbResponseCode: "OK" }),
    };
  }
}

// ================================================================
// Supabase transport — the Postgres-side state machine and SST
// computation RPCs.
// ================================================================

export interface SupabaseEInvoiceSstTransport {
  /** `capture` on `tax_compliance`. Creates a 'draft' submission for a
   * single Invoice. Throws if that invoice already has an active
   * (non-rejected/cancelled) submission. */
  createSubmission(params: { businessId: string; invoiceId: string }): Promise<EInvoiceSubmission>;

  /** `capture` on `tax_compliance`. Builds a 'draft' consolidated
   * submission for all eligible (non-B2B, per the migration's own
   * header note 4) invoices in the given period. Throws if a
   * consolidated batch already exists for the period, or if no
   * eligible invoices are found.
   *
   * NOTE: which invoices actually landed in the batch is not returned
   * by this call — read `public.e_invoice_submission_lines` (see the
   * migration's own header note 5) directly via the app's normal
   * RLS-governed table access, the same way every other plain table
   * in this schema (parties, products, ...) is read outside these
   * transport files; this file only wraps mutations and computed
   * report functions, matching every sibling transport's own
   * convention. */
  generateConsolidatedBatch(params: {
    businessId: string;
    consolidatedPeriod: string;
  }): Promise<EInvoiceSubmission>;

  /** `capture` on `tax_compliance`. Moves 'draft' -> 'submitted'.
   * Call this immediately before actually calling MyInvoisClient. */
  submitEinvoice(submissionId: string): Promise<EInvoiceSubmission>;

  /** `capture` on `tax_compliance`. Records whatever MyInvoisClient
   * (real or stub) actually returned — 'validated' (with uuid + qr)
   * or 'rejected' (with the IRB rejection reason, verbatim, in
   * irbResponseRef). Throws if the submission isn't currently
   * 'submitted'. */
  recordSubmissionResult(params: {
    submissionId: string;
    status: "validated" | "rejected";
    lhdnUuid?: string | null;
    qrCodeRef?: string | null;
    irbResponseRef?: string | null;
  }): Promise<EInvoiceSubmission>;

  /** `capture` on `tax_compliance`. Computes SST for every
   * tax-code-tagged line on the given Invoice. Throws if already
   * computed for this invoice. */
  computeSstForInvoice(invoiceId: string): Promise<SstTransaction[]>;

  /** `capture` on `tax_compliance`. Computes SST for a Payment
   * Voucher, gated on `payment_vouchers.sst_code` being set. Throws
   * if not set, or already computed. */
  computeSstForPaymentVoucher(paymentVoucherId: string): Promise<SstTransaction>;

  /** `capture` on `tax_compliance`. Aggregates all sst_transactions
   * for the period into a new 'draft' SstReturn. */
  createSstReturn(params: { businessId: string; period: string }): Promise<SstReturn>;

  /** `capture` on `tax_compliance`. Moves 'draft' -> 'submitted'. A
   * lower-fidelity carry-over this sprint (status-flip, not a real
   * Kastam API integration — see the migration's own header note 7). */
  submitSstReturn(sstReturnId: string): Promise<SstReturn>;
}

export function createSupabaseEInvoiceSstTransport(
  client: SupabaseClientLike,
): SupabaseEInvoiceSstTransport {
  return {
    async createSubmission(params) {
      const { data, error } = await client.rpc("create_einvoice_submission", {
        p_business_id: params.businessId,
        p_invoice_id: params.invoiceId,
      });
      if (error) throw error;
      const rows = data as EInvoiceSubmissionRow[];
      return toEInvoiceSubmission(rows[0]);
    },

    async generateConsolidatedBatch(params) {
      const { data, error } = await client.rpc("generate_consolidated_einvoice_batch", {
        p_business_id: params.businessId,
        p_consolidated_period: params.consolidatedPeriod,
      });
      if (error) throw error;
      const rows = data as EInvoiceSubmissionRow[];
      return toEInvoiceSubmission(rows[0]);
    },

    async submitEinvoice(submissionId) {
      const { data, error } = await client.rpc("submit_einvoice", {
        p_submission_id: submissionId,
      });
      if (error) throw error;
      const rows = data as EInvoiceSubmissionRow[];
      return toEInvoiceSubmission(rows[0]);
    },

    async recordSubmissionResult(params) {
      const { data, error } = await client.rpc("record_einvoice_submission_result", {
        p_submission_id: params.submissionId,
        p_status: params.status,
        p_lhdn_uuid: params.lhdnUuid ?? null,
        p_qr_code_ref: params.qrCodeRef ?? null,
        p_irb_response_ref: params.irbResponseRef ?? null,
      });
      if (error) throw error;
      const rows = data as EInvoiceSubmissionRow[];
      return toEInvoiceSubmission(rows[0]);
    },

    async computeSstForInvoice(invoiceId) {
      const { data, error } = await client.rpc("compute_sst_for_invoice", {
        p_invoice_id: invoiceId,
      });
      if (error) throw error;
      return (data as SstTransactionRow[]).map(toSstTransaction);
    },

    async computeSstForPaymentVoucher(paymentVoucherId) {
      const { data, error } = await client.rpc("compute_sst_for_payment_voucher", {
        p_payment_voucher_id: paymentVoucherId,
      });
      if (error) throw error;
      const rows = data as SstTransactionRow[];
      return toSstTransaction(rows[0]);
    },

    async createSstReturn(params) {
      const { data, error } = await client.rpc("create_sst_return", {
        p_business_id: params.businessId,
        p_period: params.period,
      });
      if (error) throw error;
      const rows = data as SstReturnRow[];
      return toSstReturn(rows[0]);
    },

    async submitSstReturn(sstReturnId) {
      const { data, error } = await client.rpc("submit_sst_return", {
        p_sst_return_id: sstReturnId,
      });
      if (error) throw error;
      const rows = data as SstReturnRow[];
      return toSstReturn(rows[0]);
    },
  };
}
