/**
 * Legal & Commercial — Sprint 36 (Vol 13_0 §12 Module I: Contracts,
 * Contract Alerts, e-Signature; §12.1 Credit Limit Enforcement). Final
 * sprint of the Phase 3 sprint plan.
 *
 * Mirrors attendanceLeaveCommissionTransport.ts / payrollTransport.ts's
 * own shape in this same directory.
 *
 * ============================================================
 * e-SIGNATURE PROVIDER NOTE: `provider` is a free-form string, not a
 * fixed enum — per the owner's own explicit choice this sprint (asked
 * via AskUserQuestion), `e_signature_envelopes` is a provider-agnostic
 * STUB. The sent -> viewed -> signed -> declined/expired lifecycle
 * below is simulated entirely server-side; nothing in this transport
 * or its backing RPCs calls a real vendor API (DocuSign, Dropbox Sign,
 * or otherwise). Do not present a "signed" envelope to a user as
 * having real legal e-signature backing until a real provider is
 * wired in — see the migration's own header note 1 and the Sprint 36
 * doc's Outcomes for the disclosed DoD gap this leaves open.
 *
 * CREDIT LIMIT OVERRIDE NOTE: `convertQuotationToInvoice` enforces
 * Vol 13_0 §12.1's hard blocking gate and throws `credit_limit_
 * exceeded` when it trips — this is NOT a normal validation error to
 * silently retry. The UI should surface the thrown reason clearly and
 * offer `convertQuotationToInvoiceWithCreditOverride` as an explicit,
 * separate action (never auto-retried), which only succeeds for a
 * caller with `configure` on `settings` and always writes a
 * `credit_limit_override_log` row — "never a silent, unexplained
 * block," per §12.1, cuts both ways: neither the block nor the
 * override happens quietly.
 * ============================================================
 */

/** See supabaseTransport.ts's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type ContractType = "distributor_agreement" | "nda" | "employment_contract" | "other";
export type ContractStatus = "draft" | "pending_signature" | "active" | "expired" | "terminated";
export type ContractAlertType = "renewal_upcoming" | "expiring" | "expired";
export type ContractAlertStatus = "pending" | "acknowledged";
export type ESignatureStatus = "sent" | "viewed" | "signed" | "declined" | "expired";

/** Row shape of public.contracts. */
export interface ContractRow {
  id: string;
  business_id: string;
  counterparty_id: string;
  contract_type: ContractType;
  status: ContractStatus;
  start_date: string | null;
  end_date: string | null;
  auto_renew: boolean;
  renewal_notice_days: number | null;
  document_id: string | null;
  credit_limit_override: number | null;
  created_by_membership_id: string | null;
  created_at: string;
}

export interface Contract {
  id: string;
  businessId: string;
  counterpartyId: string;
  contractType: ContractType;
  status: ContractStatus;
  startDate: string | null;
  endDate: string | null;
  autoRenew: boolean;
  renewalNoticeDays: number | null;
  documentId: string | null;
  /** When set on an 'active' Contract, takes precedence over the counterparty Party's own credit_limit — see Vol 13_0 §12.1. */
  creditLimitOverride: number | null;
  createdByMembershipId: string | null;
  createdAt: string;
}

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

/** Row shape of public.contract_alerts. */
export interface ContractAlertRow {
  id: string;
  contract_id: string;
  alert_type: ContractAlertType;
  trigger_date: string;
  status: ContractAlertStatus;
  notified_at: string | null;
  created_at: string;
}

export interface ContractAlert {
  id: string;
  contractId: string;
  alertType: ContractAlertType;
  /** end_date - renewal_notice_days — when this alert becomes due, not the contract's own expiry date. */
  triggerDate: string;
  status: ContractAlertStatus;
  notifiedAt: string | null;
  createdAt: string;
}

function toContractAlert(row: ContractAlertRow): ContractAlert {
  return {
    id: row.id,
    contractId: row.contract_id,
    alertType: row.alert_type,
    triggerDate: row.trigger_date,
    status: row.status,
    notifiedAt: row.notified_at,
    createdAt: row.created_at,
  };
}

/** Row shape of public.e_signature_envelopes. */
export interface ESignatureEnvelopeRow {
  id: string;
  business_id: string;
  contract_id: string | null;
  quotation_id: string | null;
  provider: string;
  status: ESignatureStatus;
  signed_document_id: string | null;
  created_by_membership_id: string | null;
  created_at: string;
}

