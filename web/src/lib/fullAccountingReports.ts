/**
 * Bank statement line read helper — Sprint 43 (Vol 13_0 §8 Module E).
 *
 * Every OTHER read this sprint needs (Trial Balance, Balance Sheet,
 * General Ledger detail, Tax Report Placeholder) is a genuine RPC on
 * `fullAccountingReportsTransport.ts` and is called directly from
 * there — no duplication needed, unlike the "no list RPC" lib helpers
 * elsewhere in this phase. `bank_statement_lines` is the one exception:
 * `importBankStatementLines`/`matchBankStatementLine`/
 * `ignoreBankStatementLine` are mutating-only, so listing the lines
 * for a bank account to actually build a reconciliation UI reads
 * directly against the table. RLS scopes this correctly (see
 * schema.sql's own "Active members can view their business's bank
 * statement lines" policy — join through bank_accounts, no
 * business_id column on this table itself).
 */
import { supabase } from "./supabaseClient";
import type { BankStatementLine, BankStatementLineRow } from "@aifa/core/sync/fullAccountingReportsTransport";

function toBankStatementLine(row: BankStatementLineRow): BankStatementLine {
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    statementDate: row.statement_date,
    description: row.description,
    amount: row.amount,
    matchedLedgerEntryId: row.matched_ledger_entry_id,
    matchStatus: row.match_status,
    createdAt: row.created_at,
  };
}

export async function listBankStatementLines(bankAccountId: string): Promise<BankStatementLine[]> {
  const { data, error } = await supabase
    .from("bank_statement_lines")
    .select("*")
    .eq("bank_account_id", bankAccountId)
    .order("statement_date", { ascending: false });
  if (error) throw error;
  return (data as BankStatementLineRow[]).map(toBankStatementLine);
}
