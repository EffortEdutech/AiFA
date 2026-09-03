/**
 * Quotation & Invoice + WhatsApp Send — Sprint 28 (Vol 13_0 §4 Module
 * A: Invois & Quotation, §4.1 WhatsApp send).
 *
 * Mirrors pricingTransport.ts's own shape in this same directory.
 *
 * APPROVAL NOTE: `createQuotation` routes through the real
 * ApprovalTask engine built in Sprint 25 (domain='sales',
 * subject_type='quotation') — there is no separate approval
 * mechanism here. Callers should surface the created quotation's
 * pending approval state by querying approval_tasks for
 * subject_type='quotation'/subject_id=<the new id> (not yet wrapped
 * in this transport — approvalEngineTransport.ts in this same
 * directory already exposes decide/delegate calls against that same
 * table).
 *
 * WHATSAPP SEND NOTE (Vol 13_0 §4.1, owner's Sprint 21 choice):
 * `buildWhatsAppQuotationLink` returns a `wa.me` click-to-chat URL
 * and pre-filled message text — the app opens it, the OWNER taps
 * Send themselves inside WhatsApp. This is not "AiFA sends it,"
 * matching the owner's own stated reasoning for choosing click-to-
 * chat over the WhatsApp Business Platform (zero external account
 * setup). `markQuotationSent` is a deliberate, separate, self-
 * reported confirmation call — the server has no way to observe an
 * external WhatsApp send, so the app should call it only after the
 * owner has actually completed that tap.
 *
 * PDF GENERATION NOTE (disclosed scope boundary): Vol 13_0 §4.1
 * describes the click-to-chat message as accompanied by a PDF/link.
 * This sprint's server-side work builds the message text and wa.me
 * link only — rendering the quotation itself as a PDF is a client-
 * side document-rendering concern (the existing pdf skill/pipeline
 * the app already uses elsewhere), not a database or transport
 * concern, and is not implemented in this file. Wire a PDF/share-link
 * step into the send flow before shipping the WhatsApp send UI.
 */

/** See supabaseTransport.ts's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired" | "converted_to_invoice";
export type InvoiceStatus = "draft" | "issued" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled";
export type EInvoiceStatus = "not_applicable" | "pending" | "validated" | "rejected";

/** Row shape of public.quotations (Sprint 28, Vol 13_0 §4). */
export interface QuotationRow {
  id: string;
  business_id: string;
  quotation_no: string;
  party_id: string;
  status: QuotationStatus;
  issue_date: string;
  valid_until: string | null;
  currency: string;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  notes: string | null;
  converted_invoice_id: string | null;
  captured_by_membership_id: string | null;
  created_at: string;
}

export interface Quotation {
  id: string;
  businessId: string;
  quotationNo: string;
  partyId: string;
  status: QuotationStatus;
  issueDate: string;
  validUntil: string | null;
  currency: string;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  notes: string | null;
  /**
   * Set once converted (Vol 13_0 §4's `converted_invoice_id`). Note
   * `status` reaches 'converted_to_invoice' at the same time this is
   * set — check both if the UI wants to short-circuit on the id
   * alone.
   */
  convertedInvoiceId: string | null;
  capturedByMembershipId: string | null;
  createdAt: string;
}

function toQuotation(row: QuotationRow): Quotation {
  return {
    id: row.id,
    businessId: row.business_id,
    quotationNo: row.quotation_no,
    partyId: row.party_id,
    status: row.status,
    issueDate: row.issue_date,
    validUntil: row.valid_until,
    currency: row.currency,
    subtotal: row.subtotal,
    taxTotal: row.tax_total,
    grandTotal: row.grand_total,
    notes: row.notes,
    convertedInvoiceId: row.converted_invoice_id,
    capturedByMembershipId: row.captured_by_membership_id,
    createdAt: row.created_at,
  };
}

/** Row shape of public.invoices (Sprint 28, Vol 13_0 §4). */
export interface InvoiceRow {
  id: string;
  business_id: string;
  invoice_no: string;
  party_id: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  currency: string;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  notes: string | null;
  source_quotation_id: string | null;
  delivery_order_id: string | null;
  e_invoice_status: EInvoiceStatus;
  outstanding_balance: number;
  captured_by_membership_id: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  businessId: string;
  invoiceNo: string;
  partyId: string;
  status: InvoiceStatus;
  issueDate: string;
  /** Computed from Party.creditTermsDays at conversion time (defaults to 0 days — due on issue — when the party has no credit term set; see the migration's own header note). */
  dueDate: string;
  currency: string;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  notes: string | null;
  sourceQuotationId: string | null;
  /** Stubbed only this sprint — public.delivery_orders doesn't exist until Sprint 31 (Module D). Always null until then. */
  deliveryOrderId: string | null;
  eInvoiceStatus: EInvoiceStatus;
  /**
   * Set once, at creation, equal to grandTotal, and NOT kept in sync
   * with payments this sprint — public.payments doesn't exist until
   * Sprint 29. Do not treat this as a live balance until Sprint 29
   * ships; it will always read as the full grand total until then.
   */
  outstandingBalance: number;
  capturedByMembershipId: string | null;
  createdAt: string;
}

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    businessId: row.business_id,
    invoiceNo: row.invoice_no,
    partyId: row.party_id,
    status: row.status,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    currency: row.currency,
    subtotal: row.subtotal,
    taxTotal: row.tax_total,
    grandTotal: row.grand_total,
    notes: row.notes,
    sourceQuotationId: row.source_quotation_id,
    deliveryOrderId: row.delivery_order_id,
    eInvoiceStatus: row.e_invoice_status,
    outstandingBalance: row.outstanding_balance,
    capturedByMembershipId: row.captured_by_membership_id,
    createdAt: row.created_at,
  };
}

