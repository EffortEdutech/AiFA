/**
 * Payments, Credit Notes & AR Ageing — Sprint 29 (Vol 13_0 §4:
 * Payment, CreditNote, Invoice.status lifecycle, real AR ageing).
 * Closes the sales cycle Sprint 28 opened.
 *
 * Mirrors quotationInvoiceTransport.ts's own shape in this same
 * directory.
 *
 * OVERDUE NOTE (see the migration's own header note 1): `Invoice`'s
 * own `status` field, as returned anywhere in this codebase, NEVER
 * reads `'overdue'` — that value is only ever produced by
 * `invoiceEffectiveStatus`, computed at read time (today's date vs.
 * `dueDate`, current `outstandingBalance`), never stored. Any UI
 * showing an invoice's status to the user should call
 * `invoiceEffectiveStatus` (or use `arAgeingDetail`, which already
 * applies the same logic) rather than trust `Invoice.status` alone,
 * or a genuinely overdue invoice will display as merely "issued."
 *
 * GATING NOTE: `recordPayment` and `createCreditNote` are gated
 * server-side on EITHER `capture` on `sales` OR `configure` on
 * `accounting_reports` — covering both a Sales Agent marking a sale
 * paid on the spot and a Bookkeeper reconciling it later against a
 * bank statement. See the migration's own header note 4.
 */

/** See supabaseTransport.ts's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type PaymentMethod = "cash" | "bank_transfer" | "cheque" | "card" | "e_wallet";
export type CreditNoteStatus = "draft" | "issued" | "rejected" | "cancelled";
export type AgeingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
/** Every value Invoice.status can hold in the database, PLUS the read-time-only 'overdue' overlay this transport surfaces via invoiceEffectiveStatus/arAgeingDetail. */
export type InvoiceEffectiveStatus =
  | "draft" | "issued" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled";

/** Row shape of public.payments (Sprint 29, Vol 13_0 §4). */
export interface PaymentRow {
  id: string;
  business_id: string;
  invoice_id: string;
  amount: number;
  method: PaymentMethod;
  received_at: string;
  reference: string | null;
  recorded_by_membership_id: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  businessId: string;
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  receivedAt: string;
  reference: string | null;
  recordedByMembershipId: string | null;
  createdAt: string;
}

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    businessId: row.business_id,
    invoiceId: row.invoice_id,
    amount: row.amount,
    method: row.method,
    receivedAt: row.received_at,
    reference: row.reference,
    recordedByMembershipId: row.recorded_by_membership_id,
    createdAt: row.created_at,
  };
}

/** Row shape of public.credit_notes (Sprint 29, Vol 13_0 §4). Single-amount shape — see the migration's own header note 2 on why this isn't a full DocumentHeader/line pair. */
export interface CreditNoteRow {
  id: string;
  business_id: string;
  credit_note_no: string;
  party_id: string;
  source_invoice_id: string;
  status: CreditNoteStatus;
  issue_date: string;
  currency: string;
  grand_total: number;
  reason: string | null;
  captured_by_membership_id: string | null;
  created_at: string;
}

export interface CreditNote {
  id: string;
  businessId: string;
  creditNoteNo: string;
  partyId: string;
  sourceInvoiceId: string;
  /** 'draft' until the linked ApprovalTask resolves — 'issued' (posted, balance reduced) or 'rejected' after. See createCreditNote. */
  status: CreditNoteStatus;
  issueDate: string;
  currency: string;
  grandTotal: number;
  reason: string | null;
  capturedByMembershipId: string | null;
  createdAt: string;
}

function toCreditNote(row: CreditNoteRow): CreditNote {
  return {
    id: row.id,
    businessId: row.business_id,
    creditNoteNo: row.credit_note_no,
    partyId: row.party_id,
    sourceInvoiceId: row.source_invoice_id,
    status: row.status,
    issueDate: row.issue_date,
    currency: row.currency,
    grandTotal: row.grand_total,
    reason: row.reason,
    capturedByMembershipId: row.captured_by_membership_id,
    createdAt: row.created_at,
  };
}

/** One row of public.ar_ageing_detail's result. */
export interface ArAgeingRow {
  invoice_id: string;
  invoice_no: string;
  party_id: string;
  due_date: string;
  outstanding_balance: number;
  days_overdue: number;
  ageing_bucket: AgeingBucket;
}

