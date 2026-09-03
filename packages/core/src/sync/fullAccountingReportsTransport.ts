/**
 * Full Accounting Reports & Bank Reconciliation — Sprint 32 (Vol 13_0
 * §8 Module E: Laporan Akaun, the remainder not covered by Sprint 30's
 * Cash Book/P&L). Closes Sub-phase 3c.
 *
 * Mirrors paymentVouchersReportsTransport.ts / inventoryDeliveryTransport.ts's
 * own shape in this same directory.
 *
 * BALANCE SHEET NOTE (see the migration's own header note 2):
 * `balanceSheetSummary`'s three totals do NOT satisfy
 * assets = liabilities + equity for any business with posted revenue
 * or expense activity — there is no period-closing/retained-earnings
 * mechanism anywhere in this schema yet that rolls net profit into
 * Equity. Only Trial Balance's own sum(totalDebit) == sum(totalCredit)
 * identity is a guaranteed invariant. Do not build a UI that asserts
 * or silently assumes the Balance Sheet balances.
 *
 * TAX REPORT NOTE: `taxReportPlaceholder` is exactly that — every
 * figure is null and `note` explains SST/e-Invoice data isn't wired
 * yet (Sprint 33). Do not render its null figures as real zeros.
 */

/** See supabaseTransport.ts's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type BankStatementLineMatchStatus = "unmatched" | "matched" | "ignored";

/** One row of public.trial_balance's result. */
export interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_type: string;
  total_debit: number;
  total_credit: number;
  balance: number;
}

export interface TrialBalanceEntry {
  accountCode: string;
  accountName: string;
  accountType: string;
  totalDebit: number;
  totalCredit: number;
  /** totalDebit - totalCredit. */
  balance: number;
}

function toTrialBalanceEntry(row: TrialBalanceRow): TrialBalanceEntry {
  return {
    accountCode: row.account_code,
    accountName: row.account_name,
    accountType: row.account_type,
    totalDebit: row.total_debit,
    totalCredit: row.total_credit,
    balance: row.balance,
  };
}

/** Row shape of public.balance_sheet_summary's (single-row) result. */
export interface BalanceSheetSummaryRow {
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
}

export interface BalanceSheetSummary {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

function toBalanceSheetSummary(row: BalanceSheetSummaryRow): BalanceSheetSummary {
  return {
    totalAssets: row.total_assets,
    totalLiabilities: row.total_liabilities,
    totalEquity: row.total_equity,
  };
}

/** One row of public.general_ledger_detail's result. */
export interface GeneralLedgerEntryRow {
  entry_id: string;
  posted_at: string;
  direction: "debit" | "credit";
  amount: number;
  running_balance: number;
}

export interface GeneralLedgerEntry {
  entryId: string;
  postedAt: string;
  direction: "debit" | "credit";
  amount: number;
  runningBalance: number;
}

function toGeneralLedgerEntry(row: GeneralLedgerEntryRow): GeneralLedgerEntry {
  return {
    entryId: row.entry_id,
    postedAt: row.posted_at,
    direction: row.direction,
    amount: row.amount,
    runningBalance: row.running_balance,
  };
}

/** One row of public.stock_report's result. */
export interface StockReportRow {
  product_id: string;
  sku: string | null;
  product_name: string;
  warehouse_id: string;
  quantity_on_hand: number;
  unit_cost: number | null;
  valuation: number;
}

export interface StockReportEntry {
  productId: string;
  sku: string | null;
  productName: string;
  warehouseId: string;
  quantityOnHand: number;
  /** Product.default_cost — see this file's header on why this is not real weighted-average cost yet. */
  unitCost: number | null;
  valuation: number;
}

function toStockReportEntry(row: StockReportRow): StockReportEntry {
  return {
    productId: row.product_id,
    sku: row.sku,
    productName: row.product_name,
    warehouseId: row.warehouse_id,
    quantityOnHand: row.quantity_on_hand,
    unitCost: row.unit_cost,
    valuation: row.valuation,
  };
}

/** Row shape of public.tax_report_placeholder's (single-row) result. See this file's header (TAX REPORT NOTE). */
export interface TaxReportPlaceholderRow {
  date_from: string;
  date_to: string;
  output_tax_sst: number | null;
  input_tax_sst: number | null;
  note: string;
}

export interface TaxReportPlaceholder {
  dateFrom: string;
  dateTo: string;
  outputTaxSst: number | null;
  inputTaxSst: number | null;
  note: string;
}

function toTaxReportPlaceholder(row: TaxReportPlaceholderRow): TaxReportPlaceholder {
  return {
    dateFrom: row.date_from,
    dateTo: row.date_to,
    outputTaxSst: row.output_tax_sst,
    inputTaxSst: row.input_tax_sst,
    note: row.note,
  };
}

/** Row shape of public.bank_statement_lines. */
export interface BankStatementLineRow {
  id: string;
  bank_account_id: string;
  statement_date: string;
  description: string | null;
  amount: number;
  matched_ledger_entry_id: string | null;
  match_status: BankStatementLineMatchStatus;
  created_at: string;
}

export interface BankStatementLine {
  id: string;
  bankAccountId: string;
  statementDate: string;
  description: string | null;
  amount: number;
  matchedLedgerEntryId: string | null;
  matchStatus: BankStatementLineMatchStatus;
  createdAt: string;
}

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

export interface BankStatementLineInput {
  statementDate: string;
  description?: string | null;
  amount: number;
}

export interface SupabaseFullAccountingReportsTransport {
  /**
   * `view` on `accounting_reports`. Per-account debit/credit totals as
   * of the given date; sum(totalDebit) across every returned row
   * always equals sum(totalCredit) — a mechanical property of every
   * ledger entry being posted as a balanced pair, not something this
   * call computes specially.
   */
  trialBalance(params: { businessId: string; asOfDate: string }): Promise<TrialBalanceEntry[]>;