/** One input line for createQuotation. Omit unitPrice to resolve it server-side via PRICE-001 (requires productId); supply unitPrice directly for a non-catalog line. */
export interface QuotationLineInput {
  productId?: string | null;
  description: string;
  quantity: number;
  /** Omit to resolve via Sprint 27's resolve_price (PRICE-001) against the quotation's party — requires productId. Supply to override (e.g. a manual, non-catalog line). */
  unitPrice?: number;
  discountAmount?: number;
}

export interface ResolvedWhatsAppLink {
  /** Digits-only phone number (country code + number, no '+' or separators) actually used to build the link. */
  phoneE164: string;
  messageText: string;
  /** `https://wa.me/<phone>?text=<url-encoded message>` — open this to launch WhatsApp with the message pre-filled; the owner still has to tap Send themselves (Vol 13_0 §4.1). */
  waLink: string;
}

export interface SupabaseQuotationInvoiceTransport {
  /**
   * `capture` on `sales`. Drafts a Quotation + lines (resolving each
   * line's price via PRICE-001 unless overridden) and creates a real
   * ApprovalTask (domain='sales', subject_type='quotation',
   * onApprovalAction='send WhatsApp') through Sprint 25's engine.
   * Pass `autoApproved: true` only for the same ≥90%-confidence
   * shortcut every other domain already uses (Vol 13_0 §3.3) — never
   * for payroll-adjacent flows, and this function does not itself
   * decide when that's appropriate.
   */
  createQuotation(params: {
    businessId: string;
    partyId: string;
    validUntil?: string | null;
    notes?: string | null;
    lines: QuotationLineInput[];
    aiDraftSummary?: string | null;
    autoApproved?: boolean;
  }): Promise<Quotation>;

  /**
   * `capture` on `sales`. Throws `quotation_not_yet_approved` unless
   * the quotation's linked ApprovalTask has resolved to `approved` or
   * `auto_approved`, and `party_has_no_contact_phone` if the party
   * has none on file.
   */
  buildWhatsAppQuotationLink(quotationId: string): Promise<ResolvedWhatsAppLink>;

  /**
   * `capture` on `sales`. Self-reported confirmation that the owner
   * actually tapped Send in WhatsApp (see this file's header) — call
   * only after that's actually happened, not right after generating
   * the link. Requires the quotation to be in `draft` status with an
   * approved task.
   */
  markQuotationSent(quotationId: string): Promise<Quotation>;

  /** `capture` on `sales`. sent -> accepted (the customer said yes — via reply, phone call, etc.; there is no automated reply-detection channel yet). */
  markQuotationAccepted(quotationId: string): Promise<Quotation>;

  /** `capture` on `sales`. sent -> rejected (the customer declined). Distinct call from an internal approval-task rejection, though both land on the same `rejected` status value — see the migration's own header note on this Phase 1 simplification. */
  markQuotationRejected(quotationId: string): Promise<Quotation>;

  /**
   * `capture` on `sales`. Requires the quotation to be `accepted`.
   * Copies lines into a new Invoice, computes `dueDate` from the
   * party's `creditTermsDays`, links both records, and posts the
   * SALE-001 ledger entries (debit Accounts Receivable, credit Sales
   * Revenue) for the invoice's grand total.
   */
  convertQuotationToInvoice(quotationId: string): Promise<Invoice>;
}

export function createSupabaseQuotationInvoiceTransport(
  client: SupabaseClientLike,
): SupabaseQuotationInvoiceTransport {
  return {
    async createQuotation(params) {
      const { data, error } = await client.rpc("create_quotation", {
        p_business_id: params.businessId,
        p_party_id: params.partyId,
        p_valid_until: params.validUntil ?? null,
        p_notes: params.notes ?? null,
        p_lines: params.lines.map((l) => ({
          product_id: l.productId ?? null,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unitPrice ?? null,
          discount_amount: l.discountAmount ?? 0,
        })),
        p_ai_draft_summary: params.aiDraftSummary ?? null,
        p_auto_approved: params.autoApproved ?? false,
      });
      if (error) throw error;
      return toQuotation(data as QuotationRow);
    },

    async buildWhatsAppQuotationLink(quotationId) {
      const { data, error } = await client.rpc("build_whatsapp_quotation_link", {
        p_quotation_id: quotationId,
      });
      if (error) throw error;
      const rows = data as Array<{ phone_e164: string; message_text: string; wa_link: string }>;
      const row = rows[0];
      return { phoneE164: row.phone_e164, messageText: row.message_text, waLink: row.wa_link };
    },

    async markQuotationSent(quotationId) {
      const { data, error } = await client.rpc("mark_quotation_sent", { p_quotation_id: quotationId });
      if (error) throw error;
      return toQuotation(data as QuotationRow);
    },

    async markQuotationAccepted(quotationId) {
      const { data, error } = await client.rpc("mark_quotation_accepted", { p_quotation_id: quotationId });
      if (error) throw error;
      return toQuotation(data as QuotationRow);
    },

    async markQuotationRejected(quotationId) {
      const { data, error } = await client.rpc("mark_quotation_rejected", { p_quotation_id: quotationId });
      if (error) throw error;
      return toQuotation(data as QuotationRow);
    },

    async convertQuotationToInvoice(quotationId) {
      const { data, error } = await client.rpc("convert_quotation_to_invoice", {
        p_quotation_id: quotationId,
      });
      if (error) throw error;
      return toInvoice(data as InvoiceRow);
    },
  };
}
