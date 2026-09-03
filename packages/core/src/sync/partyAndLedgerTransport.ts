/**
 * Party, document numbering, Chart of Accounts, bank accounts, and the
 * new server-side ledger — Sprint 26 (Vol 13_0 §3.1 Party, §3.2
 * Document header/line pattern, §3.4 Document numbering, §8 Chart of
 * Accounts).
 *
 * Mirrors approvalEngineTransport.ts's own shape in this same directory.
 *
 * SCOPE NOTE (Sprint 26, disclosed in the migration's own header
 * comment and this sprint's doc Outcomes): `postLedgerEntries` here
 * targets the NEW `public.ledger_entries` table — a real, server-side,
 * multi-user-queryable table Sprint 26 built following `ApprovalTask`'s
 * own Sprint 25 precedent (Vol 13_1 §8 Path A). The EXISTING local-first
 * ledger pipeline (`packages/core/src/db/ledgerRepository.ts`, which
 * writes to each device's own local SQLite and syncs as an encrypted
 * `sync_envelopes` payload) is UNCHANGED by this sprint and does not
 * call anything in this file yet — cutting that pipeline over to post
 * here instead (and migrating each business's historical local ledger
 * data, which only a client holding the Business DEK can decrypt) is
 * flagged as necessary follow-on work for its own dedicated review
 * pass, not attempted blind in this sprint. Do not wire a capture flow
 * to `postLedgerEntries` without first confirming that cutover has
 * actually happened — until then this table is empty of historical
 * data by design.
 */

/** See supabaseTransport.ts's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type PartyType = "customer" | "supplier" | "employee" | "agent" | "dropship_partner";
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type LedgerDirection = "debit" | "credit";
export type DocumentResetPeriod = "never" | "yearly" | "monthly";

/** Row shape of public.parties (Sprint 26, Vol 13_0 §3.1). */
export interface PartyRow {
  id: string;
  business_id: string;
  party_no: string;
  display_name: string;
  legal_name: string | null;
  party_types: PartyType[];
  registration_no: string | null;
  tin: string | null;
  sst_reg_no: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  billing_address: string | null;
  price_type_id: string | null;
  credit_limit: number | null;
  credit_terms_days: number | null;
  status: "active" | "inactive";
  created_by_membership_id: string | null;
  created_at: string;
}

export interface Party {
  id: string;
  businessId: string;
  /** Human-readable "PTY-NNNNNN" display id (Vol 13_0 §3.1) — generated via the same document-numbering mechanism as any other document type, not the primary key. */
  partyNo: string;
  displayName: string;
  legalName: string | null;
  partyTypes: PartyType[];
  registrationNo: string | null;
  tin: string | null;
  sstRegNo: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  billingAddress: string | null;
  priceTypeId: string | null;
  creditLimit: number | null;
  creditTermsDays: number | null;
  status: "active" | "inactive";
  createdByMembershipId: string | null;
  createdAt: string;
}