  /**
   * `view` on `accounting_reports`. See this file's header (BALANCE
   * SHEET NOTE) — the three totals do not satisfy the accounting
   * identity for a business with any revenue/expense activity.
   */
  balanceSheetSummary(params: { businessId: string; asOfDate: string }): Promise<BalanceSheetSummary>;

  /**
   * `view` on `accounting_reports`. Per-account ledger detail with a
   * running balance seeded from all activity before `dateFrom` (same
   * "true opening balance" computation as `cashBookDetail` from
   * Sprint 30, just with no separate bank-account opening_balance
   * offset to add — chart_of_accounts has none).
   */
  generalLedgerDetail(params: {
    businessId: string;
    accountId: string;
    dateFrom: string;
    dateTo: string;
  }): Promise<GeneralLedgerEntry[]>;

  /**
   * `view` on `inventory`. Current stock position (Sprint 31 data),
   * valued at each product's `default_cost` — see this file's header
   * on why this is not real weighted-average costing yet. Omit
   * `warehouseId` to see every warehouse.
   */
  stockReport(params: { businessId: string; warehouseId?: string | null }): Promise<StockReportEntry[]>;

  /**
   * `view` on `tax_compliance`. See this file's header (TAX REPORT
   * NOTE) — a placeholder shape only.
   */
  taxReportPlaceholder(params: {
    businessId: string;
    dateFrom: string;
    dateTo: string;
  }): Promise<TaxReportPlaceholder>;

  /**
   * `configure` on `accounting_reports`. Bulk-inserts statement lines
   * for a bank account, all starting 'unmatched'.
   */
  importBankStatementLines(params: {
    bankAccountId: string;
    lines: BankStatementLineInput[];
  }): Promise<BankStatementLine[]>;

  /**
   * `configure` on `accounting_reports`. Links an 'unmatched'
   * statement line to a ledger entry on the SAME chart-of-accounts row
   * as the bank account, moving it to 'matched'. Throws if the ledger
   * entry belongs to a different account, is already claimed by
   * another statement line, or the statement line isn't 'unmatched'.
   */
  matchBankStatementLine(params: {
    statementLineId: string;
    ledgerEntryId: string;
  }): Promise<BankStatementLine>;

  /**
   * `configure` on `accounting_reports`. Moves an 'unmatched'
   * statement line to 'ignored' (e.g. a bank fee with no ledger
   * counterpart). Throws if the line isn't currently 'unmatched'.
   */
  ignoreBankStatementLine(statementLineId: string): Promise<BankStatementLine>;
}

export function createSupabaseFullAccountingReportsTransport(
  client: SupabaseClientLike,
): SupabaseFullAccountingReportsTransport {
  return {
    async trialBalance(params) {
      const { data, error } = await client.rpc("trial_balance", {
        p_business_id: params.businessId,
        p_as_of_date: params.asOfDate,
      });
      if (error) throw error;
      return (data as TrialBalanceRow[]).map(toTrialBalanceEntry);
    },

    async balanceSheetSummary(params) {
      const { data, error } = await client.rpc("balance_sheet_summary", {
        p_business_id: params.businessId,
        p_as_of_date: params.asOfDate,
      });
      if (error) throw error;
      const rows = data as BalanceSheetSummaryRow[];
      return toBalanceSheetSummary(rows[0]);
    },

    async generalLedgerDetail(params) {
      const { data, error } = await client.rpc("general_ledger_detail", {
        p_business_id: params.businessId,
        p_account_id: params.accountId,
        p_date_from: params.dateFrom,
        p_date_to: params.dateTo,
      });
      if (error) throw error;
      return (data as GeneralLedgerEntryRow[]).map(toGeneralLedgerEntry);
    },

    async stockReport(params) {
      const { data, error } = await client.rpc("stock_report", {
        p_business_id: params.businessId,
        p_warehouse_id: params.warehouseId ?? null,
      });
      if (error) throw error;
      return (data as StockReportRow[]).map(toStockReportEntry);
    },

    async taxReportPlaceholder(params) {
      const { data, error } = await client.rpc("tax_report_placeholder", {
        p_business_id: params.businessId,
        p_date_from: params.dateFrom,
        p_date_to: params.dateTo,
      });
      if (error) throw error;
      const rows = data as TaxReportPlaceholderRow[];
      return toTaxReportPlaceholder(rows[0]);
    },

    async importBankStatementLines(params) {
      const { data, error } = await client.rpc("import_bank_statement_lines", {
        p_bank_account_id: params.bankAccountId,
        p_lines: params.lines.map((l) => ({
          statement_date: l.statementDate,
          description: l.description ?? null,
          amount: l.amount,
        })),
      });
      if (error) throw error;
      return (data as BankStatementLineRow[]).map(toBankStatementLine);
    },

    async matchBankStatementLine(params) {
      const { data, error } = await client.rpc("match_bank_statement_line", {
        p_statement_line_id: params.statementLineId,
        p_ledger_entry_id: params.ledgerEntryId,
      });
      if (error) throw error;
      return toBankStatementLine(data as BankStatementLineRow);
    },

    async ignoreBankStatementLine(statementLineId) {
      const { data, error } = await client.rpc("ignore_bank_statement_line", {
        p_statement_line_id: statementLineId,
      });
      if (error) throw error;
      return toBankStatementLine(data as BankStatementLineRow);
    },
  };
}
