/**
 * Payment Vouchers, Expense & Cash Book/P&L — Sprint 30 (Vol 13_0 §6
 * Module C: Payment Voucher, plus §8's Cash Book / P&L pulled forward
 * for this module's own reporting needs).
 *
 * Mirrors quotationInvoiceTransport.ts / paymentsCreditNotesTransport.ts's
 * own shape in this same directory.
 *
 * TWO-POSTING-MOMENT NOTE (see the migration's own header note 6):
 * unlike CreditNote's single-step issuance (Sprint 29), a PaymentVoucher's
 * 'approved' status is authorization ONLY — no ledger entry is posted yet.
 * `markPaymentVoucherPaid` is a separate, explicit call (mirroring
 * Quotation's `markQuotationSent` self-reported-external-event pattern
 * from Sprint 28) that is what actually posts EXP-001 (debit the resolved
 * expense account, credit Cash/Bank 1000) and moves status to 'paid'.
 * A UI must not treat 'approved' as "money has left the business."
 *
 * EXPENSE CATEGORY NOTE (see the migration's own header note 3):
 * `expenseCategory` is a bare `chart_of_accounts.account_name` value
 * (e.g. 'Supplies'), not the PKA JSON's compound 'Operating
 * Expenses:Supplies' label — `createPaymentVoucher` resolves the posting
 * account by looking up (businessId, account_name) case-insensitively
 * among expense-type accounts, and rejects an unknown category at
 * creation time rather than letting it surface as a confusing failure
 * later at mark-paid time.
 *
 * DOCUMENTS NOTE (see the migration's own header note 1): `createDocument`
 * only records an opaque storage reference (`storageRef` + `contentType`)
 * — it does NOT perform any file upload. The client is responsible for
 * uploading the actual file to its own storage layer (e.g. Supabase
 * Storage) first and passing the resulting URI/path as `storageRef`.
 */

/** See supabaseTransport.ts's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type PaymentVoucherStatus = "draft" | "approved" | "rejected" | "paid";
export type PaymentVoucherPaymentMethod = "cash" | "bank_transfer" | "cheque";

/** Row shape of public.documents (Sprint 30, see header note 1). */
export interface DocumentRow {
  id: string;
  business_id: string;
  storage_ref: string;
  content_type: string | null;
  uploaded_by_membership_id: string | null;
  created_at: string;
}

export interface AifaDocument {
  id: string;
  businessId: string;
  storageRef: string;
  contentType: string | null;
  uploadedByMembershipId: string | null;
  createdAt: string;
}

function toDocument(row: DocumentRow): AifaDocument {
  return {
    id: row.id,
    businessId: row.business_id,
    storageRef: row.storage_ref,
    contentType: row.content_type,
    uploadedByMembershipId: row.uploaded_by_membership_id,
    createdAt: row.created_at,
  };
}

/** Row shape of public.payment_vouchers (Sprint 30, Vol 13_0 §6). */
export interface PaymentVoucherRow {
  id: string;
  business_id: string;
  pv_no: string;
  payee_party_id: string;
  status: PaymentVoucherStatus;
  expense_category: string;
  document_id_receipt: string | null;
  payment_method: PaymentVoucherPaymentMethod;
  issue_date: string;
  currency: string;
  grand_total: number;
  notes: string | null;
  captured_by_membership_id: string | null;
  created_at: string;
}

export interface PaymentVoucher {
  id: string;
  businessId: string;
  pvNo: string;
  payeePartyId: string;
  /** 'draft' until the linked ApprovalTask resolves — 'approved' (authorized, NOT yet posted) or 'rejected'. 'paid' only after markPaymentVoucherPaid. See this file's header. */
  status: PaymentVoucherStatus;
  expenseCategory: string;
  documentIdReceipt: string | null;
  paymentMethod: PaymentVoucherPaymentMethod;
  issueDate: string;
  currency: string;
  grandTotal: number;
  notes: string | null;
  capturedByMembershipId: string | null;
  createdAt: string;
}

function toPaymentVoucher(row: PaymentVoucherRow): PaymentVoucher {
  return {
    id: row.id,
    businessId: row.business_id,
    pvNo: row.pv_no,
    payeePartyId: row.payee_party_id,
    status: row.status,
    expenseCategory: row.expense_category,
    documentIdReceipt: row.document_id_receipt,
    paymentMethod: row.payment_method,
    issueDate: row.issue_date,
    currency: row.currency,
    grandTotal: row.grand_total,
    notes: row.notes,
    capturedByMembershipId: row.captured_by_membership_id,
    createdAt: row.created_at,
  };
}