function toParty(row: PartyRow): Party {
  return {
    id: row.id,
    businessId: row.business_id,
    partyNo: row.party_no,
    displayName: row.display_name,
    legalName: row.legal_name,
    partyTypes: row.party_types,
    registrationNo: row.registration_no,
    tin: row.tin,
    sstRegNo: row.sst_reg_no,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    billingAddress: row.billing_address,
    priceTypeId: row.price_type_id,
    creditLimit: row.credit_limit,
    creditTermsDays: row.credit_terms_days,
    status: row.status,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

/** Row shape of public.chart_of_accounts (Sprint 26, Vol 13_0 §8). */
export interface ChartOfAccountRow {
  id: string;
  business_id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  parent_account_id: string | null;
  is_system: boolean;
  created_at: string;
}

export interface ChartOfAccount {
  id: string;
  businessId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  parentAccountId: string | null;
  /** true for the Vol 11_1 §4.1 Phase 1 seed set — the owner cannot delete these or change their type/code. */
  isSystem: boolean;
  createdAt: string;
}

function toChartOfAccount(row: ChartOfAccountRow): ChartOfAccount {
  return {
    id: row.id,
    businessId: row.business_id,
    accountCode: row.account_code,
    accountName: row.account_name,
    accountType: row.account_type,
    parentAccountId: row.parent_account_id,
    isSystem: row.is_system,
    createdAt: row.created_at,
  };
}

/** Row shape of public.bank_accounts (Sprint 26, Vol 13_0 §8). */
export interface BankAccountRow {
  id: string;
  business_id: string;
  account_name: string;
  ledger_account_id: string;
  opening_balance: number;
  created_at: string;
}

export interface BankAccount {
  id: string;
  businessId: string;
  accountName: string;
  ledgerAccountId: string;
  openingBalance: number;
  createdAt: string;
}

function toBankAccount(row: BankAccountRow): BankAccount {
  return {
    id: row.id,
    businessId: row.business_id,
    accountName: row.account_name,
    ledgerAccountId: row.ledger_account_id,
    openingBalance: row.opening_balance,
    createdAt: row.created_at,
  };
}

/** Row shape of public.ledger_entries (Sprint 26 — see this file's header for the scope note on this table's current status). */
export interface LedgerEntryRow {
  id: string;
  business_id: string;
  business_data_id: string | null;
  chart_of_accounts_id: string;
  direction: LedgerDirection;
  amount: number;
  currency: string;
  posted_at: string;
  reversal_of: string | null;
  posted_by_membership_id: string | null;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  businessId: string;
  businessDataId: string | null;
  chartOfAccountsId: string;
  direction: LedgerDirection;
  amount: number;
  currency: string;
  postedAt: string;
  reversalOf: string | null;
  postedByMembershipId: string | null;
  createdAt: string;
}

function toLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  return {
    id: row.id,
    businessId: row.business_id,
    businessDataId: row.business_data_id,
    chartOfAccountsId: row.chart_of_accounts_id,
    direction: row.direction,
    amount: row.amount,
    currency: row.currency,
    postedAt: row.posted_at,
    reversalOf: row.reversal_of,
    postedByMembershipId: row.posted_by_membership_id,
    createdAt: row.created_at,
  };
}

export interface LedgerEntryInput {
  chartOfAccountsId: string;
  direction: LedgerDirection;
  amount: number;
  currency?: string;
  /** Set only on the entry that reverses an earlier one (Vol 2_2 §6 correction pattern — reverse-and-repost, never edit in place). */
  reversalOf?: string | null;
}

export interface SupabasePartyAndLedgerTransport {
  /** Vol 13_0 §3.1. Capture-gated per party type server-side (an `employee` party needs `capture` on `hr_attendance_leave`; every other type needs `capture` on `sales`) — a caller without the right grant gets a clear rejection, not a swallowed request. */
  createParty(params: {
    businessId: string;
    displayName: string;
    legalName?: string | null;
    partyTypes: PartyType[];
    registrationNo?: string | null;
    tin?: string | null;
    sstRegNo?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    billingAddress?: string | null;
    creditLimit?: number | null;
    creditTermsDays?: number | null;
  }): Promise<Party>;

  /** Vol 13_0 §3.4 — the shared numbering mechanism every document-issuing module reuses; `documentType` is any module-defined string (e.g. 'invoice', 'quotation'). Auto-provisions a sequence with a sensible default prefix on first use if `configureDocumentSequence` was never called for this type. */
  nextDocumentNumber(businessId: string, documentType: string): Promise<string>;

  /** Owner-adjustable per-document-type prefix/reset period (`configure` on `settings`). */
  configureDocumentSequence(params: {
    businessId: string;
    documentType: string;
    prefix: string;
    resetPeriod: DocumentResetPeriod;
  }): Promise<void>;

  /** `configure` on `accounting_reports` — adds a custom (non-system) account alongside the auto-seeded Phase 1 set. */
  createChartOfAccount(params: {
    businessId: string;
    accountCode: string;
    accountName: string;
    accountType: AccountType;
    parentAccountId?: string | null;
  }): Promise<ChartOfAccount>;

  /** `configure` on `accounting_reports` — rejects a `ledgerAccountId` that doesn't belong to `businessId`. */
  createBankAccount(params: {
    businessId: string;
    accountName: string;
    ledgerAccountId: string;
    openingBalance?: number;
  }): Promise<BankAccount>;

  /**
   * Posts a whole balanced batch atomically (Vol 2_2 §6: every posted
   * entry must balance before acceptance — enforced server-side here,
   * not just by caller discipline). `configure` on `accounting_reports`
   * — see this file's header for the current scope of this table.
   */
  postLedgerEntries(params: {
    businessId: string;
    businessDataId?: string | null;
    entries: LedgerEntryInput[];
  }): Promise<LedgerEntry[]>;
}

export function createSupabasePartyAndLedgerTransport(
  client: SupabaseClientLike,
): SupabasePartyAndLedgerTransport {
  return {
    async createParty(params) {
      const { data, error } = await client.rpc("create_party", {
        p_business_id: params.businessId,
        p_display_name: params.displayName,
        p_legal_name: params.legalName ?? null,
        p_party_types: params.partyTypes,
        p_registration_no: params.registrationNo ?? null,
        p_tin: params.tin ?? null,
        p_sst_reg_no: params.sstRegNo ?? null,
        p_contact_phone: params.contactPhone ?? null,
        p_contact_email: params.contactEmail ?? null,
        p_billing_address: params.billingAddress ?? null,
        p_credit_limit: params.creditLimit ?? null,
        p_credit_terms_days: params.creditTermsDays ?? null,
      });
      if (error) throw error;
      return toParty(data as PartyRow);
    },

    async nextDocumentNumber(businessId, documentType) {
      const { data, error } = await client.rpc("next_document_number", {
        p_business_id: businessId,
        p_document_type: documentType,
      });
      if (error) throw error;
      return data as string;
    },

    async configureDocumentSequence(params) {
      const { error } = await client.rpc("configure_document_sequence", {
        p_business_id: params.businessId,
        p_document_type: params.documentType,
        p_prefix: params.prefix,
        p_reset_period: params.resetPeriod,
      });
      if (error) throw error;
    },

    async createChartOfAccount(params) {
      const { data, error } = await client.rpc("create_chart_of_account", {
        p_business_id: params.businessId,
        p_account_code: params.accountCode,
        p_account_name: params.accountName,
        p_account_type: params.accountType,
        p_parent_account_id: params.parentAccountId ?? null,
      });
      if (error) throw error;
      return toChartOfAccount(data as ChartOfAccountRow);
    },

    async createBankAccount(params) {
      const { data, error } = await client.rpc("create_bank_account", {
        p_business_id: params.businessId,
        p_account_name: params.accountName,
        p_ledger_account_id: params.ledgerAccountId,
        p_opening_balance: params.openingBalance ?? 0,
      });
      if (error) throw error;
      return toBankAccount(data as BankAccountRow);
    },

    async postLedgerEntries(params) {
      const { data, error } = await client.rpc("post_ledger_entries", {
        p_business_id: params.businessId,
        p_business_data_id: params.businessDataId ?? null,
        p_entries: params.entries.map((e) => ({
          chart_of_accounts_id: e.chartOfAccountsId,
          direction: e.direction,
          amount: e.amount,
          currency: e.currency ?? "MYR",
          reversal_of: e.reversalOf ?? null,
        })),
      });
      if (error) throw error;
      return (data as LedgerEntryRow[]).map(toLedgerEntry);
    },
  };
}