export interface ESignatureEnvelope {
  id: string;
  businessId: string;
  /** Exactly one of contractId/quotationId is set. */
  contractId: string | null;
  quotationId: string | null;
  provider: string;
  status: ESignatureStatus;
  signedDocumentId: string | null;
  createdByMembershipId: string | null;
  createdAt: string;
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

/** Row shape of public.credit_limit_override_log. */
export interface CreditLimitOverrideLogRow {
  id: string;
  business_id: string;
  invoice_id: string;
  party_id: string;
  requested_amount: number;
  effective_credit_limit: number;
  outstanding_balance_before: number;
  overridden_by_membership_id: string | null;
  reason: string | null;
  created_at: string;
}

export interface CreditLimitOverrideLogEntry {
  id: string;
  businessId: string;
  invoiceId: string;
  partyId: string;
  requestedAmount: number;
  effectiveCreditLimit: number;
  outstandingBalanceBefore: number;
  overriddenByMembershipId: string | null;
  reason: string | null;
  createdAt: string;
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

/** Row shape of public.invoices as returned by the two invoice-creation RPCs below (see quotationInvoiceTransport.ts for the full InvoiceRow shape used elsewhere). */
export interface InvoiceRow {
  id: string;
  business_id: string;
  invoice_no: string;
  party_id: string;
  status: string;
  grand_total: number;
  outstanding_balance: number;
  [key: string]: unknown;
}

export interface SupabaseLegalCommercialTransport {
  /** `capture` on `legal_contract`. Drafts a Contract and opens its own ApprovalTask. If `endDate` and `renewalNoticeDays` are both given, a ContractAlert is generated immediately (`triggerDate = endDate - renewalNoticeDays`) — the alert becomes due at that lead time, not on `endDate` itself. */
  createContract(params: {
    businessId: string;
    counterpartyId: string;
    contractType: ContractType;
    startDate?: string | null;
    endDate?: string | null;
    autoRenew: boolean;
    renewalNoticeDays?: number | null;
    documentId?: string | null;
    creditLimitOverride?: number | null;
  }): Promise<Contract>;

  /** `view` on `legal_contract`. Lists ContractAlerts whose `triggerDate` has been reached as of `asOf` (default today) and are still 'pending' — also stamps `notifiedAt` the first time each becomes due. */
  listDueContractAlerts(businessId: string, asOf?: string): Promise<ContractAlert[]>;

  /** `capture` on `legal_contract`. Marks a 'pending' ContractAlert as 'acknowledged'. */
  acknowledgeContractAlert(contractAlertId: string): Promise<ContractAlert>;

  /** `capture` on `legal_contract` (for a Contract) or `capture` on `sales` (for a Quotation) — exactly one of `contractId`/`quotationId` must be given. Opens an e-signature envelope; a Contract must be 'pending_signature', a Quotation must be 'sent'. `provider` is free-form (see this file's own provider-agnostic-stub caveat). */
  createEsignatureEnvelope(params: {
    contractId?: string | null;
    quotationId?: string | null;
    provider?: string;
  }): Promise<ESignatureEnvelope>;

  /** Requires `view` on the envelope's own domain. Moves 'sent' -> 'viewed'. */
  markEsignatureEnvelopeViewed(envelopeId: string): Promise<ESignatureEnvelope>;

  /** Requires `capture` on the envelope's own domain. Moves 'sent'/'viewed' -> 'signed', optionally attaching the signed Document. Reflects back onto the parent: a Contract moves 'pending_signature' -> 'active' (start_date set if unset); a Quotation moves 'sent' -> 'accepted'. */
  markEsignatureEnvelopeSigned(envelopeId: string, signedDocumentId?: string | null): Promise<ESignatureEnvelope>;

  /** Requires `capture` on the envelope's own domain. Moves 'sent'/'viewed' -> 'declined'. Does NOT change the parent Contract/Quotation's own status. */
  markEsignatureEnvelopeDeclined(envelopeId: string): Promise<ESignatureEnvelope>;