/** One row of public.cash_book_detail's result. */
export interface CashBookEntryRow {
  entry_id: string;
  posted_at: string;
  direction: "debit" | "credit";
  amount: number;
  running_balance: number;
}

export interface CashBookEntry {
  entryId: string;
  postedAt: string;
  direction: "debit" | "credit";
  amount: number;
  runningBalance: number;
}

function toCashBookEntry(row: CashBookEntryRow): CashBookEntry {
  return {
    entryId: row.entry_id,
    postedAt: row.posted_at,
    direction: row.direction,
    amount: row.amount,
    runningBalance: row.running_balance,
  };
}

/** Row shape of public.profit_and_loss_summary's (single-row) result. */
export interface ProfitAndLossSummaryRow {
  total_revenue: number;
  total_expense: number;
  net_profit: number;
}

export interface ProfitAndLossSummary {
  totalRevenue: number;
  totalExpense: number;
  netProfit: number;
}

function toProfitAndLossSummary(row: ProfitAndLossSummaryRow): ProfitAndLossSummary {
  return {
    totalRevenue: row.total_revenue,
    totalExpense: row.total_expense,
    netProfit: row.net_profit,
  };
}

/** One row of public.expense_category_breakdown's result, already ranked highest-share first. */
export interface ExpenseCategoryBreakdownRow {
  account_code: string;
  account_name: string;
  amount: number;
  pct_of_total_expense: number;
}

export interface ExpenseCategoryBreakdownEntry {
  accountCode: string;
  accountName: string;
  amount: number;
  pctOfTotalExpense: number;
}

function toExpenseCategoryBreakdownEntry(
  row: ExpenseCategoryBreakdownRow,
): ExpenseCategoryBreakdownEntry {
  return {
    accountCode: row.account_code,
    accountName: row.account_name,
    amount: row.amount,
    pctOfTotalExpense: row.pct_of_total_expense,
  };
}

export interface SupabasePaymentVouchersReportsTransport {
  /**
   * `capture` on `expense` OR `configure` on `accounting_reports`.
   * Records an opaque storage reference for a file the client has
   * already uploaded elsewhere — this call does NOT upload anything
   * itself. See this file's header (DOCUMENTS NOTE).
   */
  createDocument(params: {
    businessId: string;
    storageRef: string;
    contentType?: string | null;
  }): Promise<AifaDocument>;

  /**
   * `capture` on `expense`. Rejects an unknown `expenseCategory` at
   * creation time (must match an existing expense-type
   * chart_of_accounts row's account_name, case-insensitively) rather
   * than surfacing that failure later at mark-paid time. Drafts the PV
   * and routes it through the real ApprovalTask engine (domain='expense')
   * — it stays 'draft' until that task resolves.
   */
  createPaymentVoucher(params: {
    businessId: string;
    payeePartyId: string;
    expenseCategory: string;
    paymentMethod: PaymentVoucherPaymentMethod;
    grandTotal: number;
    notes?: string | null;
    documentIdReceipt?: string | null;
    aiDraftSummary?: string | null;
    autoApproved?: boolean;
  }): Promise<PaymentVoucher>;

  /**
   * `capture` on `expense`. Not restricted by approval status — a
   * receipt is evidentiary, not a financial mutation, so it can be
   * attached or replaced at any point in the PV's lifecycle.
   */
  attachPaymentVoucherReceipt(params: {
    paymentVoucherId: string;
    documentId: string;
  }): Promise<PaymentVoucher>;

  /**
   * `capture` on `expense` OR `configure` on `accounting_reports`
   * (covering both whoever raised the PV and a Bookkeeper reconciling
   * later). Throws `payment_voucher_not_approved` unless the PV is
   * currently 'approved'. This is the ONLY call that posts EXP-001 to
   * the ledger (debit the resolved expense account, credit Cash/Bank
   * 1000) — approval alone never does. See this file's header.
   */
  markPaymentVoucherPaid(paymentVoucherId: string): Promise<PaymentVoucher>;

