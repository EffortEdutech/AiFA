/**
 * Contract / ContractAlert / e-Signature Envelope / Credit Limit
 * Override Log read helpers — Sprint 47 (Vol 13_0 §12 Module I).
 *
 * Same "no list RPC" reasoning as every other lib/*.ts helper this
 * phase: `legalCommercialTransport.ts` exposes mutating/lifecycle
 * calls plus exactly one genuine read RPC (`listDueContractAlerts`,
 * called directly from the transport by the page — it also stamps
 * `notifiedAt` on first-due alerts, so it is deliberately NOT
 * duplicated here). Listing ALL Contracts, ALL e-Signature Envelopes,
 * or Credit Limit Override Log entries has no RPC, so those three
 * reads go directly against the underlying Postgres tables below,
 * relying on RLS (see schema.sql's own policies for `contracts`,
 * `e_signature_envelopes`, `credit_limit_override_log`).
 *
 * `credit_limit_override_log` RLS requires `configure` on `settings`
 * OR `view` on `accounting_reports` — the same "settings configure"
 * gate that `convertQuotationToInvoiceWithCreditOverride` itself
 * requires to succeed at all, so a caller who just performed an
 * override can always read back the row it wrote.
 */
import { supabase } from "./supabaseClient";
import type {
  Contract,
  ContractRow,
  ESignatureEnvelope,
  ESignatureEnvelopeRow,
  CreditLimitOverrideLogEntry,
  CreditLimitOverrideLogRow,
} from "@aifa/core/sync/legalCommercialTransport";

function toContract(row: ContractRow): Contract {
  return {
    id: row.id,
    businessId: row.business_id,
    counterpartyId: row.counterparty_id,
    contractType: row.contract_type,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    autoRenew: row.auto_renew,
    renewalNoticeDays: row.renewal_notice_days,
    documentId: row.document_id,
    creditLimitOverride: row.credit_limit_override,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

function toESignatureEnvelope(row: ESignatureEnvelopeRow): ESignatureEnvelope {
  return {
    id: row.id,
    businessId: row.business_id,
    contractId: row.contract_id,
    quotationId: row.quotation_id,
    provider: row.provider,
    status: row.status,
    signedDocumentId: row.signed_document_id,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

function toCreditLimitOverrideLogEntry(row: CreditLimitOverrideLogRow): CreditLimitOverrideLogEntry {
  return {
    id: row.id,
    businessId: row.business_id,
    invoiceId: row.invoice_id,
    partyId: row.party_id,
    requestedAmount: row.requested_amount,
    effectiveCreditLimit: row.effective_credit_limit,
    outstandingBalanceBefore: row.outstanding_balance_before,
    overriddenByMembershipId: row.overridden_by_membership_id,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export async function listContracts(businessId: string): Promise<Contract[]> {
  const { data, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as ContractRow[]).map(toContract);
}

export async function listESignatureEnvelopes(businessId: string): Promise<ESignatureEnvelope[]> {
  const { data, error } = await supabase
    .from("e_signature_envelopes")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as ESignatureEnvelopeRow[]).map(toESignatureEnvelope);
}

/** Used to show an override action's own logged reason/figures back to the user right after it succeeds — see this file's own header. */
export async function listCreditLimitOverrideLogForInvoice(invoiceId: string): Promise<CreditLimitOverrideLogEntry[]> {
  const { data, error } = await supabase
    .from("credit_limit_override_log")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as CreditLimitOverrideLogRow[]).map(toCreditLimitOverrideLogEntry);
}

/**
 * Best-effort per-counterparty active-Contract override lookup, used
 * to reflect `Contract.credit_limit_override` precedence over a
 * Party's own `creditLimit` wherever a credit limit is displayed (Vol
 * 13_0 §12.1). Mirrors the backend's own `_create_invoice_from_quotation`
 * tie-break — most-recently-created active Contract with a non-null
 * override wins when more than one exists for the same counterparty.
 */
export function effectiveCreditLimitOverrideByParty(contracts: Contract[]): Record<string, number> {
  const result: Record<string, number> = {};
  const sorted = [...contracts].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  for (const c of sorted) {
    if (c.status === "active" && c.creditLimitOverride != null && !(c.counterpartyId in result)) {
      result[c.counterpartyId] = c.creditLimitOverride;
    }
  }
  return result;
}
