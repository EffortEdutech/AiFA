/**
 * Dashboard financial summary — Vol 7_3 §2 (cash position, money in/out
 * trend; Sprint 4), Vol 6_1 §5 / Vol 6_2 §5 (outstanding receivables /
 * payables; Sprint 6), Vol 4_1 (Financial Data is the substrate this
 * reads). Computed entirely from local ledger_entries + business_data; no
 * network round-trip (Vol 7_3 §4).
 */
import {
  ACCOUNTS_PAYABLE_ACCOUNT,
  ACCOUNTS_RECEIVABLE_ACCOUNT,
  CASH_BANK_ACCOUNT,
} from "./accounts";
import type { SqlDb } from "./types";

export interface CashPositionSummary {
  /** Net Cash/Bank balance from all recorded ledger activity to date. */
  cashPosition: number;
  /** Cash/Bank debits (money received) in the trailing `trendDays`. */
  moneyIn: number;
  /** Cash/Bank credits (money paid out) in the trailing `trendDays`. */
  moneyOut: number;
  trendDays: number;
  /**
   * Phase 1 does not do currency conversion (Vol 4_1 §6 notes multi-currency
   * as a forward-looking concern) — this is the currency of the most
   * recent Cash/Bank posting, or the given default if there is none yet.
   * If a business mixes currencies without conversion, these totals are
   * not meaningful across currencies; that limitation is accepted for
   * Phase 1's single-currency SME target and should be revisited before
   * multi-currency support is claimed.
   */
  currency: string;
}

interface DirectionTotal {
  direction: "debit" | "credit";
  total: number | null;
}

function sumByDirection(
  rows: DirectionTotal[],
  direction: "debit" | "credit",
): number {
  return rows.find((r) => r.direction === direction)?.total ?? 0;
}

export async function getCashPositionSummary(
  db: SqlDb,
  options?: { trendDays?: number; defaultCurrency?: string },
): Promise<CashPositionSummary> {
  const trendDays = options?.trendDays ?? 30;
  const defaultCurrency = options?.defaultCurrency ?? "MYR";

  const allTimeRows = await db.queryAll<DirectionTotal>(
    `SELECT direction, SUM(amount) as total FROM ledger_entries WHERE account = ? GROUP BY direction;`,
    [CASH_BANK_ACCOUNT],
  );
  const cashPosition =
    sumByDirection(allTimeRows, "debit") -
    sumByDirection(allTimeRows, "credit");

  const cutoffIso = new Date(
    Date.now() - trendDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const trendRows = await db.queryAll<DirectionTotal>(
    `SELECT direction, SUM(amount) as total FROM ledger_entries WHERE account = ? AND posted_at >= ? GROUP BY direction;`,
    [CASH_BANK_ACCOUNT, cutoffIso],
  );

  const latestCurrencyRows = await db.queryAll<{ currency: string }>(
    `SELECT currency FROM ledger_entries WHERE account = ? ORDER BY posted_at DESC LIMIT 1;`,
    [CASH_BANK_ACCOUNT],
  );

  return {
    cashPosition,
    moneyIn: sumByDirection(trendRows, "debit"),
    moneyOut: sumByDirection(trendRows, "credit"),
    trendDays,
    currency: latestCurrencyRows[0]?.currency ?? defaultCurrency,
  };
}

export interface OutstandingItem {
  businessDataId: string;
  businessEventId: string;
  counterpartyName: string | null;
  description: string | null;
  amount: number;
  currency: string;
  capturedAt: string;
}

/**
 * Rows whose net balance on `account` is still outstanding (net debit > 0
 * for receivables, net credit > 0 for payables — see the two exported
 * wrappers below), scoped to a single BusinessData/account pair via
 * GROUP BY + HAVING rather than a per-row correlated SUM, so a corrected
 * (reversed) sale/purchase nets to zero and drops out automatically —
 * reusing the same reversal invariant Sprint 4's cash-position query
 * relies on (Vol 4_1 §4).
 *
 * Phase 1 gap (documented in accounting_rules.json's limitations): there
 * is no Payment-Received/partial-settlement posting yet (that requires the
 * Banking domain, Sprint 7), so this always reflects the FULL original
 * amount, not a partially-paid remainder. Honest for what Sprint 6 built,
 * not yet what Vol 6_1 §5 / Vol 6_2 §5 describe as the long-run target.
 */
async function getOutstandingByAccount(
  db: SqlDb,
  businessId: string,
  dataType: "sale" | "purchase",
  account: string,
  netDirection: "debit" | "credit",
): Promise<OutstandingItem[]> {
  const debitSign = netDirection === "debit" ? 1 : -1;
  const rows = await db.queryAll<{
    business_data_id: string;
    business_event_id: string;
    counterparty_name: string | null;
    description: string | null;
    amount: number;
    currency: string;
    captured_at: string;
    net_balance: number;
  }>(
    `SELECT
       bd.id as business_data_id,
       bd.business_event_id as business_event_id,
       bd.counterparty_name as counterparty_name,
       be.raw_input_ref as description,
       bd.amount as amount,
       bd.currency as currency,
       be.captured_at as captured_at,
       SUM(CASE WHEN le.direction = 'debit' THEN le.amount ELSE -le.amount END) * ? as net_balance
     FROM business_data bd
     JOIN business_events be ON be.id = bd.business_event_id
     JOIN ledger_entries le ON le.business_data_id = bd.id AND le.account = ?
     WHERE be.business_id = ? AND bd.type = ?
     GROUP BY bd.id
     HAVING net_balance > 0
     ORDER BY be.captured_at DESC;`,
    [debitSign, account, businessId, dataType],
  );

  return rows.map((row) => ({
    businessDataId: row.business_data_id,
    businessEventId: row.business_event_id,
    counterpartyName: row.counterparty_name,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    capturedAt: row.captured_at,
  }));
}

/** Sales captured on credit (payment_method 'unspecified') whose Accounts Receivable posting has not been reversed/corrected — Vol 6_1 §5. */
export async function getOutstandingReceivables(
  db: SqlDb,
  businessId: string,
): Promise<OutstandingItem[]> {
  return getOutstandingByAccount(
    db,
    businessId,
    "sale",
    ACCOUNTS_RECEIVABLE_ACCOUNT,
    "debit",
  );
}

/** Purchases captured on credit (payment_method 'unspecified') whose Accounts Payable posting has not been reversed/corrected — Vol 6_2 §5. */
export async function getOutstandingPayables(
  db: SqlDb,
  businessId: string,
): Promise<OutstandingItem[]> {
  return getOutstandingByAccount(
    db,
    businessId,
    "purchase",
    ACCOUNTS_PAYABLE_ACCOUNT,
    "credit",
  );
}
