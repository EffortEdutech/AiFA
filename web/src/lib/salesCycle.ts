/**
 * Quotation / Invoice / Payment / Credit Note read helpers — Sprint 40
 * (Vol 13_0 §4: Module A Invois & Quotation, Module B Payments/Credit
 * Notes/AR Ageing).
 *
 * Same reasoning as partiesAndAccounts.ts/productsAndPricing.ts:
 * `quotationInvoiceTransport.ts` and `paymentsCreditNotesTransport.ts`
 * expose only mutating/lifecycle calls (create*, mark*, convert*,
 * recordPayment, createCreditNote) plus two genuine read RPCs
 * (`invoiceEffectiveStatus`, `arAgeingDetail`, both already wrapped in
 * paymentsCreditNotesTransport.ts and used directly from there — not
 * duplicated here). Listing Quotation/Invoice/QuotationLine/
 * InvoiceLine/Payment/CreditNote has no transport-level RPC at all, so
 * reads go directly against the underlying tables (RLS already scopes
 * each one correctly on `view` on `sales` — see app/backend/schema.sql
 * lines ~4536-4650 and ~5029-5071).
 */
import { supabase } from "./supabaseClient";
import type { Quotation, QuotationRow, Invoice, InvoiceRow } from "@aifa/core/sync/quotationInvoiceTransport";
import type { Payment, PaymentRow, CreditNote, CreditNoteRow } from "@aifa/core/sync/paymentsCreditNotesTransport";

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

export async function listQuotations(businessId: string): Promise<Quotation[]> {
  const { data, error } = await supabase
    .from("quotations")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as QuotationRow[]).map(toQuotation);
}

export async function listInvoices(businessId: string): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as InvoiceRow[]).map(toInvoice);
}

export async function listPayments(businessId: string): Promise<Payment[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("business_id", businessId)
    .order("received_at", { ascending: false });
  if (error) throw error;
  return (data as PaymentRow[]).map(toPayment);
}

export async function listCreditNotes(businessId: string): Promise<CreditNote[]> {
  const { data, error } = await supabase
    .from("credit_notes")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as CreditNoteRow[]).map(toCreditNote);
}

/** One line of public.quotation_lines / public.invoice_lines — both
 * tables share this shape (see schema.sql), so one interface covers
 * both reads below. */
export interface SalesLine {
  id: string;
  lineNo: number;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  unitCost: number | null;
  taxCode: string | null;
  discountAmount: number;
  lineTotal: number;
}

interface SalesLineRow {
  id: string;
  line_no: number;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  unit_cost: number | null;
  tax_code: string | null;
  discount_amount: number;
  line_total: number;
}

function toSalesLine(row: SalesLineRow): SalesLine {
  return {
    id: row.id,
    lineNo: row.line_no,
    productId: row.product_id,
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    unitCost: row.unit_cost,
    taxCode: row.tax_code,
    discountAmount: row.discount_amount,
    lineTotal: row.line_total,
  };
}

export async function listQuotationLines(quotationId: string): Promise<SalesLine[]> {
  const { data, error } = await supabase
    .from("quotation_lines")
    .select("*")
    .eq("quotation_id", quotationId)
    .order("line_no", { ascending: true });
  if (error) throw error;
  return (data as SalesLineRow[]).map(toSalesLine);
}

export async function listInvoiceLines(invoiceId: string): Promise<SalesLine[]> {
  const { data, error } = await supabase
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("line_no", { ascending: true });
  if (error) throw error;
  return (data as SalesLineRow[]).map(toSalesLine);
}

export async function listPaymentsForInvoice(invoiceId: string): Promise<Payment[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("received_at", { ascending: false });
  if (error) throw error;
  return (data as PaymentRow[]).map(toPayment);
}

export async function listCreditNotesForInvoice(invoiceId: string): Promise<CreditNote[]> {
  const { data, error } = await supabase
    .from("credit_notes")
    .select("*")
    .eq("source_invoice_id", invoiceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as CreditNoteRow[]).map(toCreditNote);
}
