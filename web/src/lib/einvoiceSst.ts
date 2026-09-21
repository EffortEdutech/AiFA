/**
 * e-Invoice submission / SST rate / SST transaction / SST return read
 * helpers — Sprint 44 (Vol 13_0 §9 Module F).
 *
 * Same reasoning as every other lib/*.ts helper this phase:
 * `eInvoiceSstTransport.ts` exposes only mutating/lifecycle RPCs
 * (create*, submit*, record*, compute*) — no list RPC for any of its
 * four readable entities. Reads go directly against the underlying
 * tables; RLS already scopes each one correctly (`view` on
 * `tax_compliance`, except `sst_rates` which is a shared reference
 * catalog open to any authenticated user — see schema.sql's own
 * policies, ~lines 7062/7091/7118/7298/7400).
 */
import { supabase } from "./supabaseClient";
import type {
  EInvoiceSubmission,
  EInvoiceSubmissionRow,
  SstRate,
  SstRateRow,
  SstTransaction,
  SstTransactionRow,
  SstReturn,
  SstReturnRow,
} from "@aifa/core/sync/eInvoiceSstTransport";

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

function toSstRate(row: SstRateRow): SstRate {
  return {
    sstCode: row.sst_code,
    taxType: row.tax_type,
    rate: row.rate,
    description: row.description,
    ruleVersion: row.rule_version,
  };
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

export async function listEInvoiceSubmissions(businessId: string): Promise<EInvoiceSubmission[]> {
  const { data, error } = await supabase
    .from("e_invoice_submissions")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as EInvoiceSubmissionRow[]).map(toEInvoiceSubmission);
}

/** public.sst_rates -- shared reference catalog, not business-scoped. */
export async function listSstRates(): Promise<SstRate[]> {
  const { data, error } = await supabase.from("sst_rates").select("*").order("sst_code");
  if (error) throw error;
  return (data as SstRateRow[]).map(toSstRate);
}

export async function listSstTransactions(businessId: string): Promise<SstTransaction[]> {
  const { data, error } = await supabase
    .from("sst_transactions")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as SstTransactionRow[]).map(toSstTransaction);
}

export async function listSstReturns(businessId: string): Promise<SstReturn[]> {
  const { data, error } = await supabase
    .from("sst_returns")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as SstReturnRow[]).map(toSstReturn);
}

/**
 * public.e_invoice_submission_lines -- not exported by
 * eInvoiceSstTransport.ts (schema-only, per the transport's own note
 * on `generateConsolidatedBatch`: which invoices landed in a
 * consolidated batch is read via normal table access, same as this
 * file's every other read).
 */
export interface EInvoiceSubmissionLine {
  submissionId: string;
  invoiceId: string;
}

interface EInvoiceSubmissionLineRow {
  submission_id: string;
  invoice_id: string;
}

export async function listEInvoiceSubmissionLines(submissionId: string): Promise<EInvoiceSubmissionLine[]> {
  const { data, error } = await supabase
    .from("e_invoice_submission_lines")
    .select("*")
    .eq("submission_id", submissionId);
  if (error) throw error;
  return (data as EInvoiceSubmissionLineRow[]).map((row) => ({
    submissionId: row.submission_id,
    invoiceId: row.invoice_id,
  }));
}