  /**
   * `capture` on `sales`. Converts an 'accepted' Quotation to an Invoice —
   * SAME RPC/behaviour as Sprint 28, now additionally enforcing Vol 13_0
   * §12.1's credit limit gate. THROWS `credit_limit_exceeded` (not a
   * silent partial success) when the party's outstanding balance plus
   * this invoice's total would exceed their effective credit limit
   * (`Contract.creditLimitOverride` on an 'active' Contract for that
   * party, else `Party.creditLimit`). On that error, do not auto-retry
   * — surface the reason and offer `convertQuotationToInvoiceWithCreditOverride`
   * as a distinct, deliberate action.
   */
  convertQuotationToInvoice(quotationId: string): Promise<InvoiceRow>;

  /** `configure` on `settings` (the explicit owner-level override path — never called automatically). Converts an 'accepted' Quotation to an Invoice bypassing the credit limit gate, and ALWAYS writes a `credit_limit_override_log` row recording the figures and `reason` at the moment of the decision. */
  convertQuotationToInvoiceWithCreditOverride(quotationId: string, reason?: string | null): Promise<InvoiceRow>;
}

export function createSupabaseLegalCommercialTransport(client: SupabaseClientLike): SupabaseLegalCommercialTransport {
  return {
    async createContract(params) {
      const { data, error } = await client.rpc("create_contract", {
        p_business_id: params.businessId,
        p_counterparty_id: params.counterpartyId,
        p_contract_type: params.contractType,
        p_start_date: params.startDate ?? null,
        p_end_date: params.endDate ?? null,
        p_auto_renew: params.autoRenew,
        p_renewal_notice_days: params.renewalNoticeDays ?? null,
        p_document_id: params.documentId ?? null,
        p_credit_limit_override: params.creditLimitOverride ?? null,
      });
      if (error) throw error;
      const rows = data as ContractRow[];
      return toContract(rows[0]);
    },

    async listDueContractAlerts(businessId, asOf) {
      const { data, error } = await client.rpc("list_due_contract_alerts", {
        p_business_id: businessId,
        p_as_of: asOf ?? null,
      });
      if (error) throw error;
      const rows = data as ContractAlertRow[];
      return rows.map(toContractAlert);
    },

    async acknowledgeContractAlert(contractAlertId) {
      const { data, error } = await client.rpc("acknowledge_contract_alert", {
        p_alert_id: contractAlertId,
      });
      if (error) throw error;
      const rows = data as ContractAlertRow[];
      return toContractAlert(rows[0]);
    },

    async createEsignatureEnvelope(params) {
      const { data, error } = await client.rpc("create_esignature_envelope", {
        p_contract_id: params.contractId ?? null,
        p_quotation_id: params.quotationId ?? null,
        p_provider: params.provider ?? "generic",
      });
      if (error) throw error;
      const rows = data as ESignatureEnvelopeRow[];
      return toESignatureEnvelope(rows[0]);
    },

    async markEsignatureEnvelopeViewed(envelopeId) {
      const { data, error } = await client.rpc("mark_esignature_envelope_viewed", {
        p_envelope_id: envelopeId,
      });
      if (error) throw error;
      const rows = data as ESignatureEnvelopeRow[];
      return toESignatureEnvelope(rows[0]);
    },

    async markEsignatureEnvelopeSigned(envelopeId, signedDocumentId) {
      const { data, error } = await client.rpc("mark_esignature_envelope_signed", {
        p_envelope_id: envelopeId,
        p_signed_document_id: signedDocumentId ?? null,
      });
      if (error) throw error;
      const rows = data as ESignatureEnvelopeRow[];
      return toESignatureEnvelope(rows[0]);
    },

    async markEsignatureEnvelopeDeclined(envelopeId) {
      const { data, error } = await client.rpc("mark_esignature_envelope_declined", {
        p_envelope_id: envelopeId,
      });
      if (error) throw error;
      const rows = data as ESignatureEnvelopeRow[];
      return toESignatureEnvelope(rows[0]);
    },

    async convertQuotationToInvoice(quotationId) {
      const { data, error } = await client.rpc("convert_quotation_to_invoice", {
        p_quotation_id: quotationId,
      });
      if (error) throw error;
      const rows = data as InvoiceRow[];
      return rows[0];
    },

    async convertQuotationToInvoiceWithCreditOverride(quotationId, reason) {
      const { data, error } = await client.rpc("convert_quotation_to_invoice_with_credit_override", {
        p_quotation_id: quotationId,
        p_override_reason: reason ?? null,
      });
      if (error) throw error;
      const rows = data as InvoiceRow[];
      return rows[0];
    },
  };
}
