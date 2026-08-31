/**
 * Banking repository — Vol 6_4 (Banking Operations), Sprint 7. Manual
 * entry only in Phase 1 (Vol 0_1 §4) — deterministic, rule-based posting,
 * not AI-classified the way Expense/Sale/Purchase are (there is no
 * ambiguous category to guess: the transaction type the owner picks
 * fully determines the posting shape). BANK-001 in accounting_rules.json
 * documents this rule for governance/audit provenance even though it is
 * not run through the PCB/AiProvider machinery.
 */
import {
  ACCOUNTS_PAYABLE_ACCOUNT,
  ACCOUNTS_RECEIVABLE_ACCOUNT,
  CASH_BANK_ACCOUNT,
} from "./accounts";
import {
  recordManualCapture,
  type BusinessData,
  type BusinessEvent,
} from "./businessEventRepository";
import {
  createLedgerEntries,
  listLedgerEntriesForBusinessData,
} from "./ledgerRepository";
import type { SqlDb } from "./types";

export type BankTransactionType =
  "deposit" | "withdrawal" | "transfer" | "bank_fee";

/** Generic Phase 1 placeholder for a bank movement with no tied receivable/payable — see the module comment and accounting_rules.json's BANK-001 for why Owner's Equity / Drawings is the chosen bucket rather than leaving it uncategorised. */
const OWNERS_EQUITY_ACCOUNT = "Owner's Equity / Drawings";
const BANK_FEES_ACCOUNT = "Operating Expenses:Bank Fees";

export interface RecordBankTransactionInput {
  businessId: string;
  transactionType: BankTransactionType;
  description: string;
  amount: number;
  currency: string;
  /**
   * Only meaningful for deposit/withdrawal (Vol 6_4 §4 reconciliation) —
   * the BusinessData id of an existing outstanding Sale (for a deposit) or
   * Purchase (for a withdrawal) this transaction fully settles. Omit for a
   * standalone/unmatched transaction. Partial settlement is not supported
   * in Phase 1 — the amount must exactly equal the outstanding balance.
   */
  matchBusinessDataId?: string;
}

export interface RecordBankTransactionResult {
  event: BusinessEvent;
  data: BusinessData;
  matched: boolean;
}

interface BusinessDataRow {
  id: string;
  business_event_id: string;
  type: "sale" | "purchase" | "expense" | "bank_transaction";
}

async function getBusinessDataById(
  db: SqlDb,
  id: string,
): Promise<BusinessDataRow | null> {
  const rows = await db.queryAll<BusinessDataRow>(
    `SELECT id, business_event_id, type FROM business_data WHERE id = ?;`,
    [id],
  );
  return rows[0] ?? null;
}

/** Net balance of `account` for one BusinessData row, from its own ledger_entries — the same SUM(debit)-SUM(credit)/SUM(credit)-SUM(debit) shape financialSummaryRepository.ts's outstanding queries rely on, applied to a single row instead of a GROUP BY. */
async function getNetBalance(
  db: SqlDb,
  businessDataId: string,
  account: string,
  netDirection: "debit" | "credit",
): Promise<number> {
  const entries = (
    await listLedgerEntriesForBusinessData(db, businessDataId)
  ).filter((e) => e.account === account);
  const debitTotal = entries
    .filter((e) => e.direction === "debit")
    .reduce((sum, e) => sum + e.amount, 0);
  const creditTotal = entries
    .filter((e) => e.direction === "credit")
    .reduce((sum, e) => sum + e.amount, 0);
  return netDirection === "debit"
    ? debitTotal - creditTotal
    : creditTotal - debitTotal;
}

async function alreadyReconciled(
  db: SqlDb,
  matchedBusinessDataId: string,
): Promise<boolean> {
  const rows = await db.queryAll<{ id: string }>(
    `SELECT id FROM bank_reconciliations WHERE matched_business_data_id = ?;`,
    [matchedBusinessDataId],
  );
  return rows.length > 0;
}

/**
 * Settles a Deposit against an outstanding Sale (receivable) or a
 * Withdrawal against an outstanding Purchase (payable): posts the
 * offsetting ledger pair against the ORIGINAL BusinessData row (so
 * getOutstandingReceivables/Payables nets it to zero automatically, no
 * query changes needed), then records the bank_reconciliations link for
 * audit traceability (Vol 6_4 §4).
 */
