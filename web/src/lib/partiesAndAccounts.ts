/**
 * Party / Chart of Accounts / Bank Account / Ledger read helpers —
 * Sprint 39 (Vol 13_0 §3.1, §8).
 *
 * Same reasoning as membership.ts/approvals.ts: `partyAndLedgerTransport.ts`
 * exposes only mutating calls (create*) plus `postLedgerEntries` and
 * `nextDocumentNumber` — no list/read call for any of these four
 * entities. Reads go directly against the underlying tables (RLS
 * already scopes each one correctly, see app/backend/schema.sql's own
 * policies), except the Ledger, which has a purpose-built read RPC
 * (`general_ledger_detail`, Sprint 32) that is more correct than a raw
 * `ledger_entries` select would be (opening-balance-aware running
 * total) — that RPC exists in the schema but was never wrapped in
 * `partyAndLedgerTransport.ts`'s own shared interface, so it's called
 * directly here via `.rpc()`, the same low-level mechanism that
 * transport's own generated functions use internally.
 */
import { supabase } from "./supabaseClient";
import type { Party, PartyRow, ChartOfAccount, ChartOfAccountRow, BankAccount, BankAccountRow } from "@aifa/core/sync/partyAndLedgerTransport";

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

export async function listParties(businessId: string): Promise<Party[]> {
  const { data, error } = await supabase
    .from("parties")
    .select("*")
    .eq("business_id", businessId)
    .order("display_name", { ascending: true });
  if (error) throw error;
  return (data as PartyRow[]).map(toParty);
}

export async function listChartOfAccounts(businessId: string): Promise<ChartOfAccount[]> {
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select("*")
    .eq("business_id", businessId)
    .order("account_code", { ascending: true });
  if (error) throw error;
  return (data as ChartOfAccountRow[]).map(toChartOfAccount);
}

export async function listBankAccounts(businessId: string): Promise<BankAccount[]> {
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("*")
    .eq("business_id", businessId)
    .order("account_name", { ascending: true });
  if (error) throw error;
  return (data as BankAccountRow[]).map(toBankAccount);
}

export interface GeneralLedgerRow {
  entryId: string;
  postedAt: string;
  direction: "debit" | "credit";
  amount: number;
  runningBalance: number;
}

/** Vol 13_0 §8 — Sprint 32's `general_ledger_detail`, called directly
 * (see this file's own header for why it isn't wrapped in
 * partyAndLedgerTransport.ts). */
export async function generalLedgerDetail(
  businessId: string,
  accountId: string,
  dateFrom: string,
  dateTo: string,
): Promise<GeneralLedgerRow[]> {
  const { data, error } = await supabase.rpc("general_ledger_detail", {
    p_business_id: businessId,
    p_account_id: accountId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (error) throw error;
  return (data as Array<{ entry_id: string; posted_at: string; direction: "debit" | "credit"; amount: number; running_balance: number }>).map(
    (r) => ({
      entryId: r.entry_id,
      postedAt: r.posted_at,
      direction: r.direction,
      amount: r.amount,
      runningBalance: r.running_balance,
    }),
  );
}