  /**
   * `view` on `accounting_reports`. A bank-account-filtered ledger
   * view with a running balance seeded from the account's own
   * opening_balance plus all movement before `dateFrom` (Vol 13_0 §8,
   * minimal — full Bank Reconciliation is Sprint 32). Results are in
   * posted_at order.
   */
  cashBookDetail(params: {
    businessId: string;
    bankAccountId: string;
    dateFrom: string;
    dateTo: string;
  }): Promise<CashBookEntry[]>;

  /**
   * `view` on `accounting_reports`. A read model over the chart of
   * accounts (no new schema beyond what Sprint 26/28/29 already post
   * to) — total revenue and expense actually posted in the given
   * date range, and the resulting net profit.
   */
  profitAndLossSummary(params: {
    businessId: string;
    dateFrom: string;
    dateTo: string;
  }): Promise<ProfitAndLossSummary>;

  /**
   * `view` on `accounting_reports`. Cost/expense percentage breakdown
   * by category (Vol 13_0 §6's explicit "peratusan kos ... paling
   * tinggi" requirement), ranked highest-amount-first. Only includes
   * categories with nonzero net expense in the given date range.
   */
  expenseCategoryBreakdown(params: {
    businessId: string;
    dateFrom: string;
    dateTo: string;
  }): Promise<ExpenseCategoryBreakdownEntry[]>;
}

export function createSupabasePaymentVouchersReportsTransport(
  client: SupabaseClientLike,
): SupabasePaymentVouchersReportsTransport {
  return {
    async createDocument(params) {
      const { data, error } = await client.rpc("create_document", {
        p_business_id: params.businessId,
        p_storage_ref: params.storageRef,
        p_content_type: params.contentType ?? null,
      });
      if (error) throw error;
      return toDocument(data as DocumentRow);
    },

    async createPaymentVoucher(params) {
      const { data, error } = await client.rpc("create_payment_voucher", {
        p_business_id: params.businessId,
        p_payee_party_id: params.payeePartyId,
        p_expense_category: params.expenseCategory,
        p_payment_method: params.paymentMethod,
        p_grand_total: params.grandTotal,
        p_notes: params.notes ?? null,
        p_document_id_receipt: params.documentIdReceipt ?? null,
        p_ai_draft_summary: params.aiDraftSummary ?? null,
        p_auto_approved: params.autoApproved ?? false,
      });
      if (error) throw error;
      return toPaymentVoucher(data as PaymentVoucherRow);
    },

    async attachPaymentVoucherReceipt(params) {
      const { data, error } = await client.rpc("attach_payment_voucher_receipt", {
        p_payment_voucher_id: params.paymentVoucherId,
        p_document_id: params.documentId,
      });
      if (error) throw error;
      return toPaymentVoucher(data as PaymentVoucherRow);
    },

    async markPaymentVoucherPaid(paymentVoucherId) {
      const { data, error } = await client.rpc("mark_payment_voucher_paid", {
        p_payment_voucher_id: paymentVoucherId,
      });
      if (error) throw error;
      return toPaymentVoucher(data as PaymentVoucherRow);
    },

    async cashBookDetail(params) {
      const { data, error } = await client.rpc("cash_book_detail", {
        p_business_id: params.businessId,
        p_bank_account_id: params.bankAccountId,
        p_date_from: params.dateFrom,
        p_date_to: params.dateTo,
      });
      if (error) throw error;
      return (data as CashBookEntryRow[]).map(toCashBookEntry);
    },

    async profitAndLossSummary(params) {
      const { data, error } = await client.rpc("profit_and_loss_summary", {
        p_business_id: params.businessId,
        p_date_from: params.dateFrom,
        p_date_to: params.dateTo,
      });
      if (error) throw error;
      // Postgres RETURNS TABLE functions come back as an array even for a single logical row.
      const rows = data as ProfitAndLossSummaryRow[];
      return toProfitAndLossSummary(rows[0]);
    },

    async expenseCategoryBreakdown(params) {
      const { data, error } = await client.rpc("expense_category_breakdown", {
        p_business_id: params.businessId,
        p_date_from: params.dateFrom,
        p_date_to: params.dateTo,
      });
      if (error) throw error;
      return (data as ExpenseCategoryBreakdownRow[]).map(toExpenseCategoryBreakdownEntry);
    },
  };
}