async function settleAgainstMatch(
  db: SqlDb,
  bankEventId: string,
  transactionType: "deposit" | "withdrawal",
  matchBusinessDataId: string,
  amount: number,
  currency: string,
): Promise<void> {
  const matched = await getBusinessDataById(db, matchBusinessDataId);
  if (!matched) {
    throw new Error(`Business Data '${matchBusinessDataId}' not found.`);
  }
  if (transactionType === "deposit" && matched.type !== "sale") {
    throw new Error(
      `A deposit can only be matched to an outstanding sale (receivable); '${matchBusinessDataId}' is '${matched.type}'.`,
    );
  }
  if (transactionType === "withdrawal" && matched.type !== "purchase") {
    throw new Error(
      `A withdrawal can only be matched to an outstanding purchase (payable); '${matchBusinessDataId}' is '${matched.type}'.`,
    );
  }
  if (await alreadyReconciled(db, matchBusinessDataId)) {
    throw new Error(
      `Business Data '${matchBusinessDataId}' has already been reconciled against a bank transaction.`,
    );
  }

  const account =
    transactionType === "deposit"
      ? ACCOUNTS_RECEIVABLE_ACCOUNT
      : ACCOUNTS_PAYABLE_ACCOUNT;
  const netDirection = transactionType === "deposit" ? "debit" : "credit";
  const outstanding = await getNetBalance(
    db,
    matchBusinessDataId,
    account,
    netDirection,
  );

  if (Math.abs(outstanding - amount) > 0.005) {
    throw new Error(
      `Amount ${amount} does not match the outstanding balance ${outstanding} on '${matchBusinessDataId}' — Phase 1 only supports settling the full outstanding amount, not a partial payment.`,
    );
  }

  // Settlement is the mirror image of the original posting: reduce the
  // receivable/payable, move Cash/Bank the other way. Uses idVariant
  // "SETL" so these ids don't collide with the original DR/CR postings on
  // the same BusinessData row (see ledgerRepository.ts's comment).
  if (transactionType === "deposit") {
    await createLedgerEntries(db, [
      {
        businessDataId: matchBusinessDataId,
        account: CASH_BANK_ACCOUNT,
        direction: "debit",
        amount,
        currency,
        idVariant: "SETL",
      },
      {
        businessDataId: matchBusinessDataId,
        account: ACCOUNTS_RECEIVABLE_ACCOUNT,
        direction: "credit",
        amount,
        currency,
        idVariant: "SETL",
      },
    ]);
  } else {
    await createLedgerEntries(db, [
      {
        businessDataId: matchBusinessDataId,
        account: ACCOUNTS_PAYABLE_ACCOUNT,
        direction: "debit",
        amount,
        currency,
        idVariant: "SETL",
      },
      {
        businessDataId: matchBusinessDataId,
        account: CASH_BANK_ACCOUNT,
        direction: "credit",
        amount,
        currency,
        idVariant: "SETL",
      },
    ]);
  }

  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO bank_reconciliations (id, bank_event_id, matched_business_data_id, matched_at)
     VALUES (?, ?, ?, ?);`,
    [
      `RECON-${bankEventId.replace(/^BE-/, "")}`,
      bankEventId,
      matchBusinessDataId,
      now,
    ],
  );
}

function unmatchedLedgerAccounts(
  transactionType: "deposit" | "withdrawal" | "bank_fee",
): { debitAccount: string; creditAccount: string } {
  switch (transactionType) {
    case "deposit":
      // Money in with no tied receivable -- treated as a generic
      // capital-in placeholder (Vol 6_4 §5, BANK-001).
      return {
        debitAccount: CASH_BANK_ACCOUNT,
        creditAccount: OWNERS_EQUITY_ACCOUNT,
      };
    case "withdrawal":
      return {
        debitAccount: OWNERS_EQUITY_ACCOUNT,
        creditAccount: CASH_BANK_ACCOUNT,
      };
    case "bank_fee":
      return {
        debitAccount: BANK_FEES_ACCOUNT,
        creditAccount: CASH_BANK_ACCOUNT,
      };
  }
}

/**
 * Records a Banking BusinessEvent (Deposit/Withdrawal/Transfer/Bank Fee,
 * Vol 6_4 §2) and applies its deterministic ledger effect. Confirmed
 * immediately (via recordManualCapture) — no draft/clarify states, since
 * Banking is manual-entry only in Phase 1 and there is nothing for an AI
 * classifier to be uncertain about here.
 *
 *  - Transfer: recorded for audit trail, posts NO ledger entries. Phase 1
 *    has a single undifferentiated Cash/Bank account (Vol 11_1 §4.1); a
 *    transfer between the business's own bank accounts is invisible to a
 *    single-account model (both legs would be the same account).
 *  - Bank Fee: always unmatched -- debits Operating Expenses:Bank Fees,
 *    credits Cash/Bank.
 *  - Deposit/Withdrawal WITH matchBusinessDataId: settles the matched
 *    outstanding Sale/Purchase in full (see settleAgainstMatch) instead of
 *    posting its own separate ledger pair.
 *  - Deposit/Withdrawal WITHOUT a match: posts against Owner's Equity /
 *    Drawings as a generic capital-in/out placeholder.
 */
export async function recordBankTransaction(
  db: SqlDb,
  input: RecordBankTransactionInput,
): Promise<RecordBankTransactionResult> {
  if (
    input.matchBusinessDataId &&
    input.transactionType !== "deposit" &&
    input.transactionType !== "withdrawal"
  ) {
    throw new Error(
      `matchBusinessDataId is only valid for 'deposit' or 'withdrawal', not '${input.transactionType}'.`,
    );
  }

  const { event, data } = await recordManualCapture(db, {
    businessId: input.businessId,
    domainHint: "banking",
    dataType: "bank_transaction",
    description: input.description,
    amount: input.amount,
    currency: input.currency,
    // Not semantically meaningful for a banking transaction (it IS the
    // cash movement, not a payment method for something else) -- fixed to
    // a valid enum value so the shared BusinessData schema is satisfied.
    paymentMethod: "bank_transfer",
  });

  if (input.transactionType === "transfer") {
    return { event, data, matched: false };
  }

  if (input.matchBusinessDataId) {
    await settleAgainstMatch(
      db,
      event.id,
      input.transactionType as "deposit" | "withdrawal",
      input.matchBusinessDataId,
      input.amount,
      input.currency,
    );
    return { event, data, matched: true };
  }

  const { debitAccount, creditAccount } = unmatchedLedgerAccounts(
    input.transactionType as "deposit" | "withdrawal" | "bank_fee",
  );
  await createLedgerEntries(db, [
    {
      businessDataId: data.id,
      account: debitAccount,
      direction: "debit",
      amount: input.amount,
      currency: input.currency,
    },
    {
      businessDataId: data.id,
      account: creditAccount,
      direction: "credit",
      amount: input.amount,
      currency: input.currency,
    },
  ]);

  return { event, data, matched: false };
}