export interface ArAgeingEntry {
  invoiceId: string;
  invoiceNo: string;
  partyId: string;
  dueDate: string;
  outstandingBalance: number;
  daysOverdue: number;
  ageingBucket: AgeingBucket;
}

function toArAgeingEntry(row: ArAgeingRow): ArAgeingEntry {
  return {
    invoiceId: row.invoice_id,
    invoiceNo: row.invoice_no,
    partyId: row.party_id,
    dueDate: row.due_date,
    outstandingBalance: row.outstanding_balance,
    daysOverdue: row.days_overdue,
    ageingBucket: row.ageing_bucket,
  };
}

export interface SupabasePaymentsCreditNotesTransport {
  /**
   * `capture` on `sales` OR `configure` on `accounting_reports`.
   * Posts the ledger (debit Cash/Bank, credit Accounts Receivable)
   * and recomputes the invoice's status/outstandingBalance
   * atomically. Throws `payment_exceeds_outstanding_balance` rather
   * than allow an overpayment.
   */
  recordPayment(params: {
    businessId: string;
    invoiceId: string;
    amount: number;
    method: PaymentMethod;
    receivedAt?: string;
    reference?: string | null;
  }): Promise<Payment>;

  /**
   * `capture` on `sales` OR `configure` on `accounting_reports`.
   * Drafts a CreditNote and routes it through the real ApprovalTask
   * engine (domain='sales') — it stays 'draft' and the invoice's
   * balance is untouched until that task resolves. Throws
   * `credit_note_exceeds_outstanding_balance` if grandTotal is more
   * than the invoice currently has remaining.
   */
  createCreditNote(params: {
    businessId: string;
    sourceInvoiceId: string;
    grandTotal: number;
    reason?: string | null;
    aiDraftSummary?: string | null;
    autoApproved?: boolean;
  }): Promise<CreditNote>;

  /**
   * Computed at read time, never stored (see this file's header) —
   * the one place `'overdue'` legitimately appears. Use this (or
   * arAgeingDetail, which applies the same logic) instead of trusting
   * an Invoice row's own `status` field for display.
   */
  invoiceEffectiveStatus(invoiceId: string): Promise<InvoiceEffectiveStatus>;

  /**
   * `view` on `accounting_reports`. Real bucketed AR ageing
   * (current / 1-30 / 31-60 / 61-90 / 90+), replacing the flat
   * outstanding-list Vol 6_1 §6 flagged as a gap. Only includes
   * invoices with a nonzero outstandingBalance that aren't
   * draft/cancelled/paid.
   */
  arAgeingDetail(businessId: string): Promise<ArAgeingEntry[]>;
}

export function createSupabasePaymentsCreditNotesTransport(
  client: SupabaseClientLike,
): SupabasePaymentsCreditNotesTransport {
  return {
    async recordPayment(params) {
      const { data, error } = await client.rpc("record_payment", {
        p_business_id: params.businessId,
        p_invoice_id: params.invoiceId,
        p_amount: params.amount,
        p_method: params.method,
        p_received_at: params.receivedAt ?? null,
        p_reference: params.reference ?? null,
      });
      if (error) throw error;
      return toPayment(data as PaymentRow);
    },

    async createCreditNote(params) {
      const { data, error } = await client.rpc("create_credit_note", {
        p_business_id: params.businessId,
        p_source_invoice_id: params.sourceInvoiceId,
        p_grand_total: params.grandTotal,
        p_reason: params.reason ?? null,
        p_ai_draft_summary: params.aiDraftSummary ?? null,
        p_auto_approved: params.autoApproved ?? false,
      });
      if (error) throw error;
      return toCreditNote(data as CreditNoteRow);
    },

    async invoiceEffectiveStatus(invoiceId) {
      const { data, error } = await client.rpc("invoice_effective_status", {
        p_invoice_id: invoiceId,
      });
      if (error) throw error;
      return data as InvoiceEffectiveStatus;
    },

    async arAgeingDetail(businessId) {
      const { data, error } = await client.rpc("ar_ageing_detail", {
        p_business_id: businessId,
      });
      if (error) throw error;
      return (data as ArAgeingRow[]).map(toArAgeingEntry);
    },
  };
}
